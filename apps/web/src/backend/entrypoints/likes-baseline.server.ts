import { env } from "cloudflare:workers"
import { Effect } from "effect"
import { requireCurrentOwner } from "./app-auth.server"
import { createLikesBaselineHttp } from "./likes-baseline-http"
import { likesBaselineLayer } from "../modules/likes-baseline-runtime"
import { createSpotifyConnectionStore } from "../modules/spotify-store"
import {
  BaselineStore,
  retryLikesBaseline,
  startLikesBaseline,
} from "../workflows/likes-baseline"

function services() {
  const layer = likesBaselineLayer(env)
  const spotify = createSpotifyConnectionStore(env.DB)
  return createLikesBaselineHttp({
    owner: (request) => requireCurrentOwner(request).catch(() => null),
    connection: (ownerId) => spotify.get(ownerId),
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
