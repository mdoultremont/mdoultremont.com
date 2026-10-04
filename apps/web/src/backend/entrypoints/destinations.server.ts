import { env } from "cloudflare:workers"
import { Effect, Layer } from "effect"
import { requireCurrentOwner } from "./app-auth.server"
import { destinationStoreLayer } from "@/backend/modules/destination-store"
import { createSpotifyModule, SpotifyError } from "@/backend/modules/spotify"
import { createSpotifyConnectionStore } from "@/backend/modules/spotify-store"
import {
  createDestination,
  CreatedPlaylistConfigurationError,
  DestinationConflict,
  DestinationInputError,
  DestinationPersistenceError,
  OwnedPlaylists,
  PlaylistAccessError,
  readDestinations,
  removeDestination,
  saveDestination,
  setReviewPlaylist,
} from "@/backend/workflows/destinations"

function layers() {
  const spotify = createSpotifyModule({
    store: createSpotifyConnectionStore(env.DB),
    clientId: env.SPOTIFY_CLIENT_ID,
    clientSecret: env.SPOTIFY_CLIENT_SECRET,
    redirectUri: env.SPOTIFY_REDIRECT_URI,
    encryptionKey: env.SPOTIFY_TOKEN_ENCRYPTION_KEY,
  })
  return Layer.merge(
    destinationStoreLayer(env.DB),
    Layer.succeed(OwnedPlaylists, {
      get: (ownerId, playlistId) =>
        spotify.playlist(ownerId, playlistId).pipe(
          Effect.map((playlist) => ({ id: playlist.id, name: playlist.name })),
          Effect.mapError(toPlaylistAccessError)
        ),
      createPrivate: (ownerId, name) =>
        spotify.createPrivatePlaylist(ownerId, name).pipe(
          Effect.map((playlist) => ({ id: playlist.id, name: playlist.name })),
          Effect.mapError(toPlaylistAccessError)
        ),
    })
  )
}

export async function getDestinations(request: Request): Promise<Response> {
  const ownerId = await currentOwnerId(request)
  if (!ownerId) return json({ error: "Owner sign-in required" }, 401)
  try {
    return json(
      await Effect.runPromise(
        Effect.provide(readDestinations(ownerId), layers())
      )
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function putDestination(request: Request): Promise<Response> {
  const ownerId = await currentOwnerId(request)
  if (!ownerId) return json({ error: "Owner sign-in required" }, 401)
  if (!verifyMutation(request))
    return json({ error: "Request verification failed" }, 403)
  const input = await readObject(request)
  if (
    !input ||
    typeof input.playlistId !== "string" ||
    typeof input.description !== "string" ||
    typeof input.enabled !== "boolean"
  )
    return json({ error: "Invalid destination" }, 400)
  try {
    const destination = await Effect.runPromise(
      Effect.provide(
        saveDestination({
          ownerId,
          playlistId: input.playlistId,
          description: input.description,
          enabled: input.enabled,
          now: Date.now(),
        }),
        layers()
      )
    )
    return json({ destination })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function deleteDestination(request: Request): Promise<Response> {
  const ownerId = await currentOwnerId(request)
  if (!ownerId) return json({ error: "Owner sign-in required" }, 401)
  if (!verifyMutation(request))
    return json({ error: "Request verification failed" }, 403)
  const input = await readObject(request)
  if (!input || typeof input.playlistId !== "string")
    return json({ error: "Invalid destination" }, 400)
  try {
    await Effect.runPromise(
      Effect.provide(
        removeDestination({ ownerId, playlistId: input.playlistId }),
        layers()
      )
    )
    return json({ status: "removed" })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function postPrivateDestination(
  request: Request
): Promise<Response> {
  const ownerId = await currentOwnerId(request)
  if (!ownerId) return json({ error: "Owner sign-in required" }, 401)
  if (!verifyMutation(request))
    return json({ error: "Request verification failed" }, 403)
  const input = await readObject(request)
  if (
    !input ||
    typeof input.name !== "string" ||
    typeof input.description !== "string"
  )
    return json({ error: "Invalid destination" }, 400)
  try {
    return json(
      await Effect.runPromise(
        Effect.provide(
          createDestination({
            ownerId,
            name: input.name,
            description: input.description,
            now: Date.now(),
          }),
          layers()
        )
      ),
      201
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function putReviewPlaylist(request: Request): Promise<Response> {
  const ownerId = await currentOwnerId(request)
  if (!ownerId) return json({ error: "Owner sign-in required" }, 401)
  if (!verifyMutation(request))
    return json({ error: "Request verification failed" }, 403)
  const input = await readObject(request)
  if (
    !input ||
    (typeof input.playlistId !== "string" && input.playlistId !== null)
  )
    return json({ error: "Invalid review playlist" }, 400)
  try {
    const playlistId = await Effect.runPromise(
      Effect.provide(
        setReviewPlaylist({
          ownerId,
          playlistId: input.playlistId,
        }),
        layers()
      )
    )
    return json({ reviewPlaylistId: playlistId })
  } catch (error) {
    return errorResponse(error)
  }
}

function toPlaylistAccessError(error: SpotifyError): PlaylistAccessError {
  const code =
    error.code === "not_connected" ||
    error.code === "reconnect_needed" ||
    error.code === "rate_limited" ||
    error.code === "temporary"
      ? error.code
      : "invalid"
  const message =
    code === "invalid"
      ? "Choose a playlist owned by the connected Spotify account that is still accessible"
      : error.message
  return new PlaylistAccessError(code, message, { cause: error })
}

function errorResponse(error: unknown): Response {
  if (error instanceof DestinationInputError)
    return json({ error: error.message }, 400)
  if (error instanceof DestinationConflict)
    return json({ error: error.message }, 409)
  if (error instanceof PlaylistAccessError) {
    const status =
      error.code === "invalid"
        ? 400
        : error.code === "not_connected"
          ? 409
          : error.code === "reconnect_needed"
            ? 401
            : error.code === "rate_limited"
              ? 429
              : 503
    return json({ error: error.message, code: error.code }, status)
  }
  if (error instanceof DestinationPersistenceError)
    return json({ error: error.message }, 500)
  if (error instanceof CreatedPlaylistConfigurationError)
    return json({ error: error.message, createdPlaylist: error.playlist }, 500)
  return json({ error: "Playlist configuration failed" }, 500)
}

async function currentOwnerId(request: Request): Promise<string | null> {
  try {
    return (await requireCurrentOwner(request)).id
  } catch {
    return null
  }
}

function verifyMutation(request: Request) {
  const csrf = readCookie(request, "music_csrf")
  return (
    request.headers.get("Origin") === new URL(request.url).origin &&
    Boolean(csrf) &&
    csrf === request.headers.get("X-CSRF-Token")
  )
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

async function readObject(
  request: Request
): Promise<Record<string, unknown> | null> {
  const value: unknown = await request.json().catch(() => null)
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}
