import { and, count, eq, inArray, or } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import {
  authAccounts,
  authUsers,
  Database,
} from "@/backend/primitives/database"
import { AuthPersistenceError } from "./errors"
import type { OwnerAccount } from "./owner-accounts"

/** Reads Better Auth's users and linked accounts. Better Auth does all the writing. */
export class AuthStore extends Context.Service<
  AuthStore,
  {
    readonly userCount: () => Effect.Effect<number, AuthPersistenceError>
    /** Users who have linked at least one of these accounts. */
    readonly usersWithAccounts: (
      accounts: ReadonlyArray<OwnerAccount>,
      userId?: string
    ) => Effect.Effect<ReadonlyArray<string>, AuthPersistenceError>
    /** Providers the user can sign in with. */
    readonly providers: (
      userId: string
    ) => Effect.Effect<ReadonlyArray<string>, AuthPersistenceError>
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
        userCount: () =>
          query((db) =>
            db.select({ users: count() }).from(authUsers).get()
          ).pipe(Effect.map((row) => row?.users ?? 0)),

        usersWithAccounts: (accounts, userId) =>
          accounts.length === 0
            ? Effect.succeed([])
            : query((db) =>
                db
                  .selectDistinct({ userId: authAccounts.userId })
                  .from(authAccounts)
                  .where(
                    and(
                      or(
                        ...accounts.map((account) =>
                          and(
                            eq(authAccounts.providerId, account.provider),
                            eq(authAccounts.accountId, account.accountId)
                          )
                        )
                      ),
                      userId === undefined
                        ? undefined
                        : inArray(authAccounts.userId, [userId])
                    )
                  )
              ).pipe(Effect.map((rows) => rows.map((row) => row.userId))),

        providers: (userId) =>
          query((db) =>
            db
              .select({ providerId: authAccounts.providerId })
              .from(authAccounts)
              .where(eq(authAccounts.userId, userId))
          ).pipe(Effect.map((rows) => rows.map((row) => row.providerId))),
      })
    })
  )
}
