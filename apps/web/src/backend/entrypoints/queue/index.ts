import { Effect, Layer, Schema } from "effect"
import {
  type IngestionError,
  IngestionMessage,
  MusicIngestion,
} from "@/backend/features/music/ingestion"
import { platformLayer } from "../platform"

/** Every message the queue carries. Add one schema per pipeline step. */
const QueueMessage = Schema.Union([IngestionMessage])

/** Matches the consumer's `max_retries` in wrangler.jsonc. */
const maxAttempts = 10

const retryable = (error: IngestionError) =>
  error._tag === "SpotifyError"
    ? error.retryable
    : error._tag !== "InvalidLikesPage"

const retryDelaySeconds = (error: IngestionError, attempts: number) =>
  (error._tag === "SpotifyError" ? error.retryAfterSeconds : undefined) ??
  Math.min(300, 2 ** attempts)

/**
 * Handles one message: success acks it, a retryable failure retries it with
 * backoff, and anything else marks the work as failed so the UI can offer to
 * start again. Unknown messages are dropped.
 */
export const handleMessage = (message: Message<unknown>) =>
  Effect.gen(function* () {
    const decoded = Schema.decodeUnknownOption(QueueMessage)(message.body)
    if (decoded._tag === "None") {
      yield* Effect.logWarning("Dropping unknown queue message", message.body)
      return message.ack()
    }
    const ingestion = yield* MusicIngestion
    const { ingestionId } = decoded.value
    yield* ingestion.processNext(ingestionId).pipe(
      Effect.andThen(Effect.sync(() => message.ack())),
      Effect.catch((error) =>
        retryable(error) && message.attempts < maxAttempts
          ? Effect.sync(() =>
              message.retry({
                delaySeconds: retryDelaySeconds(error, message.attempts),
              })
            )
          : ingestion.fail(ingestionId, error.message).pipe(
              Effect.andThen(Effect.sync(() => message.ack())),
              // If even recording the failure fails, let the queue try again.
              Effect.catch(() =>
                Effect.sync(() => message.retry({ delaySeconds: 30 }))
              )
            )
      )
    )
  })

/** Worker `queue` handler. Builds the layers once per batch. */
export function consumeQueue(
  batch: MessageBatch<unknown>,
  bindings: Cloudflare.Env
): Promise<void> {
  return Effect.runPromise(
    Effect.forEach(batch.messages, handleMessage, { discard: true }).pipe(
      Effect.provide(
        MusicIngestion.layer.pipe(Layer.provide(platformLayer(bindings)))
      ),
      // Missing configuration or another defect retries the whole batch.
      Effect.catchCause((cause) =>
        Effect.logError("Queue batch failed", cause).pipe(
          Effect.andThen(
            Effect.sync(() => batch.retryAll({ delaySeconds: 60 }))
          )
        )
      )
    )
  )
}
