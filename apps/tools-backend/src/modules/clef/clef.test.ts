import { assert, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { vi } from "vitest"
import { Clef } from "."

function setup() {
  const run = vi.fn<(model: string, inputs: unknown) => Promise<unknown>>()
  return {
    run,
    provide: <A, E>(body: Effect.Effect<A, E, Clef>) =>
      body.pipe(Effect.provide(Clef.layer({ run } as unknown as Ai))),
  }
}

const ask = Clef.use((clef) =>
  clef.noul({
    model: "clef",
    state: { recording: { title: "Yellow Submarine" } },
    questions: { jazz: "Is this jazz?", pop: "Is this pop?" },
  })
)

/** What the binding throws, per a live call on 2026-10-18. */
const upstreamError = (message: string) =>
  Object.assign(new Error(message), { name: "AiGatewayError" })

describe("Clef", () => {
  it.effect("asks every question and returns each yes-probability", () => {
    const t = setup()
    // Shape recorded from a live call on 2026-10-18.
    t.run.mockResolvedValue({
      model: "clef",
      answers: {
        jazz: { type: "noul", noul: 0.0116 },
        pop: { type: "noul", noul: 0.9262 },
      },
      usage: { input_tokens: 266, output_tokens: 0 },
    })
    return t.provide(
      Effect.gen(function* () {
        assert.deepStrictEqual(yield* ask, {
          model: "clef",
          probabilities: { jazz: 0.0116, pop: 0.9262 },
        })
        const [model, inputs] = t.run.mock.calls[0]!
        assert.strictEqual(model, "@cf/cloudflare/clef")
        expect(inputs).toMatchObject({
          questions: { pop: { type: "noul", instructions: "Is this pop?" } },
        })
      })
    )
  })

  it.effect("fails when an answer is missing", () => {
    const t = setup()
    t.run.mockResolvedValue({
      model: "clef",
      answers: { jazz: { type: "noul", noul: 0.02 } },
    })
    return t.provide(
      Effect.gen(function* () {
        const error = yield* Effect.flip(ask)
        assert.strictEqual(error.reason, "InvalidResponse")
        assert.isFalse(error.retryable)
      })
    )
  })

  it.effect("reads the Workers AI error code from the binding's error", () => {
    const t = setup()
    t.run
      .mockRejectedValueOnce(upstreamError("3040: Out of capacity"))
      .mockRejectedValueOnce(upstreamError("7003: User Input Error"))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
    return t.provide(
      Effect.gen(function* () {
        const reasons = []
        for (let i = 0; i < 3; i++) {
          const error = yield* Effect.flip(ask)
          reasons.push([error.reason, error.retryable])
        }
        assert.deepStrictEqual(reasons, [
          ["RateLimited", true],
          ["Rejected", false],
          ["Unavailable", true],
        ])
      })
    )
  })
})
