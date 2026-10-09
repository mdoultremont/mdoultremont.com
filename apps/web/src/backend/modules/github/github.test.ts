import { assert, describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { vi } from "vitest"
import { GitHub } from "."

function setup() {
  const fetcher = vi.fn<typeof fetch>()
  const layer = GitHub.layer.pipe(
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          GITHUB_CLIENT_ID: "client",
          GITHUB_CLIENT_SECRET: "secret",
          GITHUB_REDIRECT_URI: "https://example.com/api/auth/github/callback",
        })
      )
    )
  )
  return {
    fetcher,
    run: <A, E>(body: Effect.Effect<A, E, GitHub>) =>
      body.pipe(
        Effect.provide(layer),
        Effect.provideService(FetchHttpClient.Fetch, fetcher)
      ),
  }
}

describe("GitHub", () => {
  it.effect("exchanges the code and reads the account", () => {
    const t = setup()
    t.fetcher
      .mockResolvedValueOnce(Response.json({ access_token: "token" }))
      .mockResolvedValueOnce(
        Response.json({ id: 42, login: "matthieu", name: null, extra: true })
      )
    return t.run(
      Effect.gen(function* () {
        const github = yield* GitHub
        assert.deepStrictEqual(yield* github.identify("code"), {
          id: "42",
          login: "matthieu",
          name: null,
          avatarUrl: null,
        })
        const profileRequest = t.fetcher.mock.calls[1]![1]
        expect(new Headers(profileRequest?.headers).get("authorization")).toBe(
          "Bearer token"
        )
        const url = new URL(github.authorizationUrl("state"))
        assert.strictEqual(url.searchParams.get("scope"), "read:user")
      })
    )
  })

  it.effect("treats a 200 without an access token as a rejected code", () => {
    const t = setup()
    t.fetcher.mockResolvedValueOnce(
      Response.json({ error: "bad_verification_code" })
    )
    return t.run(
      Effect.gen(function* () {
        const github = yield* GitHub
        const error = yield* Effect.flip(github.identify("stale"))
        assert.strictEqual(error.reason, "CodeRejected")
        expect(t.fetcher).toHaveBeenCalledOnce()
      })
    )
  })
})
