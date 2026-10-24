import { Clock, Context, Effect, Layer, Option } from "effect"
import {
  Spotify,
  SpotifyConnections,
  type SpotifyError,
} from "#backend/modules/spotify"
import { JobQueue, type JobQueueError } from "#backend/modules/job-queue"
import { SourceStore, type SourceId } from "#backend/actions/music/collection"
import {
  type Ingestion,
  type IngestionKind,
  IngestionMessage,
  IngestionPersistenceError,
  type IngestionStatus,
  InvalidSourcePage,
} from "./errors"
import { IngestionStore } from "./store"

/** A full ingestion of a source is due when its last one started longer ago than this. */
const fullIngestionInterval = 24 * 60 * 60 * 1000
/** An in-progress ingestion untouched for this long lost its queue message. */
const stalledAfter = 10 * 60 * 1000

const sourceQuery = <A, E>(effect: Effect.Effect<A, E>) =>
  effect.pipe(
    Effect.mapError((cause) => new IngestionPersistenceError({ cause }))
  )
export type IngestionError =
  | IngestionPersistenceError
  | JobQueueError
  | SpotifyError
  | InvalidSourcePage

/**
 * Ingestion: recording each enabled source's tracks as collected tracks.
 * Work runs one Spotify page per queue message.
 */
export class MusicIngestion extends Context.Service<
  MusicIngestion,
  {
    readonly start: (
      ownerId: string,
      kind: IngestionKind
    ) => Effect.Effect<
      readonly Ingestion[],
      IngestionPersistenceError | JobQueueError
    >
    readonly startSource: (
      ownerId: string,
      source: SourceId,
      kind: IngestionKind
    ) => Effect.Effect<
      Ingestion | null,
      IngestionPersistenceError | JobQueueError
    >
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
     * Hourly upkeep, per enabled source: resume a stalled ingestion, otherwise
     * start a full ingestion once a day and an incremental one in between.
     */
    readonly scheduled: (
      ownerId: string
    ) => Effect.Effect<void, IngestionPersistenceError | JobQueueError>
  }
>()("server/actions/music/MusicIngestion") {
  static readonly layerNoDeps = Layer.effect(
    MusicIngestion,
    Effect.gen(function* () {
      const store = yield* IngestionStore
      const sources = yield* SourceStore
      const spotify = yield* Spotify
      const connections = yield* SpotifyConnections
      const queue = yield* JobQueue
      const enqueue = (ingestionId: string) =>
        queue.send(
          IngestionMessage.make({ kind: "music.ingestion", ingestionId })
        )

      const startSource = Effect.fn("MusicIngestion.startSource")(function* (
        ownerId: string,
        source: SourceId,
        kind: IngestionKind
      ) {
        const row = yield* sourceQuery(sources.get(ownerId, source))
        if (!row?.enabled) return null
        const now = yield* Clock.currentTimeMillis
        const { ingestion, created } = yield* store.start({
          id: crypto.randomUUID(),
          ownerId,
          source,
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
      const start = Effect.fn("MusicIngestion.start")(function* (
        ownerId: string,
        kind: IngestionKind
      ) {
        const configured = yield* sourceQuery(sources.read(ownerId))
        const ingestions: Ingestion[] = []
        for (const source of configured.filter((entry) => entry.enabled)) {
          const ingestion = yield* startSource(ownerId, source.sourceId, kind)
          if (ingestion) ingestions.push(ingestion)
        }
        return ingestions
      })
      const processNext = Effect.fn("MusicIngestion.processNext")(function* (
        ingestionId: string
      ) {
        const stored = yield* store.get(ingestionId)
        if (
          !stored ||
          stored.status === "completed" ||
          stored.status === "failed"
        )
          return { ownerId: null, added: 0 }
        const source = yield* sourceQuery(
          sources.get(stored.ownerId, stored.source)
        )
        if (!source?.enabled) return { ownerId: null, added: 0 }
        let ingestion = stored
        if (
          ingestion.source.kind === "playlist" &&
          ingestion.snapshotId === null
        ) {
          const snapshotId = yield* spotify.playlistSnapshot(
            ingestion.ownerId,
            ingestion.source.playlistId
          )
          const current = yield* store.get(ingestion.id)
          if (current?.status !== "queued" && current?.status !== "running")
            return { ownerId: null, added: 0 }
          yield* store.setSnapshot(
            ingestion.id,
            snapshotId,
            yield* Clock.currentTimeMillis
          )
          ingestion = { ...ingestion, snapshotId }
          if (
            ingestion.kind === "incremental" &&
            source.snapshotId === snapshotId
          ) {
            yield* store.complete(
              ingestion,
              yield* Clock.currentTimeMillis,
              false
            )
            return { ownerId: ingestion.ownerId, added: 0 }
          }
        }
        const page = yield* ingestion.source.kind === "liked"
          ? spotify.savedTracksPage(
              ingestion.ownerId,
              ingestion.cursor ?? undefined
            )
          : spotify.playlistTracksPage(
              ingestion.ownerId,
              ingestion.source.playlistId,
              ingestion.cursor ?? undefined
            )
        const current = yield* store.get(ingestion.id)
        if (current?.status !== "queued" && current?.status !== "running")
          return { ownerId: null, added: 0 }
        if (page.next !== null && page.next === ingestion.cursor)
          return yield* new InvalidSourcePage({
            message: "Spotify returned a source page that does not advance",
          })
        const now = yield* Clock.currentTimeMillis
        const result = yield* store.recordPage({
          ingestion,
          tracks: page.items,
          next: page.next,
          total: page.total,
          now,
        })
        const stopAtKnownLike =
          ingestion.source.kind === "liked" &&
          ingestion.kind === "incremental" &&
          result.reachedKnownLike
        if (page.next !== null && !stopAtKnownLike) yield* enqueue(ingestion.id)
        else yield* store.complete(ingestion, now, page.next === null)
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
        return {
          sources: yield* sourceQuery(sources.read(ownerId)),
          ...(yield* store.counts(ownerId)),
        } satisfies IngestionStatus
      })
      const scheduled = Effect.fn("MusicIngestion.scheduled")(function* (
        ownerId: string
      ) {
        const connection = yield* sourceQuery(connections.get(ownerId))
        if (Option.isNone(connection) || connection.value.needsReconnect) return
        const now = yield* Clock.currentTimeMillis
        const configured = yield* sourceQuery(sources.read(ownerId))
        for (const source of configured.filter((entry) => entry.enabled)) {
          const latest = source.latest
          if (latest?.status === "queued" || latest?.status === "running") {
            if (now - latest.updatedAt > stalledAfter) {
              yield* store.touch(latest.id, now)
              yield* enqueue(latest.id)
            }
            continue
          }
          const lastFull = yield* store.latest(ownerId, source.sourceId, "full")
          yield* startSource(
            ownerId,
            source.sourceId,
            !lastFull || now - lastFull.startedAt >= fullIngestionInterval
              ? "full"
              : "incremental"
          )
        }
      })
      return MusicIngestion.of({
        start,
        startSource,
        processNext,
        fail,
        status,
        scheduled,
      })
    })
  )
  static readonly layer = MusicIngestion.layerNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(
        IngestionStore.layer,
        SourceStore.layer,
        Spotify.layer,
        SpotifyConnections.layer
      )
    )
  )
}
