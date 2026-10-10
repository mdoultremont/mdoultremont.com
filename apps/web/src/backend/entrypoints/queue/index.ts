import { Effect, Layer, Schema } from "effect"
import {
  isRetryable,
  MusicPipeline,
  type PipelineError,
  PipelineMessage,
} from "@/backend/features/music/pipeline"
import { platformLayer } from "../platform"

/** Matches the consumer's `max_retries` in wrangler.jsonc. */
const maxAttempts = 10

const retryDelaySeconds = (error: PipelineError, attempts: number) =>
  ("retryAfterSeconds" in error ? error.retryAfterSeconds : undefined) ??
  Math.min(300, 2 ** attempts)

/**
 * Handles one message: success acks it, a retryable failure retries it with
 * backoff, and anything else is handed back to the pipeline to record, then
 * acked. Unknown messages are dropped.
 */
export const handleMessage = (message: Message<unknown>) =>
  Effect.gen(function* () {
    const decoded = Schema.decodeUnknownOption(PipelineMessage)(message.body)
    if (decoded._tag === "None") {
      yield* Effect.logWarning("Dropping unknown queue message", message.body)
      return message.ack()
    }
    const pipeline = yield* MusicPipeline
    yield* pipeline.handle(decoded.value).pipe(
      Effect.andThen(Effect.sync(() => message.ack())),
      Effect.catch((error) =>
        isRetryable(error) && message.attempts < maxAttempts
          ? Effect.sync(() =>
              message.retry({
                delaySeconds: retryDelaySeconds(error, message.attempts),
              })
            )
          : pipeline.giveUp(decoded.value, error).pipe(
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
        MusicPipeline.layer.pipe(Layer.provide(platformLayer(bindings)))
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
