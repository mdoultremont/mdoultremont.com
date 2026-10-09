import { env } from "cloudflare:workers"
import { Effect, Layer } from "effect"
import {
  createSpotifyOAuthState,
  Spotify,
  type SpotifyError,
  verifySpotifyOAuthState,
} from "@/backend/modules/spotify"
import { MusicIngestion } from "@/backend/features/music/ingestion"
import { platformLayer } from "../platform"
import {
  json,
  OwnerRequired,
  readCookie,
  type RequestError,
  requireMutation,
  requireOwner,
  respond,
  spotifyErrorResponse,
} from "./http"

const stateCookie = "spotify_oauth_state"
const sessionCookie = "music_session"

const spotifyLayer = () => Spotify.layer.pipe(Layer.provide(platformLayer(env)))

/** Owner-only route using the Spotify module. Spotify errors become JSON responses. */
const route = (
  request: Request,
  options: { readonly mutation: boolean },
  handler: (
    ownerId: string
  ) => Effect.Effect<Response, RequestError | SpotifyError, Spotify>
) =>
  respond(
    Effect.gen(function* () {
      const owner = yield* requireOwner(request)
      if (options.mutation) yield* requireMutation(request)
      return yield* handler(owner.id).pipe(
        Effect.catchTag("SpotifyError", (error) =>
          Effect.succeed(spotifyErrorResponse(error))
        ),
        Effect.provide(spotifyLayer())
      )
    })
  )

export const beginSpotifyConnection = (request: Request) =>
  respond(
    Effect.gen(function* () {
      yield* requireOwner(request)
      const sessionToken = readCookie(request, sessionCookie)
      if (!sessionToken) return yield* new OwnerRequired()
      const state = yield* createSpotifyOAuthState(sessionToken)
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
      const owner = yield* requireOwner(request)
      const sessionToken = readCookie(request, sessionCookie)
      const state = url.searchParams.get("state")
      const code = url.searchParams.get("code")
      if (
        !sessionToken ||
        !state ||
        state !== readCookie(request, stateCookie) ||
        !code ||
        url.searchParams.has("error") ||
        !(yield* verifySpotifyOAuthState(state, sessionToken))
      )
        return redirect("failed")

      const spotify = yield* Spotify
      const connection = yield* spotify.connect(owner.id, code)
      if (connection.status !== "connected") return redirect("connected")
      // The connection is saved even if the first ingestion cannot be queued;
      // the music page offers to start it again.
      const ingestionQueued = yield* MusicIngestion.use((ingestion) =>
        ingestion.start(owner.id, "full")
      ).pipe(
        Effect.provide(
          MusicIngestion.layer.pipe(Layer.provide(platformLayer(env)))
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

export const spotifyStatus = (request: Request) =>
  route(request, { mutation: false }, (ownerId) =>
    Spotify.use((spotify) => spotify.status(ownerId)).pipe(Effect.map(json))
  )

export const spotifyPlaylists = (request: Request) =>
  route(request, { mutation: false }, (ownerId) =>
    Spotify.use((spotify) => spotify.playlists(ownerId)).pipe(
      Effect.map((items) => json({ items }))
    )
  )

export const spotifySavedTracks = (request: Request) =>
  route(request, { mutation: false }, (ownerId) => {
    const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined
    if (cursor !== undefined && !isSavedTracksCursor(cursor))
      return Effect.succeed(json({ error: "Invalid cursor" }, 400))
    return Spotify.use((spotify) =>
      spotify.savedTracksPage(ownerId, cursor)
    ).pipe(Effect.map(json))
  })

export const disconnectSpotify = (request: Request) =>
  route(request, { mutation: true }, (ownerId) =>
    Spotify.use((spotify) => spotify.disconnect(ownerId)).pipe(
      Effect.as(json({ status: "disconnected" }))
    )
  )

/** Only Spotify's own next-page links for Liked Songs are accepted from the browser. */
function isSavedTracksCursor(value: string) {
  try {
    const url = new URL(value, "https://api.spotify.com")
    return (
      url.origin === "https://api.spotify.com" &&
      url.pathname === "/v1/me/tracks" &&
      url.searchParams.has("offset") &&
      url.searchParams.size <= 2 &&
      [...url.searchParams.keys()].every(
        (key) => key === "offset" || key === "limit"
      )
    )
  } catch {
    return false
  }
}

function cookie(name: string, value: string, maxAge: number, request: Request) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/api/spotify",
    `Max-Age=${maxAge}`,
    "SameSite=Lax",
    "HttpOnly",
    ...(new URL(request.url).protocol === "https:" ? ["Secure"] : []),
  ].join("; ")
}
