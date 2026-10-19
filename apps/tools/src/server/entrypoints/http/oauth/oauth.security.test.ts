import { generateKeyPairSync, sign } from "node:crypto"
import { afterEach, assert, describe, it } from "@effect/vitest"
import { Effect, Fiber } from "effect"
import { vi } from "vitest"

const workerEnv = vi.hoisted(() => ({}) as Record<string, unknown>)
vi.mock("cloudflare:workers", () => ({ env: workerEnv }))

import {
  answerConsent,
  auth,
  authorizeRequest,
  call,
  callerOf,
  codeFor,
  connect,
  exchange,
  json,
  origin,
  redirectUri,
  refresh,
  refusal,
  resource,
  restoreGlobals,
  setup,
  signInFromLoginPage,
  stubGitHub,
  token,
  tokensOf,
  verifier,
} from "./testing"

afterEach(restoreGlobals)

const revoke = (values: Record<string, string>) =>
  auth("/api/auth/oauth2/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values).toString(),
  })

const register = (method: string, extra = {}) =>
  Effect.gen(function* () {
    const response = yield* auth("/api/auth/oauth2/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Security regression client",
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: method,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        ...extra,
      }),
    })
    const body = yield* json(response)
    assert.strictEqual(response.status, 201, JSON.stringify(body))
    return {
      clientId: String(body.client_id),
      secret: String(body.client_secret),
    }
  })

const consentedCode = (clientId: string) =>
  Effect.gen(function* () {
    const signed = yield* signInFromLoginPage(yield* authorizeRequest(clientId))
    const redirect = yield* answerConsent(signed.next, signed.cookie, true)
    return {
      code: redirect.searchParams.get("code") ?? "",
      cookie: signed.cookie,
    }
  })

const encodeJwtPart = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url")

const jwtClient = Effect.gen(function* () {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  })
  const jwk = {
    ...publicKey.export({ format: "jwk" }),
    kid: "test-key",
    alg: "RS256",
    use: "sig",
  }
  const { clientId } = yield* register("private_key_jwt", {
    jwks: { keys: [jwk] },
  })
  const assertion = (endpoint: "token" | "revoke") => {
    const now = Math.floor(Date.now() / 1000)
    const header = encodeJwtPart({ alg: "RS256", kid: "test-key", typ: "JWT" })
    const payload = encodeJwtPart({
      iss: clientId,
      sub: clientId,
      aud: `${origin}/api/auth/oauth2/${endpoint}`,
      iat: now,
      exp: now + 120,
      jti: crypto.randomUUID(),
    })
    const input = `${header}.${payload}`
    return {
      client_id: clientId,
      client_assertion_type:
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: `${input}.${sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`,
    }
  }
  return { clientId, assertion }
})

describe("OAuth validation before grant mutations", () => {
  it.effect(
    "accepts a corrected code exchange after missing or invalid PKCE",
    () => {
      stubGitHub(42)
      setup(workerEnv)
      return Effect.gen(function* () {
        const { clientId, cookie, tokens } = yield* connect
        for (const codeVerifier of ["", `${verifier}-wrong`]) {
          const code = yield* codeFor(clientId, cookie)
          const invalid = yield* exchange(clientId, code, {
            code_verifier: codeVerifier,
          })
          assert.strictEqual(invalid.status, 400)
          const corrected = yield* exchange(clientId, code)
          assert.strictEqual(
            corrected.status,
            200,
            JSON.stringify(corrected.body)
          )
          callerOf(yield* call({ bearer: tokensOf(corrected.body).access }))
        }
        callerOf(yield* call({ bearer: tokens.access }))
      })
    }
  )

  for (const method of ["client_secret_basic", "client_secret_post"]) {
    it.effect(
      `accepts a corrected ${method} exchange without burning the code`,
      () => {
        stubGitHub(42)
        setup(workerEnv)
        return Effect.gen(function* () {
          const { clientId, secret } = yield* register(method)
          const { code } = yield* consentedCode(clientId)
          const exchangeAs = (password: string) =>
            token(
              {
                grant_type: "authorization_code",
                code,
                redirect_uri: redirectUri,
                code_verifier: verifier,
                resource,
                ...(method === "client_secret_post"
                  ? { client_id: clientId, client_secret: password }
                  : {}),
              },
              method === "client_secret_basic"
                ? { Authorization: `Basic ${btoa(`${clientId}:${password}`)}` }
                : {}
            )
          const invalid = yield* exchangeAs("wrong-secret")
          assert.strictEqual(invalid.body.error, "invalid_client")
          const corrected = yield* exchangeAs(secret)
          assert.strictEqual(
            corrected.status,
            200,
            JSON.stringify(corrected.body)
          )
          const issued = tokensOf(corrected.body)
          callerOf(yield* call({ bearer: issued.access }))
          const replay = yield* exchangeAs("wrong-secret")
          assert.strictEqual(replay.body.error, "invalid_client")
          callerOf(yield* call({ bearer: issued.access }))
          const authenticatedReplay = yield* exchangeAs(secret)
          assert.strictEqual(authenticatedReplay.body.error, "invalid_grant")
          assert.strictEqual(
            refusal(yield* call({ bearer: issued.access })).status,
            401
          )
        })
      }
    )
  }

  it.effect(
    "revoking another client's rotated token leaves both clients' grants usable",
    () => {
      stubGitHub(42)
      setup(workerEnv)
      return Effect.gen(function* () {
        const a = yield* connect
        const rotated = tokensOf(
          (yield* refresh(a.clientId, a.tokens.refresh)).body
        )
        const b = yield* connect
        for (const hint of [
          "refresh_token",
          "",
          "unrecognized",
          "access_token",
        ]) {
          const response = yield* revoke({
            token: a.tokens.refresh,
            client_id: b.clientId,
            ...(hint ? { token_type_hint: hint } : {}),
          })
          assert.strictEqual(response.status, 200)
          callerOf(yield* call({ bearer: b.tokens.access }))
          callerOf(yield* call({ bearer: rotated.access }))
        }
        assert.strictEqual(
          (yield* refresh(b.clientId, b.tokens.refresh)).status,
          200
        )
        assert.strictEqual(
          (yield* refresh(a.clientId, rotated.refresh)).status,
          200
        )
      })
    }
  )

  it.effect(
    "authenticates private_key_jwt once per request while rejecting assertion replays",
    () => {
      stubGitHub(42)
      setup(workerEnv)
      return Effect.gen(function* () {
        const { clientId, assertion } = yield* jwtClient
        const { code, cookie } = yield* consentedCode(clientId)
        const codeAuth = assertion("token")
        const exchanged = yield* exchange(clientId, code, codeAuth)
        assert.strictEqual(
          exchanged.status,
          200,
          JSON.stringify(exchanged.body)
        )
        const first = tokensOf(exchanged.body)
        assert.strictEqual(
          (yield* exchange(clientId, code, codeAuth)).body.error,
          "invalid_client"
        )
        callerOf(yield* call({ bearer: first.access }))

        const refreshAuth = assertion("token")
        const refreshValues = {
          grant_type: "refresh_token",
          refresh_token: first.refresh,
          ...refreshAuth,
        }
        const renewed = yield* token(refreshValues)
        assert.strictEqual(renewed.status, 200, JSON.stringify(renewed.body))
        const second = tokensOf(renewed.body)
        assert.strictEqual(
          (yield* token(refreshValues)).body.error,
          "invalid_client"
        )
        callerOf(yield* call({ bearer: second.access }))
        const retried = yield* token({
          ...refreshValues,
          ...assertion("token"),
        })
        assert.strictEqual(retried.status, 200, JSON.stringify(retried.body))
        assert.deepStrictEqual(tokensOf(retried.body), second)

        const revokeAuth = assertion("revoke")
        const revoked = yield* revoke({
          token: second.access,
          token_type_hint: "access_token",
          ...revokeAuth,
        })
        assert.strictEqual(revoked.status, 200)
        assert.strictEqual(
          refusal(yield* call({ bearer: second.access })).status,
          401
        )
        assert.strictEqual(
          (yield* json(yield* revoke({ token: second.refresh, ...revokeAuth })))
            .error,
          "invalid_client"
        )
        const live = yield* token({
          grant_type: "refresh_token",
          refresh_token: second.refresh,
          ...assertion("token"),
        })
        assert.strictEqual(live.status, 200, JSON.stringify(live.body))
        const latest = tokensOf(live.body)
        assert.strictEqual(
          (yield* revoke({ token: latest.refresh, ...assertion("revoke") }))
            .status,
          200
        )
        assert.strictEqual(
          refusal(yield* call({ bearer: latest.access })).status,
          401
        )
        assert.strictEqual(
          (yield* token({
            grant_type: "refresh_token",
            refresh_token: latest.refresh,
            ...assertion("token"),
          })).status,
          400
        )

        const replayCode = yield* codeFor(clientId, cookie)
        const issued = yield* exchange(clientId, replayCode, assertion("token"))
        assert.strictEqual(issued.status, 200, JSON.stringify(issued.body))
        const replay = yield* exchange(clientId, replayCode, assertion("token"))
        assert.strictEqual(replay.body.error, "invalid_grant")
        assert.strictEqual(
          refusal(yield* call({ bearer: tokensOf(issued.body).access })).status,
          401
        )
      })
    }
  )

  it.effect(
    "revokes a private_key_jwt refresh family after the retry window",
    () => {
      stubGitHub(42)
      setup(workerEnv)
      vi.useFakeTimers({ toFake: ["Date"] })
      return Effect.gen(function* () {
        const { clientId, assertion } = yield* jwtClient
        const { code } = yield* consentedCode(clientId)
        const exchanged = yield* exchange(clientId, code, assertion("token"))
        assert.strictEqual(exchanged.status, 200)
        const first = tokensOf(exchanged.body)
        const renewed = yield* token({
          grant_type: "refresh_token",
          refresh_token: first.refresh,
          ...assertion("token"),
        })
        assert.strictEqual(renewed.status, 200)
        const second = tokensOf(renewed.body)
        vi.setSystemTime(Date.now() + 60_000)
        const replay = yield* token({
          grant_type: "refresh_token",
          refresh_token: first.refresh,
          ...assertion("token"),
        })
        assert.strictEqual(replay.body.error, "invalid_grant")
        assert.strictEqual(
          refusal(yield* call({ bearer: second.access })).status,
          401
        )
        assert.strictEqual(
          (yield* token({
            grant_type: "refresh_token",
            refresh_token: second.refresh,
            ...assertion("token"),
          })).status,
          400
        )
      })
    }
  )

  it.effect(
    "claims one private_key_jwt code when validated exchanges race",
    () => {
      stubGitHub(42)
      const t = setup(workerEnv)
      return Effect.gen(function* () {
        const { clientId, assertion } = yield* jwtClient
        const { code } = yield* consentedCode(clientId)
        const paused = t.pause(/^insert into "oauth_refresh_tokens"/i)
        const racing = yield* Effect.forkChild(
          exchange(clientId, code, assertion("token"))
        )
        yield* Effect.promise(() => paused.reached)
        const replay = yield* exchange(clientId, code, assertion("token"))
        assert.strictEqual(replay.body.error, "invalid_grant")
        paused.release()
        const issued = yield* Fiber.join(racing)
        assert.strictEqual(issued.status, 200, JSON.stringify(issued.body))
        const late = tokensOf(issued.body)
        assert.strictEqual(
          refusal(yield* call({ bearer: late.access })).status,
          401
        )
        assert.strictEqual(
          (yield* token({
            grant_type: "refresh_token",
            refresh_token: late.refresh,
            ...assertion("token"),
          })).status,
          400
        )
      })
    }
  )
})
