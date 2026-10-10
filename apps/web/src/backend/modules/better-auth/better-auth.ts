import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import {
  Config,
  Context,
  Data,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
} from "effect"
import {
  authAccounts,
  authSessions,
  authUsers,
  authVerifications,
  Database,
} from "@/backend/primitives/database"

/** The sign-in providers this site offers. */
export const signInProviders = ["github", "spotify"] as const
export type SignInProvider = (typeof signInProviders)[number]

/** An outside identity Better Auth is about to admit, and what for. */
export interface SignInAttempt {
  readonly provider: string
  /** The provider's own account ID (GitHub numeric ID, Spotify user ID). */
  readonly accountId: string
  readonly action: "create-user" | "link-account" | "sign-in"
}

export class SignInRejected extends Data.TaggedError("SignInRejected")<{
  /** Short machine-readable code, sent back to the browser as `?error=`. */
  readonly code: string
  readonly description: string
}> {}

/**
 * Decides who may sign in. Better Auth asks it before creating a user,
 * linking an account, or signing in again. This module only defines it;
 * the feature that owns the rule provides it.
 */
export class AuthGate extends Context.Service<
  AuthGate,
  {
    readonly admit: (
      attempt: SignInAttempt
    ) => Effect.Effect<void, SignInRejected>
  }
>()("backend/modules/better-auth/AuthGate") {}

export interface AuthUser {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly image: string | null
}

/** A valid session and its user. */
export interface AuthSession {
  /** Random, server-side only: never sent to the browser. */
  readonly sessionId: string
  readonly user: AuthUser
}

export class BetterAuthError extends Data.TaggedError("BetterAuthError")<{
  readonly cause: unknown
}> {
  override get message() {
    return "Sign-in could not be checked"
  }
}

const secretConfig = (name: string) =>
  Config.schema(Schema.Redacted(Schema.NonEmptyString), name)

const makeAuth = Effect.fn("BetterAuth.make")(function* () {
  const database = yield* Database
  const gate = yield* AuthGate
  const secret = yield* secretConfig("BETTER_AUTH_SECRET")
  const baseURL = yield* Config.NonEmptyString("BETTER_AUTH_URL")
  const github = {
    clientId: yield* Config.NonEmptyString("GITHUB_CLIENT_ID"),
    clientSecret: Redacted.value(yield* secretConfig("GITHUB_CLIENT_SECRET")),
  }
  const spotify = {
    clientId: yield* Config.NonEmptyString("SPOTIFY_CLIENT_ID"),
    clientSecret: Redacted.value(yield* secretConfig("SPOTIFY_CLIENT_SECRET")),
  }

  return betterAuth({
    baseURL,
    secret: Redacted.value(secret),
    database: drizzleAdapter(database.drizzle, {
      provider: "sqlite",
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
      },
    }),
    socialProviders: { github, spotify },
    account: {
      // Sign-in providers' tokens are never used, but are kept encrypted anyway.
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        // Spotify never marks emails as verified. Trusting both providers is
        // safe only because the gate already decides who is admitted.
        trustedProviders: [...signInProviders],
        allowDifferentEmails: true,
      },
    },
    verification: { storeIdentifier: "hashed" },
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    user: {
      validateUserInfo: ({ source }) => {
        const profileId = source.oauth?.profile?.id
        const attempt: SignInAttempt = {
          provider: source.oauth?.providerId ?? source.method,
          accountId:
            typeof profileId === "string" || typeof profileId === "number"
              ? String(profileId)
              : "",
          action: source.action,
        }
        return Effect.runPromise(
          gate.admit(attempt).pipe(
            Effect.match({
              onSuccess: () => undefined,
              onFailure: (rejected) => ({
                error: rejected.code,
                errorDescription: rejected.description,
              }),
            })
          )
        )
      },
    },
  })
})

/**
 * Better Auth, configured for this site: GitHub and Spotify sign-in, sessions
 * in D1. Holds no rule about who may sign in; that comes from `AuthGate`.
 */
export class BetterAuth extends Context.Service<
  BetterAuth,
  {
    /** Serves Better Auth's own routes under /api/auth. */
    readonly handler: (
      request: Request
    ) => Effect.Effect<Response, BetterAuthError>
    /** The session behind the request's cookie, if it is valid. */
    readonly session: (
      headers: Headers
    ) => Effect.Effect<Option.Option<AuthSession>, BetterAuthError>
  }
>()("backend/modules/BetterAuth") {
  /** Needs `Database`, an `AuthGate`, and the BETTER_AUTH_*, GITHUB_* and SPOTIFY_* configuration. */
  static readonly layer = Layer.effect(
    BetterAuth,
    Effect.gen(function* () {
      const auth = yield* makeAuth()
      return BetterAuth.of({
        handler: (request) =>
          Effect.tryPromise({
            try: () => auth.handler(request),
            catch: (cause) => new BetterAuthError({ cause }),
          }),
        session: (headers) =>
          Effect.tryPromise({
            try: () => auth.api.getSession({ headers }),
            catch: (cause) => new BetterAuthError({ cause }),
          }).pipe(
            Effect.map((session) =>
              Option.fromNullishOr(session).pipe(
                Option.map(({ session: { id }, user }) => ({
                  sessionId: id,
                  user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    image: user.image ?? null,
                  },
                }))
              )
            )
          ),
      })
    })
  )
}
