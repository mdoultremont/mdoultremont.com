import {
  getOAuthProviderApi,
  oauthProvider,
  type OAuthOptions,
  type Scope,
} from "@better-auth/oauth-provider"
import type { BetterAuthPlugin } from "better-auth"
import { APIError, createAuthEndpoint, isAPIError } from "better-auth/api"
import { and, eq, isNotNull, type SQL, sql } from "drizzle-orm"
import { Option, Schema } from "effect"
import { Base64Url } from "effect/encoding"
import {
  type Drizzle,
  oauthAccessTokens,
  oauthRedeemedCodes,
  oauthRefreshTokens,
  oauthRevokedGrants,
} from "#backend/modules/database"

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

export const makeOAuthProvider = (site: OAuthSite, db: Drizzle) =>
  oauthProvider({
    tokenLifecycle: toolsTokenLifecycle(db),
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

const CodeGrant = Schema.Struct({
  grant_type: Schema.Literal("authorization_code"),
  code: Schema.String,
  code_verifier: Schema.optional(Schema.String),
})

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

/** The pinned provider patch calls these after its own validation, once. */
const toolsTokenLifecycle = (
  db: Drizzle
): NonNullable<OAuthOptions<Scope[]>["tokenLifecycle"]> => ({
  authorizationCode: async ({
    ctx,
    client,
    authorizationCodeId,
    verificationValue,
  }) => {
    const now = Date.now()
    if (verificationValue !== undefined) {
      const claimed = await db
        .insert(oauthRedeemedCodes)
        .values({
          authorizationCodeId,
          clientId: client.clientId,
          codeChallenge: verificationValue.query.code_challenge ?? null,
          redeemedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: oauthRedeemedCodes.authorizationCodeId })
      if (claimed.length > 0) return
    }
    const redeemed = await db
      .select()
      .from(oauthRedeemedCodes)
      .where(eq(oauthRedeemedCodes.authorizationCodeId, authorizationCodeId))
      .get()
    const grant = Schema.decodeUnknownOption(CodeGrant)(ctx.body)
    // An absent code has no verifier left at the provider. The durable claim
    // retains its challenge so only its own client can revoke the grant.
    if (
      redeemed?.clientId === client.clientId &&
      Option.isSome(grant) &&
      (redeemed.codeChallenge === null ||
        (await provesPkce(redeemed.codeChallenge, grant.value.code_verifier)))
    )
      await db
        .insert(oauthRevokedGrants)
        .values({ authorizationCodeId, revokedAt: now })
        .onConflictDoNothing()
    throw invalidGrant("invalid code")
  },
  refreshToken: async ({ client, refreshToken }) => {
    const now = Date.now()
    const replayed =
      refreshToken.revoked != null &&
      !(
        refreshToken.rotationReplayExpiresAt != null &&
        refreshToken.rotationReplayExpiresAt.getTime() > now
      )
    if (replayed) {
      // The provider deletes this client's family next. Listing it first
      // also stops tokens stored by a concurrent refresh after that deletion.
      await revokeGrants(
        db,
        and(
          eq(oauthRefreshTokens.clientId, client.clientId),
          eq(oauthRefreshTokens.userId, refreshToken.userId)
        ),
        now
      )
      return
    }
    if (await isRevoked(db, refreshToken.authorizationCodeId ?? null))
      throw invalidGrant("invalid refresh token")
  },
  revoke: async ({ ctx, opts, client, token, tokenTypeHint: hint }) => {
    const api = getOAuthProviderApi(ctx, opts)
    const refresh =
      hint === "access_token"
        ? undefined
        : await db
            .select({
              clientId: oauthRefreshTokens.clientId,
              authorizationCodeId: oauthRefreshTokens.authorizationCodeId,
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
    // RFC 7009 answers unknown tokens with 200. Stop mismatched refresh
    // tokens here too: the provider invalidates their family before ownership.
    if (refresh === undefined && access === undefined) return true
    if (refresh === undefined) return false
    if (refresh.clientId !== client.clientId) return true
    if (refresh.authorizationCodeId !== null)
      await revokeGrants(
        db,
        eq(oauthRefreshTokens.authorizationCodeId, refresh.authorizationCodeId),
        Date.now()
      )
    return false
  },
})

/** Server-only introspection, with tools' durable grant revocations. */
export const toolsOAuth = (provider: OAuthProvider, db: Drizzle) => {
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
  } satisfies BetterAuthPlugin
}
