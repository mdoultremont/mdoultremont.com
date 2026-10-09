import { and, eq, gt, lt } from "drizzle-orm"
import { Context, Effect, Layer, Option } from "effect"
import type { GitHubIdentity } from "@/backend/modules/github"
import { appOwners, appSessions, Database } from "@/backend/primitives/database"
import { AuthPersistenceError } from "./errors"

/** The owner's GitHub profile and their sessions, stored by token hash only. */
export class AuthStore extends Context.Service<
  AuthStore,
  {
    /** Saves the session and drops the owner's expired ones. Times are Unix seconds. */
    readonly saveSession: (input: {
      readonly identity: GitHubIdentity
      readonly sessionHash: string
      readonly expiresAt: number
      readonly now: number
    }) => Effect.Effect<void, AuthPersistenceError>
    readonly findSession: (input: {
      readonly sessionHash: string
      readonly now: number
    }) => Effect.Effect<Option.Option<GitHubIdentity>, AuthPersistenceError>
    readonly revokeSession: (
      sessionHash: string
    ) => Effect.Effect<void, AuthPersistenceError>
  }
>()("backend/features/auth/AuthStore") {
  static readonly layer = Layer.effect(
    AuthStore,
    Effect.gen(function* () {
      const database = yield* Database
      const query = <A>(run: Parameters<typeof database.use<A>>[0]) =>
        database
          .use(run)
          .pipe(
            Effect.mapError(
              (error) => new AuthPersistenceError({ cause: error })
            )
          )

      return AuthStore.of({
        saveSession: ({ identity, sessionHash, expiresAt, now }) =>
          query((db) =>
            db.batch([
              db
                .insert(appOwners)
                .values({
                  githubId: identity.id,
                  login: identity.login,
                  name: identity.name,
                  avatarUrl: identity.avatarUrl,
                  updatedAt: now,
                })
                .onConflictDoUpdate({
                  target: appOwners.githubId,
                  set: {
                    login: identity.login,
                    name: identity.name,
                    avatarUrl: identity.avatarUrl,
                    updatedAt: now,
                  },
                }),
              db.insert(appSessions).values({
                tokenHash: sessionHash,
                githubId: identity.id,
                createdAt: now,
                expiresAt,
              }),
              db
                .delete(appSessions)
                .where(
                  and(
                    eq(appSessions.githubId, identity.id),
                    lt(appSessions.expiresAt, now)
                  )
                ),
            ])
          ).pipe(Effect.asVoid),

        findSession: ({ sessionHash, now }) =>
          query((db) =>
            db
              .select({
                id: appOwners.githubId,
                login: appOwners.login,
                name: appOwners.name,
                avatarUrl: appOwners.avatarUrl,
              })
              .from(appSessions)
              .innerJoin(
                appOwners,
                eq(appSessions.githubId, appOwners.githubId)
              )
              .where(
                and(
                  eq(appSessions.tokenHash, sessionHash),
                  gt(appSessions.expiresAt, now)
                )
              )
              .get()
          ).pipe(Effect.map(Option.fromNullishOr)),

        revokeSession: (sessionHash) =>
          query((db) =>
            db.delete(appSessions).where(eq(appSessions.tokenHash, sessionHash))
          ).pipe(Effect.asVoid),
      })
    })
  )
}
