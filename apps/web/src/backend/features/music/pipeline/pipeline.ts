import { Context, Effect, Layer, Schema } from "effect"
import {
  type ClassificationError,
  ClassificationMessage,
  type ClassificationPersistenceError,
  MusicClassification,
} from "@/backend/features/music/classification"
import {
  type DeliveryError,
  DeliveryMessage,
  type DeliveryPersistenceError,
  MusicDelivery,
} from "@/backend/features/music/delivery"
import {
  type DestinationPersistenceError,
  Destinations,
  type SetupIncomplete,
} from "@/backend/features/music/destinations"
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
  ClassificationMessage,
  DeliveryMessage,
])
export type PipelineMessage = typeof PipelineMessage.Type

export type PipelineError =
  | IngestionError
  | EnrichmentError
  | ClassificationError
  | DeliveryError

/** True when the same message may succeed later without the owner doing anything. */
export function isRetryable(error: PipelineError): boolean {
  switch (error._tag) {
    case "SpotifyError":
    case "MusicBrainzError":
    case "AcousticBrainzError":
    case "JevError":
      return error.retryable
    case "InvalidLikesPage":
      return false
    case "IngestionPersistenceError":
    case "EnrichmentPersistenceError":
    case "ClassificationPersistenceError":
    case "DestinationPersistenceError":
    case "DeliveryPersistenceError":
    case "JobQueueError":
      return true
  }
}

/**
 * The music pipeline: runs each step's queued work and starts the next step
 * when there is something for it.
 *
 *   ingestion ──► enrichment ──► classification ──► delivery
 *        │                       (once Ready)       (Write now, or automatic)
 *        └──────────────────────► classification (tracks without an ISRC)
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
    /** Marks the setup Ready (or not) and starts classification when it is. */
    readonly setReady: (
      ownerId: string,
      ready: boolean
    ) => Effect.Effect<
      boolean,
      SetupIncomplete | DestinationPersistenceError | JobQueueError
    >
    /** Hourly upkeep for every step. */
    readonly scheduled: (
      ownerId: string
    ) => Effect.Effect<
      void,
      | IngestionPersistenceError
      | EnrichmentPersistenceError
      | ClassificationPersistenceError
      | DestinationPersistenceError
      | DeliveryPersistenceError
      | JobQueueError
    >
  }
>()("backend/features/music/MusicPipeline") {
  static readonly layerNoDeps = Layer.effect(
    MusicPipeline,
    Effect.gen(function* () {
      const ingestion = yield* MusicIngestion
      const enrichment = yield* MusicEnrichment
      const classification = yield* MusicClassification
      const destinations = yield* Destinations
      const delivery = yield* MusicDelivery

      const handle = Effect.fn("MusicPipeline.handle")(function* (
        message: PipelineMessage
      ) {
        switch (message.kind) {
          case "music.ingestion": {
            const page = yield* ingestion.processNext(message.ingestionId)
            if (page.ownerId === null || page.added === 0) return
            // Enrichment starts during ingestion, not after it. Tracks
            // without an ISRC can be classified straight away.
            yield* enrichment.request(page.ownerId)
            yield* classification.request(page.ownerId)
            return
          }
          case "music.enrichment": {
            const { looked } = yield* enrichment.processNext(message.ownerId)
            if (looked > 0) yield* classification.request(message.ownerId)
            return
          }
          case "music.classification": {
            const { decided } = yield* classification.processNext(
              message.ownerId
            )
            if (decided > 0) yield* delivery.requestIfAutomatic(message.ownerId)
            return
          }
          case "music.delivery":
            yield* delivery.processNext(message.ownerId)
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
          case "music.classification":
          case "music.delivery":
            // Undone work stays pending; the next hourly upkeep tries again.
            yield* Effect.logWarning(
              `${message.kind} batch abandoned`,
              error.message
            )
            return
        }
      })

      const setReady = Effect.fn("MusicPipeline.setReady")(function* (
        ownerId: string,
        ready: boolean
      ) {
        const result = yield* destinations.setReady({ ownerId, ready })
        if (result) yield* classification.request(ownerId)
        return result
      })

      const scheduled = Effect.fn("MusicPipeline.scheduled")(function* (
        ownerId: string
      ) {
        yield* ingestion.scheduled(ownerId)
        const { pending } = yield* enrichment.status(ownerId)
        if (pending > 0) yield* enrichment.request(ownerId)
        const classificationStatus = yield* classification.status(ownerId)
        if (classificationStatus.pending > 0)
          yield* classification.request(ownerId)
        const deliveryStatus = yield* delivery.status(ownerId)
        if (deliveryStatus.toWrite > 0)
          yield* delivery.requestIfAutomatic(ownerId)
      })

      return MusicPipeline.of({ handle, giveUp, setReady, scheduled })
    })
  )

  /** Production layer. Needs the platform (`Database`, `JobQueue`, config). */
  static readonly layer = MusicPipeline.layerNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(
        MusicIngestion.layer,
        MusicEnrichment.layer,
        MusicClassification.layer,
        MusicDelivery.layer,
        Destinations.layer
      )
    )
  )
}
