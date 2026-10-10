import { and, count, desc, eq, inArray, lt, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import type { SpotifySavedTrack } from "@/backend/modules/spotify"
import {
  Database,
  musicIngestions,
  musicLikedTracks,
} from "@/backend/primitives/database"
import {
  type Ingestion,
  type IngestionKind,
  IngestionPersistenceError,
} from "./errors"

/** D1 allows 100 bound parameters per statement; a liked-track row binds 9. */
const rowsPerInsert = 10

export interface PageResult {
  /** Tracks that were new, re-liked, or liked again at a different time. */
  readonly added: number
  /** True when the page contained a like already stored unchanged. */
  readonly reachedKnownLike: boolean
}

/** Liked tracks and ingestion progress. */
export class IngestionStore extends Context.Service<
  IngestionStore,
  {
    /** Creates a queued ingestion, or returns the one already in progress. */
    readonly start: (input: {
      readonly id: string
      readonly ownerId: string
      readonly kind: IngestionKind
      readonly now: number
    }) => Effect.Effect<
      { readonly ingestion: Ingestion; readonly created: boolean },
      IngestionPersistenceError
    >
    readonly get: (
      id: string
    ) => Effect.Effect<Ingestion | null, IngestionPersistenceError>
    readonly latest: (
      ownerId: string,
      kind?: IngestionKind
    ) => Effect.Effect<Ingestion | null, IngestionPersistenceError>
    /** Upserts one page of likes and advances the ingestion atomically. */
    readonly recordPage: (input: {
      readonly ingestion: Ingestion
      readonly tracks: readonly SpotifySavedTrack[]
      readonly next: string | null
      readonly total: number
      readonly now: number
    }) => Effect.Effect<PageResult, IngestionPersistenceError>
    /** Finishes the ingestion; a full one marks likes it did not see as un-liked. */
    readonly complete: (
      ingestion: Ingestion,
      now: number
    ) => Effect.Effect<Ingestion, IngestionPersistenceError>
    readonly fail: (
      id: string,
      error: string,
      now: number
    ) => Effect.Effect<void, IngestionPersistenceError>
    /** Re-marks a stalled ingestion as touched so a re-sent message is not doubled. */
    readonly touch: (
      id: string,
      now: number
    ) => Effect.Effect<void, IngestionPersistenceError>
    readonly counts: (
      ownerId: string
    ) => Effect.Effect<
      { readonly liked: number; readonly unliked: number },
      IngestionPersistenceError
    >
  }
>()("backend/features/music/ingestion/IngestionStore") {
  static readonly layer = Layer.effect(
    IngestionStore,
    Effect.gen(function* () {
      const database = yield* Database
      const query = <A>(run: Parameters<typeof database.use<A>>[0]) =>
        database
          .use(run)
          .pipe(
            Effect.mapError(
              (error) => new IngestionPersistenceError({ cause: error })
            )
          )

      const get = (id: string) =>
        query((db) =>
          db
            .select()
            .from(musicIngestions)
            .where(eq(musicIngestions.id, id))
            .get()
        ).pipe(Effect.map((row) => row ?? null))

      const active = (ownerId: string) =>
        query((db) =>
          db
            .select()
            .from(musicIngestions)
            .where(
              and(
                eq(musicIngestions.ownerId, ownerId),
                inArray(musicIngestions.status, ["queued", "running"])
              )
            )
            .get()
        ).pipe(Effect.map((row) => row ?? null))

      return IngestionStore.of({
        start: ({ id, ownerId, kind, now }) =>
          Effect.gen(function* () {
            const inserted = yield* query((db) =>
              db
                .insert(musicIngestions)
                .values({
                  id,
                  ownerId,
                  kind,
                  status: "queued",
                  startedAt: now,
                  updatedAt: now,
                })
                // The partial unique index allows one queued/running ingestion per owner.
                .onConflictDoNothing()
                .returning()
            )
            if (inserted[0]) return { ingestion: inserted[0], created: true }
            const existing = yield* active(ownerId)
            if (!existing)
              return yield* new IngestionPersistenceError({
                cause: "Ingestion conflicted but none is active",
              })
            return { ingestion: existing, created: false }
          }),

        get,

        latest: (ownerId, kind) =>
          query((db) =>
            db
              .select()
              .from(musicIngestions)
              .where(
                and(
                  eq(musicIngestions.ownerId, ownerId),
                  kind ? eq(musicIngestions.kind, kind) : undefined
                )
              )
              .orderBy(desc(musicIngestions.startedAt))
              .limit(1)
              .get()
          ).pipe(Effect.map((row) => row ?? null)),

        recordPage: ({ ingestion, tracks, next, total, now }) =>
          query(async (db) => {
            const ids = tracks.map((track) => track.id)
            const existing =
              ids.length === 0
                ? []
                : await db
                    .select({
                      trackId: musicLikedTracks.trackId,
                      likedAt: musicLikedTracks.likedAt,
                      liked: musicLikedTracks.liked,
                    })
                    .from(musicLikedTracks)
                    .where(
                      and(
                        eq(musicLikedTracks.ownerId, ingestion.ownerId),
                        inArray(musicLikedTracks.trackId, ids)
                      )
                    )
            const known = new Map(existing.map((row) => [row.trackId, row]))
            const unchanged = (track: SpotifySavedTrack) => {
              const row = known.get(track.id)
              return (
                row !== undefined && row.liked && row.likedAt === track.addedAt
              )
            }
            const added = tracks.filter((track) => !unchanged(track)).length

            const upserts = []
            for (let start = 0; start < tracks.length; start += rowsPerInsert)
              upserts.push(
                db
                  .insert(musicLikedTracks)
                  .values(
                    tracks.slice(start, start + rowsPerInsert).map((track) => ({
                      ownerId: ingestion.ownerId,
                      trackId: track.id,
                      name: track.name,
                      artistNames: track.artistNames,
                      isrc: track.isrc,
                      likedAt: track.addedAt,
                      liked: true,
                      firstSeenAt: now,
                      lastSeenAt: now,
                    }))
                  )
                  .onConflictDoUpdate({
                    target: [
                      musicLikedTracks.ownerId,
                      musicLikedTracks.trackId,
                    ],
                    set: {
                      name: sql`excluded.name`,
                      artistNames: sql`excluded.artist_names`,
                      isrc: sql`excluded.isrc`,
                      likedAt: sql`excluded.liked_at`,
                      liked: true,
                      lastSeenAt: now,
                    },
                  })
              )
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
            return {
              added,
              reachedKnownLike: tracks.some(unchanged),
            } satisfies PageResult
          }),

        complete: (ingestion, now) =>
          query(async (db) => {
            const unliked =
              ingestion.kind === "full"
                ? await db
                    .update(musicLikedTracks)
                    .set({ liked: false })
                    .where(
                      and(
                        eq(musicLikedTracks.ownerId, ingestion.ownerId),
                        eq(musicLikedTracks.liked, true),
                        lt(musicLikedTracks.lastSeenAt, ingestion.startedAt)
                      )
                    )
                    .returning({ trackId: musicLikedTracks.trackId })
                : []
            const [finished] = await db
              .update(musicIngestions)
              .set({
                status: "completed",
                cursor: null,
                unliked: unliked.length,
                updatedAt: now,
                finishedAt: now,
              })
              .where(eq(musicIngestions.id, ingestion.id))
              .returning()
            return finished ?? ingestion
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
              .select({ liked: musicLikedTracks.liked, count: count() })
              .from(musicLikedTracks)
              .where(eq(musicLikedTracks.ownerId, ownerId))
              .groupBy(musicLikedTracks.liked)
          ).pipe(
            Effect.map((rows) => ({
              liked: rows.find((row) => row.liked)?.count ?? 0,
              unliked: rows.find((row) => !row.liked)?.count ?? 0,
            }))
          ),
      })
    })
  )
}
