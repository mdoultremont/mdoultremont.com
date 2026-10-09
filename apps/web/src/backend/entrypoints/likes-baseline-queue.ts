import { Effect } from "effect"
import { likesBaselineLayer } from "@/backend/modules/likes-baseline-runtime"
import { SpotifyError } from "@/backend/modules/spotify"
import {
  BaselineError,
  BaselineStore,
  processLikesBaselinePage,
} from "@/backend/workflows/likes-baseline"

export interface LikesBaselineMessage {
  readonly kind: "likes-baseline"
  readonly runId: string
}

export function isLikesBaselineMessage(
  value: unknown
): value is LikesBaselineMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "likes-baseline" &&
    "runId" in value &&
    typeof value.runId === "string" &&
    value.runId.length > 0
  )
}

export async function consumeLikesBaselineBatch(
  batch: MessageBatch<unknown>,
  bindings: Cloudflare.Env
): Promise<void> {
  const layer = likesBaselineLayer(bindings)
  for (const message of batch.messages) {
    if (!isLikesBaselineMessage(message.body)) {
      message.ack()
      continue
    }
    const runId = message.body.runId
    try {
      await Effect.runPromise(
        Effect.provide(processLikesBaselinePage(runId), layer)
      )
      message.ack()
    } catch (error) {
      const cause = error instanceof BaselineError ? error.cause : null
      const spotify = cause instanceof SpotifyError ? cause : null
      const permanent =
        spotify?.reason._tag === "ReconnectNeeded" ||
        spotify?.reason._tag === "NotConnected" ||
        (error instanceof BaselineError && error.code === "invalid_page")
      if (permanent || message.attempts >= 10) {
        const explanation =
          permanent && spotify
            ? spotify.message
            : "Initialization stopped after repeated errors. Retry to continue from the saved page."
        try {
          await Effect.runPromise(
            Effect.provide(
              Effect.gen(function* () {
                const store = yield* BaselineStore
                yield* store.fail(runId, explanation, Date.now())
              }),
              layer
            )
          )
          message.ack()
        } catch {
          message.retry({ delaySeconds: 30 })
        }
      } else {
        message.retry({
          delaySeconds:
            spotify?.retryAfterSeconds ?? Math.min(300, 2 ** message.attempts),
        })
      }
    }
  }
}
