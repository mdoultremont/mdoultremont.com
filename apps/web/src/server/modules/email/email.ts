import { Config, Context, Data, Effect, Layer, Option } from "effect"

export interface EmailMessage {
  readonly to: string
  readonly subject: string
  readonly text: string
  readonly html: string
}

export class EmailError extends Data.TaggedError("EmailError")<{
  /** Cloudflare's error code, such as `E_RECIPIENT_SUPPRESSED`, when it gave one. */
  readonly code: string | undefined
  readonly cause: unknown
}> {
  override get message() {
    return "The email could not be sent"
  }
}

const codeOf = (cause: unknown) =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  typeof cause.code === "string"
    ? cause.code
    : undefined

/** Sends transactional email through Cloudflare Email Service, from EMAIL_FROM. */
export class Email extends Context.Service<
  Email,
  {
    readonly send: (message: EmailMessage) => Effect.Effect<void, EmailError>
  }
>()("server/modules/Email") {
  /** Needs the `send_email` binding. Without EMAIL_FROM, sending fails but nothing else does. */
  static readonly layer = (binding: SendEmail) =>
    Layer.effect(
      Email,
      Effect.gen(function* () {
        const from = yield* Config.option(Config.NonEmptyString("EMAIL_FROM"))
        return Email.of({
          send: Effect.fn("Email.send")(function* (message) {
            if (Option.isNone(from))
              return yield* new EmailError({
                code: undefined,
                cause: "EMAIL_FROM is not set",
              })
            yield* Effect.tryPromise({
              try: () => binding.send({ from: from.value, ...message }),
              catch: (cause) => new EmailError({ code: codeOf(cause), cause }),
            })
          }),
        })
      })
    )
}
