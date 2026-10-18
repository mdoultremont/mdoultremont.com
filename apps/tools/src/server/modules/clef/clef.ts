import { Context, Data, Effect, Layer, Schema } from "effect"

export class ClefError extends Data.TaggedError("ClefError")<{
  readonly reason:
    | "RateLimited"
    | "Unavailable"
    | "Rejected"
    | "InvalidResponse"
  readonly cause?: unknown
}> {
  override get message() {
    switch (this.reason) {
      case "Rejected":
        return "Clef refused this input"
      case "InvalidResponse":
        return "Clef returned an answer that could not be read"
      default:
        return "Clef is temporarily unavailable"
    }
  }

  get retryable() {
    return this.reason === "RateLimited" || this.reason === "Unavailable"
  }
}

const Answers = Schema.Struct({
  model: Schema.String,
  answers: Schema.Record(
    Schema.String,
    Schema.Struct({
      type: Schema.Literal("noul"),
      noul: Schema.Finite.check(
        Schema.isGreaterThanOrEqualTo(0),
        Schema.isLessThanOrEqualTo(1)
      ),
    })
  ),
})

/**
 * The binding throws `InferenceUpstreamError` with the Workers AI error code
 * leading the message, as in `3040: Out of capacity`.
 */
function failureReason(cause: unknown): ClefError["reason"] {
  const code = /^(\d+):/.exec(
    cause instanceof Error ? cause.message : String(cause)
  )?.[1]
  switch (code) {
    case "3036":
    case "3040":
      return "RateLimited"
    case "3006":
    case "7003":
      return "Rejected"
    default:
      return "Unavailable"
  }
}

/**
 * Cloudflare's Clef decision model through the Workers AI binding. Asks
 * yes/no ("noul") questions about a state and returns a probability for each.
 * Knows nothing about music.
 */
export class Clef extends Context.Service<
  Clef,
  {
    readonly noul: (input: {
      readonly model: "clef" | "clef-flash"
      readonly state: unknown
      /** Instructions keyed by an answer key of the caller's choosing. */
      readonly questions: Readonly<Record<string, string>>
    }) => Effect.Effect<
      {
        /** The model that answered, as Clef names it. */
        readonly model: string
        readonly probabilities: Readonly<Record<string, number>>
      },
      ClefError
    >
  }
>()("server/modules/Clef") {
  /** Needs the `ai` binding. */
  static readonly layer = (binding: Ai) =>
    Layer.succeed(
      Clef,
      Clef.of({
        noul: Effect.fn("Clef.noul")(function* (input) {
          const keys = Object.keys(input.questions)
          if (keys.length === 0)
            return { model: input.model, probabilities: {} }
          const raw = yield* Effect.tryPromise({
            try: () =>
              binding.run(`@cf/cloudflare/${input.model}`, {
                state: input.state,
                questions: Object.fromEntries(
                  keys.map((key) => [
                    key,
                    { type: "noul", instructions: input.questions[key] },
                  ])
                ),
              }),
            catch: (cause) =>
              new ClefError({ reason: failureReason(cause), cause }),
          })
          const body = yield* Schema.decodeUnknownEffect(Answers)(raw).pipe(
            Effect.mapError(
              (cause) => new ClefError({ reason: "InvalidResponse", cause })
            )
          )
          const probabilities: Record<string, number> = {}
          for (const key of keys) {
            const answer = body.answers[key]
            if (!answer)
              return yield* new ClefError({
                reason: "InvalidResponse",
                cause: `Clef did not answer ${key}`,
              })
            probabilities[key] = answer.noul
          }
          return { model: body.model, probabilities }
        }),
      })
    )
}
