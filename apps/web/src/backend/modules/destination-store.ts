import { and, eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { createDatabase } from "../primitives/db/client"
import { musicDestinations, musicSettings } from "../primitives/db/schema"
import {
  DestinationConflict,
  DestinationPersistenceError,
  DestinationStore,
  type Destination,
} from "../workflows/destinations"

export function destinationStoreLayer(binding: D1Database) {
  const database = createDatabase(binding)
  return Layer.succeed(DestinationStore, {
    read: (ownerId) =>
      Effect.tryPromise({
        try: async () => {
          const [destinations, settings] = await Promise.all([
            database
              .select()
              .from(musicDestinations)
              .where(eq(musicDestinations.ownerId, ownerId))
              .all(),
            database
              .select()
              .from(musicSettings)
              .where(eq(musicSettings.ownerId, ownerId))
              .get(),
          ])
          return {
            destinations: destinations.map(
              ({ playlistId, description, enabled, createdAt, updatedAt }) => ({
                playlistId,
                description,
                enabled,
                createdAt,
                updatedAt,
              })
            ),
            reviewPlaylistId: settings?.reviewPlaylistId ?? null,
          }
        },
        catch: (cause) => new DestinationPersistenceError(cause),
      }),
    save: (ownerId, destination: Destination) =>
      Effect.tryPromise({
        try: async () => {
          const result = await binding
            .prepare(`
          INSERT INTO music_destinations
            (owner_id, playlist_id, description, enabled, created_at, updated_at)
          SELECT ?, ?, ?, ?, ?, ? WHERE ? = 0 OR NOT EXISTS (
            SELECT 1 FROM music_settings
            WHERE owner_id = ? AND review_playlist_id = ?
          )
          ON CONFLICT(owner_id, playlist_id) DO UPDATE SET
            description = excluded.description,
            enabled = excluded.enabled,
            updated_at = excluded.updated_at
          WHERE excluded.enabled = 0 OR NOT EXISTS (
            SELECT 1 FROM music_settings
            WHERE owner_id = excluded.owner_id AND review_playlist_id = excluded.playlist_id
          )
        `)
            .bind(
              ownerId,
              destination.playlistId,
              destination.description,
              destination.enabled ? 1 : 0,
              destination.createdAt,
              destination.updatedAt,
              destination.enabled ? 1 : 0,
              ownerId,
              destination.playlistId
            )
            .run()
          if (result.meta.changes === 0) throw new DestinationConflict()
        },
        catch: (cause) =>
          cause instanceof DestinationConflict
            ? cause
            : new DestinationPersistenceError(cause),
      }),
    remove: (ownerId, playlistId) =>
      Effect.tryPromise({
        try: async () => {
          await database
            .delete(musicDestinations)
            .where(
              and(
                eq(musicDestinations.ownerId, ownerId),
                eq(musicDestinations.playlistId, playlistId)
              )
            )
        },
        catch: (cause) => new DestinationPersistenceError(cause),
      }),
    setReview: (ownerId, playlistId) =>
      Effect.tryPromise({
        try: async () => {
          const result = await binding
            .prepare(`
          INSERT INTO music_settings (owner_id, review_playlist_id, updated_at)
          SELECT ?, ?, ? WHERE ? IS NULL OR NOT EXISTS (
            SELECT 1 FROM music_destinations
            WHERE owner_id = ? AND playlist_id = ? AND enabled = 1
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
            .bind(
              ownerId,
              playlistId,
              Date.now(),
              playlistId,
              ownerId,
              playlistId
            )
            .run()
          if (result.meta.changes === 0) throw new DestinationConflict()
        },
        catch: (cause) =>
          cause instanceof DestinationConflict
            ? cause
            : new DestinationPersistenceError(cause),
      }),
  })
}
