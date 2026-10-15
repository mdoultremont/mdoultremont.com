import { Context, Effect, Layer, Option } from "effect"
import {
  AuthGate,
  type AuthUser,
  BetterAuth,
  type BetterAuthError,
  SignInRejected,
} from "@/backend/modules/better-auth"
import type { AuthPersistenceError } from "./errors"
import { isOwnerAccount, ownerAccounts } from "./owner-accounts"
import { AuthStore } from "./store"

/** The signed-in owner, and the providers they can sign in with. */
export interface Owner extends AuthUser {
  readonly providers: ReadonlyArray<string>
}

/** The owner and their current session. `sessionId` stays on the server. */
export interface OwnerSession extends Owner {
  readonly sessionId: string
}

/**
 * Admits only the owner's accounts (OWNER_ACCOUNTS). The site has a single
 * user: once it exists, a new sign-in method must be linked from a signed-in
 * session, or match its email, rather than create a second user.
 */
export const OwnerGate = Layer.effect(
  AuthGate,
  Effect.gen(function* () {
    const accounts = yield* ownerAccounts
    const store = yield* AuthStore
    return AuthGate.of({
      admit: Effect.fn("OwnerGate.admit")(function* (attempt) {
        if (!isOwnerAccount(accounts, attempt))
          return yield* new SignInRejected({
            code: "not_allowed",
            description: "This account is not allowed to sign in",
          })
        if (attempt.action !== "create-user") return
        const users = yield* store.userCount().pipe(
          Effect.catch(() =>
            Effect.fail(
              new SignInRejected({
                code: "unavailable",
                description: "Sign-in is temporarily unavailable",
              })
            )
          )
        )
        if (users > 0)
          return yield* new SignInRejected({
            code: "link_required",
            description:
              "Sign in with the account you used before, then link this one",
          })
      }),
    })
  })
)

/** Owner sign-in for the private area, on top of Better Auth. */
export class OwnerAuth extends Context.Service<
  OwnerAuth,
  {
    /** Better Auth's routes: sign-in redirects, callbacks, sign-out, linking. */
    readonly handler: (
      request: Request
    ) => Effect.Effect<Response, BetterAuthError>
    /** The owner behind the request's session, if it is still one of OWNER_ACCOUNTS. */
    readonly currentOwner: (
      headers: Headers
    ) => Effect.Effect<
      Option.Option<OwnerSession>,
      BetterAuthError | AuthPersistenceError
    >
    /** Every owner user, for scheduled work that runs without a request. */
    readonly ownerIds: () => Effect.Effect<
      ReadonlyArray<string>,
      AuthPersistenceError
    >
  }
>()("backend/features/OwnerAuth") {
  static readonly layerNoDeps = Layer.effect(
    OwnerAuth,
    Effect.gen(function* () {
      const accounts = yield* ownerAccounts
      const betterAuth = yield* BetterAuth
      const store = yield* AuthStore

      const currentOwner = Effect.fn("OwnerAuth.currentOwner")(function* (
        headers: Headers
      ) {
        const session = yield* betterAuth.session(headers)
        if (Option.isNone(session)) return Option.none<OwnerSession>()
        const { sessionId, user } = session.value
        // Checked on every request: removing an account from OWNER_ACCOUNTS
        // ends access even for sessions opened before.
        const owners = yield* store.usersWithAccounts(accounts, user.id)
        if (owners.length === 0) return Option.none<OwnerSession>()
        const providers = yield* store.providers(user.id)
        return Option.some({ ...user, providers, sessionId })
      })

      return OwnerAuth.of({
        handler: betterAuth.handler,
        currentOwner,
        ownerIds: () => store.usersWithAccounts(accounts),
      })
    })
  )

  /** Production layer. Needs `Database` and the OWNER_ACCOUNTS, BETTER_AUTH_*, GITHUB_* and SPOTIFY_* configuration. */
  static readonly layer = OwnerAuth.layerNoDeps.pipe(
    Layer.provide(BetterAuth.layer),
    Layer.provide(OwnerGate),
    Layer.provideMerge(AuthStore.layer)
  )
}
