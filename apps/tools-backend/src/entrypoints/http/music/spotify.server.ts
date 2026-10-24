import { env } from "cloudflare:workers"
import { Clock, Effect, Layer } from "effect"
import {
  createSpotifyOAuthState,
  Spotify,
  verifySpotifyOAuthState,
} from "#backend/modules/spotify"
import { SourceStore } from "#backend/actions/music/collection"
import { MusicIngestion } from "#backend/actions/music/ingestion"
import { platformLayer } from "../../platform"
import { readCookie } from "../cookies"
import { requireApp, respond } from "../http"

const stateCookie = "spotify_oauth_state"

const spotifyLayer = () => Spotify.layer.pipe(Layer.provide(platformLayer(env)))

export const beginSpotifyConnection = (request: Request) =>
  respond(
    Effect.gen(function* () {
      const owner = yield* requireApp(request, "music")
      const state = yield* createSpotifyOAuthState(owner.sessionId)
      const spotify = yield* Spotify
      return new Response(null, {
        status: 302,
        headers: {
          Location: spotify.authorizationUrl(state),
          "Set-Cookie": cookie(stateCookie, state, 600, request),
          "Cache-Control": "no-store",
        },
      })
    }).pipe(
      Effect.provide(spotifyLayer()),
      Effect.catchTag("ConfigError", () =>
        Effect.succeed(
          new Response("Spotify is not configured", { status: 503 })
        )
      )
    )
  )

/**
 * OAuth callback. Always redirects back to /music with a result flag, so
 * every failure, including a missing owner session, becomes `failed` or `denied`.
 */
export const completeSpotifyConnection = (request: Request) => {
  const url = new URL(request.url)
  const clearCookie = cookie(stateCookie, "", 0, request)
  const redirect = (result: string) =>
    new Response(null, {
      status: 303,
      headers: [
        [
          "Location",
          new URL(`/music?spotify=${result}`, request.url).toString(),
        ],
        ["Set-Cookie", clearCookie],
        ["Cache-Control", "no-store"],
      ],
    })

  return respond(
    Effect.gen(function* () {
      const owner = yield* requireApp(request, "music")
      const state = url.searchParams.get("state")
      const code = url.searchParams.get("code")
      if (
        !state ||
        state !== readCookie(request, stateCookie) ||
        !code ||
        url.searchParams.has("error") ||
        !(yield* verifySpotifyOAuthState(state, owner.sessionId))
      )
        return redirect("failed")

      const spotify = yield* Spotify
      const connection = yield* spotify.connect(owner.id, code)
      if (connection.status !== "connected") return redirect("connected")
      // The connection is saved even if the first ingestion cannot be queued;
      // the music page offers to start it again.
      const ingestionQueued = yield* Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        yield* SourceStore.use((sources) => sources.seedLiked(owner.id, now))
        yield* MusicIngestion.use((ingestion) =>
          ingestion.start(owner.id, "full")
        )
      }).pipe(
        Effect.provide(
          Layer.mergeAll(MusicIngestion.layer, SourceStore.layer).pipe(
            Layer.provide(platformLayer(env))
          )
        ),
        Effect.as(true),
        Effect.orElseSucceed(() => false)
      )
      return redirect(ingestionQueued ? "connected" : "ingestion_failed")
    }).pipe(
      Effect.provide(spotifyLayer()),
      Effect.catchReason("SpotifyError", "AccessDenied", () =>
        Effect.succeed(redirect("denied"))
      ),
      Effect.catch(() => Effect.succeed(redirect("failed")))
    )
  )
}

function cookie(name: string, value: string, maxAge: number, request: Request) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/api/music/spotify",
    `Max-Age=${maxAge}`,
    "SameSite=Lax",
    "HttpOnly",
    ...(new URL(request.url).protocol === "https:" ? ["Secure"] : []),
  ].join("; ")
}
