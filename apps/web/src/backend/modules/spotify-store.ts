import { eq, and } from "drizzle-orm"
import { createDatabase } from "@/backend/primitives/db/client"
import { spotifyConnections } from "@/backend/primitives/db/schema"
import type { SpotifyConnection, SpotifyConnectionStore } from "./spotify"

export function createSpotifyConnectionStore(
  binding: D1Database
): SpotifyConnectionStore {
  const database = createDatabase(binding)
  return {
    async get(ownerId) {
      const row = await database
        .select()
        .from(spotifyConnections)
        .where(eq(spotifyConnections.ownerId, ownerId))
        .get()
      return row ?? null
    },
    async save(connection: SpotifyConnection) {
      await database
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
    },
    async replaceRefreshToken(ownerId, previous, next) {
      const updated = await database
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
      return updated.length > 0
    },
    async markReconnect(ownerId) {
      await database
        .update(spotifyConnections)
        .set({ needsReconnect: true })
        .where(eq(spotifyConnections.ownerId, ownerId))
    },
    async disconnect(ownerId) {
      await database
        .delete(spotifyConnections)
        .where(eq(spotifyConnections.ownerId, ownerId))
    },
  }
}
