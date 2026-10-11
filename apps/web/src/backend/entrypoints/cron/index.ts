import { Effect, Layer } from "effect"
import { UserAuth } from "@/backend/features/auth"
import { MusicPipeline } from "@/backend/features/music/pipeline"
import { platformLayer } from "../platform"

/** Hourly trigger from wrangler.jsonc. Keeps the music pipeline moving for every user of the music app. */
export function runScheduled(
  _controller: ScheduledController,
  bindings: Cloudflare.Env
): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const ownerIds = yield* UserAuth.use((auth) => auth.userIds("music"))
      const pipeline = yield* MusicPipeline
      // One user's failure must not hold up the others.
      yield* Effect.forEach(
        ownerIds,
        (ownerId) =>
          pipeline
            .scheduled(ownerId)
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logError("Scheduled music upkeep failed", ownerId, cause)
              )
            ),
        { discard: true }
      )
    }).pipe(
      Effect.provide(
        Layer.mergeAll(UserAuth.layer, MusicPipeline.layer).pipe(
          Layer.provide(platformLayer(bindings))
        )
      ),
      Effect.catchCause((cause) =>
        Effect.logError("Scheduled music upkeep failed", cause)
      )
    )
  )
}
