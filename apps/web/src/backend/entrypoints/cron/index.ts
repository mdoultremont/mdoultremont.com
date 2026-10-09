import { Config, Effect, Layer } from "effect"
import { MusicPipeline } from "@/backend/features/music/pipeline"
import { platformLayer } from "../platform"

/** Hourly trigger from wrangler.jsonc. Keeps the owner's music pipeline moving. */
export function runScheduled(
  _controller: ScheduledController,
  bindings: Cloudflare.Env
): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const ownerId = yield* Config.NonEmptyString("GITHUB_OWNER_ID")
      const pipeline = yield* MusicPipeline
      yield* pipeline.scheduled(ownerId)
    }).pipe(
      Effect.provide(
        MusicPipeline.layer.pipe(Layer.provide(platformLayer(bindings)))
      ),
      Effect.catchCause((cause) =>
        Effect.logError("Scheduled music upkeep failed", cause)
      )
    )
  )
}
