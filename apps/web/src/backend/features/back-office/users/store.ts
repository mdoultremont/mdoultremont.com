import { and, asc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm"
import { Context, Effect, Layer, Option } from "effect"
import {
  type App,
  apps as allApps,
  decodeInvitationApps,
} from "@/backend/features/auth"
import {
  appAccess,
  authAccounts,
  authSessions,
  authUsers,
  Database,
  invitations,
} from "@/backend/modules/database"
import {
  type DirectoryUser,
  type PendingInvitationSummary,
  UserDirectoryPersistenceError,
} from "./errors"

/** What a guarded change did: applied, or refused and why. */
export type GuardedChange = "applied" | "not-found" | "last-back-office-user"

/** `true` when another user who was not removed may use the back office. */
const otherBackOfficeUser = (userId: string) =>
  sql`EXISTS (SELECT 1 FROM ${appAccess} INNER JOIN ${authUsers} ON ${authUsers.id} = ${appAccess.userId} WHERE ${appAccess.app} = 'backOffice' AND ${authUsers.deletedAt} IS NULL AND ${appAccess.userId} <> ${userId})`

const changes = (result: unknown) =>
  typeof result === "object" &&
  result !== null &&
  "meta" in result &&
  typeof result.meta === "object" &&
  result.meta !== null &&
  "changes" in result.meta &&
  typeof result.meta.changes === "number"
    ? result.meta.changes
    : 0

/** Users, their app access, and invitations, as the back office manages them. */
export class UserDirectoryStore extends Context.Service<
  UserDirectoryStore,
  {
    readonly users: () => Effect.Effect<
      ReadonlyArray<DirectoryUser>,
      UserDirectoryPersistenceError
    >
    readonly pendingInvitations: (
      now: number
    ) => Effect.Effect<
      ReadonlyArray<PendingInvitationSummary>,
      UserDirectoryPersistenceError
    >
    readonly hasUserWithEmail: (
      email: string
    ) => Effect.Effect<boolean, UserDirectoryPersistenceError>
    /** Saves the invitation and drops any other pending invitation to the same email. */
    readonly createInvitation: (invitation: {
      readonly id: string
      readonly email: string
      readonly tokenHash: string
      readonly apps: ReadonlyArray<App>
      readonly invitedBy: string
      readonly createdAt: number
      readonly expiresAt: number
    }) => Effect.Effect<void, UserDirectoryPersistenceError>
    /** Gives a pending invitation a new token and expiry; the old link stops working. */
    readonly renewInvitation: (input: {
      readonly id: string
      readonly tokenHash: string
      readonly expiresAt: number
    }) => Effect.Effect<
      Option.Option<{
        readonly email: string
        readonly apps: ReadonlyArray<App>
      }>,
      UserDirectoryPersistenceError
    >
    /** Deletes a pending invitation. `false` when there was none. */
    readonly deleteInvitation: (
      id: string
    ) => Effect.Effect<boolean, UserDirectoryPersistenceError>
    /** Replaces the user's app access, never leaving the back office without a user. */
    readonly setAccess: (input: {
      readonly userId: string
      readonly apps: ReadonlyArray<App>
      readonly now: number
    }) => Effect.Effect<GuardedChange, UserDirectoryPersistenceError>
    /**
     * Marks the user removed, ends their sessions and drops their app access,
     * never leaving the back office without a user. Their data stays.
     */
    readonly remove: (input: {
      readonly userId: string
      readonly now: number
    }) => Effect.Effect<GuardedChange, UserDirectoryPersistenceError>
  }
>()("backend/features/back-office/UserDirectoryStore") {
  static readonly layer = Layer.effect(
    UserDirectoryStore,
    Effect.gen(function* () {
      const database = yield* Database
      const query = <A>(run: Parameters<typeof database.use<A>>[0]) =>
        database
          .use(run)
          .pipe(
            Effect.mapError(
              (error) => new UserDirectoryPersistenceError({ cause: error })
            )
          )

      const activeUser = (userId: string) =>
        query((db) =>
          db
            .select({ id: authUsers.id })
            .from(authUsers)
            .where(and(eq(authUsers.id, userId), isNull(authUsers.deletedAt)))
            .get()
        ).pipe(Effect.map((row) => row !== undefined))

      return UserDirectoryStore.of({
        users: () =>
          query(async (db) => {
            const users = await db
              .select({
                id: authUsers.id,
                name: authUsers.name,
                email: authUsers.email,
                image: authUsers.image,
              })
              .from(authUsers)
              .where(isNull(authUsers.deletedAt))
              .orderBy(asc(authUsers.createdAt))
            const ids = users.map((user) => user.id)
            if (ids.length === 0) return []
            const [access, accounts] = await Promise.all([
              db
                .select({ userId: appAccess.userId, app: appAccess.app })
                .from(appAccess)
                .where(inArray(appAccess.userId, ids)),
              db
                .select({
                  userId: authAccounts.userId,
                  providerId: authAccounts.providerId,
                })
                .from(authAccounts)
                .where(inArray(authAccounts.userId, ids)),
            ])
            return users.map((user) => ({
              ...user,
              providers: accounts
                .filter((account) => account.userId === user.id)
                .map((account) => account.providerId),
              apps: allApps.filter((app) =>
                access.some((row) => row.userId === user.id && row.app === app)
              ),
            }))
          }),

        pendingInvitations: (now) =>
          query((db) =>
            db
              .select({
                id: invitations.id,
                email: invitations.email,
                apps: invitations.apps,
                createdAt: invitations.createdAt,
                expiresAt: invitations.expiresAt,
              })
              .from(invitations)
              .where(isNull(invitations.acceptedAt))
              .orderBy(asc(invitations.createdAt))
          ).pipe(
            Effect.map((rows) =>
              rows.map((row) => ({
                ...row,
                apps: decodeInvitationApps(row.apps),
                expired: row.expiresAt <= now,
              }))
            )
          ),

        hasUserWithEmail: (email) =>
          query((db) =>
            db
              .select({ id: authUsers.id })
              .from(authUsers)
              .where(
                and(eq(authUsers.email, email), isNull(authUsers.deletedAt))
              )
              .get()
          ).pipe(Effect.map((row) => row !== undefined)),

        createInvitation: (invitation) =>
          query((db) =>
            db.batch([
              db
                .delete(invitations)
                .where(
                  and(
                    eq(invitations.email, invitation.email),
                    isNull(invitations.acceptedAt)
                  )
                ),
              db.insert(invitations).values({
                ...invitation,
                apps: JSON.stringify(invitation.apps),
              }),
            ])
          ).pipe(Effect.asVoid),

        renewInvitation: ({ id, tokenHash, expiresAt }) =>
          query((db) =>
            db
              .update(invitations)
              .set({ tokenHash, expiresAt })
              .where(
                and(eq(invitations.id, id), isNull(invitations.acceptedAt))
              )
              .returning({ email: invitations.email, apps: invitations.apps })
              .get()
          ).pipe(
            Effect.map((row) =>
              Option.fromNullishOr(row).pipe(
                Option.map(({ email, apps }) => ({
                  email,
                  apps: decodeInvitationApps(apps),
                }))
              )
            )
          ),

        deleteInvitation: (id) =>
          query((db) =>
            db
              .delete(invitations)
              .where(
                and(eq(invitations.id, id), isNull(invitations.acceptedAt))
              )
              .run()
          ).pipe(Effect.map((result) => changes(result) > 0)),

        setAccess: ({ userId, apps, now }) =>
          Effect.gen(function* () {
            if (!(yield* activeUser(userId))) return "not-found" as const
            if (!apps.includes("backOffice")) {
              // One statement, so two concurrent removals cannot both pass.
              const kept = yield* query(async (db) => {
                await db
                  .delete(appAccess)
                  .where(
                    and(
                      eq(appAccess.userId, userId),
                      eq(appAccess.app, "backOffice"),
                      otherBackOfficeUser(userId)
                    )
                  )
                return db
                  .select({ app: appAccess.app })
                  .from(appAccess)
                  .where(
                    and(
                      eq(appAccess.userId, userId),
                      eq(appAccess.app, "backOffice")
                    )
                  )
                  .get()
              })
              if (kept !== undefined) return "last-back-office-user" as const
            }
            yield* query((db) =>
              db.batch([
                db
                  .delete(appAccess)
                  .where(
                    and(
                      eq(appAccess.userId, userId),
                      notInArray(appAccess.app, [...apps, "backOffice"])
                    )
                  ),
                ...apps.map((app) =>
                  db
                    .insert(appAccess)
                    .values({ userId, app, grantedAt: now })
                    .onConflictDoNothing()
                ),
              ])
            )
            return "applied" as const
          }),

        remove: ({ userId, now }) =>
          Effect.gen(function* () {
            if (!(yield* activeUser(userId))) return "not-found" as const
            const removedHere = sql`EXISTS (SELECT 1 FROM ${authUsers} WHERE ${authUsers.id} = ${userId} AND ${authUsers.deletedAt} = ${now})`
            const [removed] = yield* query((db) =>
              db.batch([
                db
                  .update(authUsers)
                  .set({ deletedAt: now })
                  .where(
                    and(
                      eq(authUsers.id, userId),
                      isNull(authUsers.deletedAt),
                      sql`(NOT EXISTS (SELECT 1 FROM ${appAccess} WHERE ${appAccess.userId} = ${userId} AND ${appAccess.app} = 'backOffice') OR ${otherBackOfficeUser(userId)})`
                    )
                  ),
                db
                  .delete(appAccess)
                  .where(and(eq(appAccess.userId, userId), removedHere)),
                db
                  .delete(authSessions)
                  .where(and(eq(authSessions.userId, userId), removedHere)),
              ])
            )
            return changes(removed) > 0
              ? ("applied" as const)
              : ("last-back-office-user" as const)
          }),
      })
    })
  )
}
