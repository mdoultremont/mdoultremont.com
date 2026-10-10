import { afterEach, assert, describe, it } from "@effect/vitest"
import { ConfigProvider, Effect, Layer, Option } from "effect"
import { vi } from "vitest"
import { Database } from "@/backend/primitives/database"
import { makeTestD1 } from "@/backend/primitives/database/testing"
import { AuthGate, BetterAuth, SignInRejected } from "."

const baseURL = "http://127.0.0.1:3000"

/** GitHub's token and profile endpoints, answering for the given account. */
function stubGitHub(id: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.startsWith("https://github.com/login/oauth/access_token"))
        return Response.json({
          access_token: "github-token",
          token_type: "bearer",
          scope: "read:user,user:email",
        })
      if (url === "https://api.github.com/user")
        return Response.json({
          id,
          login: "matthieu",
          name: "Matthieu",
          email: "matthieu@example.com",
          avatar_url: null,
        })
      if (url === "https://api.github.com/user/emails")
        return Response.json([
          { email: "matthieu@example.com", primary: true, verified: true },
        ])
      return new Response("Unexpected request", { status: 500 })
    })
  )
}

function setup() {
  const d1 = makeTestD1()
  const layer = BetterAuth.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Database.layer(d1.binding),
        Layer.succeed(
          AuthGate,
          AuthGate.of({
            admit: (attempt) =>
              attempt.provider === "github" && attempt.accountId === "42"
                ? Effect.void
                : Effect.fail(
                    new SignInRejected({
                      code: "not_allowed",
                      description: "Not allowed",
                    })
                  ),
          })
        ),
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            BETTER_AUTH_SECRET: "test-secret-with-enough-entropy-1234567890",
            BETTER_AUTH_URL: baseURL,
            GITHUB_CLIENT_ID: "github-client",
            GITHUB_CLIENT_SECRET: "github-secret",
            SPOTIFY_CLIENT_ID: "spotify-client",
            SPOTIFY_CLIENT_SECRET: "spotify-secret",
          })
        )
      )
    )
  )
  return {
    d1,
    run: <A, E>(body: Effect.Effect<A, E, BetterAuth>) =>
      body.pipe(Effect.provide(layer), Effect.ensuring(Effect.sync(d1.close))),
  }
}

const cookiesOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ")

/** Runs a GitHub sign-in through Better Auth's real routes, up to the callback's redirect. */
const signInWithGitHub = Effect.fn(function* () {
  const auth = yield* BetterAuth
  const started = yield* auth.handler(
    new Request(`${baseURL}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseURL },
      body: JSON.stringify({
        provider: "github",
        callbackURL: "/music",
        errorCallbackURL: "/music",
      }),
    })
  )
  const { url } = (yield* Effect.promise(() => started.json())) as {
    url: string
  }
  const authorization = new URL(url)
  assert.strictEqual(authorization.host, "github.com")
  const callback = yield* auth.handler(
    new Request(
      `${baseURL}/api/auth/callback/github?code=code&state=${authorization.searchParams.get("state")}`,
      { headers: { Cookie: cookiesOf(started) } }
    )
  )
  return callback
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Better Auth on D1", () => {
  it.effect(
    "signs in through GitHub, stores the session, and encrypts provider tokens",
    () => {
      stubGitHub(42)
      const t = setup()
      return t.run(
        Effect.gen(function* () {
          const callback = yield* signInWithGitHub()
          assert.strictEqual(callback.status, 302)
          assert.strictEqual(callback.headers.get("Location"), "/music")

          const auth = yield* BetterAuth
          const session = yield* auth.session(
            new Headers({ Cookie: cookiesOf(callback) })
          )
          assert.deepStrictEqual(
            Option.map(session, ({ user }) => user.email),
            Option.some("matthieu@example.com")
          )
          const account = t.d1.sqlite
            .prepare(
              "SELECT provider_id, account_id, access_token FROM auth_accounts"
            )
            .get()
          assert.strictEqual(account?.provider_id, "github")
          assert.strictEqual(account?.account_id, "42")
          assert.notStrictEqual(account?.access_token, "github-token")
        })
      )
    }
  )

  it.effect("sends a refused account back with the gate's error code", () => {
    stubGitHub(7)
    const t = setup()
    return t.run(
      Effect.gen(function* () {
        const callback = yield* signInWithGitHub()
        const location = new URL(
          callback.headers.get("Location") ?? "",
          baseURL
        )
        assert.strictEqual(location.pathname, "/music")
        assert.strictEqual(location.searchParams.get("error"), "not_allowed")
        assert.strictEqual(
          t.d1.sqlite.prepare("SELECT count(*) AS users FROM auth_users").get()
            ?.users,
          0
        )
        const auth = yield* BetterAuth
        assert.isTrue(
          Option.isNone(
            yield* auth.session(new Headers({ Cookie: cookiesOf(callback) }))
          )
        )
      })
    )
  })

  it.effect("has no session without a cookie", () => {
    const t = setup()
    return t.run(
      BetterAuth.use((auth) => auth.session(new Headers())).pipe(
        Effect.map((session) => assert.isTrue(Option.isNone(session)))
      )
    )
  })
})
