import { env } from "cloudflare:workers"
import { Effect, Layer, Option } from "effect"
import { requireCurrentOwner } from "./app-auth.server"
import { createLikesBaselineHttp } from "./likes-baseline-http"
import { likesBaselineLayer } from "@/backend/modules/likes-baseline-runtime"
import { SpotifyConnections } from "@/backend/modules/spotify"
import { platformLayer } from "./platform"
import {
  BaselineStore,
  retryLikesBaseline,
  startLikesBaseline,
} from "@/backend/workflows/likes-baseline"

function services() {
  const layer = likesBaselineLayer(env)
  const connections = SpotifyConnections.layer.pipe(
    Layer.provide(platformLayer(env))
  )
  return createLikesBaselineHttp({
    owner: (request) => requireCurrentOwner(request).catch(() => null),
    connection: (ownerId) =>
      Effect.runPromise(
        SpotifyConnections.use((store) => store.get(ownerId)).pipe(
          Effect.map(Option.getOrNull),
          Effect.provide(connections)
        )
      ),
    latest: (ownerId, accountId) =>
      Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const store = yield* BaselineStore
            return yield* store.latest(ownerId, accountId)
          }),
          layer
        )
      ),
    start: (ownerId, accountId) =>
      Effect.runPromise(
        Effect.provide(startLikesBaseline(ownerId, accountId), layer)
      ),
    retry: (runId) =>
      Effect.runPromise(Effect.provide(retryLikesBaseline(runId), layer)),
  })
}

function safe(
  handler: (request: Request) => Promise<Response>,
  request: Request
) {
  return handler(request).catch(() =>
    Response.json(
      { error: "Initialization is temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    )
  )
}

export function likesBaselineStatus(request: Request) {
  return safe(services().status, request)
}
export function beginLikesBaseline(request: Request) {
  return safe(services().start, request)
}
export function retryBaseline(request: Request) {
  return safe(services().retry, request)
}
