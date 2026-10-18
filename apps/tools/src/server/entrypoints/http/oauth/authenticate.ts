import { Effect, Option } from "effect"
import { CallerAuth } from "@/server/actions/auth"
import type { Caller } from "@/server/entrypoints/actions"
import { authLayer } from "../auth.server"
import { challenge, type Refusal, refusal } from "./challenge"

/** RFC 6750 §2.1: `Bearer` and a b64token, nothing else. */
const bearerPattern = /^Bearer +([A-Za-z0-9\-._~+/]+=*) *$/i

const readOnlyMethods = new Set(["GET", "HEAD", "OPTIONS"])

/**
 * Which credentials a transport accepts.
 *
 * - `bearer-or-session`: the HTTP API and oRPC. A bearer token, or the
 *   session cookie on requests from this site's pages.
 * - `bearer`: MCP. Only a bearer token; a session cookie never counts, and a
 *   request that names an `Origin` must name this site's (MCP's defense
 *   against DNS rebinding). Native clients send no `Origin`.
 */
export type Credentials = "bearer-or-session" | "bearer"

const unavailable = () =>
  refusal("SERVICE_UNAVAILABLE", "Sign-in could not be checked", {
    "Retry-After": "5",
  })

/**
 * The caller of a private API request, or why it is refused.
 *
 * - With an `Authorization` header, only that header counts: it must be a
 *   valid bearer access token for `resource`, or the request is refused even
 *   if it also carries a session cookie. No Origin is required, because a
 *   bearer token is never sent by a browser on its own.
 * - Otherwise the session cookie counts, and requests that change something
 *   must come from this site's origin.
 *
 * "This site" is BETTER_AUTH_URL's origin, never the request's Host; it is
 * also the caller's `origin`. The user and their app access are read again on
 * every request.
 */
export const authenticateRequest = Effect.fn("authenticateRequest")(
  function* (
    request: Request,
    credentials: Credentials = "bearer-or-session",
    resource?: string
  ) {
    const auth = yield* CallerAuth
    const site = auth.oauth
    const requestOrigin = request.headers.get("Origin")
    const authorization = request.headers.get("Authorization")
    const caller = (userId: string, apps: Caller["apps"]): Caller => ({
      userId,
      apps,
      origin: site.origin,
    })

    if (
      credentials === "bearer" &&
      requestOrigin !== null &&
      requestOrigin !== site.origin
    )
      return refusal("FORBIDDEN", "Origin not allowed")

    if (authorization !== null) {
      const token = bearerPattern.exec(authorization)?.[1]
      if (token === undefined)
        return /^Bearer\b/i.test(authorization)
          ? challenge(site, {
              error: "invalid_request",
              description: "Malformed bearer token",
            })
          : challenge(site)
      return yield* auth.bearer(token, resource ?? site.resource).pipe(
        Effect.map(({ userId, apps }) => caller(userId, apps)),
        Effect.catchTags({
          InvalidAccessToken: () =>
            Effect.succeed(
              challenge(site, {
                error: "invalid_token",
                description: "The access token is invalid or expired",
              })
            ),
          InsufficientScope: ({ scope }) =>
            Effect.succeed(
              challenge(site, {
                error: "insufficient_scope",
                description: `The access token lacks the ${scope} scope`,
              })
            ),
        })
      )
    }
    if (credentials === "bearer") return challenge(site)

    const session = yield* auth.session(request.headers)
    if (Option.isNone(session)) return challenge(site)
    if (!readOnlyMethods.has(request.method) && requestOrigin !== site.origin)
      return refusal("FORBIDDEN", "Request verification failed")
    return caller(session.value.userId, session.value.apps)
  },
  Effect.catchTags({
    BetterAuthError: (error) =>
      Effect.logError("Authentication failed", error).pipe(
        Effect.as(unavailable())
      ),
    AuthPersistenceError: (error) =>
      Effect.logError("Authentication failed", error).pipe(
        Effect.as(unavailable())
      ),
  })
)

/** `authenticateRequest` for one Worker request, over this request's own auth layer. */
export const authenticate = (
  request: Request,
  credentials?: Credentials,
  resource?: string
): Promise<Caller | Refusal> =>
  Effect.runPromise(
    authenticateRequest(request, credentials, resource).pipe(
      Effect.provide(authLayer()),
      Effect.catchTag("ConfigError", () => Effect.succeed(unavailable()))
    )
  )
