import { Effect } from "effect"
import { CallerAuth } from "@/server/actions/auth"
import type { OAuthSite } from "@/server/modules/better-auth"
import { authLayer, handleAuthRequest } from "../auth.server"
import { requestedScopes } from "./challenge"

const protectedResourcePrefix = "/.well-known/oauth-protected-resource"
const authorizationServerPath = "/.well-known/oauth-authorization-server"

/**
 * The provider's endpoints a client calls without the user's browser session:
 * dynamic registration, code and refresh exchange, revocation. They
 * authenticate the client, never a cookie.
 */
const publicEndpoints = new Set([
  "/api/auth/oauth2/register",
  "/api/auth/oauth2/token",
  "/api/auth/oauth2/revoke",
])

/**
 * RFC 9728 metadata. Every path under `/api` (`/api/mcp`, `/api/v1`, ...) is
 * part of the one `<origin>/api` resource, so each alias returns it.
 */
export const protectedResourceMetadata = (site: OAuthSite) => ({
  resource: site.resource,
  resource_name: "Tools",
  authorization_servers: [site.issuer],
  bearer_methods_supported: ["header"],
  scopes_supported: requestedScopes.split(" "),
})

const isProtectedResourcePath = (pathname: string) => {
  if (pathname === protectedResourcePrefix) return true
  const resourcePath = pathname.slice(protectedResourcePrefix.length)
  return (
    pathname.startsWith(protectedResourcePrefix) &&
    (resourcePath === "/api" || resourcePath.startsWith("/api/"))
  )
}

/**
 * Browser-based clients may read discovery and call the public endpoints from
 * any origin, but never with the user's cookies: `*` is not valid with
 * credentials, so a browser refuses to send or expose them.
 */
const anyOrigin = { "Access-Control-Allow-Origin": "*" }

const preflight = (methods: string) =>
  new Response(null, {
    status: 204,
    headers: {
      ...anyOrigin,
      "Access-Control-Allow-Methods": methods,
      "Access-Control-Allow-Headers":
        "Authorization, Content-Type, MCP-Protocol-Version",
      "Access-Control-Max-Age": "86400",
    },
  })

const shareable = (response: Response) => {
  const shared = new Response(response.body, response)
  shared.headers.set("Access-Control-Allow-Origin", "*")
  shared.headers.delete("Access-Control-Allow-Credentials")
  return shared
}

/** This site's OAuth configuration, from BETTER_AUTH_URL, for one request. */
const oauthSite = () =>
  CallerAuth.use((auth) => Effect.succeed(auth.oauth)).pipe(
    Effect.provide(authLayer())
  )

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"])

/**
 * The provider's endpoints that act for the signed-in user, such as consent,
 * do not check `Origin` themselves; any change under `/api/auth/oauth2/` that
 * carries the session cookie must come from this site's pages. Undefined when
 * the request may go on.
 */
const crossSiteRefusal = async (request: Request, pathname: string) => {
  if (
    !pathname.startsWith("/api/auth/oauth2/") ||
    safeMethods.has(request.method) ||
    !request.headers.has("Cookie")
  )
    return undefined
  const site = await Effect.runPromise(
    oauthSite().pipe(
      Effect.map(({ origin }) => origin),
      Effect.option
    )
  )
  return site._tag === "Some" && request.headers.get("Origin") === site.value
    ? undefined
    : Response.json(
        { error: "Request verification failed" },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      )
}

const methodNotAllowed = (allow: string) =>
  new Response(null, { status: 405, headers: { Allow: allow } })

const resourceMetadata = (request: Request) =>
  Effect.runPromise(
    oauthSite().pipe(
      Effect.map((site) =>
        Response.json(protectedResourceMetadata(site), {
          headers: { ...anyOrigin, "Cache-Control": "public, max-age=300" },
        })
      ),
      Effect.map((response) =>
        request.method === "HEAD" ? new Response(null, response) : response
      ),
      Effect.catchCause((cause) =>
        Effect.logError("Protected resource metadata failed", cause).pipe(
          Effect.as(new Response("OAuth is not configured", { status: 503 }))
        )
      )
    )
  )

/**
 * Serves OAuth discovery, and the provider's public endpoints for browsers,
 * or `undefined` for any other path:
 *
 * - `/.well-known/oauth-protected-resource[/api[/...]]`: the protected
 *   resource metadata of `<origin>/api`.
 * - `/.well-known/oauth-authorization-server/api/auth` (RFC 8414 for issuer
 *   `<origin>/api/auth`), and the same document at the bare well-known path
 *   for clients that predate path insertion.
 * - `/api/auth/oauth2/{register,token,revoke}`: Better Auth's answer, readable
 *   from any origin, plus CORS preflights.
 * - A 403 for a change under `/api/auth/oauth2/` that carries the session
 *   cookie from another origin.
 *
 * URLs in every document come from BETTER_AUTH_URL, never from the request.
 */
export const handleOAuthRequest = async (
  request: Request
): Promise<Response | undefined> => {
  const url = new URL(request.url)
  const pathname = url.pathname.replace(/\/+$/, "")
  const { method } = request
  if (isProtectedResourcePath(pathname)) {
    if (method === "OPTIONS") return preflight("GET, HEAD")
    if (method !== "GET" && method !== "HEAD")
      return methodNotAllowed("GET, HEAD")
    return resourceMetadata(request)
  }
  if (
    pathname === `${authorizationServerPath}/api/auth` ||
    pathname === authorizationServerPath
  ) {
    if (method === "OPTIONS") return preflight("GET, HEAD")
    const metadata = new URL(`${authorizationServerPath}/api/auth`, url)
    return shareable(
      await handleAuthRequest(
        new Request(metadata, { method, headers: request.headers })
      )
    )
  }
  const refused = await crossSiteRefusal(request, pathname)
  if (refused !== undefined) return refused
  if (publicEndpoints.has(pathname)) {
    if (method === "OPTIONS") return preflight("POST")
    return shareable(await handleAuthRequest(request))
  }
  return undefined
}
