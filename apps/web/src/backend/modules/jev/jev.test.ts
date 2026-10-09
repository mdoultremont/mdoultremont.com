import { assert, describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { vi } from "vitest"
import { Jev } from "."

function setup() {
  const fetcher = vi.fn<typeof fetch>()
  const layer = Jev.layer.pipe(
    Layer.provide(
      ConfigProvider.layer(ConfigProvider.fromUnknown({ JEV_API_KEY: "key" }))
    )
  )
  return {
    fetcher,
    run: <A, E>(body: Effect.Effect<A, E, Jev>) =>
      body.pipe(
        Effect.provide(layer),
        Effect.provideService(FetchHttpClient.Fetch, fetcher)
      ),
  }
}

const ask = Jev.use((jev) =>
  jev.noul({
    model: "jev-1.13.0",
    state: { recording: { title: "Yellow Submarine" } },
    questions: { jazz: "Is this jazz?", pop: "Is this pop?" },
  })
)

describe("Jev", () => {
  it.effect("asks every question and returns each yes-probability", () => {
    const t = setup()
    // Shape recorded from a live call on 2026-10-09.
    t.fetcher.mockResolvedValue(
      Response.json({
        model: "jev-1.13.0",
        answers: {
          jazz: { type: "noul", noul: 0.02 },
          pop: { type: "noul", noul: 0.92 },
        },
        usage: { input_tokens: 434, output_tokens: 40 },
      })
    )
    return t.run(
      Effect.gen(function* () {
        assert.deepStrictEqual(yield* ask, {
          model: "jev-1.13.0",
          probabilities: { jazz: 0.02, pop: 0.92 },
        })
        const [url, init] = t.fetcher.mock.calls[0]!
        assert.strictEqual(String(url), "https://api.typesafe.ai/v1/systemone")
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer key"
        )
        const body = JSON.parse(
          new TextDecoder().decode(init?.body as Uint8Array)
        )
        expect(body).toMatchObject({
          model: "jev-1.13.0",
          questions: { pop: { type: "noul", instructions: "Is this pop?" } },
        })
      })
    )
  })

  it.effect("fails when an answer is missing", () => {
    const t = setup()
    t.fetcher.mockResolvedValue(
      Response.json({
        model: "jev-1.13.0",
        answers: { jazz: { type: "noul", noul: 0.02 } },
      })
    )
    return t.run(
      Effect.gen(function* () {
        const error = yield* Effect.flip(ask)
        assert.strictEqual(error.reason, "InvalidResponse")
        assert.isFalse(error.retryable)
      })
    )
  })

  it.effect("rate limits are retryable, a bad key is not", () => {
    const t = setup()
    t.fetcher
      .mockResolvedValueOnce(
        Response.json({}, { status: 429, headers: { "Retry-After": "9" } })
      )
      .mockResolvedValueOnce(Response.json({}, { status: 401 }))
    return t.run(
      Effect.gen(function* () {
        expect(yield* Effect.flip(ask)).toMatchObject({
          reason: "RateLimited",
          retryAfterSeconds: 9,
        })
        const unauthorized = yield* Effect.flip(ask)
        assert.strictEqual(unauthorized.reason, "Unauthorized")
        assert.isFalse(unauthorized.retryable)
      })
    )
  })
})
