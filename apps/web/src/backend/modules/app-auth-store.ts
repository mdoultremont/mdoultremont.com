import { Effect, Layer } from "effect"
import { and, eq, gt, lt } from "drizzle-orm"
import { appOwners, appSessions } from "../primitives/db/schema"
import { createDatabase } from "../primitives/db/client"
import {
  AppAuthStore,
  AuthPersistenceError,
  type OwnerSession,
} from "../workflows/app-auth"

export function appAuthStoreLayer(binding: D1Database) {
  const database = createDatabase(binding)

  return Layer.succeed(AppAuthStore, {
    saveOwnerSession: (session: OwnerSession) =>
      Effect.tryPromise({
        try: async () => {
          const now = Math.floor(Date.now() / 1000)
          await database
            .insert(appOwners)
            .values({
              githubId: session.identity.id,
              login: session.identity.login,
              name: session.identity.name,
              avatarUrl: session.identity.avatarUrl,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: appOwners.githubId,
              set: {
                login: session.identity.login,
                name: session.identity.name,
                avatarUrl: session.identity.avatarUrl,
                updatedAt: now,
              },
            })
          await database.insert(appSessions).values({
            tokenHash: session.sessionHash,
            githubId: session.identity.id,
            createdAt: now,
            expiresAt: session.expiresAt,
          })
          await database
            .delete(appSessions)
            .where(
              and(
                eq(appSessions.githubId, session.identity.id),
                lt(appSessions.expiresAt, now)
              )
            )
        },
        catch: (cause) => new AuthPersistenceError(cause),
      }),
    findOwnerSession: ({ sessionHash, now }) =>
      Effect.tryPromise({
        try: async () => {
          const session = await database
            .select({
              id: appOwners.githubId,
              login: appOwners.login,
              name: appOwners.name,
              avatarUrl: appOwners.avatarUrl,
            })
            .from(appSessions)
            .innerJoin(appOwners, eq(appSessions.githubId, appOwners.githubId))
            .where(
              and(
                eq(appSessions.tokenHash, sessionHash),
                gt(appSessions.expiresAt, now)
              )
            )
            .get()

          return session ?? null
        },
        catch: (cause) => new AuthPersistenceError(cause),
      }),
    revokeSession: (sessionHash) =>
      Effect.tryPromise({
        try: async () => {
          await database
            .delete(appSessions)
            .where(eq(appSessions.tokenHash, sessionHash))
        },
        catch: (cause) => new AuthPersistenceError(cause),
      }),
  })
}
