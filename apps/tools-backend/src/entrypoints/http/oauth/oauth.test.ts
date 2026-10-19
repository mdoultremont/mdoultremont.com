import { afterEach, assert, describe, it } from "@effect/vitest"
import { Effect, Fiber } from "effect"
import { vi } from "vitest"
import { UserAuth } from "#backend/actions/auth"
import { sha256Hex } from "#backend/modules/hashing"

const workerEnv = vi.hoisted(() => ({}) as Record<string, unknown>)
vi.mock("cloudflare:workers", () => ({ env: workerEnv }))

import { authLayer, consentRequest } from "../auth.server"
import { authenticate, handleOAuthRequest } from "."
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
  register,
  resource,
  signInFromLoginPage,
  stubGitHub,
  token,
  tokensOf,
  verifier,
  restoreGlobals,
  setup as setupOAuth,
} from "./testing"

const setup = () => setupOAuth(workerEnv)

afterEach(restoreGlobals)

const revoke = (values: Record<string, string>) =>
  auth("/api/auth/oauth2/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values).toString(),
  })

describe("OAuth authorization for tools clients", () => {
  it.effect(
    "sends a signed-out user to sign in, asks for consent, and acts as them with their current apps",
    () => {
      stubGitHub(42)
      const t = setup()
      return Effect.gen(function* () {
        const clientId = yield* register
        const login = yield* authorizeRequest(clientId)
        assert.strictEqual(login.pathname, "/oauth/sign-in")
        assert.strictEqual(login.searchParams.get("client_id"), clientId)
        assert.isNotNull(login.searchParams.get("sig"))

        const signedIn = yield* signInFromLoginPage(login)
        assert.strictEqual(signedIn.next.pathname, "/oauth/consent")

        const shown = yield* Effect.promise(() =>
          consentRequest(
            new Request(`${origin}/oauth/consent`, {
              headers: { Cookie: signedIn.cookie },
            }),
            signedIn.next.search
          )
        )
        assert.deepStrictEqual(shown, {
          client: {
            clientId,
            name: "Codex",
          },
          redirectOrigin: "http://127.0.0.1:43123",
          user: { name: "Matthieu", email: "matthieu@example.com" },
          apps: ["music", "backOffice", "flights"],
        })
        const tampered = new URL(signedIn.next)
        tampered.searchParams.set("redirect_uri", "https://evil.example/cb")
        assert.isNull(
          yield* Effect.promise(() =>
            consentRequest(
              new Request(`${origin}/oauth/consent`, {
                headers: { Cookie: signedIn.cookie },
              }),
              tampered.search
            )
          )
        )

        const redirect = yield* answerConsent(
          signedIn.next,
          signedIn.cookie,
          true
        )
        assert.strictEqual(
          `${redirect.origin}${redirect.pathname}`,
          redirectUri
        )
        assert.strictEqual(redirect.searchParams.get("state"), "state-1")
        assert.strictEqual(
          redirect.searchParams.get("iss"),
          `${origin}/api/auth`
        )

        const exchanged = yield* exchange(
          clientId,
          redirect.searchParams.get("code") ?? ""
        )
        assert.strictEqual(exchanged.status, 200)
        assert.strictEqual(exchanged.body.token_type, "Bearer")
        assert.strictEqual(exchanged.body.scope, "tools offline_access")
        const tokens = tokensOf(exchanged.body)

        const userId = String(
          t.d1.sqlite.prepare("SELECT id FROM auth_users").get()?.id
        )
        // A bearer request needs no Origin, even to change something.
        const caller = callerOf(
          yield* call({ bearer: tokens.access }, { method: "POST" })
        )
        assert.deepStrictEqual(caller, {
          userId,
          apps: ["music", "backOffice", "flights"],
          origin,
        })

        // Consent is remembered: the next authorization skips every page.
        assert.isNotEmpty(yield* codeFor(clientId, signedIn.cookie))
      })
    }
  )

  it.effect("denying consent sends access_denied and grants nothing", () => {
    stubGitHub(42)
    const t = setup()
    return Effect.gen(function* () {
      const clientId = yield* register
      const signedIn = yield* signInFromLoginPage(
        yield* authorizeRequest(clientId)
      )
      const redirect = yield* answerConsent(
        signedIn.next,
        signedIn.cookie,
        false
      )
      assert.strictEqual(redirect.searchParams.get("error"), "access_denied")
      assert.strictEqual(redirect.searchParams.get("state"), "state-1")
      assert.isNull(redirect.searchParams.get("code"))
      assert.strictEqual(
        t.count("SELECT count(*) AS count FROM oauth_consents"),
        0
      )
      const again = yield* authorizeRequest(clientId, {
        cookie: signedIn.cookie,
      })
      assert.strictEqual(again.pathname, "/oauth/consent")
    })
  })

  it.effect(
    "redeems a code once, only with its PKCE verifier, and revokes what a replayed code issued",
    () => {
      stubGitHub(42)
      setup()
      return Effect.gen(function* () {
        const { clientId, cookie } = yield* connect

        const withoutVerifier = yield* codeFor(clientId, cookie)
        const missing = yield* token({
          grant_type: "authorization_code",
          code: withoutVerifier,
          redirect_uri: redirectUri,
          client_id: clientId,
          resource,
        })
        assert.strictEqual(missing.status, 400)
        assert.strictEqual(missing.body.error, "invalid_request")

        const wrong = yield* exchange(
          clientId,
          yield* codeFor(clientId, cookie),
          { code_verifier: `${verifier}-wrong` }
        )
        assert.strictEqual(wrong.status, 400)
        assert.strictEqual(wrong.body.error, "invalid_grant")

        const code = yield* codeFor(clientId, cookie)
        const first = yield* exchange(clientId, code)
        assert.strictEqual(first.status, 200)
        const issued = tokensOf(first.body)
        callerOf(yield* call({ bearer: issued.access }))

        const replay = yield* exchange(clientId, code)
        assert.strictEqual(replay.status, 400)
        assert.strictEqual(replay.body.error, "invalid_grant")
        assert.strictEqual(
          refusal(yield* call({ bearer: issued.access })).status,
          401
        )
        assert.strictEqual(
          (yield* refresh(clientId, issued.refresh)).status,
          400
        )
      })
    }
  )

  it.effect(
    "accepts a token only for the tools resource and scope, and never falls back to the cookie",
    () => {
      stubGitHub(42)
      setup()
      return Effect.gen(function* () {
        const { clientId, cookie, tokens } = yield* connect

        const noResource = yield* token({
          grant_type: "authorization_code",
          code: yield* codeFor(clientId, cookie, { resource: "" }),
          redirect_uri: redirectUri,
          client_id: clientId,
          code_verifier: verifier,
        })
        assert.strictEqual(noResource.status, 200)
        const unbound = refusal(
          yield* call({ bearer: String(noResource.body.access_token) })
        )
        assert.strictEqual(unbound.status, 401)
        assert.include(unbound.challenge ?? "", 'error="invalid_token"')

        const elsewhere = yield* authorizeRequest(clientId, {
          cookie,
          params: { resource: "https://elsewhere.example/api" },
        })
        assert.strictEqual(
          elsewhere.searchParams.get("error"),
          "invalid_target"
        )

        const toolsless = yield* exchange(
          clientId,
          yield* codeFor(clientId, cookie, { scope: "offline_access" })
        )
        assert.strictEqual(toolsless.status, 200)
        const insufficient = refusal(
          yield* call({ bearer: String(toolsless.body.access_token) })
        )
        assert.strictEqual(insufficient.status, 403)
        assert.include(
          insufficient.challenge ?? "",
          'error="insufficient_scope"'
        )

        assert.strictEqual(
          refusal(
            yield* Effect.promise(() =>
              authenticate(
                new Request(`${origin}/api/mcp`, {
                  headers: { Authorization: `Bearer ${tokens.access}` },
                }),
                "bearer",
                `${origin}/api/other`
              )
            )
          ).status,
          401
        )

        // A bad Authorization header is refused even with a valid session cookie.
        assert.strictEqual(
          refusal(yield* call({ bearer: "not-a-token", cookie })).status,
          401
        )
        assert.strictEqual(
          refusal(
            yield* Effect.promise(() =>
              authenticate(
                new Request(`${origin}/api/v1/flights.list`, {
                  headers: { Authorization: "Basic abc", Cookie: cookie },
                })
              )
            )
          ).status,
          401
        )
        assert.strictEqual(
          refusal(
            yield* Effect.promise(() =>
              authenticate(
                new Request(`${origin}/api/v1/flights.list`, {
                  headers: { Authorization: "Bearer a b", Cookie: cookie },
                })
              )
            )
          ).status,
          400
        )
      })
    }
  )

  it.effect(
    "rotates refresh tokens, replays a retried refresh, and revokes the grant on reuse",
    () => {
      stubGitHub(42)
      setup()
      vi.useFakeTimers({ toFake: ["Date"] })
      return Effect.gen(function* () {
        const { clientId, tokens: first } = yield* connect

        const rotated = yield* refresh(clientId, first.refresh)
        assert.strictEqual(rotated.status, 200)
        const second = tokensOf(rotated.body)
        assert.notStrictEqual(second.refresh, first.refresh)
        callerOf(yield* call({ bearer: second.access }))

        const retried = yield* refresh(clientId, first.refresh)
        assert.strictEqual(retried.status, 200)
        assert.deepStrictEqual(tokensOf(retried.body), second)

        vi.setSystemTime(Date.now() + 60_000)
        const third = tokensOf((yield* refresh(clientId, second.refresh)).body)
        callerOf(yield* call({ bearer: third.access }))

        const reused = yield* refresh(clientId, first.refresh)
        assert.strictEqual(reused.status, 400)
        assert.strictEqual(reused.body.error, "invalid_grant")
        for (const access of [first.access, second.access, third.access])
          assert.strictEqual(
            refusal(yield* call({ bearer: access })).status,
            401
          )
        assert.strictEqual(
          (yield* refresh(clientId, third.refresh)).status,
          400
        )
      })
    }
  )

  it.effect(
    "leaves no usable token when a refresh races the revocation of its grant",
    () => {
      stubGitHub(42)
      const t = setup()
      vi.useFakeTimers({ toFake: ["Date"] })
      return Effect.gen(function* () {
        const { clientId, tokens: first } = yield* connect
        const second = tokensOf((yield* refresh(clientId, first.refresh)).body)
        vi.setSystemTime(Date.now() + 60_000)

        // The rotation of `second` stops right after revoking it, before
        // storing its successor, while a replay of `first` tears the family down.
        const pause = t.pause(/^insert into "oauth_refresh_tokens"/i)
        const racing = yield* Effect.forkChild(
          refresh(clientId, second.refresh)
        )
        yield* Effect.promise(() => pause.reached)
        const replay = yield* refresh(clientId, first.refresh)
        assert.strictEqual(replay.status, 400)
        pause.release()
        const raced = yield* Fiber.join(racing)

        // The provider alone leaves the successor live: its rows are unrevoked.
        assert.strictEqual(raced.status, 200, JSON.stringify(raced.body))
        const successor = tokensOf(raced.body)
        assert.strictEqual(
          t.count(
            "SELECT count(*) AS count FROM oauth_refresh_tokens WHERE revoked IS NULL"
          ),
          1
        )
        assert.strictEqual(
          t.count(
            "SELECT count(*) AS count FROM oauth_access_tokens WHERE revoked IS NULL"
          ),
          1
        )
        assert.strictEqual(
          refusal(yield* call({ bearer: successor.access })).status,
          401
        )
        const refreshed = yield* refresh(clientId, successor.refresh)
        assert.strictEqual(refreshed.status, 400)
        assert.strictEqual(refreshed.body.error, "invalid_grant")
      })
    }
  )

  it.effect(
    "revoking a refresh token ends every token of its grant; revoking an access token ends only that one",
    () => {
      stubGitHub(42)
      const t = setup()
      return Effect.gen(function* () {
        const { clientId, cookie, tokens: first } = yield* connect
        const second = tokensOf((yield* refresh(clientId, first.refresh)).body)

        // Another client cannot revoke this grant.
        const other = yield* register
        yield* revoke({ token: second.refresh, client_id: other })
        callerOf(yield* call({ bearer: second.access }))

        assert.strictEqual(
          (yield* revoke({
            token: second.refresh,
            token_type_hint: "refresh_token",
            client_id: clientId,
          })).status,
          200
        )
        // The provider deletes only the access token issued with that refresh
        // token; the first one would still be live without the grant check.
        assert.strictEqual(
          t.count(
            "SELECT count(*) AS count FROM oauth_access_tokens WHERE revoked IS NULL"
          ),
          1
        )
        for (const access of [first.access, second.access])
          assert.strictEqual(
            refusal(yield* call({ bearer: access })).status,
            401
          )
        assert.strictEqual(
          (yield* refresh(clientId, second.refresh)).status,
          400
        )

        const fresh = tokensOf(
          (yield* exchange(clientId, yield* codeFor(clientId, cookie))).body
        )
        yield* revoke({
          token: fresh.access,
          token_type_hint: "access_token",
          client_id: clientId,
        })
        assert.strictEqual(
          refusal(yield* call({ bearer: fresh.access })).status,
          401
        )
        const renewed = yield* refresh(clientId, fresh.refresh)
        assert.strictEqual(renewed.status, 200)
        callerOf(yield* call({ bearer: String(renewed.body.access_token) }))
      })
    }
  )

  it.effect(
    "applies app access changes and user removal to live tokens, and a restored user starts over",
    () => {
      stubGitHub(42)
      const t = setup()
      return Effect.gen(function* () {
        const { clientId, cookie, tokens } = yield* connect
        const userId = String(
          t.d1.sqlite.prepare("SELECT id FROM auth_users").get()?.id
        )

        t.d1.sqlite
          .prepare("DELETE FROM app_access WHERE user_id = ? AND app = 'music'")
          .run(userId)
        assert.deepStrictEqual(
          callerOf(yield* call({ bearer: tokens.access })).apps,
          ["backOffice", "flights"]
        )
        assert.deepStrictEqual(callerOf(yield* call({ cookie })).apps, [
          "backOffice",
          "flights",
        ])

        // What the back office does when it removes a user.
        t.d1.sqlite
          .prepare("UPDATE auth_users SET deleted_at = 1 WHERE id = ?")
          .run(userId)
        t.d1.sqlite
          .prepare("DELETE FROM app_access WHERE user_id = ?")
          .run(userId)
        t.d1.sqlite
          .prepare("DELETE FROM auth_sessions WHERE user_id = ?")
          .run(userId)
        assert.strictEqual(
          refusal(yield* call({ bearer: tokens.access })).status,
          401
        )
        assert.strictEqual(refusal(yield* call({ cookie })).status, 401)
        // The client may still refresh, but nothing it gets works.
        const meanwhile = yield* refresh(clientId, tokens.refresh)
        assert.strictEqual(meanwhile.status, 200)
        const latest = tokensOf(meanwhile.body)
        assert.strictEqual(
          refusal(yield* call({ bearer: latest.access })).status,
          401
        )

        const invitation = "restore-token"
        t.d1.sqlite
          .prepare(
            "INSERT INTO invitations (id, email, token_hash, apps, created_at, expires_at) VALUES ('again', 'matthieu@example.com', ?, '[\"flights\"]', 0, ?)"
          )
          .run(yield* sha256Hex(invitation), Date.now() + 60_000)
        assert.isTrue(
          yield* UserAuth.use((users) =>
            users.acceptInvitation({ token: invitation, userId })
          ).pipe(Effect.provide(authLayer()))
        )
        for (const access of [tokens.access, latest.access])
          assert.strictEqual(
            refusal(yield* call({ bearer: access })).status,
            401
          )
        assert.strictEqual(
          (yield* refresh(clientId, latest.refresh)).status,
          400
        )

        const login = yield* authorizeRequest(clientId)
        assert.strictEqual(login.pathname, "/oauth/sign-in")
        const signedIn = yield* signInFromLoginPage(login)
        const redirect =
          signedIn.next.pathname === "/oauth/consent"
            ? yield* answerConsent(signedIn.next, signedIn.cookie, true)
            : signedIn.next
        const renewed = tokensOf(
          (yield* exchange(clientId, redirect.searchParams.get("code") ?? ""))
            .body
        )
        assert.strictEqual(
          callerOf(yield* call({ bearer: renewed.access })).userId,
          userId
        )
      })
    }
  )

  it.effect("offers no client credentials grant", () => {
    setup()
    return Effect.gen(function* () {
      const registration = yield* auth("/api/auth/oauth2/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "Robot",
          grant_types: ["client_credentials"],
          token_endpoint_auth_method: "client_secret_basic",
        }),
      })
      assert.strictEqual(registration.status, 400)
      const clientId = yield* register
      const attempt = yield* token({
        grant_type: "client_credentials",
        client_id: clientId,
        scope: "tools",
      })
      assert.strictEqual(attempt.status, 400)
      assert.strictEqual(attempt.body.error, "unsupported_grant_type")
    })
  })
})

describe("token verification", () => {
  it.effect("is not reachable over HTTP", () => {
    setup()
    return Effect.gen(function* () {
      const response = yield* auth("/api/auth/tools/oauth/access-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "anything" }),
      })
      assert.strictEqual(response.status, 404)
    })
  })
})

describe("session callers", () => {
  it.effect(
    "authenticates the cookie, and requires this site's Origin to change anything",
    () => {
      stubGitHub(42)
      const t = setup()
      return Effect.gen(function* () {
        const { cookie } = yield* connect
        const userId = String(
          t.d1.sqlite.prepare("SELECT id FROM auth_users").get()?.id
        )
        assert.deepStrictEqual(callerOf(yield* call({ cookie })), {
          userId,
          apps: ["music", "backOffice", "flights"],
          origin,
        })
        callerOf(yield* call({ cookie }, { method: "POST", origin }))
        assert.strictEqual(
          refusal(yield* call({ cookie }, { method: "POST" })).status,
          403
        )
        // The configured origin counts, not the Host the request names.
        assert.strictEqual(
          refusal(
            yield* call(
              { cookie },
              {
                method: "POST",
                url: "https://evil.example/api/v1/flights.list",
                origin: "https://evil.example",
              }
            )
          ).status,
          403
        )
        const signedOut = refusal(yield* call({}))
        assert.strictEqual(signedOut.status, 401)
        assert.strictEqual(
          signedOut.challenge,
          `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api", scope="tools offline_access"`
        )
      })
    }
  )
})

describe("OAuth discovery", () => {
  it.effect(
    "describes the one /api resource at every alias, from BETTER_AUTH_URL",
    () => {
      setup()
      return Effect.gen(function* () {
        for (const path of [
          "/.well-known/oauth-protected-resource",
          "/.well-known/oauth-protected-resource/api",
          "/.well-known/oauth-protected-resource/api/mcp",
          "/.well-known/oauth-protected-resource/api/v1",
        ]) {
          const response = yield* Effect.promise(() =>
            handleOAuthRequest(new Request(`https://evil.example${path}`))
          )
          assert.strictEqual(response?.status, 200, path)
          assert.deepStrictEqual(yield* json(response ?? new Response()), {
            resource,
            resource_name: "Tools",
            authorization_servers: [`${origin}/api/auth`],
            bearer_methods_supported: ["header"],
            scopes_supported: ["tools", "offline_access"],
          })
        }
        const posted = yield* Effect.promise(() =>
          handleOAuthRequest(
            new Request(`${origin}/.well-known/oauth-protected-resource/api`, {
              method: "POST",
            })
          )
        )
        assert.strictEqual(posted?.status, 405)
        assert.isUndefined(
          yield* Effect.promise(() =>
            handleOAuthRequest(
              new Request(`${origin}/.well-known/security.txt`)
            )
          )
        )
      })
    }
  )

  it.effect(
    "publishes authorization server metadata for issuer /api/auth",
    () => {
      setup()
      return Effect.gen(function* () {
        for (const path of [
          "/.well-known/oauth-authorization-server/api/auth",
          "/.well-known/oauth-authorization-server",
        ]) {
          const response = yield* Effect.promise(() =>
            handleOAuthRequest(new Request(`https://evil.example${path}`))
          )
          assert.strictEqual(response?.status, 200, path)
          const metadata = yield* json(response ?? new Response())
          assert.strictEqual(metadata.issuer, `${origin}/api/auth`)
          assert.strictEqual(
            metadata.authorization_endpoint,
            `${origin}/api/auth/oauth2/authorize`
          )
          assert.strictEqual(
            metadata.token_endpoint,
            `${origin}/api/auth/oauth2/token`
          )
          assert.strictEqual(
            metadata.registration_endpoint,
            `${origin}/api/auth/oauth2/register`
          )
          assert.strictEqual(
            metadata.revocation_endpoint,
            `${origin}/api/auth/oauth2/revoke`
          )
          assert.deepStrictEqual(metadata.code_challenge_methods_supported, [
            "S256",
          ])
          assert.deepStrictEqual(metadata.grant_types_supported, [
            "authorization_code",
            "refresh_token",
          ])
          assert.deepStrictEqual(metadata.scopes_supported, [
            "tools",
            "offline_access",
          ])
        }
      })
    }
  )
})

describe("replays and revocations", () => {
  it.effect(
    "lists a grant whose code is replayed while its first redemption is still storing tokens",
    () => {
      stubGitHub(42)
      const t = setup()
      return Effect.gen(function* () {
        const { clientId, cookie } = yield* connect
        const code = yield* codeFor(clientId, cookie)
        const pause = t.pause(/^insert into "oauth_refresh_tokens"/i)
        const racing = yield* Effect.forkChild(exchange(clientId, code))
        yield* Effect.promise(() => pause.reached)
        const replay = yield* exchange(clientId, code)
        assert.strictEqual(replay.status, 400)
        assert.strictEqual(replay.body.error, "invalid_grant")
        pause.release()
        const raced = yield* Fiber.join(racing)
        assert.strictEqual(raced.status, 200)
        const late = tokensOf(raced.body)
        assert.deepStrictEqual(
          {
            access: refusal(yield* call({ bearer: late.access })).status,
            refresh: (yield* refresh(clientId, late.refresh)).status,
          },
          { access: 401, refresh: 400 }
        )
      })
    }
  )

  it.effect(
    "gives no usable tokens when two exchanges of one code race",
    () => {
      stubGitHub(42)
      setup()
      return Effect.gen(function* () {
        const { clientId, cookie } = yield* connect
        const code = yield* codeFor(clientId, cookie)
        const both = yield* Effect.all(
          [exchange(clientId, code), exchange(clientId, code)],
          { concurrency: "unbounded" }
        )
        assert.sameMembers(
          both.map(({ status }) => status),
          [200, 400]
        )
        for (const { status, body } of both)
          if (status === 200) {
            const issued = tokensOf(body)
            assert.strictEqual(
              refusal(yield* call({ bearer: issued.access })).status,
              401
            )
            assert.strictEqual(
              (yield* refresh(clientId, issued.refresh)).status,
              400
            )
          }
      })
    }
  )

  it.effect(
    "signing out of the browser ends that session's access tokens, but not the grant",
    () => {
      stubGitHub(42)
      setup()
      return Effect.gen(function* () {
        const { clientId, cookie, tokens } = yield* connect
        const signedOut = yield* auth("/api/auth/sign-out", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: origin,
            Cookie: cookie,
          },
          body: "{}",
        })
        assert.strictEqual(signedOut.status, 200)
        assert.strictEqual(
          refusal(yield* call({ bearer: tokens.access })).status,
          401
        )
        const renewed = yield* refresh(clientId, tokens.refresh)
        assert.strictEqual(renewed.status, 200)
        callerOf(yield* call({ bearer: String(renewed.body.access_token) }))
      })
    }
  )

  it.effect(
    "lists nothing when a code is replayed by another client or without its PKCE verifier",
    () => {
      stubGitHub(42)
      setup()
      return Effect.gen(function* () {
        const { clientId, cookie } = yield* connect
        const other = yield* register
        const code = yield* codeFor(clientId, cookie)
        const issued = tokensOf((yield* exchange(clientId, code)).body)
        for (const replay of [
          yield* exchange(other, code),
          yield* exchange(clientId, code, {
            code_verifier: `${verifier}-wrong`,
          }),
        ])
          assert.strictEqual(replay.status, 400)
        callerOf(yield* call({ bearer: issued.access }))
        assert.strictEqual(
          (yield* refresh(clientId, issued.refresh)).status,
          200
        )
      })
    }
  )

  it.effect(
    "a rotated refresh token replayed by another client does not revoke the grant",
    () => {
      stubGitHub(42)
      setup()
      vi.useFakeTimers({ toFake: ["Date"] })
      return Effect.gen(function* () {
        const { clientId, tokens: first } = yield* connect
        const second = tokensOf((yield* refresh(clientId, first.refresh)).body)
        const other = yield* register
        vi.setSystemTime(Date.now() + 60_000)
        assert.strictEqual((yield* refresh(other, first.refresh)).status, 400)
        callerOf(yield* call({ bearer: second.access }))
        assert.strictEqual(
          (yield* refresh(clientId, second.refresh)).status,
          200
        )
      })
    }
  )

  it.effect(
    "answers 200 for a token that is unknown or already revoked, as RFC 7009 asks",
    () => {
      stubGitHub(42)
      setup()
      return Effect.gen(function* () {
        const { clientId, tokens } = yield* connect
        for (const revoked of [tokens.refresh, tokens.access, "unknown"])
          assert.strictEqual(
            (yield* revoke({ token: revoked, client_id: clientId })).status,
            200
          )
        const stranger = yield* revoke({
          token: "unknown",
          client_id: "no-such-client",
        })
        assert.strictEqual((yield* json(stranger)).error, "invalid_client")
      })
    }
  )

  it.effect(
    "revokes a confidential client's grant only with that client's secret",
    () => {
      stubGitHub(42)
      setup()
      return Effect.gen(function* () {
        const registered = yield* json(
          yield* auth("/api/auth/oauth2/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              client_name: "Server app",
              redirect_uris: [redirectUri],
              token_endpoint_auth_method: "client_secret_basic",
              grant_types: ["authorization_code", "refresh_token"],
              response_types: ["code"],
            }),
          })
        )
        const clientId = String(registered.client_id)
        const basic = (secret: string) => ({
          Authorization: `Basic ${btoa(`${clientId}:${secret}`)}`,
        })
        const secret = String(registered.client_secret)
        const signedIn = yield* signInFromLoginPage(
          yield* authorizeRequest(clientId)
        )
        const redirect = yield* answerConsent(
          signedIn.next,
          signedIn.cookie,
          true
        )
        const exchanged = yield* token(
          {
            grant_type: "authorization_code",
            code: redirect.searchParams.get("code") ?? "",
            redirect_uri: redirectUri,
            code_verifier: verifier,
            resource,
          },
          basic(secret)
        )
        assert.strictEqual(
          exchanged.status,
          200,
          JSON.stringify(exchanged.body)
        )
        const tokens = tokensOf(exchanged.body)

        const revokeAs = (headers: Record<string, string>, values = {}) =>
          auth("/api/auth/oauth2/revoke", {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              ...headers,
            },
            body: new URLSearchParams({
              token: tokens.refresh,
              token_type_hint: "refresh_token",
              ...values,
            }).toString(),
          })
        for (const refused of [
          yield* revokeAs({}, { client_id: clientId }),
          yield* revokeAs(basic("not-the-secret")),
        ])
          assert.strictEqual((yield* json(refused)).error, "invalid_client")
        callerOf(yield* call({ bearer: tokens.access }))

        assert.strictEqual((yield* revokeAs(basic(secret))).status, 200)
        assert.strictEqual(
          refusal(yield* call({ bearer: tokens.access })).status,
          401
        )
      })
    }
  )
})
