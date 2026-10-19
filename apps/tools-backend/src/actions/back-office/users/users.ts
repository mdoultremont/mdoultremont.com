import { Clock, Context, Effect, Layer, Option } from "effect"
import type { App } from "#backend/actions/auth"
import { Email, type EmailError } from "#backend/modules/email"
import { randomToken, sha256Hex } from "#backend/modules/hashing"
import {
  AlreadyAUser,
  InvitationNotFound,
  LastBackOfficeUser,
  OwnAccessProtected,
  type UserDirectory,
  type UserDirectoryPersistenceError,
  UserInputError,
  UserNotFound,
} from "./errors"
import { invitationEmail } from "./invitation-email"
import { type GuardedChange, UserDirectoryStore } from "./store"

/** How long an invitation link works. */
export const invitationLifetimeMs = 7 * 24 * 60 * 60 * 1000

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

/** Turns a refused guarded change into its error. */
const applied = (change: GuardedChange) =>
  change === "applied"
    ? Effect.void
    : change === "not-found"
      ? Effect.fail(new UserNotFound())
      : Effect.fail(new LastBackOfficeUser())

/**
 * The back office's user management: inviting people by email, choosing the
 * apps each user may use, and removing users. At least one user always keeps
 * the back office, and nobody can remove themselves or their own access to it.
 */
export class Users extends Context.Service<
  Users,
  {
    readonly list: () => Effect.Effect<
      UserDirectory,
      UserDirectoryPersistenceError
    >
    /** Saves an invitation and emails its link, which works for a week. */
    readonly invite: (input: {
      readonly email: string
      readonly apps: ReadonlyArray<App>
      readonly invitedBy: string
      /** The site's origin, for the link in the email. */
      readonly origin: string
    }) => Effect.Effect<
      void,
      UserInputError | AlreadyAUser | EmailError | UserDirectoryPersistenceError
    >
    /** Emails a new link for a pending invitation; the old link stops working. */
    readonly resendInvitation: (input: {
      readonly invitationId: string
      readonly origin: string
    }) => Effect.Effect<
      void,
      InvitationNotFound | EmailError | UserDirectoryPersistenceError
    >
    readonly revokeInvitation: (
      invitationId: string
    ) => Effect.Effect<void, InvitationNotFound | UserDirectoryPersistenceError>
    readonly setAccess: (input: {
      readonly actorId: string
      readonly userId: string
      readonly apps: ReadonlyArray<App>
    }) => Effect.Effect<
      void,
      | OwnAccessProtected
      | UserNotFound
      | LastBackOfficeUser
      | UserDirectoryPersistenceError
    >
    readonly remove: (input: {
      readonly actorId: string
      readonly userId: string
    }) => Effect.Effect<
      void,
      | OwnAccessProtected
      | UserNotFound
      | LastBackOfficeUser
      | UserDirectoryPersistenceError
    >
  }
>()("server/actions/back-office/Users") {
  static readonly layerNoDeps = Layer.effect(
    Users,
    Effect.gen(function* () {
      const store = yield* UserDirectoryStore
      const email = yield* Email

      const sendInvitation = (input: {
        readonly to: string
        readonly token: string
        readonly apps: ReadonlyArray<App>
        readonly origin: string
      }) =>
        email.send({
          to: input.to,
          ...invitationEmail({
            link: `${input.origin}/api/invitations/accept?token=${input.token}`,
            apps: input.apps,
          }),
        })

      const invite = Effect.fn("Users.invite")(function* (input: {
        readonly email: string
        readonly apps: ReadonlyArray<App>
        readonly invitedBy: string
        readonly origin: string
      }) {
        const to = input.email.trim().toLowerCase()
        if (!emailPattern.test(to))
          return yield* new UserInputError({ message: "Enter a valid email" })
        if (input.apps.length === 0)
          return yield* new UserInputError({
            message: "Choose at least one app",
          })
        if (yield* store.hasUserWithEmail(to)) return yield* new AlreadyAUser()

        const now = yield* Clock.currentTimeMillis
        const id = crypto.randomUUID()
        const token = yield* randomToken
        yield* store.createInvitation({
          id,
          email: to,
          tokenHash: yield* sha256Hex(token),
          apps: input.apps,
          invitedBy: input.invitedBy,
          createdAt: now,
          expiresAt: now + invitationLifetimeMs,
        })
        // An invitation whose email never left would only confuse: drop it.
        yield* sendInvitation({
          to,
          token,
          apps: input.apps,
          origin: input.origin,
        }).pipe(
          Effect.tapError(() => store.deleteInvitation(id).pipe(Effect.ignore))
        )
      })

      const resendInvitation = Effect.fn("Users.resendInvitation")(
        function* (input: {
          readonly invitationId: string
          readonly origin: string
        }) {
          const now = yield* Clock.currentTimeMillis
          const token = yield* randomToken
          const invitation = yield* store.renewInvitation({
            id: input.invitationId,
            tokenHash: yield* sha256Hex(token),
            expiresAt: now + invitationLifetimeMs,
          })
          if (Option.isNone(invitation)) return yield* new InvitationNotFound()
          yield* sendInvitation({
            to: invitation.value.email,
            token,
            apps: invitation.value.apps,
            origin: input.origin,
          })
        }
      )

      const revokeInvitation = Effect.fn("Users.revokeInvitation")(function* (
        invitationId: string
      ) {
        if (!(yield* store.deleteInvitation(invitationId)))
          return yield* new InvitationNotFound()
      })

      const setAccess = Effect.fn("Users.setAccess")(function* (input: {
        readonly actorId: string
        readonly userId: string
        readonly apps: ReadonlyArray<App>
      }) {
        if (
          input.actorId === input.userId &&
          !input.apps.includes("backOffice")
        )
          return yield* new OwnAccessProtected()
        const now = yield* Clock.currentTimeMillis
        yield* applied(
          yield* store.setAccess({
            userId: input.userId,
            apps: input.apps,
            now,
          })
        )
      })

      const remove = Effect.fn("Users.remove")(function* (input: {
        readonly actorId: string
        readonly userId: string
      }) {
        if (input.actorId === input.userId)
          return yield* new OwnAccessProtected()
        const now = yield* Clock.currentTimeMillis
        yield* applied(yield* store.remove({ userId: input.userId, now }))
      })

      return Users.of({
        list: () =>
          Clock.currentTimeMillis.pipe(
            Effect.flatMap((now) =>
              Effect.all({
                users: store.users(),
                invitations: store.pendingInvitations(now),
              })
            )
          ),
        invite,
        resendInvitation,
        revokeInvitation,
        setAccess,
        remove,
      })
    })
  )

  /** Production layer. Needs `Database`, `Email` and the EMAIL_FROM configuration. */
  static readonly layer = Users.layerNoDeps.pipe(
    Layer.provide(UserDirectoryStore.layer)
  )
}
