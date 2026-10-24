import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { vi } from "vitest"
import { WorkersAi } from "."

const ask = WorkersAi.use((ai) =>
  ai.generate({
    instructions: "Return a JSON answer.",
    data: { topic: "test" },
    schema: Schema.Struct({ answer: Schema.String }),
  })
)

function setup() {
  const run = vi.fn<(model: string, input: unknown) => Promise<unknown>>()
  return {
    run,
    provide: <A, E>(body: Effect.Effect<A, E, WorkersAi>) =>
      body.pipe(Effect.provide(WorkersAi.layer({ run } as unknown as Ai))),
  }
}

describe("Workers AI structured generation", () => {
  for (const response of [{ answer: "hello" }, '{"answer":"hello"}']) {
    it.effect(`decodes a ${typeof response} response`, () => {
      const t = setup()
      t.run.mockResolvedValue({ response })
      return t.provide(
        Effect.gen(function* () {
          expect(yield* ask).toEqual({ answer: "hello" })
          expect(t.run.mock.calls[0]?.[1]).toMatchObject({
            messages: [
              { role: "system", content: "Return a JSON answer." },
              { role: "user", content: '{"topic":"test"}' },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                type: "object",
                properties: { answer: { type: "string" } },
              },
            },
          })
        })
      )
    })
  }

  for (const [message, reason, retryable] of [
    ["3036: Account limited", "RateLimited", true],
    ["3040: Out of capacity", "RateLimited", true],
    ["3007: Request timeout", "Unavailable", true],
    ["3008: Request aborted", "Unavailable", true],
    ["3006: Request too large", "Rejected", false],
    ["5007: No such model", "Rejected", false],
    ["5035: Model requires Workers Paid plan", "Rejected", false],
    ["7003: User Input Error", "Rejected", false],
    ["fetch failed", "Unavailable", true],
  ] as const) {
    it.effect(`maps ${message} to a typed failure`, () => {
      const t = setup()
      t.run.mockRejectedValue(new Error(message))
      return t.provide(
        Effect.gen(function* () {
          expect(yield* Effect.flip(ask)).toMatchObject({
            _tag: "WorkersAiError",
            reason,
            retryable,
          })
        })
      )
    })
  }

  for (const raw of [{}, { response: null }, { response: { answer: 42 } }]) {
    it.effect(`rejects ${JSON.stringify(raw)} without a defect`, () => {
      const t = setup()
      t.run.mockResolvedValue(raw)
      return t.provide(
        Effect.gen(function* () {
          expect(yield* Effect.flip(ask)).toMatchObject({
            reason: "InvalidResponse",
            retryable: false,
          })
        })
      )
    })
  }
})
