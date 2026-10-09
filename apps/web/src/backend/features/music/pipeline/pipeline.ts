import { Context, Effect, Layer, Schema } from "effect"
import {
  type EnrichmentError,
  EnrichmentMessage,
  type EnrichmentPersistenceError,
  MusicEnrichment,
} from "@/backend/features/music/enrichment"
import {
  type IngestionError,
  IngestionMessage,
  type IngestionPersistenceError,
  MusicIngestion,
} from "@/backend/features/music/ingestion"
import type { JobQueueError } from "@/backend/primitives/job-queue"

/** Every queue message of the music pipeline. */
export const PipelineMessage = Schema.Union([
  IngestionMessage,
  EnrichmentMessage,
])
export type PipelineMessage = typeof PipelineMessage.Type

export type PipelineError = IngestionError | EnrichmentError

/** True when the same message may succeed later without the owner doing anything. */
export function isRetryable(error: PipelineError): boolean {
  switch (error._tag) {
    case "SpotifyError":
    case "MusicBrainzError":
    case "AcousticBrainzError":
      return error.retryable
    case "InvalidLikesPage":
      return false
    case "IngestionPersistenceError":
    case "EnrichmentPersistenceError":
    case "JobQueueError":
      return true
  }
}

/**
 * The music pipeline: runs each step's queued work and starts the next step
 * when there is something for it. Ingestion feeds enrichment.
 */
export class MusicPipeline extends Context.Service<
  MusicPipeline,
  {
    readonly handle: (
      message: PipelineMessage
    ) => Effect.Effect<void, PipelineError>
    /** Called when a message will not be retried again. */
    readonly giveUp: (
      message: PipelineMessage,
      error: PipelineError
    ) => Effect.Effect<void, IngestionPersistenceError>
    /** Hourly upkeep for every step. */
    readonly scheduled: (
      ownerId: string
    ) => Effect.Effect<
      void,
      IngestionPersistenceError | EnrichmentPersistenceError | JobQueueError
    >
  }
>()("backend/features/music/MusicPipeline") {
  static readonly layerNoDeps = Layer.effect(
    MusicPipeline,
    Effect.gen(function* () {
      const ingestion = yield* MusicIngestion
      const enrichment = yield* MusicEnrichment

      const handle = Effect.fn("MusicPipeline.handle")(function* (
        message: PipelineMessage
      ) {
        switch (message.kind) {
          case "music.ingestion": {
            const { added } = yield* ingestion.processNext(message.ingestionId)
            // Enrichment starts during ingestion, not after it.
            if (added > 0) yield* enrichment.request()
            return
          }
          case "music.enrichment":
            yield* enrichment.processNext()
            return
        }
      })

      const giveUp = Effect.fn("MusicPipeline.giveUp")(function* (
        message: PipelineMessage,
        error: PipelineError
      ) {
        switch (message.kind) {
          case "music.ingestion":
            yield* ingestion.fail(message.ingestionId, error.message)
            return
          case "music.enrichment":
            // Unresolved ISRCs stay pending; the next hourly upkeep tries again.
            yield* Effect.logWarning(
              "Enrichment batch abandoned",
              error.message
            )
            return
        }
      })

      const scheduled = Effect.fn("MusicPipeline.scheduled")(function* (
        ownerId: string
      ) {
        yield* ingestion.scheduled(ownerId)
        const { pending } = yield* enrichment.status(ownerId)
        if (pending > 0) yield* enrichment.request()
      })

      return MusicPipeline.of({ handle, giveUp, scheduled })
    })
  )

  /** Production layer. Needs the platform (`Database`, `JobQueue`, config). */
  static readonly layer = MusicPipeline.layerNoDeps.pipe(
    Layer.provide(Layer.mergeAll(MusicIngestion.layer, MusicEnrichment.layer))
  )
}
