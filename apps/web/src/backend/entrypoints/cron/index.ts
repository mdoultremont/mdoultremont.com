import { Config, Effect, Layer } from "effect"
import { MusicIngestion } from "@/backend/features/music/ingestion"
import { platformLayer } from "../platform"

/** Hourly trigger from wrangler.jsonc. Keeps the owner's music pipeline moving. */
export function runScheduled(
  _controller: ScheduledController,
  bindings: Cloudflare.Env
): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const ownerId = yield* Config.NonEmptyString("GITHUB_OWNER_ID")
      const ingestion = yield* MusicIngestion
      yield* ingestion.scheduled(ownerId)
    }).pipe(
      Effect.provide(
        MusicIngestion.layer.pipe(Layer.provide(platformLayer(bindings)))
      ),
      Effect.catchCause((cause) =>
        Effect.logError("Scheduled music upkeep failed", cause)
      )
    )
  )
}
