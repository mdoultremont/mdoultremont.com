import { and, eq, inArray, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import {
  Database,
  musicDecisions,
  musicDeliveries,
  musicLikedTracks,
  musicSettings,
} from "@/backend/primitives/database"
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
    /** Decisions of tracks that are still liked. */
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
        readonly status: "pending" | "delivered"
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
    /** Records that Spotify no longer lists these tracks as liked. */
    readonly markUnliked: (
      ownerId: string,
      trackIds: readonly string[]
    ) => Effect.Effect<void, DeliveryPersistenceError>
  }
>()("backend/features/music/delivery/DeliveryStore") {
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
        status: "pending" | "delivered",
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
                set: { status, updatedAt: now },
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
              .orderBy(sql`${musicLikedTracks.likedAt} DESC`)
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

        markUnliked: (ownerId, trackIds) =>
          query(async (db) => {
            for (let start = 0; start < trackIds.length; start += 50)
              await db
                .update(musicLikedTracks)
                .set({ liked: false })
                .where(
                  and(
                    eq(musicLikedTracks.ownerId, ownerId),
                    inArray(
                      musicLikedTracks.trackId,
                      trackIds.slice(start, start + 50)
                    )
                  )
                )
          }),
      })
    })
  )
}
