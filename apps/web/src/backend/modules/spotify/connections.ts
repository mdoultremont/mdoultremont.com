import { and, eq } from "drizzle-orm"
import { Context, Effect, Layer, Option } from "effect"
import {
  Database,
  type DatabaseError,
  spotifyConnections,
} from "@/backend/primitives/database"

export interface SpotifyConnection {
  readonly ownerId: string
  readonly accountId: string
  readonly spotifyUserId: string
  readonly displayName: string | null
  readonly encryptedRefreshToken: string
  readonly scopes: string
  readonly connectedAt: number
  readonly needsReconnect: boolean
}

/** Durable Spotify credentials, one row per owner. */
export class SpotifyConnections extends Context.Service<
  SpotifyConnections,
  {
    readonly get: (
      ownerId: string
    ) => Effect.Effect<Option.Option<SpotifyConnection>, DatabaseError>
    readonly save: (
      connection: SpotifyConnection
    ) => Effect.Effect<void, DatabaseError>
    /** Compare-and-swap so a rotated token never overwrites a newer connection. */
    readonly replaceRefreshToken: (
      ownerId: string,
      previous: string,
      next: string
    ) => Effect.Effect<boolean, DatabaseError>
    /** Marks reconnect only while the stored refresh token is still the one that failed. */
    readonly markReconnect: (
      ownerId: string,
      encryptedRefreshToken: string
    ) => Effect.Effect<void, DatabaseError>
    readonly disconnect: (ownerId: string) => Effect.Effect<void, DatabaseError>
  }
>()("backend/modules/spotify/SpotifyConnections") {
  static readonly layer = Layer.effect(
    SpotifyConnections,
    Effect.gen(function* () {
      const database = yield* Database
      return SpotifyConnections.of({
        get: (ownerId) =>
          database
            .use((db) =>
              db
                .select()
                .from(spotifyConnections)
                .where(eq(spotifyConnections.ownerId, ownerId))
                .get()
            )
            .pipe(Effect.map(Option.fromNullishOr)),
        save: (connection) =>
          database.use((db) =>
            db
              .insert(spotifyConnections)
              .values(connection)
              .onConflictDoUpdate({
                target: spotifyConnections.ownerId,
                set: {
                  accountId: connection.accountId,
                  spotifyUserId: connection.spotifyUserId,
                  displayName: connection.displayName,
                  encryptedRefreshToken: connection.encryptedRefreshToken,
                  scopes: connection.scopes,
                  connectedAt: connection.connectedAt,
                  needsReconnect: false,
                },
              })
          ),
        replaceRefreshToken: (ownerId, previous, next) =>
          database
            .use((db) =>
              db
                .update(spotifyConnections)
                .set({ encryptedRefreshToken: next })
                .where(
                  and(
                    eq(spotifyConnections.ownerId, ownerId),
                    eq(spotifyConnections.encryptedRefreshToken, previous),
                    eq(spotifyConnections.needsReconnect, false)
                  )
                )
                .returning({ ownerId: spotifyConnections.ownerId })
            )
            .pipe(Effect.map((rows) => rows.length > 0)),
        markReconnect: (ownerId, encryptedRefreshToken) =>
          database.use((db) =>
            db
              .update(spotifyConnections)
              .set({ needsReconnect: true })
              .where(
                and(
                  eq(spotifyConnections.ownerId, ownerId),
                  eq(
                    spotifyConnections.encryptedRefreshToken,
                    encryptedRefreshToken
                  )
                )
              )
          ),
        disconnect: (ownerId) =>
          database.use((db) =>
            db
              .delete(spotifyConnections)
              .where(eq(spotifyConnections.ownerId, ownerId))
          ),
      })
    })
  )
}
