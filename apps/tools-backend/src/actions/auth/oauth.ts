import { Context, Data, Effect, Layer, Option } from "effect"
import {
  BetterAuth,
  type BetterAuthError,
  type OAuthSite,
  toolsScope,
} from "#backend/modules/better-auth"
import type { ConsentRequest } from "@mdoultremont/tools-contracts/auth"
import type { App } from "./apps"
import { AccessGate, UserAuth } from "./auth"
import type { AuthPersistenceError } from "./errors"
import { AuthStore } from "./store"

/** How a caller proved who they are. */
export type CallerOrigin =
  | { readonly kind: "session" }
  | { readonly kind: "oauth"; readonly clientId: string }

/**
 * Who is calling a private API: a user and the apps they may use right now,
 * read from D1 on every request. An OAuth client acts with all of the user's
 * current access; nothing narrows it.
 */
export interface Caller {
  readonly userId: string
  readonly apps: ReadonlyArray<App>
  readonly origin: CallerOrigin
}

/** The token is unknown, expired, revoked, for another resource, or its user was removed. */
export class InvalidAccessToken extends Data.TaggedError(
  "InvalidAccessToken"
)<{}> {}

/** The token is valid but was not granted the `tools` scope. */
export class InsufficientScope extends Data.TaggedError("InsufficientScope")<{
  readonly scope: string
}> {}

export type { ConsentRequest } from "@mdoultremont/tools-contracts/auth"

/** The client and redirect of a signed authorization query, if it names both. */
export const consentTarget = (query: string) => {
  const params = new URLSearchParams(query)
  const clientId = params.get("client_id")
  const redirectUri = params.get("redirect_uri")
  if (clientId === null || redirectUri === null || !URL.canParse(redirectUri))
    return null
  const redirect = new URL(redirectUri)
  return {
    clientId,
    redirectOrigin:
      redirect.origin !== "null"
        ? redirect.origin
        : redirect.host === ""
          ? redirect.protocol
          : `${redirect.protocol}//${redirect.host}`,
  }
}

/**
 * Authenticates calls to private APIs, from a session cookie or an OAuth
 * access token, and serves the OAuth consent page. Every call reads the user,
 * their app access and, for tokens, the grant from D1 again.
 */
export class CallerAuth extends Context.Service<
  CallerAuth,
  {
    /** The OAuth issuer and protected resource of this site. */
    readonly oauth: OAuthSite
    /** The caller behind the request's session cookie, unless signed out or removed. */
    readonly session: (
      headers: Headers
    ) => Effect.Effect<
      Option.Option<Caller>,
      BetterAuthError | AuthPersistenceError
    >
    /**
     * The caller behind an access token issued for `resource`. Revoking the
     * token or its grant, disabling its client, removing the user, or changing
     * their app access applies to the next call.
     */
    readonly bearer: (
      token: string,
      resource: string
    ) => Effect.Effect<
      Caller,
      | InvalidAccessToken
      | InsufficientScope
      | BetterAuthError
      | AuthPersistenceError
    >
    /**
     * The authorization request a consent page shows, if this server signed
     * its query and the signed-in user was not removed.
     */
    readonly consentRequest: (
      headers: Headers,
      query: string
    ) => Effect.Effect<
      Option.Option<ConsentRequest>,
      BetterAuthError | AuthPersistenceError
    >
  }
>()("server/actions/CallerAuth") {
  static readonly layerNoDeps = Layer.effect(
    CallerAuth,
    Effect.gen(function* () {
      const betterAuth = yield* BetterAuth
      const userAuth = yield* UserAuth
      const store = yield* AuthStore

      const bearer = Effect.fn("CallerAuth.bearer")(function* (
        token: string,
        resource: string
      ) {
        const access = yield* betterAuth.accessToken(token)
        if (Option.isNone(access) || !access.value.audience.includes(resource))
          return yield* new InvalidAccessToken()
        const { userId, clientId, scopes } = access.value
        if (!scopes.includes(toolsScope))
          return yield* new InsufficientScope({ scope: toolsScope })
        if (yield* store.isRemoved(userId))
          return yield* new InvalidAccessToken()
        const userApps = yield* store.apps(userId)
        return {
          userId,
          apps: userApps,
          origin: { kind: "oauth", clientId },
        } satisfies Caller
      })

      const consentRequest = Effect.fn("CallerAuth.consentRequest")(function* (
        headers: Headers,
        search: string
      ) {
        const query = search.replace(/^\?/, "")
        const target = consentTarget(query)
        if (target === null || !(yield* betterAuth.isSignedOAuthQuery(query)))
          return Option.none<ConsentRequest>()
        const user = yield* userAuth.currentUser(headers)
        if (Option.isNone(user)) return Option.none<ConsentRequest>()
        const client = yield* betterAuth.oauthClient(target.clientId, headers)
        return Option.map(client, (found): ConsentRequest => ({
          client: found,
          redirectOrigin: target.redirectOrigin,
          user: { name: user.value.name, email: user.value.email },
          apps: user.value.apps,
        }))
      })

      return CallerAuth.of({
        oauth: betterAuth.oauth,
        session: (headers) =>
          userAuth.currentUser(headers).pipe(
            Effect.map(
              Option.map(({ id, apps }): Caller => ({
                userId: id,
                apps,
                origin: { kind: "session" },
              }))
            )
          ),
        bearer,
        consentRequest,
      })
    })
  )

  /**
   * Production layer, sharing one Better Auth with the `UserAuth` it also
   * provides. Needs what `UserAuth.layer` needs.
   */
  static readonly layer = CallerAuth.layerNoDeps.pipe(
    Layer.provideMerge(UserAuth.layerNoDeps),
    Layer.provide(BetterAuth.layer),
    Layer.provide(AccessGate),
    Layer.provideMerge(AuthStore.layer)
  )
}
