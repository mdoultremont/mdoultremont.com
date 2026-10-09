import { Clock, Config, Context, Effect, Layer, Option } from "effect"
import {
  GitHub,
  type GitHubError,
  type GitHubIdentity,
} from "@/backend/modules/github"
import { randomToken, sha256Hex } from "@/backend/primitives/hashing"
import { type AuthPersistenceError, OwnerAccessDenied } from "./errors"
import { AuthStore } from "./store"

export const sessionLifetimeSeconds = 60 * 60 * 24 * 30

export interface OwnerSession {
  readonly identity: GitHubIdentity
  /** Sent to the browser in an HttpOnly cookie; only its hash is stored. */
  readonly sessionToken: string
  /** Sent in a readable cookie and echoed in a header to prove same-origin mutations. */
  readonly csrfToken: string
}

/**
 * Owner sign-in: only the GitHub account configured as GITHUB_OWNER_ID can
 * open a session for the private area.
 */
export class OwnerAuth extends Context.Service<
  OwnerAuth,
  {
    readonly authorizationUrl: (state: string) => string
    readonly signIn: (
      code: string
    ) => Effect.Effect<
      OwnerSession,
      OwnerAccessDenied | AuthPersistenceError | GitHubError
    >
    /** The owner behind a session token, if the session is valid and still the owner's. */
    readonly currentOwner: (
      sessionToken: string
    ) => Effect.Effect<Option.Option<GitHubIdentity>, AuthPersistenceError>
    readonly signOut: (
      sessionToken: string
    ) => Effect.Effect<void, AuthPersistenceError>
  }
>()("backend/features/OwnerAuth") {
  static readonly layerNoDeps = Layer.effect(
    OwnerAuth,
    Effect.gen(function* () {
      const ownerId = yield* Config.NonEmptyString("GITHUB_OWNER_ID")
      const github = yield* GitHub
      const store = yield* AuthStore
      const nowSeconds = Effect.map(Clock.currentTimeMillis, (millis) =>
        Math.floor(millis / 1000)
      )

      const signIn = Effect.fn("OwnerAuth.signIn")(function* (code: string) {
        const identity = yield* github.identify(code)
        if (identity.id !== ownerId) return yield* new OwnerAccessDenied()
        const sessionToken = yield* randomToken
        const now = yield* nowSeconds
        yield* store.saveSession({
          identity,
          sessionHash: yield* sha256Hex(sessionToken),
          expiresAt: now + sessionLifetimeSeconds,
          now,
        })
        return { identity, sessionToken, csrfToken: yield* randomToken }
      })

      const currentOwner = Effect.fn("OwnerAuth.currentOwner")(function* (
        sessionToken: string
      ) {
        const identity = yield* store.findSession({
          sessionHash: yield* sha256Hex(sessionToken),
          now: yield* nowSeconds,
        })
        // A session outlives a change of configured owner; it must not grant access.
        return Option.filter(identity, (owner) => owner.id === ownerId)
      })

      const signOut = Effect.fn("OwnerAuth.signOut")(function* (
        sessionToken: string
      ) {
        yield* store.revokeSession(yield* sha256Hex(sessionToken))
      })

      return OwnerAuth.of({
        authorizationUrl: github.authorizationUrl,
        signIn,
        currentOwner,
        signOut,
      })
    })
  )

  /** Production layer. Needs `Database` and the GITHUB_* configuration. */
  static readonly layer = OwnerAuth.layerNoDeps.pipe(
    Layer.provide(Layer.mergeAll(GitHub.layer, AuthStore.layer))
  )
}
