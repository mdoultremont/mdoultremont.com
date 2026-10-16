import { env } from "cloudflare:workers"
import { ORPCError, type AnyRouter } from "@orpc/server"
import { RPCHandler } from "@orpc/server/fetch"
import { Effect, Option } from "effect"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { createMiddleware } from "hono/factory"
import type { App } from "@/server/actions/auth"
import { userFromRequest } from "../auth.server"
import {
  downloadFlightFile,
  flightsRouter,
  type FlightsContext,
} from "../flights"
import { platformLayer } from "../../platform"

/** Cap on any RPC request body, including JSON escaping and metadata. */
const maxRpcBodyBytes = 6_000_000

type Variables = { flights: FlightsContext }
type AppApi = Hono<{ Variables: Variables }>

/** How a failure leaves the API: oRPC clients and plain routes read different bodies. */
type Failure = (
  code: "UNAUTHORIZED" | "FORBIDDEN" | "PAYLOAD_TOO_LARGE",
  message: string
) => Response

const failure =
  (wire: "rpc" | "json"): Failure =>
  (code, message) => {
    const error = new ORPCError(code, { message })
    return Response.json(
      wire === "rpc" ? { json: error.toJSON() } : { error: message },
      { status: error.status, headers: { "Cache-Control": "no-store" } }
    )
  }

/** Signed-in user with access to `app`, else 401 or 403. Checked on every request. */
const requireApp = (app: App, fail: Failure) =>
  createMiddleware<{ Variables: Variables }>(async (c, next) => {
    const user = await Effect.runPromise(userFromRequest(c.req.raw))
    if (Option.isNone(user)) return fail("UNAUTHORIZED", "Sign-in required")
    if (!user.value.apps.includes(app))
      return fail("FORBIDDEN", "You do not have access to this app")
    c.set("flights", {
      userId: user.value.id,
      platform: platformLayer(env),
    })
    await next()
  })

/**
 * Changes must come from this site's own pages. Browsers always send `Origin`
 * on a POST, PUT or DELETE, and the session cookie is `SameSite=Lax`, so a
 * request from another site is refused twice over.
 */
const requireSameOrigin = (fail: Failure) =>
  createMiddleware(async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      if (c.req.header("Origin") !== new URL(c.req.url).origin)
        return fail("FORBIDDEN", "Request verification failed")
    }
    await next()
  })

/**
 * Mounts one app's oRPC router at `/api/rpc/<name>/*`. Only that prefix
 * requires access to the app; every call is origin-checked and body-capped.
 * Adding an app to the API is one `mountAppRpc` line in `createApi`.
 */
function mountAppRpc(app: AppApi, name: App, router: AnyRouter) {
  const prefix = `/api/rpc/${name}` as const
  const handler = new RPCHandler(router)
  const fail = failure("rpc")
  app.use(
    `${prefix}/*`,
    bodyLimit({
      maxSize: maxRpcBodyBytes,
      onError: () =>
        fail(
          "PAYLOAD_TOO_LARGE",
          "Request exceeds 6 MB; use a file of at most 5 MB with minimal JSON escaping"
        ),
    }),
    requireApp(name, fail),
    requireSameOrigin(fail)
  )
  app.all(`${prefix}/*`, async (c, next) => {
    const { matched, response } = await handler.handle(c.req.raw, {
      prefix,
      context: c.var.flights,
    })
    if (!matched) return next()
    return response
  })
}

/**
 * The HTTP shell for everything under /api/. Routes it does not own fall
 * through to `fallback` (the TanStack server routes: auth, music, back office,
 * invitations).
 *
 * - /api/rpc/<app>/*: that app's oRPC procedures (see `mountAppRpc`).
 * - /api/apps/flights/files/:fileId: the original file download (binary).
 */
export function createApi(
  fallback: (request: Request) => Response | Promise<Response>
) {
  const app: AppApi = new Hono<{ Variables: Variables }>()
  mountAppRpc(app, "flights", flightsRouter)

  app.use("/api/apps/flights/*", requireApp("flights", failure("json")))
  app.get("/api/apps/flights/files/:fileId", (c) =>
    downloadFlightFile(c.var.flights, c.req.param("fileId"))
  )

  app.notFound((c) => fallback(c.req.raw))
  app.onError((error) => {
    console.error("Unhandled API failure", error)
    return Response.json(
      { error: "Request failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    )
  })
  return app
}
