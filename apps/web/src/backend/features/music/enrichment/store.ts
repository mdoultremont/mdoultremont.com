import { and, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import {
  Database,
  musicLikedTracks,
  musicRecordings,
} from "@/backend/primitives/database"
import { EnrichmentPersistenceError, type EnrichmentStatus } from "./errors"

export type RecordingRow = typeof musicRecordings.$inferInsert

/** Recording data per ISRC and the queries that find work for enrichment. */
export class EnrichmentStore extends Context.Service<
  EnrichmentStore,
  {
    /** ISRCs of liked tracks that have no recording data yet. */
    readonly pendingIsrcs: (
      limit: number
    ) => Effect.Effect<readonly string[], EnrichmentPersistenceError>
    readonly save: (
      row: RecordingRow
    ) => Effect.Effect<void, EnrichmentPersistenceError>
    readonly status: (
      ownerId: string
    ) => Effect.Effect<EnrichmentStatus, EnrichmentPersistenceError>
    /** Forgets not-found, ambiguous, and failed lookups so they are tried again. */
    readonly clearUnresolved: () => Effect.Effect<
      number,
      EnrichmentPersistenceError
    >
  }
>()("backend/features/music/enrichment/EnrichmentStore") {
  static readonly layer = Layer.effect(
    EnrichmentStore,
    Effect.gen(function* () {
      const database = yield* Database
      const query = <A>(run: Parameters<typeof database.use<A>>[0]) =>
        database
          .use(run)
          .pipe(
            Effect.mapError(
              (error) => new EnrichmentPersistenceError({ cause: error })
            )
          )

      return EnrichmentStore.of({
        pendingIsrcs: (limit) =>
          query((db) =>
            db
              .selectDistinct({ isrc: musicLikedTracks.isrc })
              .from(musicLikedTracks)
              .leftJoin(
                musicRecordings,
                eq(musicRecordings.isrc, musicLikedTracks.isrc)
              )
              .where(
                and(
                  eq(musicLikedTracks.liked, true),
                  isNotNull(musicLikedTracks.isrc),
                  sql`${musicRecordings.isrc} IS NULL`
                )
              )
              .limit(limit)
          ).pipe(
            Effect.map((rows) =>
              rows.flatMap((row) => (row.isrc ? [row.isrc] : []))
            )
          ),

        save: (row) =>
          query((db) =>
            db
              .insert(musicRecordings)
              .values(row)
              .onConflictDoUpdate({ target: musicRecordings.isrc, set: row })
          ).pipe(Effect.asVoid),

        status: (ownerId) =>
          query((db) =>
            db
              .select({
                status: musicRecordings.status,
                hasIsrc: sql<number>`${musicLikedTracks.isrc} IS NOT NULL`,
                hasAnalysis: sql<number>`${musicRecordings.acoustic} IS NOT NULL`,
                count: sql<number>`count(*)`,
              })
              .from(musicLikedTracks)
              .leftJoin(
                musicRecordings,
                eq(musicRecordings.isrc, musicLikedTracks.isrc)
              )
              .where(
                and(
                  eq(musicLikedTracks.ownerId, ownerId),
                  eq(musicLikedTracks.liked, true)
                )
              )
              .groupBy(
                musicRecordings.status,
                sql`${musicLikedTracks.isrc} IS NOT NULL`,
                sql`${musicRecordings.acoustic} IS NOT NULL`
              )
          ).pipe(
            Effect.map((rows) => {
              const sum = (match: (row: (typeof rows)[number]) => boolean) =>
                rows.filter(match).reduce((total, row) => total + row.count, 0)
              return {
                enriched: sum((row) => row.status === "found"),
                withAnalysis: sum(
                  (row) => row.status === "found" && Boolean(row.hasAnalysis)
                ),
                notFound: sum((row) => row.status === "not_found"),
                ambiguous: sum((row) => row.status === "ambiguous"),
                failed: sum((row) => row.status === "failed"),
                pending: sum(
                  (row) => row.status === null && Boolean(row.hasIsrc)
                ),
                withoutIsrc: sum((row) => !row.hasIsrc),
              } satisfies EnrichmentStatus
            })
          ),

        clearUnresolved: () =>
          query((db) =>
            db
              .delete(musicRecordings)
              .where(
                inArray(musicRecordings.status, [
                  "not_found",
                  "ambiguous",
                  "failed",
                ])
              )
              .returning({ isrc: musicRecordings.isrc })
          ).pipe(Effect.map((rows) => rows.length)),
      })
    })
  )
}
