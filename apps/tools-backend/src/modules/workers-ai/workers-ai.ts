import { Context, Data, Effect, Layer, Schema } from "effect"

export const textGenerationModel = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"

export class WorkersAiError extends Data.TaggedError("WorkersAiError")<{
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
        return "Workers AI refused this input"
      case "InvalidResponse":
        return "Workers AI returned an answer that could not be read"
      default:
        return "Workers AI is temporarily unavailable"
    }
  }

  get retryable() {
    return this.reason === "RateLimited" || this.reason === "Unavailable"
  }
}

function failureReason(cause: unknown): WorkersAiError["reason"] {
  const code = /^(\d+):/.exec(
    cause instanceof Error ? cause.message : String(cause)
  )?.[1]
  switch (code) {
    case "3036":
    case "3040":
      return "RateLimited"
    case "3003":
    case "3006":
    case "3023":
    case "3041":
    case "3042":
    case "5004":
    case "5007":
    case "5016":
    case "5018":
    case "5019":
    case "5035":
    case "7003":
      return "Rejected"
    default:
      return "Unavailable"
  }
}

const Response = Schema.Struct({ response: Schema.Unknown })

export class WorkersAi extends Context.Service<
  WorkersAi,
  {
    readonly generate: <A>(input: {
      readonly instructions: string
      readonly data: unknown
      readonly schema: Schema.Codec<A, unknown>
    }) => Effect.Effect<A, WorkersAiError>
  }
>()("server/modules/WorkersAi") {
  static readonly layer = (binding: Ai) =>
    Layer.succeed(
      WorkersAi,
      WorkersAi.of({
        generate: Effect.fn("WorkersAi.generate")(function* <A>(input: {
          readonly instructions: string
          readonly data: unknown
          readonly schema: Schema.Codec<A, unknown>
        }) {
          const document = Schema.toJsonSchemaDocument(input.schema)
          const raw = yield* Effect.tryPromise({
            try: () =>
              binding.run(textGenerationModel, {
                messages: [
                  { role: "system", content: input.instructions },
                  { role: "user", content: JSON.stringify(input.data) },
                ],
                response_format: {
                  type: "json_schema",
                  json_schema: {
                    ...document.schema,
                    $defs: document.definitions,
                  },
                },
                max_tokens: 1800,
                temperature: 0.6,
              }),
            catch: (cause) =>
              new WorkersAiError({ reason: failureReason(cause), cause }),
          }).pipe(
            Effect.timeoutOrElse({
              duration: "30 seconds",
              orElse: () =>
                Effect.fail(
                  new WorkersAiError({
                    reason: "Unavailable",
                    cause: "Text generation timed out",
                  })
                ),
            })
          )
          return yield* Schema.decodeUnknownEffect(Response)(raw).pipe(
            Effect.flatMap((body) =>
              Schema.decodeUnknownEffect(
                Schema.Union([
                  input.schema,
                  Schema.fromJsonString(input.schema),
                ])
              )(body.response)
            ),
            Effect.mapError(
              (cause) =>
                new WorkersAiError({ reason: "InvalidResponse", cause })
            )
          )
        }),
      })
    )
}
