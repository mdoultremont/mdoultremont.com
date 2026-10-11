import { Clock, Context, Effect, Layer, Option } from "effect"
import {
  AuthGate,
  type AuthUser,
  BetterAuth,
  type BetterAuthError,
  SignInRejected,
} from "@/backend/modules/better-auth"
import { sha256Hex } from "@/backend/modules/hashing"
import { type App, apps } from "./apps"
import type { AuthPersistenceError } from "./errors"
import { invitationToken } from "./invitation-cookie"
import { isOwnerAccount, ownerAccounts } from "./owner-accounts"
import { AuthStore } from "./store"

/** A signed-in user, the providers they can sign in with, and the apps they may use. */
export interface SignedInUser extends AuthUser {
  readonly providers: ReadonlyArray<string>
  readonly apps: ReadonlyArray<App>
}

/** The user and their current session. `sessionId` stays on the server. */
export interface UserSession extends SignedInUser {
  readonly sessionId: string
}

const unavailable = () =>
  new SignInRejected({
    code: "unavailable",
    description: "Sign-in is temporarily unavailable",
  })

/**
 * Admits users and people with an invitation:
 *
 * - A user who was not removed signs in again with an account they linked.
 * - Anyone holding a pending invitation (its link set the invitation cookie)
 *   may create a user, or sign in as an existing or removed one, and the
 *   invitation is accepted once the session starts.
 * - While nobody may use the back office, OWNER_ACCOUNTS may sign in and
 *   receive every app, so the site can always be recovered.
 *
 * New sign-in methods are linked from a signed-in session.
 */
export const AccessGate = Layer.effect(
  AuthGate,
  Effect.gen(function* () {
    const accounts = yield* ownerAccounts
    const store = yield* AuthStore

    const invitationFrom = Effect.fn("AccessGate.invitationFrom")(function* (
      headers: Headers
    ) {
      const token = invitationToken(headers)
      if (token === null) return Option.none()
      const now = yield* Clock.currentTimeMillis
      return yield* store.pendingInvitation(yield* sha256Hex(token), now)
    })

    const nobodyHasBackOffice = store
      .usersWithApp("backOffice")
      .pipe(Effect.map((users) => users.length === 0))

    return AuthGate.of({
      admit: Effect.fn("AccessGate.admit")(function* (attempt) {
        if (attempt.action === "link-account") return
        return yield* Effect.gen(function* () {
          if (Option.isSome(yield* invitationFrom(attempt.headers))) return
          if (isOwnerAccount(accounts, attempt) && (yield* nobodyHasBackOffice))
            return
          if (attempt.action === "sign-in") {
            const user = yield* store.userForAccount(attempt)
            if (Option.isSome(user) && !user.value.removed) return
            return yield* new SignInRejected({
              code: "not_allowed",
              description: "This account is not allowed to sign in",
            })
          }
          return yield* new SignInRejected({
            code: "invitation_required",
            description: "Only invited people can sign up",
          })
        }).pipe(
          Effect.catchTag("AuthPersistenceError", () =>
            Effect.fail(unavailable())
          )
        )
      }),

      sessionStarting: Effect.fn("AccessGate.sessionStarting")(
        function* (userId, headers) {
          return yield* Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis
            const invitation = yield* invitationFrom(headers)
            if (Option.isSome(invitation)) {
              yield* store.acceptInvitation({
                invitation: invitation.value,
                userId,
                now,
              })
              return
            }
            if (!(yield* nobodyHasBackOffice)) return
            const owners = yield* store.usersWithAccounts(accounts, userId)
            if (owners.length > 0) yield* store.grant(userId, apps, now)
          }).pipe(
            Effect.catchTag("AuthPersistenceError", () =>
              Effect.fail(unavailable())
            )
          )
        }
      ),
    })
  })
)

/** Sign-in for the private apps under /apps, on top of Better Auth. */
export class UserAuth extends Context.Service<
  UserAuth,
  {
    /** Better Auth's routes: sign-in redirects, callbacks, sign-out, linking. */
    readonly handler: (
      request: Request
    ) => Effect.Effect<Response, BetterAuthError>
    /** The user behind the request's session, unless they were removed. */
    readonly currentUser: (
      headers: Headers
    ) => Effect.Effect<
      Option.Option<UserSession>,
      BetterAuthError | AuthPersistenceError
    >
    /** Whether the token belongs to a pending invitation. */
    readonly hasPendingInvitation: (
      token: string
    ) => Effect.Effect<boolean, AuthPersistenceError>
    /**
     * Accepts a pending invitation for a user who is already signed in. `false`
     * when the token belongs to no pending invitation.
     */
    readonly acceptInvitation: (input: {
      readonly token: string
      readonly userId: string
    }) => Effect.Effect<boolean, AuthPersistenceError>
    /** Users who may use the app, for scheduled work that runs without a request. */
    readonly userIds: (
      app: App
    ) => Effect.Effect<ReadonlyArray<string>, AuthPersistenceError>
  }
>()("backend/features/UserAuth") {
  static readonly layerNoDeps = Layer.effect(
    UserAuth,
    Effect.gen(function* () {
      const betterAuth = yield* BetterAuth
      const store = yield* AuthStore

      const currentUser = Effect.fn("UserAuth.currentUser")(function* (
        headers: Headers
      ) {
        const session = yield* betterAuth.session(headers)
        if (Option.isNone(session)) return Option.none<UserSession>()
        const { sessionId, user } = session.value
        // Checked on every request: removing a user ends their access even
        // for sessions opened before.
        if (yield* store.isRemoved(user.id)) return Option.none<UserSession>()
        const [providers, userApps] = yield* Effect.all([
          store.providers(user.id),
          store.apps(user.id),
        ])
        return Option.some({ ...user, providers, apps: userApps, sessionId })
      })

      const pendingInvitation = Effect.fn("UserAuth.pendingInvitation")(
        function* (token: string) {
          const now = yield* Clock.currentTimeMillis
          return yield* store.pendingInvitation(yield* sha256Hex(token), now)
        }
      )

      const acceptInvitation = Effect.fn("UserAuth.acceptInvitation")(
        function* (input: { readonly token: string; readonly userId: string }) {
          const invitation = yield* pendingInvitation(input.token)
          if (Option.isNone(invitation)) return false
          const now = yield* Clock.currentTimeMillis
          yield* store.acceptInvitation({
            invitation: invitation.value,
            userId: input.userId,
            now,
          })
          return true
        }
      )

      return UserAuth.of({
        handler: betterAuth.handler,
        currentUser,
        hasPendingInvitation: (token) =>
          pendingInvitation(token).pipe(Effect.map(Option.isSome)),
        acceptInvitation,
        userIds: store.usersWithApp,
      })
    })
  )

  /** Production layer. Needs `Database` and the OWNER_ACCOUNTS, BETTER_AUTH_*, GITHUB_* and SPOTIFY_* configuration. */
  static readonly layer = UserAuth.layerNoDeps.pipe(
    Layer.provide(BetterAuth.layer),
    Layer.provide(AccessGate),
    Layer.provideMerge(AuthStore.layer)
  )
}
