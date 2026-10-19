import * as oauth from "oauth4webapi"
import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { rm } from "node:fs/promises"
import { z } from "zod"
import {
  credentialPath,
  readCredentials,
  saveCredentials,
  secureUrl,
  withCredentialLock,
} from "./config.mjs"

/** @param {string} origin @param {AbortSignal} [signal] */
function requestOptions(origin, signal) {
  return {
    [oauth.allowInsecureRequests]: new URL(origin).protocol === "http:",
    signal: AbortSignal.any([
      AbortSignal.timeout(15_000),
      ...(signal ? [signal] : []),
    ]),
  }
}

/** @param {string} origin @param {AbortSignal} [signal] */
async function discover(origin, signal) {
  const resource = new URL("/api", origin)
  const issuer = new URL("/api/auth", origin)
  const metadata = await oauth.processResourceDiscoveryResponse(
    resource,
    await oauth.resourceDiscoveryRequest(
      resource,
      requestOptions(origin, signal)
    )
  )
  if (!metadata.authorization_servers?.includes(issuer.href))
    throw new Error("Resource metadata does not advertise the expected issuer")
  const as = await oauth.processDiscoveryResponse(
    issuer,
    await oauth.discoveryRequest(issuer, {
      ...requestOptions(origin, signal),
      algorithm: "oauth2",
    })
  )
  for (const endpoint of [
    as.authorization_endpoint,
    as.token_endpoint,
    as.registration_endpoint,
    as.revocation_endpoint,
  ]) {
    if (endpoint) secureUrl(endpoint)
  }
  if (!as.authorization_endpoint || !as.token_endpoint)
    throw new Error("Authorization metadata is incomplete")
  if (!as.code_challenge_methods_supported?.includes("S256"))
    throw new Error("Authorization server must support S256 PKCE")
  return {
    as,
    resource: resource.href,
    authorizationEndpoint: as.authorization_endpoint,
  }
}

/** @param {URL} url */
async function launchBrowser(url) {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url.href]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url.href]]
        : ["xdg-open", [url.href]]
  const child = spawn(command, args, { detached: true, stdio: "ignore" })
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve)
    child.once("error", reject)
  })
  child.unref()
}

/** @param {oauth.TokenEndpointResponse} response @param {string | undefined} previousRefresh */
function tokenRecord(response, previousRefresh) {
  if (response.token_type.toLowerCase() !== "bearer")
    throw new Error("Only bearer tokens are supported")
  if (response.scope && !response.scope.split(" ").includes("tools"))
    throw new Error("Authorization did not grant the tools scope")
  return {
    access_token: response.access_token,
    refresh_token: response.refresh_token ?? previousRefresh,
    expires_at: Date.now() + (response.expires_in ?? 300) * 1000,
    scope: response.scope,
  }
}

/** @param {string} origin @param {{noBrowser?: boolean}} options */
export async function login(origin, options) {
  const path = credentialPath(origin)
  const { as, resource, authorizationEndpoint } = await discover(origin)
  const verifier = oauth.generateRandomCodeVerifier()
  const challenge = await oauth.calculatePKCECodeChallenge(verifier)
  const state = oauth.generateRandomState()
  /** @type {oauth.Client | undefined} */
  let client
  /** @type {PromiseWithResolvers<URLSearchParams>} */
  const { promise: callback, resolve: accept, reject } = Promise.withResolvers()
  void callback.catch(() => {})
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1")
    if (
      request.method !== "GET" ||
      url.pathname !== "/callback" ||
      request.headers.host !== new URL(redirect).host
    ) {
      response.writeHead(404).end()
      return
    }
    try {
      if (!client) throw new Error("OAuth client is not registered")
      const parameters = oauth.validateAuthResponse(as, client, url, state)
      response
        .writeHead(200, {
          "Content-Type": "text/plain",
          "Cache-Control": "no-store",
        })
        .end("Signed in. You can close this window.")
      accept(parameters)
    } catch (error) {
      response
        .writeHead(400, { "Content-Type": "text/plain" })
        .end("Invalid authorization response.")
      reject(
        new Error(
          "Invalid OAuth callback state, issuer, or authorization response",
          { cause: error }
        )
      )
    }
  })
  const timeoutMs = z.coerce
    .number()
    .int()
    .positive()
    .max(600_000)
    .parse(process.env.TOOLS_LOGIN_TIMEOUT_MS || 180_000)
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer
  let redirect = ""
  try {
    await new Promise((resolve, fail) => {
      server.once("error", fail)
      server.listen(0, "127.0.0.1", () => resolve(undefined))
    })
    const address = server.address()
    if (!address || typeof address === "string")
      throw new Error("Could not open loopback callback")
    redirect = `http://127.0.0.1:${address.port}/callback`
    const registered = await oauth.processDynamicClientRegistrationResponse(
      await oauth.dynamicClientRegistrationRequest(
        as,
        {
          client_name: "Matthieu tools CLI",
          application_type: "native",
          token_endpoint_auth_method: "none",
          redirect_uris: [redirect],
          response_types: ["code"],
          grant_types: ["authorization_code", "refresh_token"],
          scope: "tools offline_access",
        },
        requestOptions(origin)
      )
    )
    client = {
      client_id: registered.client_id,
      redirect_uris: [redirect],
      token_endpoint_auth_method: "none",
    }
    const authorize = new URL(authorizationEndpoint)
    authorize.search = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: redirect,
      response_type: "code",
      scope: "tools offline_access",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource,
    }).toString()
    timer = setTimeout(
      () => reject(new Error("OAuth login timed out")),
      timeoutMs
    )
    process.stderr.write(`Open this URL to sign in:\n${authorize.href}\n`)
    if (!options.noBrowser) await launchBrowser(authorize)
    const parameters = await callback
    const response = await oauth.authorizationCodeGrantRequest(
      as,
      client,
      oauth.None(),
      parameters,
      redirect,
      verifier,
      {
        ...requestOptions(origin),
        additionalParameters: { resource },
      }
    )
    const tokens = tokenRecord(
      await oauth.processAuthorizationCodeResponse(as, client, response),
      undefined
    )
    /** @type {import('./config.mjs').Credentials} */
    const credentials = {
      origin,
      issuer: as.issuer,
      resource,
      client: {
        client_id: client.client_id,
        redirect_uris: [redirect],
        token_endpoint_auth_method: "none",
      },
      tokens,
    }
    await withCredentialLock(path, () => saveCredentials(path, credentials))
    return { authenticated: true, origin }
  } finally {
    clearTimeout(timer)
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

/** @param {string} origin */
export async function accessToken(origin) {
  if (process.env.TOOLS_TOKEN) return process.env.TOOLS_TOKEN
  const path = credentialPath(origin)
  return withCredentialLock(path, async (signal) => {
    const credentials = await readCredentials(path)
    if (
      !credentials ||
      credentials.origin !== origin ||
      credentials.resource !== `${origin}/api` ||
      credentials.issuer !== `${origin}/api/auth`
    )
      throw new Error("Run tools login or set TOOLS_TOKEN")
    if (credentials.refreshPending)
      throw new Error("A refresh was interrupted; run tools login again")
    if (credentials.tokens.expires_at > Date.now() + 30_000)
      return credentials.tokens.access_token
    if (!credentials.tokens.refresh_token)
      throw new Error("Session expired; run tools login again")
    const { as, resource } = await discover(origin, signal)
    await saveCredentials(path, { ...credentials, refreshPending: true })
    const response = await oauth.refreshTokenGrantRequest(
      as,
      credentials.client,
      oauth.None(),
      credentials.tokens.refresh_token,
      {
        ...requestOptions(origin, signal),
        additionalParameters: { resource },
      }
    )
    const tokens = tokenRecord(
      await oauth.processRefreshTokenResponse(as, credentials.client, response),
      credentials.tokens.refresh_token
    )
    await saveCredentials(path, {
      ...credentials,
      tokens,
      refreshPending: false,
    })
    return tokens.access_token
  })
}

/** @param {string} origin */
export async function logout(origin) {
  const path = credentialPath(origin)
  return withCredentialLock(path, async (signal) => {
    const credentials = await readCredentials(path)
    try {
      if (credentials) {
        const { as } = await discover(origin, signal)
        if (as.revocation_endpoint) {
          for (const token of new Set([
            credentials.tokens.refresh_token,
            credentials.tokens.access_token,
          ])) {
            if (token)
              await oauth.processRevocationResponse(
                await oauth.revocationRequest(
                  as,
                  credentials.client,
                  oauth.None(),
                  token,
                  requestOptions(origin, signal)
                )
              )
          }
        }
      }
    } finally {
      await rm(path, { force: true })
    }
    return { authenticated: false, origin }
  })
}
