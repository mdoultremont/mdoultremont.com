import { Clock, Context, Effect, Layer, Option } from "effect"
import {
  AcousticBrainz,
  type AcousticBrainzError,
} from "@/backend/modules/acousticbrainz"
import {
  MusicBrainz,
  type MusicBrainzError,
} from "@/backend/modules/musicbrainz"
import { JobQueue, type JobQueueError } from "@/backend/primitives/job-queue"
import {
  EnrichmentMessage,
  type EnrichmentPersistenceError,
  type EnrichmentStatus,
} from "./errors"
import { EnrichmentStore } from "./store"

/** ISRCs looked up per queue message: about 30 seconds of spaced requests. */
const batchSize = 10
/** Keeps the request spacing across messages, which start a fresh client. */
const continuationDelaySeconds = 2

export type EnrichmentError =
  | EnrichmentPersistenceError
  | JobQueueError
  | MusicBrainzError
  | AcousticBrainzError

/**
 * Enrichment: attaching recording data to liked tracks from MusicBrainz and
 * AcousticBrainz, once per ISRC.
 */
export class MusicEnrichment extends Context.Service<
  MusicEnrichment,
  {
    /** Queues a lookup batch. Safe to call often: a batch with no work ends at once. */
    readonly request: (ownerId: string) => Effect.Effect<void, JobQueueError>
    /** Looks up one batch of ISRCs and queues the next while work remains. */
    readonly processNext: (
      ownerId: string
    ) => Effect.Effect<{ readonly looked: number }, EnrichmentError>
    readonly status: (
      ownerId: string
    ) => Effect.Effect<EnrichmentStatus, EnrichmentPersistenceError>
    /** Looks up not-found, ambiguous, and failed ISRCs again. */
    readonly retryUnresolved: (
      ownerId: string
    ) => Effect.Effect<number, EnrichmentPersistenceError | JobQueueError>
  }
>()("backend/features/music/MusicEnrichment") {
  static readonly layerNoDeps = Layer.effect(
    MusicEnrichment,
    Effect.gen(function* () {
      const store = yield* EnrichmentStore
      const musicBrainz = yield* MusicBrainz
      const acousticBrainz = yield* AcousticBrainz
      const queue = yield* JobQueue

      const request = (ownerId: string) =>
        queue.send(
          EnrichmentMessage.make({ kind: "music.enrichment", ownerId }),
          { delaySeconds: continuationDelaySeconds }
        )

      /**
       * Retryable provider failures stop the batch and propagate, so the
       * queue retries later. Anything else is recorded against the ISRC and
       * the batch moves on.
       */
      const enrich = Effect.fn("MusicEnrichment.enrich")(function* (
        isrc: string
      ) {
        const fetchedAt = yield* Clock.currentTimeMillis
        const recordings = yield* musicBrainz.recordingsByIsrc(isrc).pipe(
          Effect.catchIf(
            (error) => !error.retryable,
            (error) =>
              store
                .save({
                  isrc,
                  status: "failed",
                  error: error.message,
                  fetchedAt,
                })
                .pipe(Effect.as(null))
          )
        )
        if (recordings === null) return
        // One ISRC can name several recordings; picking one would be a guess.
        if (recordings.length !== 1) {
          yield* store.save({
            isrc,
            status: recordings.length === 0 ? "not_found" : "ambiguous",
            fetchedAt,
          })
          return
        }
        const [recording] = recordings
        // The analysis is optional: AcousticBrainz is read-only, lacks every
        // recording made after 2022, and an outage must not stop MusicBrainz
        // lookups for every other track.
        const analysis = yield* acousticBrainz
          .analysis(recording!.id)
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning(
                "AcousticBrainz analysis skipped",
                error.message
              ).pipe(Effect.as(Option.none()))
            )
          )
        yield* store.save({
          isrc,
          status: "found",
          recordingId: recording!.id,
          title: recording!.title,
          artistCredit: recording!.artistCredit,
          durationMs: recording!.durationMs,
          acoustic: Option.getOrNull(analysis),
          fetchedAt,
        })
      })

      const processNext = Effect.fn("MusicEnrichment.processNext")(function* (
        ownerId: string
      ) {
        const isrcs = yield* store.pendingIsrcs(batchSize)
        for (const isrc of isrcs) yield* enrich(isrc)
        if (isrcs.length === batchSize) yield* request(ownerId)
        return { looked: isrcs.length }
      })

      const status = Effect.fn("MusicEnrichment.status")(function* (
        ownerId: string
      ) {
        return yield* store.status(ownerId)
      })

      const retryUnresolved = Effect.fn("MusicEnrichment.retryUnresolved")(
        function* (ownerId: string) {
          const cleared = yield* store.clearUnresolved()
          if (cleared > 0) yield* request(ownerId)
          return cleared
        }
      )

      return MusicEnrichment.of({
        request,
        processNext,
        status,
        retryUnresolved,
      })
    })
  )

  /** Production layer. Needs the platform (`Database`, `JobQueue`). */
  static readonly layer = MusicEnrichment.layerNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(
        EnrichmentStore.layer,
        MusicBrainz.layer,
        AcousticBrainz.layer
      )
    )
  )
}
