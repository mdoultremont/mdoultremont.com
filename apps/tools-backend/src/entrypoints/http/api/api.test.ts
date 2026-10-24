import { spawn } from "node:child_process"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { createServer, get, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  Client,
  type OAuthClientInformationMixed,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthTokens,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from "@modelcontextprotocol/client"
import { Effect } from "effect"
import { actionRegistry } from "#backend/entrypoints/actions"
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vitest"

/** The site is served on a free port of its own, which BETTER_AUTH_URL names. */
await vi.hoisted(async () => {
  const { execFileSync } = await import("node:child_process")
  const port = execFileSync(process.execPath, [
    "-e",
    "const s=require('node:net').createServer().listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})",
  ]).toString()
  process.env.TOOLS_TEST_ORIGIN = `http://127.0.0.1:${port}`
})
const workerEnv = vi.hoisted(() => ({}) as Record<string, unknown>)
vi.mock("cloudflare:workers", () => ({ env: workerEnv }))

import { handleAuthRequest } from "../auth.server"
import {
  answerConsent,
  connect,
  origin,
  restoreGlobals,
  setup as setupOAuth,
  stubGitHub,
} from "../oauth/testing"
import { createToolsFetch } from "."

const cli = fileURLToPath(
  new URL("../../../../../tools-cli/src/cli.mjs", import.meta.url)
)
const wing = { kind: "wing", name: "Zeno 2", notes: "", retired: false }

/** The tools Worker's fetch, with Better Auth standing in for the TanStack routes. */
const site = createToolsFetch((request) =>
  new URL(request.url).pathname.startsWith("/api/auth/")
    ? handleAuthRequest(request)
    : new Response("Not found", { status: 404 })
)

/** Serves `site` over real HTTP at `origin`, for the CLI and MCP SDK. */
let server: Server
beforeAll(async () => {
  server = createServer(async (incoming, outgoing) => {
    const chunks: Array<Buffer> = []
    for await (const chunk of incoming) chunks.push(chunk as Buffer)
    const headers = new Headers()
    for (const [name, value] of Object.entries(incoming.headers))
      for (const item of [value ?? []].flat()) headers.append(name, item)
    const method = incoming.method ?? "GET"
    const response = await site(
      new Request(new URL(incoming.url ?? "/", origin), {
        method,
        headers,
        ...(method === "GET" || method === "HEAD"
          ? {}
          : { body: Buffer.concat(chunks) }),
      })
    )
    const sent: Array<[string, string]> = []
    response.headers.forEach((value, name) => {
      if (name !== "set-cookie") sent.push([name, value])
    })
    for (const cookie of response.headers.getSetCookie())
      sent.push(["set-cookie", cookie])
    outgoing.writeHead(response.status, sent.flat())
    if (response.body)
      for await (const chunk of response.body) outgoing.write(chunk)
    outgoing.end()
  })
  const { port } = new URL(origin)
  await new Promise<void>((resolve) =>
    server.listen(Number(port), "127.0.0.1", resolve)
  )
})
afterAll(async () => {
  delete process.env.TOOLS_TEST_ORIGIN
  await new Promise((resolve) => server.close(resolve))
})

let configDir: string
const setup = async () => {
  stubGitHub(42)
  const t = setupOAuth(workerEnv)
  configDir = await mkdtemp(join(tmpdir(), "tools-cli-"))
  const { cookie } = await Effect.runPromise(connect)
  const userId = String(
    t.d1.sqlite.prepare("SELECT id FROM auth_users").get()?.id
  )
  const equipment = () =>
    Number(
      t.d1.sqlite.prepare("SELECT count(*) AS count FROM equipment").get()
        ?.count
    )
  return { ...t, cookie, userId, equipment }
}
afterEach(async () => {
  restoreGlobals()
  await rm(configDir, { recursive: true, force: true })
})

/**
 * A top-level browser navigation. Node's `fetch` always sends
 * `Sec-Fetch-Mode: cors`, which Better Auth answers with JSON instead of a
 * redirect, so this uses `node:http`.
 */
const navigate = (url: string, cookie: string) =>
  new Promise<{ status: number; location: string | undefined }>(
    (resolve, reject) =>
      get(
        url,
        {
          headers: {
            Accept: "text/html",
            Cookie: cookie,
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
          },
        },
        (response) => {
          response.resume()
          resolve({
            status: response.statusCode ?? 0,
            location: response.headers.location,
          })
        }
      ).once("error", reject)
  )

/**
 * The user's browser: follows an authorization URL with the signed-in cookie
 * and accepts the consent page if the client has none yet. Resolves to the
 * client's callback URL.
 */
const authorizeInBrowser = async (authorization: string, cookie: string) => {
  const response = await navigate(authorization, cookie)
  expect(response.status).toBe(302)
  const next = new URL(response.location ?? "", origin)
  return next.pathname === "/oauth/consent"
    ? Effect.runPromise(answerConsent(next, cookie, true))
    : next
}

interface Run {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

/** Runs the tools CLI against the site; `onStderr` sees its output as it comes. */
const runCli = (
  args: ReadonlyArray<string>,
  options: {
    env?: Record<string, string>
    onStderr?: (text: string) => void
  } = {}
) =>
  new Promise<Run>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "--url", origin, ...args], {
      env: { ...process.env, TOOLS_CONFIG_DIR: configDir, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => (stdout += chunk))
    child.stderr.on("data", (chunk) => {
      stderr += chunk
      options.onStderr?.(stderr)
    })
    child.once("error", reject)
    child.once("close", (code) => resolve({ code, stdout, stderr }))
  })

/** `tools login --no-browser`, with the browser part done by `authorizeInBrowser`. */
const cliLogin = async (cookie: string) => {
  let opened: Promise<void> | undefined
  const run = await runCli(["login", "--no-browser"], {
    onStderr: (text) => {
      const url = /^(http:\/\/\S+\/oauth2\/authorize\S*)$/m.exec(text)?.[1]
      if (url === undefined || opened !== undefined) return
      opened = (async () => {
        const callback = await authorizeInBrowser(url, cookie)
        expect((await fetch(callback)).status).toBe(200)
      })()
    },
  })
  await opened
  expect({ code: run.code, stderr: run.stderr }).toMatchObject({ code: 0 })
  const [file] = await readdir(configDir)
  const stored = JSON.parse(await readFile(join(configDir, file ?? ""), "utf8"))
  return {
    clientId: String(stored.client.client_id),
    access: String(stored.tokens.access_token),
    refresh: String(stored.tokens.refresh_token),
  }
}

/** An MCP client of the official SDK, signing in with its own OAuth flow. */
class MemoryOAuthProvider implements OAuthClientProvider {
  authorization: URL | undefined
  private client: OAuthClientInformationMixed | undefined
  private saved: OAuthTokens | undefined
  private verifier = ""
  readonly redirectUrl = "http://127.0.0.1:43124/callback"
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "MCP SDK test",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }
  }
  clientInformation() {
    return this.client
  }
  saveClientInformation(client: OAuthClientInformationMixed) {
    this.client = client
  }
  tokens() {
    return this.saved
  }
  saveTokens(tokens: OAuthTokens) {
    this.saved = tokens
  }
  redirectToAuthorization(url: URL) {
    this.authorization = url
  }
  saveCodeVerifier(verifier: string) {
    this.verifier = verifier
  }
  codeVerifier() {
    return this.verifier
  }
}

type Revision = "2025-11-25" | "2026-07-28"

const mcpClient = (revision: Revision) =>
  new Client(
    { name: "tools-test", version: "1" },
    {
      supportedProtocolVersions: [revision],
      versionNegotiation: {
        mode: revision === "2026-07-28" ? { pin: revision } : "legacy",
      },
    }
  )

/** Connects with a fixed bearer token, as a client that already holds one. */
const mcpWithToken = async (
  access: string,
  revision: Revision = "2026-07-28",
  headers: Record<string, string> = {}
) => {
  const client = mcpClient(revision)
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}/api/mcp`), {
      requestInit: {
        headers: { Authorization: `Bearer ${access}`, ...headers },
      },
    })
  )
  return client
}

const rest = (path: string, init: RequestInit = {}) =>
  fetch(`${origin}${path}`, init)

const bearer = (access: string, init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { Authorization: `Bearer ${access}`, ...init.headers },
})

const createWing = (headers: Record<string, string>) =>
  rest("/api/v1/flights/equipment", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(wing),
  })

describe("one OAuth sign-in serves REST, MCP and the CLI", () => {
  test.each(["2025-11-25", "2026-07-28"] as const)(
    "the MCP SDK %s discovers /api, signs in and calls every tool of the user",
    async (revision) => {
      const t = await setup()
      const provider = new MemoryOAuthProvider()
      const url = new URL(`${origin}/api/mcp`)
      const first = new StreamableHTTPClientTransport(url, {
        authProvider: provider,
      })
      await expect(mcpClient(revision).connect(first)).rejects.toBeInstanceOf(
        UnauthorizedError
      )
      const authorization = provider.authorization
      expect(authorization?.searchParams.get("resource")).toBe(`${origin}/api`)
      expect(`${authorization?.origin}${authorization?.pathname}`).toBe(
        `${origin}/api/auth/oauth2/authorize`
      )
      const callback = await authorizeInBrowser(String(authorization), t.cookie)
      await first.finishAuth(callback.searchParams)
      expect(provider.tokens()?.scope).toBe("tools offline_access")

      const client = mcpClient(revision)
      await client.connect(
        new StreamableHTTPClientTransport(url, { authProvider: provider })
      )
      try {
        const { tools } = await client.listTools()
        expect(tools).toHaveLength(actionRegistry.actions.length)
        const created = await client.callTool({
          name: "flights.equipment.create",
          arguments: wing,
        })
        expect(created.isError).toBeFalsy()
        expect(created.structuredContent).toMatchObject({
          equipment: { name: "Zeno 2" },
        })
        // The SDK validates every structured result against its output schema.
        for (const name of [
          "flights.equipment.list",
          "flights.list",
          "flights.stats.get",
        ])
          expect(
            (await client.callTool({ name, arguments: {} })).isError
          ).toBeFalsy()
        expect(t.equipment()).toBe(1)
      } finally {
        await client.close()
      }
    }
  )

  test("the CLI signs in, reads the manifest and calls actions; revoking its grant stops every transport", async () => {
    const t = await setup()
    const tokens = await cliLogin(t.cookie)

    const listed = await runCli(["actions"])
    expect({ code: listed.code, stderr: listed.stderr }).toMatchObject({
      code: 0,
    })
    expect(JSON.parse(listed.stdout).actions).toHaveLength(
      actionRegistry.actions.length
    )

    const created = await runCli([
      "call",
      "flights.equipment.create",
      "--json",
      JSON.stringify(wing),
    ])
    expect({ code: created.code, stderr: created.stderr }).toMatchObject({
      code: 0,
    })
    expect(JSON.parse(created.stdout)).toMatchObject({
      equipment: { name: "Zeno 2" },
    })

    // The same token, by hand: no Origin is needed with a bearer token.
    const byHand = await createWing({
      Authorization: `Bearer ${tokens.access}`,
    })
    expect(byHand.status).toBe(200)
    const listedByHand = await rest(
      `/api/v1/flights?input=${encodeURIComponent(JSON.stringify({}))}`,
      bearer(tokens.access)
    )
    expect(listedByHand.status).toBe(200)
    const mcp = await mcpWithToken(tokens.access)
    expect(
      (
        await mcp.callTool({
          name: "flights.equipment.create",
          arguments: wing,
        })
      ).isError
    ).toBeFalsy()
    await mcp.close()
    expect(t.equipment()).toBe(3)

    const revoked = await rest("/api/auth/oauth2/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: tokens.refresh,
        token_type_hint: "refresh_token",
        client_id: tokens.clientId,
      }),
    })
    expect(revoked.status).toBe(200)

    const refusedRest = await createWing({
      Authorization: `Bearer ${tokens.access}`,
    })
    expect(refusedRest.status).toBe(401)
    expect(refusedRest.headers.get("WWW-Authenticate")).toContain(
      `resource_metadata="${origin}/.well-known/oauth-protected-resource/api"`
    )
    expect(await refusedRest.json()).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "The access token is invalid or expired",
      },
    })
    await expect(mcpWithToken(tokens.access)).rejects.toThrow(/401/)
    const refusedCli = await runCli([
      "call",
      "flights.equipment.create",
      "--json",
      JSON.stringify(wing),
    ])
    expect(refusedCli.code).toBe(1)
    expect(refusedCli.stderr).toContain("HTTP 401")
    const refusedRefresh = await runCli(["actions"], {
      env: { TOOLS_TOKEN: tokens.access },
    })
    expect(refusedRefresh.code).toBe(1)
    expect(t.equipment()).toBe(3)
  })

  test("tools logout revokes the CLI's grant", async () => {
    const t = await setup()
    const tokens = await cliLogin(t.cookie)
    const logout = await runCli(["logout"])
    expect({ code: logout.code, stderr: logout.stderr }).toMatchObject({
      code: 0,
    })
    expect(
      (await createWing({ Authorization: `Bearer ${tokens.access}` })).status
    ).toBe(401)
    expect(t.equipment()).toBe(0)
  })

  test("losing app access applies to live tokens on every transport", async () => {
    const t = await setup()
    const tokens = await cliLogin(t.cookie)
    t.d1.sqlite
      .prepare("DELETE FROM app_access WHERE user_id = ? AND app = 'flights'")
      .run(t.userId)

    const refused = await createWing({
      Authorization: `Bearer ${tokens.access}`,
    })
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({
      error: {
        code: "FORBIDDEN",
        message: "You do not have access to this app",
      },
    })

    const mcp = await mcpWithToken(tokens.access)
    const names = (await mcp.listTools()).tools.map(({ name }) => name)
    expect(names.some((name) => name.startsWith("flights."))).toBe(false)
    expect(names.length).toBeGreaterThan(0)
    await expect(
      mcp.callTool({ name: "flights.equipment.create", arguments: wing })
    ).rejects.toMatchObject({ code: -32602 })
    await mcp.close()

    const actions = await runCli(["actions"])
    expect(
      JSON.parse(actions.stdout).actions.some(({ name }: { name: string }) =>
        name.startsWith("flights.")
      )
    ).toBe(false)
    const call = await runCli(["call", "flights.equipment.list"])
    expect(call.code).toBe(1)
    expect(call.stderr).toContain("Unknown action: flights.equipment.list")
    expect(t.equipment()).toBe(0)
  })
})

describe("credentials and origins", () => {
  test("the session cookie works from this site's pages only, and never on MCP", async () => {
    const t = await setup()
    const cookie = { Cookie: t.cookie }
    expect((await rest("/api/v1", { headers: cookie })).status).toBe(200)
    const foreign: Array<Record<string, string>> = [
      {},
      { Origin: "https://attacker.example" },
    ]
    for (const headers of foreign)
      expect((await createWing({ ...cookie, ...headers })).status).toBe(403)
    expect((await createWing({ ...cookie, Origin: origin })).status).toBe(200)
    const rpc = await rest("/api/rpc/flights/equipment/list", {
      method: "POST",
      headers: {
        ...cookie,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ json: {} }),
    })
    expect(rpc.status).toBe(200)

    const mcp = await rest("/api/mcp", {
      method: "POST",
      headers: {
        ...cookie,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    })
    expect(mcp.status).toBe(401)
    expect(mcp.headers.get("WWW-Authenticate")).toBe(
      `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api", scope="tools offline_access"`
    )
    expect(t.equipment()).toBe(1)
  })

  test("an invalid bearer token is refused even with a valid cookie", async () => {
    const t = await setup()
    const headers = {
      Authorization: "Bearer not-a-token",
      Cookie: t.cookie,
      Origin: origin,
      "Content-Type": "application/json",
    }
    for (const [path, body] of [
      ["/api/v1/flights/equipment", wing],
      ["/api/rpc/flights/equipment/create", { json: wing }],
      ["/api/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" }],
    ] as const) {
      const response = await rest(path, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })
      expect([path, response.status]).toEqual([path, 401])
      expect(response.headers.get("WWW-Authenticate")).toContain(
        'error="invalid_token"'
      )
    }
    expect(t.equipment()).toBe(0)
  })

  test("MCP accepts native clients and this site's pages, not other origins", async () => {
    const t = await setup()
    const { access } = await cliLogin(t.cookie)
    const native = await mcpWithToken(access)
    await native.close()
    const page = await mcpWithToken(access, "2026-07-28", { Origin: origin })
    await page.close()
    const foreign = await rest("/api/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access}`,
        Origin: "https://attacker.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    })
    expect(foreign.status).toBe(403)
  })

  test("browsers may call the public OAuth endpoints from any origin, without credentials", async () => {
    const t = await setup()
    const preflight = await rest("/api/auth/oauth2/token", {
      method: "OPTIONS",
      headers: {
        Origin: "https://client.example",
        "Access-Control-Request-Method": "POST",
      },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*")
    expect(preflight.headers.get("Access-Control-Allow-Credentials")).toBeNull()

    for (const path of [
      "/.well-known/oauth-protected-resource/api/mcp",
      "/.well-known/oauth-authorization-server/api/auth",
    ]) {
      const metadata = await rest(path, {
        headers: { Origin: "https://client.example" },
      })
      expect([path, metadata.status]).toEqual([path, 200])
      expect(metadata.headers.get("Access-Control-Allow-Origin")).toBe("*")
    }
    const registered = await rest("/api/auth/oauth2/register", {
      method: "POST",
      headers: {
        Origin: "https://client.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_name: "Browser client",
        redirect_uris: ["https://client.example/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    })
    expect(registered.status).toBe(201)
    expect(registered.headers.get("Access-Control-Allow-Origin")).toBe("*")

    // Consent still needs this site's Origin with the cookie.
    const pending = await navigate(
      `${origin}/api/auth/oauth2/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: ((await registered.json()) as { client_id: string })
          .client_id,
        redirect_uri: "https://client.example/callback",
        scope: "tools offline_access",
        state: "state-1",
        code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        code_challenge_method: "S256",
        resource: `${origin}/api`,
      })}`,
      t.cookie
    )
    const consentPage = new URL(pending.location ?? "", origin)
    expect(consentPage.pathname).toBe("/oauth/consent")
    const consent = await rest("/api/auth/oauth2/consent", {
      method: "POST",
      headers: {
        Origin: "https://client.example",
        Cookie: t.cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        accept: true,
        oauth_query: consentPage.search.slice(1),
      }),
    })
    expect(consent.status).toBe(403)
    expect(consent.headers.get("Access-Control-Allow-Origin")).toBeNull()
    expect(
      (
        await rest("/api/v1", { headers: { Origin: "https://client.example" } })
      ).headers.get("Access-Control-Allow-Origin")
    ).toBeNull()
  })
})
