import { RunTrackError } from "@/backend/workflows/music-runs"
import { Effect } from "effect"
import { musicRunRuntime } from "@/backend/modules/music-run-runtime"
import { consumeLikesBaselineBatch } from "./likes-baseline-queue"

export function isMusicRunMessage(
  value: unknown
): value is { kind: "music-run"; runId: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "music-run" &&
    "runId" in value &&
    typeof value.runId === "string" &&
    value.runId.length > 0
  )
}
export async function consumeMusicBatch(
  batch: MessageBatch<unknown>,
  bindings: Cloudflare.Env
) {
  const runtime = musicRunRuntime(bindings)
  for (const message of batch.messages) {
    if (!isMusicRunMessage(message.body)) {
      await consumeLikesBaselineBatch(
        { ...batch, messages: [message] },
        bindings
      )
      continue
    }
    try {
      await Effect.runPromise(runtime.process(message.body.runId))
      message.ack()
    } catch (cause) {
      if (
        (cause instanceof RunTrackError && !cause.retryable) ||
        message.attempts >= 10
      ) {
        await runtime.store.fail(
          message.body.runId,
          cause instanceof RunTrackError && !cause.retryable
            ? cause.message
            : "Repeated provider or delivery failures. Start a new run to recover unfinished tracks."
        )
        message.ack()
      } else
        message.retry({
          delaySeconds: Math.min(
            43200,
            Math.max(
              Math.min(300, 2 ** message.attempts),
              cause instanceof RunTrackError
                ? (cause.retryAfterSeconds ?? 0)
                : 0
            )
          ),
        })
    }
  }
}
export async function scheduledMusic(
  _event: ScheduledController,
  bindings: Cloudflare.Env
) {
  const runtime = musicRunRuntime(bindings)
  const ownerId = bindings.GITHUB_OWNER_ID
  if (!ownerId) return
  // Recovery applies even while paused; the switch gates new scheduled starts only.
  await runtime.recover(ownerId)
  try {
    await runtime.start(ownerId, "catchup", true)
  } catch (error) {
    console.warn("Scheduled music start skipped", {
      error: error instanceof Error ? error.message : "Unknown error",
    })
  }
}
