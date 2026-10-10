import { Effect, Layer } from "effect"
import { OwnerAuth } from "@/backend/features/auth"
import { MusicPipeline } from "@/backend/features/music/pipeline"
import { platformLayer } from "../platform"

/** Hourly trigger from wrangler.jsonc. Keeps each owner's music pipeline moving. */
export function runScheduled(
  _controller: ScheduledController,
  bindings: Cloudflare.Env
): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const ownerIds = yield* OwnerAuth.use((auth) => auth.ownerIds())
      const pipeline = yield* MusicPipeline
      yield* Effect.forEach(
        ownerIds,
        (ownerId) => pipeline.scheduled(ownerId),
        {
          discard: true,
        }
      )
    }).pipe(
      Effect.provide(
        Layer.mergeAll(OwnerAuth.layer, MusicPipeline.layer).pipe(
          Layer.provide(platformLayer(bindings))
        )
      ),
      Effect.catchCause((cause) =>
        Effect.logError("Scheduled music upkeep failed", cause)
      )
    )
  )
}
