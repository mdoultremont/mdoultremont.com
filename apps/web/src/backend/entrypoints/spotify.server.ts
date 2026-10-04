import { env } from "cloudflare:workers"
import { Effect } from "effect"
import { requireCurrentOwner } from "./app-auth.server"
import {
  createSpotifyModule,
  SpotifyError,
  spotifyScopes,
} from "@/backend/modules/spotify"
import { createSpotifyConnectionStore } from "@/backend/modules/spotify-store"
import {
  createSpotifyOAuthState,
  verifySpotifyOAuthState,
} from "@/backend/modules/spotify-oauth-state"
import { likesBaselineLayer } from "@/backend/modules/likes-baseline-runtime"
import { startLikesBaseline } from "@/backend/workflows/likes-baseline"

const stateCookie = "spotify_oauth_state"
const sessionCookie = "music_session"
const csrfCookie = "music_csrf"

function spotify() {
  return createSpotifyModule({
    store: createSpotifyConnectionStore(env.DB),
    clientId: env.SPOTIFY_CLIENT_ID,
    clientSecret: env.SPOTIFY_CLIENT_SECRET,
    redirectUri: env.SPOTIFY_REDIRECT_URI,
    encryptionKey: env.SPOTIFY_TOKEN_ENCRYPTION_KEY,
  })
}

export async function beginSpotifyConnection(
  request: Request
): Promise<Response> {
  const owner = await ownerOrNull(request)
  if (!owner) return unauthorized()
  const sessionToken = readCookie(request, sessionCookie)
  if (!sessionToken) return unauthorized()
  if (
    !env.SPOTIFY_CLIENT_ID ||
    !env.SPOTIFY_CLIENT_SECRET ||
    !env.SPOTIFY_REDIRECT_URI ||
    !env.SPOTIFY_TOKEN_ENCRYPTION_KEY
  )
    return new Response("Spotify is not configured", { status: 503 })

  const state = await createSpotifyOAuthState(sessionToken)
  const url = new URL("https://accounts.spotify.com/authorize")
  url.searchParams.set("client_id", env.SPOTIFY_CLIENT_ID)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("redirect_uri", env.SPOTIFY_REDIRECT_URI)
  url.searchParams.set("scope", spotifyScopes.join(" "))
  url.searchParams.set("state", state)
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      "Set-Cookie": cookie(stateCookie, state, 600, request),
      "Cache-Control": "no-store",
    },
  })
}

export async function completeSpotifyConnection(
  request: Request
): Promise<Response> {
  const owner = await ownerOrNull(request)
  const sessionToken = readCookie(request, sessionCookie)
  const stateCookieValue = readCookie(request, stateCookie)
  const url = new URL(request.url)
  const state = url.searchParams.get("state")
  const code = url.searchParams.get("code")
  const clearCookie = cookie(stateCookie, "", 0, request)
  if (
    !owner ||
    !sessionToken ||
    !stateCookieValue ||
    !state ||
    stateCookieValue !== state ||
    !(await verifySpotifyOAuthState(state, sessionToken)) ||
    !code ||
    url.searchParams.has("error")
  )
    return callbackRedirect(request, "failed", clearCookie)

  try {
    const connection = await Effect.runPromise(
      spotify().connect(owner.id, code)
    )
    let baselineQueued = true
    if (connection.status === "connected") {
      await Effect.runPromise(
        Effect.provide(
          startLikesBaseline(owner.id, connection.accountId),
          likesBaselineLayer(env)
        )
      ).catch(() => {
        baselineQueued = false
      })
    }
    return callbackRedirect(
      request,
      baselineQueued ? "connected" : "baseline_failed",
      clearCookie
    )
  } catch (error) {
    return callbackRedirect(
      request,
      error instanceof SpotifyError && error.code === "authorization"
        ? "denied"
        : "failed",
      clearCookie
    )
  }
}

export async function spotifyStatus(request: Request): Promise<Response> {
  const owner = await ownerOrNull(request)
  if (!owner) return unauthorized()
  try {
    return json(await Effect.runPromise(spotify().status(owner.id)))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function spotifyPlaylists(request: Request): Promise<Response> {
  const owner = await ownerOrNull(request)
  if (!owner) return unauthorized()
  try {
    return json({
      items: await Effect.runPromise(spotify().playlists(owner.id)),
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function spotifySavedTracks(request: Request): Promise<Response> {
  const owner = await ownerOrNull(request)
  if (!owner) return unauthorized()
  const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined
  if (cursor && !isSavedTracksCursor(cursor))
    return json({ error: "Invalid cursor" }, 400)
  try {
    return json(
      await Effect.runPromise(spotify().savedTracksPage(owner.id, cursor))
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function disconnectSpotify(request: Request): Promise<Response> {
  const owner = await ownerOrNull(request)
  if (!owner) return unauthorized()
  if (!verifyMutation(request))
    return json({ error: "Request verification failed" }, 403)
  try {
    await Effect.runPromise(spotify().disconnect(owner.id))
    return json({ status: "disconnected" })
  } catch (error) {
    return errorResponse(error)
  }
}

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

function verifyMutation(request: Request) {
  return (
    request.headers.get("Origin") === new URL(request.url).origin &&
    Boolean(readCookie(request, csrfCookie)) &&
    readCookie(request, csrfCookie) === request.headers.get("X-CSRF-Token")
  )
}

function callbackRedirect(
  request: Request,
  result: string,
  stateCookieValue: string
) {
  return new Response(null, {
    status: 303,
    headers: [
      ["Location", new URL(`/music?spotify=${result}`, request.url).toString()],
      ["Set-Cookie", stateCookieValue],
      ["Cache-Control", "no-store"],
    ],
  })
}

function errorResponse(error: unknown): Response {
  if (!(error instanceof SpotifyError))
    return json({ error: "Spotify operation failed" }, 500)
  const status =
    error.code === "not_connected"
      ? 409
      : error.code === "reconnect_needed"
        ? 401
        : error.code === "rate_limited"
          ? 429
          : error.code === "configuration"
            ? 503
            : error.code === "temporary"
              ? 503
              : 502
  const headers: Record<string, string> = {}
  if (error.retryAfterSeconds !== undefined)
    headers["Retry-After"] = String(error.retryAfterSeconds)
  return json({ error: error.message, code: error.code }, status, headers)
}

function json(value: unknown, status = 200, headers?: Record<string, string>) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  })
}

function unauthorized() {
  return json({ error: "Owner sign-in required" }, 401)
}

async function ownerOrNull(request: Request) {
  try {
    return await requireCurrentOwner(request)
  } catch {
    return null
  }
}

function readCookie(request: Request, name: string): string | null {
  for (const part of request.headers.get("Cookie")?.split(";") ?? []) {
    const separator = part.indexOf("=")
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue
    try {
      return decodeURIComponent(part.slice(separator + 1).trim())
    } catch {
      return null
    }
  }
  return null
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
