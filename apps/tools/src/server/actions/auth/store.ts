import { and, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema } from "effect"
import {
  appAccess,
  authAccounts,
  authUsers,
  Database,
  invitations,
  oauthAccessTokens,
  oauthRefreshTokens,
  oauthRevokedGrants,
} from "@/server/modules/database"
import { type App, apps as allApps, isApp } from "./apps"
import { AuthPersistenceError } from "./errors"
import type { OwnerAccount } from "./owner-accounts"

/** A pending invitation: not accepted yet and not expired. */
export interface PendingInvitation {
  readonly id: string
  readonly email: string
  readonly apps: ReadonlyArray<App>
}

const InvitationApps = Schema.fromJsonString(Schema.Array(Schema.String))

/** Reads JSON-encoded app IDs, keeping only apps that still exist. */
export const decodeInvitationApps = (value: string): ReadonlyArray<App> =>
  Option.match(Schema.decodeUnknownOption(InvitationApps)(value), {
    onNone: () => [],
    onSome: (ids) => ids.filter(isApp),
  })

/**
 * Reads users, their sign-in accounts and app access for sign-in. Better Auth
 * writes users, sessions and accounts; this store writes only app access and
 * invitation acceptance.
 */
export class AuthStore extends Context.Service<
  AuthStore,
  {
    /** Users who have linked at least one of these accounts. */
    readonly usersWithAccounts: (
      accounts: ReadonlyArray<OwnerAccount>,
      userId?: string
    ) => Effect.Effect<ReadonlyArray<string>, AuthPersistenceError>
    /** The user who signs in with this account, and whether they were removed. */
    readonly userForAccount: (
      account: OwnerAccount
    ) => Effect.Effect<
      Option.Option<{ readonly id: string; readonly removed: boolean }>,
      AuthPersistenceError
    >
    readonly isRemoved: (
      userId: string
    ) => Effect.Effect<boolean, AuthPersistenceError>
    /** Providers the user can sign in with. */
    readonly providers: (
      userId: string
    ) => Effect.Effect<ReadonlyArray<string>, AuthPersistenceError>
    /** Apps the user may use. */
    readonly apps: (
      userId: string
    ) => Effect.Effect<ReadonlyArray<App>, AuthPersistenceError>
    /** Users who may use the app and were not removed. */
    readonly usersWithApp: (
      app: App
    ) => Effect.Effect<ReadonlyArray<string>, AuthPersistenceError>
    readonly grant: (
      userId: string,
      apps: ReadonlyArray<App>,
      now: number
    ) => Effect.Effect<void, AuthPersistenceError>
    readonly pendingInvitation: (
      tokenHash: string,
      now: number
    ) => Effect.Effect<Option.Option<PendingInvitation>, AuthPersistenceError>
    /**
     * Marks the invitation accepted by the user, grants its apps, and restores
     * the user if they were removed, revoking the OAuth grants they held.
     * Does nothing if someone else accepted it first.
     */
    readonly acceptInvitation: (input: {
      readonly invitation: PendingInvitation
      readonly userId: string
      readonly now: number
    }) => Effect.Effect<void, AuthPersistenceError>
  }
>()("server/actions/auth/AuthStore") {
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

        userForAccount: (account) =>
          query((db) =>
            db
              .select({ id: authUsers.id, deletedAt: authUsers.deletedAt })
              .from(authAccounts)
              .innerJoin(authUsers, eq(authUsers.id, authAccounts.userId))
              .where(
                and(
                  eq(authAccounts.providerId, account.provider),
                  eq(authAccounts.accountId, account.accountId)
                )
              )
              .get()
          ).pipe(
            Effect.map((row) =>
              Option.fromNullishOr(row).pipe(
                Option.map(({ id, deletedAt }) => ({
                  id,
                  removed: deletedAt !== null,
                }))
              )
            )
          ),

        isRemoved: (userId) =>
          query((db) =>
            db
              .select({ deletedAt: authUsers.deletedAt })
              .from(authUsers)
              .where(eq(authUsers.id, userId))
              .get()
          ).pipe(
            Effect.map((row) => row === undefined || row.deletedAt !== null)
          ),

        providers: (userId) =>
          query((db) =>
            db
              .select({ providerId: authAccounts.providerId })
              .from(authAccounts)
              .where(eq(authAccounts.userId, userId))
          ).pipe(Effect.map((rows) => rows.map((row) => row.providerId))),

        apps: (userId) =>
          query((db) =>
            db
              .select({ app: appAccess.app })
              .from(appAccess)
              .where(eq(appAccess.userId, userId))
          ).pipe(
            Effect.map((rows) =>
              allApps.filter((app) => rows.some((row) => row.app === app))
            )
          ),

        usersWithApp: (app) =>
          query((db) =>
            db
              .select({ userId: appAccess.userId })
              .from(appAccess)
              .innerJoin(authUsers, eq(authUsers.id, appAccess.userId))
              .where(and(eq(appAccess.app, app), isNull(authUsers.deletedAt)))
          ).pipe(Effect.map((rows) => rows.map((row) => row.userId))),

        grant: (userId, apps, now) =>
          apps.length === 0
            ? Effect.void
            : query(async (db) => {
                const [first, ...rest] = apps.map((app) =>
                  db
                    .insert(appAccess)
                    .values({ userId, app, grantedAt: now })
                    .onConflictDoNothing()
                )
                if (first) await db.batch([first, ...rest])
              }),

        pendingInvitation: (tokenHash, now) =>
          query((db) =>
            db
              .select({
                id: invitations.id,
                email: invitations.email,
                apps: invitations.apps,
              })
              .from(invitations)
              .where(
                and(
                  eq(invitations.tokenHash, tokenHash),
                  isNull(invitations.acceptedAt),
                  gt(invitations.expiresAt, now)
                )
              )
              .get()
          ).pipe(
            Effect.map((row) =>
              Option.fromNullishOr(row).pipe(
                Option.map((invitation) => ({
                  ...invitation,
                  apps: decodeInvitationApps(invitation.apps),
                }))
              )
            )
          ),

        acceptInvitation: ({ invitation, userId, now }) =>
          query(async (db) => {
            // The grants and the restore apply only if this batch's update
            // is the one that accepted the invitation.
            const acceptedHere = and(
              eq(invitations.id, invitation.id),
              eq(invitations.acceptedBy, userId),
              eq(invitations.acceptedAt, now)
            )
            await db.batch([
              db
                .update(invitations)
                .set({ acceptedAt: now, acceptedBy: userId })
                .where(
                  and(
                    eq(invitations.id, invitation.id),
                    isNull(invitations.acceptedAt)
                  )
                ),
              ...invitation.apps.map((app) =>
                db
                  .insert(appAccess)
                  .select(
                    db
                      .select({
                        userId: sql<string>`${userId}`.as("user_id"),
                        app: sql<string>`${app}`.as("app"),
                        grantedAt: sql<number>`${now}`.as("granted_at"),
                      })
                      .from(invitations)
                      .where(acceptedHere)
                  )
                  .onConflictDoNothing()
              ),
              // A restored user starts without the OAuth grants they held
              // before removal, including any a client refreshed meanwhile.
              ...[oauthRefreshTokens, oauthAccessTokens].map((tokens) =>
                db
                  .insert(oauthRevokedGrants)
                  .select(
                    db
                      .selectDistinct({
                        authorizationCodeId:
                          sql<string>`${tokens.authorizationCodeId}`.as(
                            "authorization_code_id"
                          ),
                        revokedAt: sql<number>`${now}`.as("revoked_at"),
                      })
                      .from(tokens)
                      .innerJoin(authUsers, eq(authUsers.id, tokens.userId))
                      .where(
                        and(
                          eq(tokens.userId, userId),
                          isNotNull(tokens.authorizationCodeId),
                          isNotNull(authUsers.deletedAt),
                          sql`EXISTS (SELECT 1 FROM ${invitations} WHERE ${acceptedHere})`
                        )
                      )
                  )
                  .onConflictDoNothing()
              ),
              db
                .update(authUsers)
                .set({ deletedAt: null })
                .where(
                  and(
                    eq(authUsers.id, userId),
                    sql`EXISTS (SELECT 1 FROM ${invitations} WHERE ${acceptedHere})`
                  )
                ),
            ])
          }),
      })
    })
  )
}
