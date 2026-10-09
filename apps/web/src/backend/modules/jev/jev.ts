import { Config, Context, Data, Effect, Layer, Redacted, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"

export class JevError extends Data.TaggedError("JevError")<{
  readonly reason:
    | "RateLimited"
    | "Unavailable"
    | "Unauthorized"
    | "InvalidResponse"
  readonly retryAfterSeconds?: number
  readonly cause?: unknown
}> {
  override get message() {
    switch (this.reason) {
      case "Unauthorized":
        return "Jev rejected the API key"
      case "InvalidResponse":
        return "Jev returned an answer that could not be read"
      default:
        return "Jev is temporarily unavailable"
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
 * TypeSafe's Jev "System One" API. Asks yes/no ("noul") questions about a
 * state and returns a probability for each. Knows nothing about music.
 */
export class Jev extends Context.Service<
  Jev,
  {
    readonly noul: (input: {
      readonly model: string
      readonly state: unknown
      /** Instructions keyed by an answer key of the caller's choosing. */
      readonly questions: Readonly<Record<string, string>>
    }) => Effect.Effect<
      {
        /** The exact model version that answered. */
        readonly model: string
        readonly probabilities: Readonly<Record<string, number>>
      },
      JevError
    >
  }
>()("backend/modules/Jev") {
  static readonly layer = Layer.effect(
    Jev,
    Effect.gen(function* () {
      const apiKey = yield* Config.schema(
        Schema.Redacted(Schema.NonEmptyString),
        "JEV_API_KEY"
      )
      const http = yield* HttpClient.HttpClient

      const noul = Effect.fn("Jev.noul")(function* (input: {
        readonly model: string
        readonly state: unknown
        readonly questions: Readonly<Record<string, string>>
      }) {
        const keys = Object.keys(input.questions)
        if (keys.length === 0) return { model: input.model, probabilities: {} }
        const response = yield* HttpClientRequest.post(
          "https://api.typesafe.ai/v1/systemone"
        ).pipe(
          HttpClientRequest.bearerToken(Redacted.value(apiKey)),
          HttpClientRequest.bodyJsonUnsafe({
            model: input.model,
            state: input.state,
            questions: Object.fromEntries(
              keys.map((key) => [
                key,
                { type: "noul", instructions: input.questions[key] },
              ])
            ),
          }),
          http.execute,
          Effect.mapError(
            (cause) => new JevError({ reason: "Unavailable", cause })
          )
        )
        if (response.status === 401 || response.status === 403)
          return yield* new JevError({ reason: "Unauthorized" })
        if (response.status === 429) {
          const header = Number(response.headers["retry-after"])
          return yield* new JevError({
            reason: "RateLimited",
            retryAfterSeconds:
              Number.isFinite(header) && header >= 0 ? header : undefined,
          })
        }
        if (response.status >= 500)
          return yield* new JevError({ reason: "Unavailable" })
        if (response.status < 200 || response.status >= 300)
          return yield* new JevError({
            reason: "InvalidResponse",
            cause: `Jev returned ${response.status}`,
          })
        const body = yield* response.json.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Answers)),
          Effect.mapError(
            (cause) => new JevError({ reason: "InvalidResponse", cause })
          )
        )
        const probabilities: Record<string, number> = {}
        for (const key of keys) {
          const answer = body.answers[key]
          if (!answer)
            return yield* new JevError({
              reason: "InvalidResponse",
              cause: `Jev did not answer ${key}`,
            })
          probabilities[key] = answer.noul
        }
        return { model: body.model, probabilities }
      })

      return Jev.of({ noul })
    })
  ).pipe(Layer.provide(FetchHttpClient.layer))
}
