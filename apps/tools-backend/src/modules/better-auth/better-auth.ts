import { verifyOAuthQueryParams } from "@better-auth/oauth-provider"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { isAPIError } from "better-auth/api"
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
  oauthAccessTokens,
  oauthClientAssertions,
  oauthClientResources,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
  oauthResources,
} from "#backend/modules/database"
import {
  makeOAuthProvider,
  type OAuthAccess,
  type OAuthSite,
  oauthSite,
  toolsOAuth,
} from "./oauth"

/** The sign-in providers this site offers. */
export const signInProviders = ["github", "spotify"] as const
export type SignInProvider = (typeof signInProviders)[number]

/** An outside identity Better Auth is about to admit, and what for. */
export interface SignInAttempt {
  readonly provider: string
  /** The provider's own account ID (GitHub numeric ID, Spotify user ID). */
  readonly accountId: string
  readonly action: "create-user" | "link-account" | "sign-in"
  /** The request's headers, including its cookies. */
  readonly headers: Headers
}

export class SignInRejected extends Data.TaggedError("SignInRejected")<{
  /** Short machine-readable code, sent back to the browser as `?error=`. */
  readonly code: string
  readonly description: string
}> {}

/**
 * Decides who may sign in. Better Auth asks it before creating a user,
 * linking an account, or signing in again, and tells it when a session
 * starts. This module only defines it; the action that owns the rule
 * provides it.
 */
export class AuthGate extends Context.Service<
  AuthGate,
  {
    readonly admit: (
      attempt: SignInAttempt
    ) => Effect.Effect<void, SignInRejected>
    /** Runs before a sign-in's session is created; a rejection cancels the session. */
    readonly sessionStarting: (
      userId: string,
      headers: Headers
    ) => Effect.Effect<void, SignInRejected>
  }
>()("server/modules/better-auth/AuthGate") {}

export interface AuthUser {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly image: string | null
}

/** What a consent page shows about the client asking for access. */
export interface OAuthClientSummary {
  readonly clientId: string
  /** Chosen by whoever registered the client; never proof of who it is. */
  readonly name: string | null
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

  const site = oauthSite(baseURL)
  const provider = makeOAuthProvider(site, database.drizzle)

  const auth = betterAuth({
    baseURL,
    secret: Redacted.value(secret),
    database: drizzleAdapter(database.drizzle, {
      provider: "sqlite",
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
        oauthClient: oauthClients,
        oauthResource: oauthResources,
        oauthClientResource: oauthClientResources,
        oauthRefreshToken: oauthRefreshTokens,
        oauthAccessToken: oauthAccessTokens,
        oauthConsent: oauthConsents,
        oauthClientAssertion: oauthClientAssertions,
      },
    }),
    plugins: [provider, toolsOAuth(provider, database.drizzle)],
    socialProviders: { github, spotify },
    account: {
      // Sign-in providers' tokens are never used, but are kept encrypted anyway.
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        // Accounts are linked only from a signed-in session, never because a
        // provider reports the same email: Spotify does not verify emails, so
        // matching on them would let anyone take over a user.
        disableImplicitLinking: true,
        trustedProviders: [...signInProviders],
        allowDifferentEmails: true,
      },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session, context) =>
            Effect.runPromise(
              gate
                .sessionStarting(
                  session.userId,
                  context?.headers ?? new Headers()
                )
                .pipe(
                  Effect.as(undefined),
                  Effect.orElseSucceed(() => false as const)
                )
            ),
        },
      },
    },
    verification: { storeIdentifier: "hashed" },
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    user: {
      validateUserInfo: ({ source }, context) => {
        const profileId = source.oauth?.profile?.id
        const attempt: SignInAttempt = {
          provider: source.oauth?.providerId ?? source.method,
          accountId:
            typeof profileId === "string" || typeof profileId === "number"
              ? String(profileId)
              : "",
          action: source.action,
          headers: context.headers ?? new Headers(),
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
  return { auth, site, secret: Redacted.value(secret) }
})

/**
 * Better Auth, configured for this site: GitHub and Spotify sign-in, sessions
 * in D1, and the OAuth provider that lets clients act for a user. Holds no
 * rule about who may sign in; that comes from `AuthGate`.
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
    /** The OAuth issuer and protected resource, from BETTER_AUTH_URL. */
    readonly oauth: OAuthSite
    /**
     * The access token's user and client, if the provider finds it active for
     * an unrevoked grant. Audience and scope are the caller's to check.
     */
    readonly accessToken: (
      token: string
    ) => Effect.Effect<Option.Option<OAuthAccess>, BetterAuthError>
    /** Whether an authorization request's query was signed by this server. */
    readonly isSignedOAuthQuery: (
      query: string
    ) => Effect.Effect<boolean, BetterAuthError>
    /** The registered client, as shown to the signed-in user being asked for consent. */
    readonly oauthClient: (
      clientId: string,
      headers: Headers
    ) => Effect.Effect<Option.Option<OAuthClientSummary>, BetterAuthError>
  }
>()("server/modules/BetterAuth") {
  /** Needs `Database`, an `AuthGate`, and the BETTER_AUTH_*, GITHUB_* and SPOTIFY_* configuration. */
  static readonly layer = Layer.effect(
    BetterAuth,
    Effect.gen(function* () {
      const { auth, site, secret } = yield* makeAuth()
      const attempt = <A>(run: () => Promise<A>) =>
        Effect.tryPromise({
          try: run,
          catch: (cause) => new BetterAuthError({ cause }),
        })
      return BetterAuth.of({
        handler: (request) => attempt(() => auth.handler(request)),
        oauth: site,
        accessToken: (token) =>
          attempt(() => auth.api.toolsAccessToken({ body: { token } })).pipe(
            Effect.map(Option.fromNullishOr)
          ),
        isSignedOAuthQuery: (query) =>
          attempt(() => verifyOAuthQueryParams(query, secret)),
        oauthClient: (clientId, headers) =>
          attempt(() =>
            auth.api.getOAuthClientPublic({
              query: { client_id: clientId },
              headers,
            })
          ).pipe(
            Effect.map((client) =>
              Option.some({
                clientId: client.client_id,
                name: client.client_name ?? null,
              })
            ),
            Effect.catchIf(
              (error) => isAPIError(error.cause),
              () => Effect.succeed(Option.none())
            )
          ),
        session: (headers) =>
          attempt(() => auth.api.getSession({ headers })).pipe(
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
