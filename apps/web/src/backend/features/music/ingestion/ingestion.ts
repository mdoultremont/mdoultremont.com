import { Clock, Context, Effect, Layer, Option } from "effect"
import {
  Spotify,
  SpotifyConnections,
  type SpotifyError,
} from "@/backend/modules/spotify"
import { JobQueue, type JobQueueError } from "@/backend/primitives/job-queue"
import {
  type Ingestion,
  type IngestionKind,
  IngestionMessage,
  IngestionPersistenceError,
  type IngestionStatus,
  InvalidLikesPage,
} from "./errors"
import { IngestionStore } from "./store"

/** A full ingestion is due when the last one started longer ago than this. */
const fullIngestionInterval = 24 * 60 * 60 * 1000
/** An in-progress ingestion untouched for this long lost its queue message. */
const stalledAfter = 10 * 60 * 1000

export type IngestionError =
  | IngestionPersistenceError
  | JobQueueError
  | SpotifyError
  | InvalidLikesPage

/**
 * Ingestion: recording the owner's Spotify Liked Songs as liked tracks.
 * Work runs one Spotify page per queue message.
 */
export class MusicIngestion extends Context.Service<
  MusicIngestion,
  {
    /** Starts an ingestion, or returns the one already in progress. */
    readonly start: (
      ownerId: string,
      kind: IngestionKind
    ) => Effect.Effect<Ingestion, IngestionPersistenceError | JobQueueError>
    /**
     * Handles one page; queues the next page or completes the ingestion.
     * Reports whose likes and how many the page added, so later steps know there is work.
     */
    readonly processNext: (
      ingestionId: string
    ) => Effect.Effect<
      { readonly ownerId: string | null; readonly added: number },
      IngestionError
    >
    readonly fail: (
      ingestionId: string,
      error: string
    ) => Effect.Effect<void, IngestionPersistenceError>
    readonly status: (
      ownerId: string
    ) => Effect.Effect<IngestionStatus, IngestionPersistenceError>
    /**
     * Hourly upkeep: resume a stalled ingestion, otherwise start a full
     * ingestion once a day and an incremental one in between.
     */
    readonly scheduled: (
      ownerId: string
    ) => Effect.Effect<void, IngestionPersistenceError | JobQueueError>
  }
>()("backend/features/music/MusicIngestion") {
  static readonly layerNoDeps = Layer.effect(
    MusicIngestion,
    Effect.gen(function* () {
      const store = yield* IngestionStore
      const spotify = yield* Spotify
      const connections = yield* SpotifyConnections
      const queue = yield* JobQueue

      const enqueue = (ingestionId: string) =>
        queue.send(
          IngestionMessage.make({ kind: "music.ingestion", ingestionId })
        )

      const start = Effect.fn("MusicIngestion.start")(function* (
        ownerId: string,
        kind: IngestionKind
      ) {
        const now = yield* Clock.currentTimeMillis
        const id = crypto.randomUUID()
        const { ingestion, created } = yield* store.start({
          id,
          ownerId,
          kind,
          now,
        })
        if (created)
          yield* enqueue(ingestion.id).pipe(
            Effect.tapError((error) =>
              store.fail(ingestion.id, error.message, now)
            )
          )
        return ingestion
      })

      const processNext = Effect.fn("MusicIngestion.processNext")(function* (
        ingestionId: string
      ) {
        const ingestion = yield* store.get(ingestionId)
        // Redelivered messages for finished work are ignored.
        if (
          !ingestion ||
          ingestion.status === "completed" ||
          ingestion.status === "failed"
        )
          return { ownerId: null, added: 0 }
        const page = yield* spotify.savedTracksPage(
          ingestion.ownerId,
          ingestion.cursor ?? undefined
        )
        if (page.next !== null && page.next === ingestion.cursor)
          return yield* new InvalidLikesPage({
            message:
              "Spotify returned a Liked Songs page that does not advance",
          })
        const now = yield* Clock.currentTimeMillis
        const result = yield* store.recordPage({
          ingestion,
          tracks: page.items,
          next: page.next,
          total: page.total,
          now,
        })
        // Likes come newest first: an incremental ingestion can stop at the
        // first like it already has. A full one reads everything to find un-likes.
        const morePages =
          page.next !== null &&
          (ingestion.kind === "full" || !result.reachedKnownLike)
        if (morePages) yield* enqueue(ingestion.id)
        else yield* store.complete(ingestion, now)
        return { ownerId: ingestion.ownerId, added: result.added }
      })

      const fail = Effect.fn("MusicIngestion.fail")(function* (
        ingestionId: string,
        error: string
      ) {
        yield* store.fail(ingestionId, error, yield* Clock.currentTimeMillis)
      })

      const status = Effect.fn("MusicIngestion.status")(function* (
        ownerId: string
      ) {
        const latest = yield* store.latest(ownerId)
        const counts = yield* store.counts(ownerId)
        return { latest, ...counts } satisfies IngestionStatus
      })

      const scheduled = Effect.fn("MusicIngestion.scheduled")(function* (
        ownerId: string
      ) {
        const connection = yield* connections
          .get(ownerId)
          .pipe(
            Effect.mapError((cause) => new IngestionPersistenceError({ cause }))
          )
        if (Option.isNone(connection) || connection.value.needsReconnect) return

        const now = yield* Clock.currentTimeMillis
        const latest = yield* store.latest(ownerId)
        if (latest?.status === "queued" || latest?.status === "running") {
          if (now - latest.updatedAt > stalledAfter) {
            yield* store.touch(latest.id, now)
            yield* enqueue(latest.id)
          }
          return
        }
        const lastFull = yield* store.latest(ownerId, "full")
        const fullDue =
          !lastFull || now - lastFull.startedAt >= fullIngestionInterval
        yield* start(ownerId, fullDue ? "full" : "incremental")
      })

      return MusicIngestion.of({ start, processNext, fail, status, scheduled })
    })
  )

  /** Production layer. Needs the platform (`Database`, `JobQueue`, config). */
  static readonly layer = MusicIngestion.layerNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(
        IngestionStore.layer,
        Spotify.layer,
        SpotifyConnections.layer
      )
    )
  )
}
