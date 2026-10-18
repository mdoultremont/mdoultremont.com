import { getOAuthProviderApi, oauthProvider } from "@better-auth/oauth-provider"
import type { BetterAuthPlugin } from "better-auth"
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  isAPIError,
} from "better-auth/api"
import { and, eq, isNotNull, type SQL, sql } from "drizzle-orm"
import { Option, Schema } from "effect"
import { Base64Url } from "effect/encoding"
import {
  type Drizzle,
  oauthAccessTokens,
  oauthRedeemedCodes,
  oauthRefreshTokens,
  oauthRevokedGrants,
} from "@/server/modules/database"

/** The one scope a client asks for: act as the user in every app they may use. */
export const toolsScope = "tools"

/**
 * Where OAuth lives, derived from BETTER_AUTH_URL only, never from a request's
 * Host. One protected resource, `<origin>/api`, covers REST, MCP and RPC, so a
 * token obtained once works on all of them.
 */
export interface OAuthSite {
  readonly origin: string
  /** Authorization server issuer: Better Auth's base path. */
  readonly issuer: string
  /** RFC 8707 resource identifier, the audience of every access token. */
  readonly resource: string
  /** RFC 9728 metadata document for `resource`. */
  readonly resourceMetadataUrl: string
}

export const oauthSite = (baseURL: string): OAuthSite => {
  const origin = new URL(baseURL).origin
  return {
    origin,
    issuer: `${origin}/api/auth`,
    resource: `${origin}/api`,
    resourceMetadataUrl: `${origin}/.well-known/oauth-protected-resource/api`,
  }
}

export const makeOAuthProvider = (site: OAuthSite) =>
  oauthProvider({
    loginPage: "/oauth/sign-in",
    consentPage: "/oauth/consent",
    scopes: [toolsScope, "offline_access"],
    // Every token acts for a user; there is no machine access.
    grantTypes: ["authorization_code", "refresh_token"],
    // Opaque access tokens live in D1, so revoking one, or removing its
    // client, stops it on the next request.
    disableJwtPlugin: true,
    accessTokenExpiresIn: 15 * 60,
    // Same window as @better-auth/mcp: a client retrying a refresh gets the
    // same response instead of having its grant revoked as a replay.
    refreshTokenReuseInterval: 30,
    resources: [{ identifier: site.resource, name: "Tools" }],
    clientRegistrationDefaultResources: [site.resource],
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: true,
    // Older Claude Code and Codex releases register http://127.0.0.1
    // callbacks without saying they are native apps.
    clientRegistrationDefaultApplicationType: "infer",
    // Signed-in users may register clients, but not edit, rotate or list them.
    clientPrivileges: ({ action }) => action === "create",
  })

export type OAuthProvider = ReturnType<typeof makeOAuthProvider>

/** An active access token for the tools resource, as introspected by the provider. */
export interface OAuthAccess {
  readonly userId: string
  readonly clientId: string
  readonly scopes: ReadonlyArray<string>
  readonly audience: ReadonlyArray<string>
}

const AccessTokenRequest = Schema.Struct({ token: Schema.String })

const Introspection = Schema.Struct({
  active: Schema.Literal(true),
  sub: Schema.String,
  client_id: Schema.String,
  scope: Schema.String,
  token_type: Schema.Literal("Bearer"),
  aud: Schema.optional(
    Schema.Union([Schema.String, Schema.Array(Schema.String)])
  ),
})

const RefreshGrant = Schema.Struct({
  grant_type: Schema.Literal("refresh_token"),
  refresh_token: Schema.String,
})

const Revocation = Schema.Struct({
  token: Schema.String,
  token_type_hint: Schema.optional(Schema.String),
})

const CodeGrant = Schema.Struct({
  grant_type: Schema.Literal("authorization_code"),
  code: Schema.String,
  code_verifier: Schema.optional(Schema.String),
  client_id: Schema.optional(Schema.String),
})

/** The client a token request names, in its body or HTTP Basic credentials. Not proof. */
const namedClient = (
  clientId: string | undefined,
  headers: Headers | undefined
) => {
  if (clientId !== undefined) return clientId
  const authorization = headers?.get("authorization") ?? ""
  if (!authorization.startsWith("Basic ")) return undefined
  try {
    const [id = ""] = atob(authorization.slice(6)).split(":")
    return decodeURIComponent(id)
  } catch {
    return undefined
  }
}

/** The part of the provider's stored authorization code that names its client. */
const IssuedCode = Schema.fromJsonString(
  Schema.Struct({
    type: Schema.Literal("authorization_code"),
    query: Schema.Struct({
      client_id: Schema.String,
      code_challenge: Schema.optional(Schema.String),
    }),
  })
)

const invalidGrant = (description: string) =>
  new APIError("BAD_REQUEST", {
    error: "invalid_grant",
    error_description: description,
  })

/** RFC 7636 S256: whether `verifier` is the one behind `challenge`. */
const provesPkce = async (challenge: string, verifier: string | undefined) => {
  if (verifier === undefined) return false
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  )
  return Base64Url.encode(new Uint8Array(digest)) === challenge
}

const isRevoked = async (db: Drizzle, authorizationCodeId: string | null) =>
  authorizationCodeId === null ||
  (await db
    .select({ id: oauthRevokedGrants.authorizationCodeId })
    .from(oauthRevokedGrants)
    .where(eq(oauthRevokedGrants.authorizationCodeId, authorizationCodeId))
    .get()) !== undefined

/**
 * Records grants as revoked. Every access and refresh token of a grant carries
 * its authorization code, including a successor minted by a refresh that races
 * the revocation, so listing the code stops the whole grant for good. A new
 * authorization creates a new code; it never revives a listed one.
 */
const revokeGrants = (db: Drizzle, where: SQL | undefined, now: number) =>
  db
    .insert(oauthRevokedGrants)
    .select(
      db
        .selectDistinct({
          authorizationCodeId:
            sql<string>`${oauthRefreshTokens.authorizationCodeId}`.as(
              "authorization_code_id"
            ),
          revokedAt: sql<number>`${now}`.as("revoked_at"),
        })
        .from(oauthRefreshTokens)
        .where(and(where, isNotNull(oauthRefreshTokens.authorizationCodeId)))
    )
    .onConflictDoNothing()

/**
 * Tools' additions to the provider:
 *
 * - `toolsAccessToken`, a server-only endpoint that introspects an access token
 *   with the provider (expiry, revocation, client, session, audience) and
 *   refuses it when its grant was revoked.
 * - Grant revocation the provider cannot finish atomically on D1. Revoking a
 *   refresh token, replaying a rotated one, or redeeming an authorization code
 *   twice lists the grant (see `oauthRevokedGrants`), and a listed grant's
 *   tokens are refused even when they are stored after the listing.
 *
 * Nothing is listed for a request the provider would refuse first: the
 * requesting client must authenticate as the provider checks it, and must be
 * the client the code or token was issued to.
 */
export const toolsOAuth = (provider: OAuthProvider, db: Drizzle) => {
  /** The client the request authenticates as, checked as the provider does. */
  const authenticatedClient = async (
    ctx: Parameters<typeof getOAuthProviderApi>[0],
    grantType?: "authorization_code" | "refresh_token"
  ) => {
    try {
      const { clientId } = await getOAuthProviderApi(
        ctx,
        provider.options,
        grantType
      ).authenticateClient({ requireCredentials: false })
      return clientId
    } catch (error) {
      if (isAPIError(error)) return undefined
      throw error
    }
  }

  const listGrant = (authorizationCodeId: string, now: number) =>
    db
      .insert(oauthRevokedGrants)
      .values({ authorizationCodeId, revokedAt: now })
      .onConflictDoNothing()

  return {
    id: "tools-oauth",
    endpoints: {
      toolsAccessToken: createAuthEndpoint(
        "/tools/oauth/access-token",
        {
          method: "POST",
          body: Schema.toStandardSchemaV1(AccessTokenRequest),
          metadata: { SERVER_ONLY: true },
        },
        async (ctx): Promise<OAuthAccess | null> => {
          const api = getOAuthProviderApi(ctx, provider.options)
          let payload: unknown
          try {
            payload = await api.requireActiveAccessToken(ctx.body.token)
          } catch (error) {
            if (isAPIError(error)) return null
            throw error
          }
          const introspection =
            Schema.decodeUnknownOption(Introspection)(payload)
          if (Option.isNone(introspection)) return null
          const row = await db
            .select({
              authorizationCodeId: oauthAccessTokens.authorizationCodeId,
            })
            .from(oauthAccessTokens)
            .where(
              eq(
                oauthAccessTokens.token,
                await api.hashToken(ctx.body.token, "access_token")
              )
            )
            .get()
          if (
            row === undefined ||
            (await isRevoked(db, row.authorizationCodeId))
          )
            return null
          const { sub, client_id, scope, aud } = introspection.value
          return {
            userId: sub,
            clientId: client_id,
            scopes: scope.split(" ").filter(Boolean),
            audience:
              aud === undefined ? [] : typeof aud === "string" ? [aud] : aud,
          }
        }
      ),
    },
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/oauth2/token",
          handler: createAuthMiddleware(async (ctx) => {
            const grant = Schema.decodeUnknownOption(CodeGrant)(ctx.body)
            if (Option.isNone(grant)) return
            const api = getOAuthProviderApi(ctx, provider.options)
            const authorizationCodeId = await api.hashToken(
              grant.value.code,
              "authorization_code"
            )
            const now = Date.now()
            const stored =
              await ctx.context.internalAdapter.findVerificationValue(
                authorizationCodeId
              )
            const issued = Schema.decodeUnknownOption(IssuedCode)(stored?.value)
            // The first redemption by the code's client claims the code; any
            // later one is a replay, even while the first is still storing its
            // tokens. Claiming does not authenticate the client: a stolen code
            // can be spent, but listing the grant below needs proof.
            if (
              Option.isSome(issued) &&
              namedClient(grant.value.client_id, ctx.headers) ===
                issued.value.query.client_id
            ) {
              const claimed = await db
                .insert(oauthRedeemedCodes)
                .values({
                  authorizationCodeId,
                  clientId: issued.value.query.client_id,
                  codeChallenge: issued.value.query.code_challenge ?? null,
                  redeemedAt: now,
                })
                .onConflictDoNothing()
                .returning({ id: oauthRedeemedCodes.authorizationCodeId })
              if (claimed.length > 0) return
            }
            const redeemed = await db
              .select()
              .from(oauthRedeemedCodes)
              .where(
                eq(oauthRedeemedCodes.authorizationCodeId, authorizationCodeId)
              )
              .get()
            // Unknown or expired: the provider refuses it.
            if (redeemed === undefined) return
            // RFC 6749 §4.1.2: a code used twice revokes its grant, when the
            // party replaying it proves it is the client the code was for.
            if (
              (await authenticatedClient(ctx, "authorization_code")) ===
                redeemed.clientId &&
              (redeemed.codeChallenge === null ||
                (await provesPkce(
                  redeemed.codeChallenge,
                  grant.value.code_verifier
                )))
            )
              await listGrant(authorizationCodeId, now)
            throw invalidGrant("invalid code")
          }),
        },
        {
          matcher: (ctx) => ctx.path === "/oauth2/token",
          handler: createAuthMiddleware(async (ctx) => {
            const grant = Schema.decodeUnknownOption(RefreshGrant)(ctx.body)
            if (Option.isNone(grant)) return
            const api = getOAuthProviderApi(ctx, provider.options)
            const refresh = await db
              .select({
                clientId: oauthRefreshTokens.clientId,
                userId: oauthRefreshTokens.userId,
                authorizationCodeId: oauthRefreshTokens.authorizationCodeId,
                expiresAt: oauthRefreshTokens.expiresAt,
                revoked: oauthRefreshTokens.revoked,
                rotationReplayExpiresAt:
                  oauthRefreshTokens.rotationReplayExpiresAt,
              })
              .from(oauthRefreshTokens)
              .where(
                eq(
                  oauthRefreshTokens.token,
                  await api.hashToken(
                    grant.value.refresh_token,
                    "refresh_token"
                  )
                )
              )
              .get()
            if (refresh === undefined) return
            const now = Date.now()
            const replayed =
              refresh.revoked !== null &&
              !(
                refresh.rotationReplayExpiresAt !== null &&
                refresh.rotationReplayExpiresAt.getTime() > now
              )
            // The provider answers a replay itself and deletes the family it
            // finds: every grant of this client for this user. Listing those
            // grants first also stops a successor that a concurrent refresh
            // stores after that deletion. The provider only gets there for the
            // token's own, authenticated client and an unexpired token.
            if (replayed) {
              if (
                refresh.expiresAt.getTime() < now ||
                (await authenticatedClient(ctx, "refresh_token")) !==
                  refresh.clientId
              )
                return
              return void (await revokeGrants(
                db,
                and(
                  eq(oauthRefreshTokens.clientId, refresh.clientId),
                  eq(oauthRefreshTokens.userId, refresh.userId)
                ),
                now
              ))
            }
            if (await isRevoked(db, refresh.authorizationCodeId))
              throw invalidGrant("invalid refresh token")
          }),
        },
        {
          matcher: (ctx) => ctx.path === "/oauth2/revoke",
          handler: createAuthMiddleware(async (ctx) => {
            const request = Schema.decodeUnknownOption(Revocation)(ctx.body)
            if (Option.isNone(request)) return
            const { token, token_type_hint: hint } = request.value
            // The provider refuses an unauthenticated client itself.
            const clientId = await authenticatedClient(ctx)
            if (clientId === undefined) return
            const api = getOAuthProviderApi(ctx, provider.options)
            const refresh =
              hint === "access_token"
                ? undefined
                : await db
                    .select({
                      clientId: oauthRefreshTokens.clientId,
                      authorizationCodeId:
                        oauthRefreshTokens.authorizationCodeId,
                    })
                    .from(oauthRefreshTokens)
                    .where(
                      eq(
                        oauthRefreshTokens.token,
                        await api.hashToken(token, "refresh_token")
                      )
                    )
                    .get()
            const access =
              refresh !== undefined || hint === "refresh_token"
                ? undefined
                : await db
                    .select({ id: oauthAccessTokens.id })
                    .from(oauthAccessTokens)
                    .where(
                      eq(
                        oauthAccessTokens.token,
                        await api.hashToken(token, "access_token")
                      )
                    )
                    .get()
            // RFC 7009 §2.2: an unknown token, such as one already revoked
            // with its grant, is answered with a 200; the provider says 400.
            if (refresh === undefined && access === undefined)
              return ctx.json(null)
            if (
              refresh?.authorizationCodeId == null ||
              refresh.clientId !== clientId
            )
              return
            // RFC 7009 §2.1: revoking a refresh token ends its whole grant.
            await revokeGrants(
              db,
              eq(
                oauthRefreshTokens.authorizationCodeId,
                refresh.authorizationCodeId
              ),
              Date.now()
            )
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin
}
