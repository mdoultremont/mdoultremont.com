import { and, count, desc, eq, isNull, or, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import {
  Database,
  musicDecisions,
  musicLikedTracks,
  musicRecordings,
} from "@/backend/primitives/database"
import { ClassificationPersistenceError, type DecisionSummary } from "./errors"

export type DecisionRow = typeof musicDecisions.$inferInsert

/** Recording data a pending track can be classified with; `null` when it has none. */
export interface PendingTrack {
  readonly trackId: string
  readonly recording: {
    readonly title: string
    readonly artistCredit: string
    readonly durationMs: number | null
    readonly acoustic: typeof musicRecordings.$inferSelect.acoustic
  } | null
}

const undecided = (ownerId: string) =>
  and(
    eq(musicLikedTracks.ownerId, ownerId),
    eq(musicLikedTracks.liked, true),
    isNull(musicDecisions.trackId)
  )
const decisionJoin = and(
  eq(musicDecisions.ownerId, musicLikedTracks.ownerId),
  eq(musicDecisions.trackId, musicLikedTracks.trackId)
)

/** Decisions, and the queries that find tracks ready to classify. */
export class ClassificationStore extends Context.Service<
  ClassificationStore,
  {
    /**
     * Liked tracks without a decision whose enrichment is settled: either
     * recording data was looked up, or there is no ISRC to look up.
     * Only recording data is returned, never Spotify fields.
     */
    readonly pending: (
      ownerId: string,
      limit: number
    ) => Effect.Effect<readonly PendingTrack[], ClassificationPersistenceError>
    readonly save: (
      row: DecisionRow
    ) => Effect.Effect<void, ClassificationPersistenceError>
    readonly counts: (
      ownerId: string,
      fingerprint: string
    ) => Effect.Effect<
      {
        readonly decided: number
        readonly toDestinations: number
        readonly toReview: number
        readonly withoutRecordingData: number
        readonly waitingForEnrichment: number
        readonly pending: number
        readonly outdated: number
      },
      ClassificationPersistenceError
    >
    readonly recent: (
      ownerId: string,
      limit: number
    ) => Effect.Effect<
      readonly DecisionSummary[],
      ClassificationPersistenceError
    >
    /** Deletes every decision so all liked tracks are classified again. */
    readonly clear: (
      ownerId: string
    ) => Effect.Effect<void, ClassificationPersistenceError>
  }
>()("backend/features/music/classification/ClassificationStore") {
  static readonly layer = Layer.effect(
    ClassificationStore,
    Effect.gen(function* () {
      const database = yield* Database
      const query = <A>(run: Parameters<typeof database.use<A>>[0]) =>
        database
          .use(run)
          .pipe(
            Effect.mapError(
              (error) => new ClassificationPersistenceError({ cause: error })
            )
          )

      return ClassificationStore.of({
        pending: (ownerId, limit) =>
          query((db) =>
            db
              .select({
                trackId: musicLikedTracks.trackId,
                status: musicRecordings.status,
                title: musicRecordings.title,
                artistCredit: musicRecordings.artistCredit,
                durationMs: musicRecordings.durationMs,
                acoustic: musicRecordings.acoustic,
              })
              .from(musicLikedTracks)
              .leftJoin(musicDecisions, decisionJoin)
              .leftJoin(
                musicRecordings,
                eq(musicRecordings.isrc, musicLikedTracks.isrc)
              )
              .where(
                and(
                  undecided(ownerId),
                  or(
                    isNull(musicLikedTracks.isrc),
                    sql`${musicRecordings.isrc} IS NOT NULL`
                  )
                )
              )
              .orderBy(desc(musicLikedTracks.likedAt))
              .limit(limit)
          ).pipe(
            Effect.map((rows) =>
              rows.map((row): PendingTrack => ({
                trackId: row.trackId,
                recording:
                  row.status === "found" && row.title && row.artistCredit
                    ? {
                        title: row.title,
                        artistCredit: row.artistCredit,
                        durationMs: row.durationMs,
                        acoustic: row.acoustic,
                      }
                    : null,
              }))
            )
          ),

        save: (row) =>
          query((db) =>
            db
              .insert(musicDecisions)
              .values(row)
              .onConflictDoUpdate({
                target: [musicDecisions.ownerId, musicDecisions.trackId],
                set: row,
              })
          ).pipe(Effect.asVoid),

        counts: (ownerId, fingerprint) =>
          query(async (db) => {
            const [decided] = await db
              .select({
                decided: count(),
                toReview: sql<number>`coalesce(sum(${musicDecisions.review}), 0)`,
                withoutRecordingData: sql<number>`coalesce(sum(${musicDecisions.reason} = 'no_recording_data'), 0)`,
                outdated: sql<number>`coalesce(sum(${musicDecisions.fingerprint} != ${fingerprint}), 0)`,
              })
              .from(musicDecisions)
              .innerJoin(
                musicLikedTracks,
                and(
                  eq(musicLikedTracks.ownerId, musicDecisions.ownerId),
                  eq(musicLikedTracks.trackId, musicDecisions.trackId)
                )
              )
              .where(
                and(
                  eq(musicDecisions.ownerId, ownerId),
                  eq(musicLikedTracks.liked, true)
                )
              )
            const [waiting] = await db
              .select({
                waitingForEnrichment: sql<number>`coalesce(sum(${musicLikedTracks.isrc} IS NOT NULL AND ${musicRecordings.isrc} IS NULL), 0)`,
                pending: sql<number>`coalesce(sum(${musicLikedTracks.isrc} IS NULL OR ${musicRecordings.isrc} IS NOT NULL), 0)`,
              })
              .from(musicLikedTracks)
              .leftJoin(musicDecisions, decisionJoin)
              .leftJoin(
                musicRecordings,
                eq(musicRecordings.isrc, musicLikedTracks.isrc)
              )
              .where(undecided(ownerId))
            const decidedCount = decided?.decided ?? 0
            const toReview = Number(decided?.toReview ?? 0)
            return {
              decided: decidedCount,
              toDestinations: decidedCount - toReview,
              toReview,
              withoutRecordingData: Number(decided?.withoutRecordingData ?? 0),
              waitingForEnrichment: Number(waiting?.waitingForEnrichment ?? 0),
              pending: Number(waiting?.pending ?? 0),
              outdated: Number(decided?.outdated ?? 0),
            }
          }),

        recent: (ownerId, limit) =>
          query((db) =>
            db
              .select({
                trackId: musicDecisions.trackId,
                name: musicLikedTracks.name,
                artistNames: musicLikedTracks.artistNames,
                destinationIds: musicDecisions.destinationIds,
                review: musicDecisions.review,
                reason: musicDecisions.reason,
                probabilities: musicDecisions.probabilities,
                classifiedAt: musicDecisions.classifiedAt,
              })
              .from(musicDecisions)
              .innerJoin(
                musicLikedTracks,
                and(
                  eq(musicLikedTracks.ownerId, musicDecisions.ownerId),
                  eq(musicLikedTracks.trackId, musicDecisions.trackId)
                )
              )
              .where(eq(musicDecisions.ownerId, ownerId))
              .orderBy(desc(musicDecisions.classifiedAt))
              .limit(limit)
          ),

        clear: (ownerId) =>
          query((db) =>
            db.delete(musicDecisions).where(eq(musicDecisions.ownerId, ownerId))
          ).pipe(Effect.asVoid),
      })
    })
  )
}
