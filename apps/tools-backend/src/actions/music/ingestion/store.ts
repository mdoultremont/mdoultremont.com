import { and, desc, eq, inArray, lt, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import type { SpotifySavedTrack } from "#backend/modules/spotify"
import {
  Database,
  musicIngestions,
  musicSources,
  musicSourceTracks,
  musicTracks,
} from "#backend/modules/database"
import {
  eligibleTrack,
  ingestionFromStorage,
  storedSourceId,
  type SourceId,
} from "#backend/actions/music/collection"
import {
  type Ingestion,
  type IngestionKind,
  IngestionPersistenceError,
} from "./errors"

// Ten rows keep both upserts below D1's 100-parameter limit.
const rowsPerInsert = 10

export class IngestionStore extends Context.Service<
  IngestionStore,
  {
    readonly start: (input: {
      id: string
      ownerId: string
      source: SourceId
      kind: IngestionKind
      now: number
    }) => Effect.Effect<
      { ingestion: Ingestion; created: boolean },
      IngestionPersistenceError
    >
    readonly get: (
      id: string
    ) => Effect.Effect<Ingestion | null, IngestionPersistenceError>
    readonly latest: (
      ownerId: string,
      source: SourceId,
      kind?: IngestionKind
    ) => Effect.Effect<Ingestion | null, IngestionPersistenceError>
    readonly setSnapshot: (
      id: string,
      snapshotId: string,
      now: number
    ) => Effect.Effect<void, IngestionPersistenceError>
    readonly recordPage: (input: {
      ingestion: Ingestion
      tracks: readonly SpotifySavedTrack[]
      next: string | null
      total: number
      now: number
    }) => Effect.Effect<
      { added: number; reachedKnownLike: boolean },
      IngestionPersistenceError
    >
    readonly complete: (
      ingestion: Ingestion,
      now: number,
      readAll: boolean
    ) => Effect.Effect<void, IngestionPersistenceError>
    readonly fail: (
      id: string,
      error: string,
      now: number
    ) => Effect.Effect<void, IngestionPersistenceError>
    readonly touch: (
      id: string,
      now: number
    ) => Effect.Effect<void, IngestionPersistenceError>
    readonly counts: (
      ownerId: string
    ) => Effect.Effect<
      { present: number; removed: number },
      IngestionPersistenceError
    >
  }
>()("server/actions/music/ingestion/IngestionStore") {
  static readonly layer = Layer.effect(
    IngestionStore,
    Effect.gen(function* () {
      const database = yield* Database
      const query = <A>(run: Parameters<typeof database.use<A>>[0]) =>
        database
          .use(run)
          .pipe(
            Effect.mapError((cause) => new IngestionPersistenceError({ cause }))
          )
      const get = (id: string) =>
        query((db) =>
          db
            .select()
            .from(musicIngestions)
            .where(eq(musicIngestions.id, id))
            .get()
        ).pipe(Effect.map((row) => (row ? ingestionFromStorage(row) : null)))
      return IngestionStore.of({
        start: ({ id, ownerId, source, kind, now }) =>
          Effect.gen(function* () {
            const inserted = yield* query((db) =>
              db
                .insert(musicIngestions)
                .values({
                  id,
                  ownerId,
                  sourceId: storedSourceId(source),
                  kind,
                  status: "queued",
                  startedAt: now,
                  updatedAt: now,
                })
                .onConflictDoNothing()
                .returning()
            )
            if (inserted[0])
              return {
                ingestion: ingestionFromStorage(inserted[0]),
                created: true,
              }
            const active = yield* query((db) =>
              db
                .select()
                .from(musicIngestions)
                .where(
                  and(
                    eq(musicIngestions.ownerId, ownerId),
                    eq(musicIngestions.sourceId, storedSourceId(source)),
                    inArray(musicIngestions.status, ["queued", "running"])
                  )
                )
                .get()
            )
            if (!active)
              return yield* new IngestionPersistenceError({
                cause: "Ingestion conflicted but none is active",
              })
            return { ingestion: ingestionFromStorage(active), created: false }
          }),
        get,
        latest: (ownerId, source, kind) =>
          query((db) =>
            db
              .select()
              .from(musicIngestions)
              .where(
                and(
                  eq(musicIngestions.ownerId, ownerId),
                  eq(musicIngestions.sourceId, storedSourceId(source)),
                  kind ? eq(musicIngestions.kind, kind) : undefined
                )
              )
              .orderBy(desc(musicIngestions.startedAt), desc(sql`rowid`))
              .limit(1)
              .get()
          ).pipe(Effect.map((row) => (row ? ingestionFromStorage(row) : null))),
        setSnapshot: (id, snapshotId, now) =>
          query((db) =>
            db
              .update(musicIngestions)
              .set({ snapshotId, updatedAt: now })
              .where(eq(musicIngestions.id, id))
          ).pipe(Effect.asVoid),
        recordPage: ({ ingestion, tracks, next, total, now }) =>
          query(async (db) => {
            const sourceId = storedSourceId(ingestion.source)
            const ids = [...new Set(tracks.map((track) => track.id))]
            const existing =
              ids.length === 0
                ? []
                : await db
                    .select()
                    .from(musicSourceTracks)
                    .where(
                      and(
                        eq(musicSourceTracks.ownerId, ingestion.ownerId),
                        eq(musicSourceTracks.sourceId, sourceId),
                        inArray(musicSourceTracks.trackId, ids)
                      )
                    )
            const known = new Map(existing.map((row) => [row.trackId, row]))
            const unchanged = (track: SpotifySavedTrack) => {
              const row = known.get(track.id)
              return (
                row !== undefined &&
                row.present &&
                row.addedAt === track.addedAt
              )
            }
            const added = tracks.filter((track) => !unchanged(track)).length
            const upserts = []
            for (let start = 0; start < tracks.length; start += rowsPerInsert) {
              const chunk = tracks.slice(start, start + rowsPerInsert)
              upserts.push(
                db
                  .insert(musicTracks)
                  .values(
                    chunk.map((track) => ({
                      ownerId: ingestion.ownerId,
                      trackId: track.id,
                      name: track.name,
                      artistNames: track.artistNames,
                      isrc: track.isrc,
                      addedAt: track.addedAt,
                      firstSeenAt: now,
                      lastSeenAt: now,
                    }))
                  )
                  .onConflictDoUpdate({
                    target: [musicTracks.ownerId, musicTracks.trackId],
                    set: {
                      name: sql`excluded.name`,
                      artistNames: sql`excluded.artist_names`,
                      isrc: sql`excluded.isrc`,
                      addedAt: sql`max(${musicTracks.addedAt}, excluded.added_at)`,
                      lastSeenAt: now,
                    },
                  })
              )
              upserts.push(
                db
                  .insert(musicSourceTracks)
                  .values(
                    chunk.map((track) => ({
                      ownerId: ingestion.ownerId,
                      sourceId,
                      trackId: track.id,
                      addedAt: track.addedAt,
                      present: true,
                      lastSeenAt: now,
                    }))
                  )
                  .onConflictDoUpdate({
                    target: [
                      musicSourceTracks.ownerId,
                      musicSourceTracks.sourceId,
                      musicSourceTracks.trackId,
                    ],
                    set: {
                      addedAt: sql`max(${musicSourceTracks.addedAt}, excluded.added_at)`,
                      present: true,
                      lastSeenAt: now,
                    },
                  })
              )
            }
            const progress = db
              .update(musicIngestions)
              .set({
                status: "running",
                cursor: next,
                pages: sql`${musicIngestions.pages} + 1`,
                seen: sql`${musicIngestions.seen} + ${tracks.length}`,
                added: sql`${musicIngestions.added} + ${added}`,
                total,
                updatedAt: now,
              })
              .where(eq(musicIngestions.id, ingestion.id))
            await db.batch([progress, ...upserts])
            return { added, reachedKnownLike: tracks.some(unchanged) }
          }),
        complete: (ingestion, now, readAll) =>
          query(async (db) => {
            const sourceId = storedSourceId(ingestion.source)
            const absent = and(
              eq(musicSourceTracks.ownerId, ingestion.ownerId),
              eq(musicSourceTracks.sourceId, sourceId),
              eq(musicSourceTracks.present, true),
              lt(musicSourceTracks.lastSeenAt, ingestion.startedAt)
            )
            const finish = db
              .update(musicIngestions)
              .set({
                status: "completed",
                cursor: null,
                removed: readAll
                  ? sql`(SELECT count(*) FROM ${musicSourceTracks} WHERE ${absent})`
                  : 0,
                updatedAt: now,
                finishedAt: now,
              })
              .where(eq(musicIngestions.id, ingestion.id))
            const memberships = readAll
              ? [
                  db
                    .update(musicSourceTracks)
                    .set({ present: false })
                    .where(absent),
                ]
              : []
            const snapshots =
              ingestion.source.kind === "playlist" && readAll
                ? [
                    db
                      .update(musicSources)
                      .set({ snapshotId: ingestion.snapshotId, updatedAt: now })
                      .where(
                        and(
                          eq(musicSources.ownerId, ingestion.ownerId),
                          eq(musicSources.sourceId, sourceId)
                        )
                      ),
                  ]
                : []
            await db.batch([finish, ...memberships, ...snapshots])
          }),
        fail: (id, error, now) =>
          query((db) =>
            db
              .update(musicIngestions)
              .set({ status: "failed", error, updatedAt: now, finishedAt: now })
              .where(eq(musicIngestions.id, id))
          ).pipe(Effect.asVoid),
        touch: (id, now) =>
          query((db) =>
            db
              .update(musicIngestions)
              .set({ updatedAt: now })
              .where(eq(musicIngestions.id, id))
          ).pipe(Effect.asVoid),
        counts: (ownerId) =>
          query((db) =>
            db
              .select({
                present: sql<number>`coalesce(sum(${eligibleTrack(musicTracks.ownerId, musicTracks.trackId)}),0)`,
                total: sql<number>`count(*)`,
              })
              .from(musicTracks)
              .where(eq(musicTracks.ownerId, ownerId))
              .get()
          ).pipe(
            Effect.map((row) => ({
              present: Number(row?.present ?? 0),
              removed: Number(row?.total ?? 0) - Number(row?.present ?? 0),
            }))
          ),
      })
    })
  )
}
