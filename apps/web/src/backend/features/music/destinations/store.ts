import { and, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import {
  Database,
  musicDestinations,
  musicSettings,
} from "@/backend/primitives/database"
import {
  type Destination,
  type DestinationConfiguration,
  DestinationConflict,
  DestinationPersistenceError,
} from "./errors"

/** A conditional write that changed nothing lost to the conflict rule. */
const changedOrConflict = (changes: number) =>
  changes === 0 ? Effect.fail(new DestinationConflict()) : Effect.void

/**
 * Destination rows and the review playlist setting. The conflict rule (review
 * playlist ≠ enabled destination) is enforced in SQL too, so concurrent saves
 * cannot both win.
 */
export class DestinationStore extends Context.Service<
  DestinationStore,
  {
    readonly read: (
      ownerId: string
    ) => Effect.Effect<DestinationConfiguration, DestinationPersistenceError>
    readonly save: (
      ownerId: string,
      destination: Destination
    ) => Effect.Effect<void, DestinationPersistenceError | DestinationConflict>
    readonly remove: (
      ownerId: string,
      playlistId: string
    ) => Effect.Effect<void, DestinationPersistenceError>
    readonly setReady: (
      ownerId: string,
      ready: boolean,
      now: number
    ) => Effect.Effect<void, DestinationPersistenceError>
    readonly setReview: (
      ownerId: string,
      playlistId: string | null,
      now: number
    ) => Effect.Effect<void, DestinationPersistenceError | DestinationConflict>
  }
>()("backend/features/destinations/DestinationStore") {
  static readonly layer = Layer.effect(
    DestinationStore,
    Effect.gen(function* () {
      const database = yield* Database
      const query = <A>(run: Parameters<typeof database.use<A>>[0]) =>
        database
          .use(run)
          .pipe(
            Effect.mapError(
              (error) => new DestinationPersistenceError({ cause: error })
            )
          )
      return DestinationStore.of({
        read: (ownerId) =>
          query((db) =>
            Promise.all([
              db
                .select()
                .from(musicDestinations)
                .where(eq(musicDestinations.ownerId, ownerId))
                .all(),
              db
                .select()
                .from(musicSettings)
                .where(eq(musicSettings.ownerId, ownerId))
                .get(),
            ])
          ).pipe(
            Effect.map(([destinations, settings]) => ({
              destinations: destinations.map(
                ({
                  playlistId,
                  description,
                  enabled,
                  createdAt,
                  updatedAt,
                }) => ({
                  playlistId,
                  description,
                  enabled,
                  createdAt,
                  updatedAt,
                })
              ),
              reviewPlaylistId: settings?.reviewPlaylistId ?? null,
              ready: settings?.ready ?? false,
            }))
          ),

        save: (ownerId, destination) => {
          const enabled = destination.enabled ? 1 : 0
          return query((db) =>
            db.run(sql`
              INSERT INTO music_destinations
                (owner_id, playlist_id, description, enabled, created_at, updated_at)
              SELECT ${ownerId}, ${destination.playlistId}, ${destination.description},
                ${enabled}, ${destination.createdAt}, ${destination.updatedAt}
              WHERE ${enabled} = 0 OR NOT EXISTS (
                SELECT 1 FROM music_settings
                WHERE owner_id = ${ownerId} AND review_playlist_id = ${destination.playlistId}
              )
              ON CONFLICT(owner_id, playlist_id) DO UPDATE SET
                description = excluded.description,
                enabled = excluded.enabled,
                updated_at = excluded.updated_at
              WHERE excluded.enabled = 0 OR NOT EXISTS (
                SELECT 1 FROM music_settings
                WHERE owner_id = excluded.owner_id
                  AND review_playlist_id = excluded.playlist_id
              )
            `)
          ).pipe(
            Effect.flatMap((result) => changedOrConflict(result.meta.changes))
          )
        },

        setReady: (ownerId, ready, now) =>
          query((db) =>
            db
              .insert(musicSettings)
              .values({ ownerId, ready, updatedAt: now })
              .onConflictDoUpdate({
                target: musicSettings.ownerId,
                set: { ready, updatedAt: now },
              })
          ).pipe(Effect.asVoid),

        remove: (ownerId, playlistId) =>
          query((db) =>
            db
              .delete(musicDestinations)
              .where(
                and(
                  eq(musicDestinations.ownerId, ownerId),
                  eq(musicDestinations.playlistId, playlistId)
                )
              )
          ).pipe(Effect.asVoid),

        setReview: (ownerId, playlistId, now) =>
          query((db) =>
            db.run(sql`
              INSERT INTO music_settings (owner_id, review_playlist_id, updated_at)
              SELECT ${ownerId}, ${playlistId}, ${now}
              WHERE ${playlistId} IS NULL OR NOT EXISTS (
                SELECT 1 FROM music_destinations
                WHERE owner_id = ${ownerId} AND playlist_id = ${playlistId} AND enabled = 1
              )
              ON CONFLICT(owner_id) DO UPDATE SET
                review_playlist_id = excluded.review_playlist_id,
                updated_at = excluded.updated_at
              WHERE excluded.review_playlist_id IS NULL OR NOT EXISTS (
                SELECT 1 FROM music_destinations
                WHERE owner_id = excluded.owner_id
                  AND playlist_id = excluded.review_playlist_id AND enabled = 1
              )
            `)
          ).pipe(
            Effect.flatMap((result) => changedOrConflict(result.meta.changes))
          ),
      })
    })
  )
}
