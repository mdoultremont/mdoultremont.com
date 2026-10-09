import {
  Clock,
  Config,
  Context,
  Data,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
  Semaphore,
} from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/http"
import { TokenCipher } from "@/backend/primitives/token-cipher"
import { type SpotifyConnection, SpotifyConnections } from "./connections"
import {
  AccessDenied,
  InvalidInput,
  InvalidResponse,
  NotConnected,
  RateLimited,
  ReconnectNeeded,
  Rejected,
  type SpotifyError,
  spotifyError,
  Unavailable,
} from "./errors"
import * as Api from "./schemas"
import {
  type SpotifyConnectionStatus,
  type SpotifyPage,
  type SpotifyPlaylist,
  type SpotifySavedTrack,
  spotifyScopes,
} from "./schemas"

const apiOrigin = "https://api.spotify.com"
const tokenUrl = "https://accounts.spotify.com/api/token"
const spotifyId = /^[A-Za-z0-9]+$/u

/**
 * Spotify Web API access for one app owner. Holds no business rules: it only
 * exposes the reads and writes the music features need, with credentials,
 * token refresh, and provider errors handled inside.
 */
export class Spotify extends Context.Service<
  Spotify,
  {
    readonly authorizationUrl: (state: string) => string
    readonly connect: (
      ownerId: string,
      code: string
    ) => Effect.Effect<SpotifyConnectionStatus, SpotifyError>
    readonly status: (
      ownerId: string
    ) => Effect.Effect<SpotifyConnectionStatus, SpotifyError>
    readonly playlists: (
      ownerId: string
    ) => Effect.Effect<readonly SpotifyPlaylist[], SpotifyError>
    /** Fails with `AccessDenied` unless the connected account owns the playlist. */
    readonly playlist: (
      ownerId: string,
      playlistId: string
    ) => Effect.Effect<SpotifyPlaylist, SpotifyError>
    readonly createPrivatePlaylist: (
      ownerId: string,
      name: string
    ) => Effect.Effect<SpotifyPlaylist, SpotifyError>
    readonly savedTracksPage: (
      ownerId: string,
      cursor?: string
    ) => Effect.Effect<SpotifyPage<SpotifySavedTrack>, SpotifyError>
    readonly isTrackLiked: (
      ownerId: string,
      trackId: string
    ) => Effect.Effect<boolean, SpotifyError>
    readonly isTrackInPlaylist: (
      ownerId: string,
      playlistId: string,
      trackId: string
    ) => Effect.Effect<boolean, SpotifyError>
    readonly addTrackToPlaylist: (
      ownerId: string,
      playlistId: string,
      trackId: string
    ) => Effect.Effect<void, SpotifyError>
    readonly disconnect: (ownerId: string) => Effect.Effect<void, SpotifyError>
  }
>()("backend/modules/Spotify") {
  /** Needs `SpotifyConnections`, `TokenCipher`, `HttpClient`, and config. Used by tests. */
  static readonly layerNoDeps = Layer.effect(
    Spotify,
    Effect.gen(function* () {
      return Spotify.of(yield* make)
    })
  )

  /** Production layer. Needs only `Database` and the SPOTIFY_* configuration. */
  static readonly layer = Spotify.layerNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(
        SpotifyConnections.layer,
        TokenCipher.layerConfig("SPOTIFY_TOKEN_ENCRYPTION_KEY"),
        FetchHttpClient.layer
      )
    )
  )
}

/** Internal signal: Spotify rejected the credentials. Callers turn it into a public reason. */
class Unauthorized extends Data.TaggedError("Unauthorized")<{}> {}

interface CachedAccessToken {
  readonly encryptedRefreshToken: string
  readonly accessToken: string
  readonly expiresAt: number
}

const fail = (reason: Parameters<typeof spotifyError>[0]) =>
  Effect.fail(spotifyError(reason))

/** Connection storage and encryption failures surface as `Unavailable`. */
const storage = <A, E>(effect: Effect.Effect<A, E>) =>
  effect.pipe(
    Effect.mapError((cause) => spotifyError(new Unavailable({ cause })))
  )

/** Decodes a JSON body with a schema; any mismatch is an `InvalidResponse`. */
const decode =
  <S extends Schema.Top>(schema: S, message: string) =>
  (response: HttpClientResponse.HttpClientResponse) =>
    response.json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(schema)),
      Effect.mapError((cause) =>
        spotifyError(new InvalidResponse({ message, cause }))
      )
    ) as Effect.Effect<S["Type"], SpotifyError>

const make = Effect.gen(function* () {
  const clientId = yield* Config.NonEmptyString("SPOTIFY_CLIENT_ID")
  const clientSecret = yield* Config.schema(
    Schema.Redacted(Schema.NonEmptyString),
    "SPOTIFY_CLIENT_SECRET"
  )
  const redirectUri = yield* Config.NonEmptyString("SPOTIFY_REDIRECT_URI")
  const connections = yield* SpotifyConnections
  const cipher = yield* TokenCipher
  const http = yield* HttpClient.HttpClient

  // Lives as long as the layer: one request or one queue batch.
  const accessTokens = new Map<string, CachedAccessToken>()
  // Concurrent calls share one refresh instead of racing token rotation.
  const refreshLock = yield* Semaphore.make(1)

  // --- HTTP ----------------------------------------------------------------

  const send = (request: HttpClientRequest.HttpClientRequest) =>
    http.execute(request).pipe(
      Effect.mapError((cause) => spotifyError(new Unavailable({ cause }))),
      Effect.flatMap(checkStatus)
    )

  const checkStatus = (
    response: HttpClientResponse.HttpClientResponse
  ): Effect.Effect<
    HttpClientResponse.HttpClientResponse,
    SpotifyError | Unauthorized
  > =>
    Effect.gen(function* () {
      if (response.status >= 200 && response.status < 300) return response
      if (response.status === 429) {
        const header = Number(response.headers["retry-after"])
        return yield* fail(
          new RateLimited({
            retryAfterSeconds:
              Number.isFinite(header) && header >= 0 ? header : undefined,
          })
        )
      }
      if (response.status === 401 || response.status === 403)
        return yield* new Unauthorized()
      if (response.status === 400) {
        const body = yield* response.json.pipe(Effect.orElseSucceed(() => null))
        if (
          typeof body === "object" &&
          body !== null &&
          "error" in body &&
          body.error === "invalid_grant"
        )
          return yield* new Unauthorized()
      }
      if (response.status >= 500) return yield* fail(new Unavailable({}))
      return yield* fail(new Rejected({ status: response.status }))
    })

  const tokenRequest = (body: Record<string, string>) =>
    HttpClientRequest.post(tokenUrl).pipe(
      HttpClientRequest.basicAuth(clientId, Redacted.value(clientSecret)),
      HttpClientRequest.bodyUrlParams(body),
      send,
      Effect.flatMap(
        decode(Api.TokenResponse, "Spotify returned an invalid token response")
      )
    )

  const apiGet = (pathOrUrl: string, accessToken: string) =>
    HttpClientRequest.get(new URL(pathOrUrl, apiOrigin)).pipe(
      HttpClientRequest.bearerToken(accessToken),
      send
    )

  const apiPost = (path: string, accessToken: string, body: unknown) =>
    HttpClientRequest.post(new URL(path, apiOrigin)).pipe(
      HttpClientRequest.bearerToken(accessToken),
      HttpClientRequest.bodyJsonUnsafe(body),
      send
    )

  // --- Credentials ---------------------------------------------------------

  const markReconnect = (ownerId: string, connection: SpotifyConnection) =>
    Effect.sync(() => accessTokens.delete(ownerId)).pipe(
      Effect.andThen(
        storage(
          connections.markReconnect(ownerId, connection.encryptedRefreshToken)
        )
      ),
      Effect.andThen(fail(new ReconnectNeeded()))
    )

  const activeConnection = (ownerId: string) =>
    Effect.gen(function* () {
      const stored = yield* storage(connections.get(ownerId))
      if (Option.isNone(stored)) {
        accessTokens.delete(ownerId)
        return yield* fail(new NotConnected())
      }
      if (stored.value.needsReconnect) {
        accessTokens.delete(ownerId)
        return yield* fail(new ReconnectNeeded())
      }
      return stored.value
    })

  /** Returns a usable access token, refreshing and rotating the stored refresh token when needed. */
  const refresh = (ownerId: string, force = false) =>
    refreshLock.withPermit(
      Effect.gen(function* () {
        let connection = yield* activeConnection(ownerId)
        const now = yield* Clock.currentTimeMillis
        const cached = accessTokens.get(ownerId)
        if (
          !force &&
          cached &&
          cached.encryptedRefreshToken === connection.encryptedRefreshToken &&
          cached.expiresAt > now
        )
          return { connection, accessToken: cached.accessToken }
        accessTokens.delete(ownerId)

        const refreshToken = yield* cipher
          .decrypt(connection.encryptedRefreshToken)
          .pipe(Effect.mapError(() => spotifyError(new ReconnectNeeded())))
        const failed = connection
        const token = yield* tokenRequest({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }).pipe(
          Effect.catchTag("Unauthorized", () => markReconnect(ownerId, failed))
        )

        if (token.refresh_token) {
          const encrypted = yield* cipher
            .encrypt(token.refresh_token)
            .pipe(
              Effect.mapError((cause) =>
                spotifyError(new Unavailable({ cause }))
              )
            )
          const replaced = yield* storage(
            connections.replaceRefreshToken(
              ownerId,
              connection.encryptedRefreshToken,
              encrypted
            )
          )
          if (replaced)
            connection = { ...connection, encryptedRefreshToken: encrypted }
          else {
            const latest = yield* storage(connections.get(ownerId))
            if (Option.isNone(latest) || latest.value.needsReconnect)
              return yield* fail(new ReconnectNeeded())
            connection = latest.value
          }
        }

        if (token.expires_in !== undefined && token.expires_in > 60)
          accessTokens.set(ownerId, {
            encryptedRefreshToken: connection.encryptedRefreshToken,
            accessToken: token.access_token,
            expiresAt: now + (token.expires_in - 60) * 1000,
          })
        return { connection, accessToken: token.access_token }
      })
    )

  /**
   * Runs an API call with a fresh access token. If Spotify rejects the token,
   * the connection is marked for reconnection.
   */
  const authorized = <A>(
    ownerId: string,
    call: (
      accessToken: string,
      connection: SpotifyConnection
    ) => Effect.Effect<A, SpotifyError | Unauthorized>
  ) =>
    Effect.gen(function* () {
      const { connection, accessToken } = yield* refresh(ownerId)
      return yield* call(accessToken, connection).pipe(
        Effect.catchTag("Unauthorized", () =>
          markReconnect(ownerId, connection)
        )
      )
    })

  const requireId = (id: string, kind: string) =>
    spotifyId.test(id)
      ? Effect.void
      : fail(new InvalidInput({ message: `Invalid ${kind} ID` }))

  const page = decode(Api.Page, "Spotify returned an invalid page")

  // --- Public API ----------------------------------------------------------

  const authorizationUrl = (state: string) => {
    const url = new URL("https://accounts.spotify.com/authorize")
    url.searchParams.set("client_id", clientId)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("redirect_uri", redirectUri)
    url.searchParams.set("scope", spotifyScopes.join(" "))
    url.searchParams.set("state", state)
    return url.toString()
  }

  const connect = Effect.fn("Spotify.connect")(function* (
    ownerId: string,
    code: string
  ) {
    accessTokens.delete(ownerId)
    const denied = (message: string) => () =>
      fail(new AccessDenied({ message }))
    const token = yield* tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }).pipe(
      Effect.catchTag("Unauthorized", denied("Spotify authorization failed"))
    )
    if (!token.refresh_token)
      return yield* fail(
        new InvalidResponse({
          message: "Spotify returned incomplete credentials",
        })
      )
    const granted = token.scope?.split(/\s+/u) ?? []
    if (spotifyScopes.some((scope) => !granted.includes(scope)))
      return yield* fail(
        new AccessDenied({
          message: "Spotify did not grant the required permissions",
        })
      )

    const profile = yield* apiGet("/v1/me", token.access_token).pipe(
      Effect.flatMap(decode(Api.Profile, "Spotify returned no account ID")),
      Effect.catchTag("Unauthorized", denied("Spotify authorization failed"))
    )
    const accountId = profile.account_id ?? profile.id
    const existing = yield* storage(connections.get(ownerId))
    if (Option.isSome(existing) && existing.value.accountId !== accountId)
      return yield* fail(
        new AccessDenied({
          message:
            "Disconnect the previous Spotify account before changing accounts",
        })
      )

    const displayName = profile.display_name ?? null
    const encryptedRefreshToken = yield* cipher
      .encrypt(token.refresh_token)
      .pipe(
        Effect.mapError((cause) => spotifyError(new Unavailable({ cause })))
      )
    yield* storage(
      connections.save({
        ownerId,
        accountId,
        spotifyUserId: profile.id,
        displayName,
        encryptedRefreshToken,
        scopes: granted.join(" "),
        connectedAt: yield* Clock.currentTimeMillis,
        needsReconnect: false,
      })
    )
    return {
      status: "connected",
      accountId,
      displayName,
    } satisfies SpotifyConnectionStatus as SpotifyConnectionStatus
  })

  const status = Effect.fn("Spotify.status")(function* (ownerId: string) {
    const stored = yield* storage(connections.get(ownerId))
    if (Option.isNone(stored))
      return { status: "disconnected" } as SpotifyConnectionStatus
    const { accountId, displayName } = stored.value
    const reconnect: SpotifyConnectionStatus = {
      status: "reconnect_needed",
      accountId,
      displayName,
    }
    if (stored.value.needsReconnect) return reconnect
    // Force a refresh: a cached access token says nothing about whether the
    // refresh token still works.
    return yield* refresh(ownerId, true).pipe(
      Effect.as<SpotifyConnectionStatus>({
        status: "connected",
        accountId,
        displayName,
      }),
      Effect.catchReason("SpotifyError", "ReconnectNeeded", () =>
        Effect.succeed(reconnect)
      )
    )
  })

  const playlists = Effect.fn("Spotify.playlists")(function* (ownerId: string) {
    return yield* authorized(ownerId, (accessToken) =>
      Effect.gen(function* () {
        const items: SpotifyPlaylist[] = []
        let next: string | null = "/v1/me/playlists?limit=50"
        while (next) {
          const current: typeof Api.Page.Type = yield* apiGet(
            next,
            accessToken
          ).pipe(Effect.flatMap(page))
          for (const value of current.items) {
            // Playlists Spotify no longer returns in full are skipped, not fatal.
            const playlist = Schema.decodeUnknownOption(Api.Playlist)(value)
            if (Option.isSome(playlist))
              items.push(Api.toPlaylist(playlist.value))
          }
          next = current.next
        }
        return items as readonly SpotifyPlaylist[]
      })
    )
  })

  const playlist = Effect.fn("Spotify.playlist")(function* (
    ownerId: string,
    playlistId: string
  ) {
    yield* requireId(playlistId, "playlist")
    return yield* authorized(ownerId, (accessToken, connection) =>
      apiGet(`/v1/playlists/${playlistId}`, accessToken).pipe(
        Effect.flatMap(
          decode(Api.Playlist, "Spotify returned an invalid playlist")
        ),
        Effect.map(Api.toPlaylist),
        Effect.filterOrFail(
          (found) => found.ownerId === connection.spotifyUserId,
          () =>
            spotifyError(
              new AccessDenied({
                message:
                  "Playlist is not owned by the connected Spotify account",
              })
            )
        )
      )
    )
  })

  const createPrivatePlaylist = Effect.fn("Spotify.createPrivatePlaylist")(
    function* (ownerId: string, name: string) {
      const trimmed = name.trim()
      if (!trimmed || trimmed.length > 100)
        return yield* fail(
          new InvalidInput({
            message: "Playlist name must be 1 to 100 characters",
          })
        )
      return yield* authorized(ownerId, (accessToken, connection) =>
        apiPost("/v1/me/playlists", accessToken, {
          name: trimmed,
          public: false,
        }).pipe(
          Effect.flatMap(
            decode(Api.Playlist, "Spotify returned an invalid playlist")
          ),
          Effect.map(Api.toPlaylist),
          Effect.filterOrFail(
            (created) =>
              created.ownerId === connection.spotifyUserId &&
              created.public === false,
            () =>
              spotifyError(
                new InvalidResponse({
                  message:
                    "Spotify did not create a private playlist for this account",
                })
              )
          )
        )
      )
    }
  )

  const savedTracksPage = Effect.fn("Spotify.savedTracksPage")(function* (
    ownerId: string,
    cursor?: string
  ) {
    if (cursor !== undefined && !isSameEndpoint(cursor, "/v1/me/tracks"))
      return yield* fail(
        new InvalidInput({ message: "Invalid saved tracks cursor" })
      )
    return yield* authorized(ownerId, (accessToken) =>
      Effect.gen(function* () {
        const current: typeof Api.Page.Type = yield* apiGet(
          cursor ?? "/v1/me/tracks?limit=50",
          accessToken
        ).pipe(Effect.flatMap(page))
        const items: SpotifySavedTrack[] = []
        for (const value of current.items) {
          const saved = Schema.decodeUnknownOption(Api.SavedTrackItem)(value)
          if (Option.isNone(saved)) continue
          const { track, added_at } = saved.value
          const id = yield* originalTrackId(track)
          if (!id || !track.name) continue
          items.push({
            id,
            name: track.name,
            artistNames: (track.artists ?? []).flatMap((artist) =>
              artist.name === undefined ? [] : [artist.name]
            ),
            isrc: track.external_ids?.isrc || null,
            durationMs:
              typeof track.duration_ms === "number" &&
              Number.isSafeInteger(track.duration_ms) &&
              track.duration_ms >= 0
                ? track.duration_ms
                : null,
            addedAt: added_at,
          })
        }
        return {
          items,
          next: current.next,
          total: current.total,
        } as SpotifyPage<SpotifySavedTrack>
      })
    )
  })

  const isTrackLiked = Effect.fn("Spotify.isTrackLiked")(function* (
    ownerId: string,
    trackId: string
  ) {
    yield* requireId(trackId, "track")
    return yield* authorized(ownerId, (accessToken) =>
      HttpClientRequest.get(new URL("/v1/me/library/contains", apiOrigin)).pipe(
        HttpClientRequest.setUrlParam("uris", `spotify:track:${trackId}`),
        HttpClientRequest.bearerToken(accessToken),
        send,
        Effect.flatMap(
          decode(
            Api.LibraryContains,
            "Spotify returned an invalid library membership result"
          )
        ),
        Effect.map(([liked]) => liked)
      )
    )
  })

  const isTrackInPlaylist = Effect.fn("Spotify.isTrackInPlaylist")(function* (
    ownerId: string,
    playlistId: string,
    trackId: string
  ) {
    yield* requireId(playlistId, "playlist")
    yield* requireId(trackId, "track")
    const itemsPath = `/v1/playlists/${playlistId}/items`
    return yield* authorized(ownerId, (accessToken) =>
      Effect.gen(function* () {
        let next: string | null = `${itemsPath}?limit=50`
        const seen = new Set<string>()
        while (next) {
          const url: string = new URL(next, apiOrigin).toString()
          if (!isSameEndpoint(url, itemsPath) || seen.has(url))
            return yield* fail(
              new InvalidResponse({
                message: "Spotify returned an invalid playlist page URL",
              })
            )
          seen.add(url)
          const current: typeof Api.Page.Type = yield* apiGet(
            url,
            accessToken
          ).pipe(Effect.flatMap(page))
          for (const value of current.items) {
            const entry = Schema.decodeUnknownOption(Api.PlaylistItem)(value)
            if (Option.isNone(entry)) continue
            const track = entry.value.item ?? entry.value.track
            if (
              track?.type === "track" &&
              (yield* originalTrackId(track)) === trackId
            )
              return true
          }
          next = current.next
        }
        return false
      })
    )
  })

  const addTrackToPlaylist = Effect.fn("Spotify.addTrackToPlaylist")(function* (
    ownerId: string,
    playlistId: string,
    trackId: string
  ) {
    yield* requireId(playlistId, "playlist")
    yield* requireId(trackId, "track")
    yield* authorized(ownerId, (accessToken) =>
      apiPost(`/v1/playlists/${playlistId}/items`, accessToken, {
        uris: [`spotify:track:${trackId}`],
      }).pipe(
        Effect.flatMap(
          decode(Api.Snapshot, "Spotify returned no playlist snapshot")
        )
      )
    )
  })

  const disconnect = Effect.fn("Spotify.disconnect")(function* (
    ownerId: string
  ) {
    accessTokens.delete(ownerId)
    yield* storage(connections.disconnect(ownerId))
  })

  return {
    authorizationUrl,
    connect,
    status,
    playlists,
    playlist,
    createPrivatePlaylist,
    savedTracksPage,
    isTrackLiked,
    isTrackInPlaylist,
    addTrackToPlaylist,
    disconnect,
  }
})

/** Relinked responses represent the original saved/playlist item, not its playable replacement. */
function originalTrackId(track: typeof Api.Track.Type) {
  if (track.linked_from) {
    const original = track.linked_from.id
    return typeof original === "string" && original
      ? Effect.succeed<string | null>(original)
      : Effect.fail(
          spotifyError(
            new InvalidResponse({
              message: "Spotify returned an invalid original track ID",
            })
          )
        )
  }
  return Effect.succeed(track.id || null)
}

function isSameEndpoint(value: string, pathname: string) {
  try {
    const url = new URL(value, apiOrigin)
    return url.origin === apiOrigin && url.pathname === pathname
  } catch {
    return false
  }
}
