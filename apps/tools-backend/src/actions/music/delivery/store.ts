import {
  storedSourceId,
  eligibleTrack,
} from "#backend/actions/music/collection"
import { and, eq, inArray, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import {
  Database,
  musicDecisions,
  musicDeliveries,
  musicTracks,
  musicSources,
  musicSourceTracks,
  musicSettings,
} from "#backend/modules/database"
import { DeliveryPersistenceError } from "./errors"

export interface TrackPlaylist {
  readonly trackId: string
  readonly playlistId: string
}

/** D1 allows 100 bound parameters per statement; a delivery row binds 5. */
const rowsPerInsert = 20

/** Decisions to deliver, delivery records, and the automatic-delivery setting. */
export class DeliveryStore extends Context.Service<
  DeliveryStore,
  {
    readonly automatic: (
      ownerId: string
    ) => Effect.Effect<boolean, DeliveryPersistenceError>
    readonly setAutomatic: (
      ownerId: string,
      automatic: boolean,
      now: number
    ) => Effect.Effect<void, DeliveryPersistenceError>
    /** Decisions of tracks present in an enabled source. */
    readonly decisions: (ownerId: string) => Effect.Effect<
      readonly {
        readonly trackId: string
        readonly destinationIds: readonly string[]
        readonly review: boolean
      }[],
      DeliveryPersistenceError
    >
    readonly deliveries: (ownerId: string) => Effect.Effect<
      readonly (TrackPlaylist & {
        readonly status: "pending" | "delivered" | "refused"
        readonly updatedAt: number
      })[],
      DeliveryPersistenceError
    >
    /** Records writes about to be attempted. */
    readonly markPending: (
      ownerId: string,
      pairs: readonly TrackPlaylist[],
      now: number
    ) => Effect.Effect<void, DeliveryPersistenceError>
    readonly markDelivered: (
      ownerId: string,
      pairs: readonly TrackPlaylist[],
      now: number
    ) => Effect.Effect<void, DeliveryPersistenceError>
    /** Records writes Spotify refused, so they are skipped until retried. */
    readonly markRefused: (
      ownerId: string,
      pairs: readonly TrackPlaylist[],
      now: number
    ) => Effect.Effect<void, DeliveryPersistenceError>
    /** Makes refused writes eligible again. */
    readonly clearRefused: (
      ownerId: string
    ) => Effect.Effect<void, DeliveryPersistenceError>
    readonly likedMemberships: (
      ownerId: string,
      trackIds: readonly string[]
    ) => Effect.Effect<readonly string[], DeliveryPersistenceError>
    readonly eligible: (
      ownerId: string,
      trackIds: readonly string[]
    ) => Effect.Effect<ReadonlySet<string>, DeliveryPersistenceError>
    readonly markRemoved: (
      ownerId: string,
      trackIds: readonly string[]
    ) => Effect.Effect<void, DeliveryPersistenceError>
  }
>()("server/actions/music/delivery/DeliveryStore") {
  static readonly layer = Layer.effect(
    DeliveryStore,
    Effect.gen(function* () {
      const database = yield* Database
      const query = <A>(run: Parameters<typeof database.use<A>>[0]) =>
        database
          .use(run)
          .pipe(
            Effect.mapError(
              (error) => new DeliveryPersistenceError({ cause: error })
            )
          )

      const upsert = (
        ownerId: string,
        pairs: readonly TrackPlaylist[],
        status: "pending" | "delivered" | "refused",
        now: number
      ) =>
        query(async (db) => {
          for (let start = 0; start < pairs.length; start += rowsPerInsert)
            await db
              .insert(musicDeliveries)
              .values(
                pairs
                  .slice(start, start + rowsPerInsert)
                  .map((pair) => ({ ownerId, ...pair, status, updatedAt: now }))
              )
              .onConflictDoUpdate({
                target: [
                  musicDeliveries.ownerId,
                  musicDeliveries.trackId,
                  musicDeliveries.playlistId,
                ],
                // Reuse the inserted values: binding them again would pass D1's limit.
                set: {
                  status: sql`excluded.status`,
                  updatedAt: sql`excluded.updated_at`,
                },
              })
        })

      return DeliveryStore.of({
        automatic: (ownerId) =>
          query((db) =>
            db
              .select({ automatic: musicSettings.automaticDelivery })
              .from(musicSettings)
              .where(eq(musicSettings.ownerId, ownerId))
              .get()
          ).pipe(Effect.map((row) => row?.automatic ?? false)),

        setAutomatic: (ownerId, automatic, now) =>
          query((db) =>
            db
              .insert(musicSettings)
              .values({ ownerId, automaticDelivery: automatic, updatedAt: now })
              .onConflictDoUpdate({
                target: musicSettings.ownerId,
                set: { automaticDelivery: automatic, updatedAt: now },
              })
          ).pipe(Effect.asVoid),

        decisions: (ownerId) =>
          query((db) =>
            db
              .select({
                trackId: musicDecisions.trackId,
                destinationIds: musicDecisions.destinationIds,
                review: musicDecisions.review,
              })
              .from(musicDecisions)
              .innerJoin(
                musicTracks,
                and(
                  eq(musicTracks.ownerId, musicDecisions.ownerId),
                  eq(musicTracks.trackId, musicDecisions.trackId)
                )
              )
              .where(
                and(
                  eq(musicDecisions.ownerId, ownerId),
                  eligibleTrack(musicTracks.ownerId, musicTracks.trackId)
                )
              )
              .orderBy(sql`${musicTracks.addedAt} DESC`)
          ),

        deliveries: (ownerId) =>
          query((db) =>
            db
              .select({
                trackId: musicDeliveries.trackId,
                playlistId: musicDeliveries.playlistId,
                status: musicDeliveries.status,
                updatedAt: musicDeliveries.updatedAt,
              })
              .from(musicDeliveries)
              .where(eq(musicDeliveries.ownerId, ownerId))
          ),

        markPending: (ownerId, pairs, now) =>
          upsert(ownerId, pairs, "pending", now),
        markDelivered: (ownerId, pairs, now) =>
          upsert(ownerId, pairs, "delivered", now),
        markRefused: (ownerId, pairs, now) =>
          upsert(ownerId, pairs, "refused", now),
        clearRefused: (ownerId) =>
          query((db) =>
            db
              .delete(musicDeliveries)
              .where(
                and(
                  eq(musicDeliveries.ownerId, ownerId),
                  eq(musicDeliveries.status, "refused")
                )
              )
          ).pipe(Effect.asVoid),

        likedMemberships: (ownerId, trackIds) =>
          query(async (db) => {
            const result: string[] = []
            for (let start = 0; start < trackIds.length; start += 50) {
              const rows = await db
                .select({ trackId: musicSourceTracks.trackId })
                .from(musicSourceTracks)
                .innerJoin(
                  musicSources,
                  and(
                    eq(musicSources.ownerId, musicSourceTracks.ownerId),
                    eq(musicSources.sourceId, musicSourceTracks.sourceId)
                  )
                )
                .where(
                  and(
                    eq(musicSourceTracks.ownerId, ownerId),
                    eq(
                      musicSourceTracks.sourceId,
                      storedSourceId({ kind: "liked" })
                    ),
                    eq(musicSourceTracks.present, true),
                    eq(musicSources.enabled, true),
                    inArray(
                      musicSourceTracks.trackId,
                      trackIds.slice(start, start + 50)
                    )
                  )
                )
              result.push(...rows.map((row) => row.trackId))
            }
            return result
          }),
        eligible: (ownerId, trackIds) =>
          query(async (db) => {
            const result = new Set<string>()
            for (let start = 0; start < trackIds.length; start += 50) {
              const rows = await db
                .select({ trackId: musicTracks.trackId })
                .from(musicTracks)
                .where(
                  and(
                    eq(musicTracks.ownerId, ownerId),
                    inArray(
                      musicTracks.trackId,
                      trackIds.slice(start, start + 50)
                    ),
                    eligibleTrack(musicTracks.ownerId, musicTracks.trackId)
                  )
                )
              for (const row of rows) result.add(row.trackId)
            }
            return result
          }),
        markRemoved: (ownerId, trackIds) =>
          query(async (db) => {
            for (let start = 0; start < trackIds.length; start += 50)
              await db
                .update(musicSourceTracks)
                .set({ present: false })
                .where(
                  and(
                    eq(musicSourceTracks.ownerId, ownerId),
                    eq(
                      musicSourceTracks.sourceId,
                      storedSourceId({ kind: "liked" })
                    ),
                    inArray(
                      musicSourceTracks.trackId,
                      trackIds.slice(start, start + 50)
                    )
                  )
                )
          }),
      })
    })
  )
}
