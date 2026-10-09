import { Effect } from "effect"

export const spotifyScopes = [
  "user-library-read",
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
  "playlist-modify-public",
] as const

export interface SpotifyConnection {
  readonly ownerId: string
  readonly accountId: string
  readonly spotifyUserId: string
  readonly displayName: string | null
  readonly encryptedRefreshToken: string
  readonly scopes: string
  readonly connectedAt: number
  readonly needsReconnect: boolean
}

export interface SpotifyConnectionStore {
  get(ownerId: string): Promise<SpotifyConnection | null>
  save(connection: SpotifyConnection): Promise<void>
  replaceRefreshToken(
    ownerId: string,
    previous: string,
    next: string
  ): Promise<boolean>
  /** Marks reconnect only while the stored refresh token is still the one that failed. */
  markReconnect(ownerId: string, encryptedRefreshToken: string): Promise<void>
  disconnect(ownerId: string): Promise<void>
}

export interface SpotifyPlaylist {
  readonly id: string
  readonly name: string
  readonly public: boolean | null
  readonly collaborative: boolean
  readonly ownerId: string
}

export interface SpotifySavedTrack {
  readonly id: string
  readonly name: string
  readonly artistNames: readonly string[]
  readonly isrc: string | null
  readonly durationMs: number | null
  readonly addedAt: string
}

export interface SpotifyPage<T> {
  readonly items: readonly T[]
  readonly next: string | null
  readonly total: number
}

export type SpotifyConnectionStatus =
  | { readonly status: "disconnected" }
  | {
      readonly status: "reconnect_needed"
      readonly accountId: string
      readonly displayName: string | null
    }
  | {
      readonly status: "connected"
      readonly accountId: string
      readonly displayName: string | null
    }

export class SpotifyError extends Error {
  readonly _tag = "SpotifyError"

  constructor(
    readonly code:
      | "configuration"
      | "authorization"
      | "reconnect_needed"
      | "rate_limited"
      | "temporary"
      | "provider"
      | "invalid_response"
      | "not_connected",
    message: string,
    readonly retryAfterSeconds?: number,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = "SpotifyError"
  }
}

export interface SpotifyModuleOptions {
  readonly store: SpotifyConnectionStore
  readonly clientId: string
  readonly clientSecret: string
  readonly redirectUri: string
  readonly encryptionKey: string
  readonly fetch?: typeof fetch
  readonly now?: () => number
}

export function createSpotifyModule(options: SpotifyModuleOptions) {
  const fetcher = options.fetch ?? fetch
  const now = options.now ?? Date.now
  const accessTokens = new Map<
    string,
    {
      readonly encryptedRefreshToken: string
      readonly accessToken: string
      readonly expiresAt: number
    }
  >()

  async function markReconnect(ownerId: string, encryptedRefreshToken: string) {
    accessTokens.delete(ownerId)
    await options.store.markReconnect(ownerId, encryptedRefreshToken)
  }

  function configured() {
    if (
      !options.clientId ||
      !options.clientSecret ||
      !options.redirectUri ||
      !options.encryptionKey
    )
      throw new SpotifyError("configuration", "Spotify is not configured")
  }

  async function providerRequest(
    url: string,
    init: RequestInit
  ): Promise<Response> {
    let response: Response
    try {
      response = await fetcher(url, init)
    } catch (cause) {
      throw new SpotifyError(
        "temporary",
        "Spotify could not be reached",
        undefined,
        { cause }
      )
    }
    if (response.ok) return response
    const retryAfterHeader = response.headers.get("Retry-After")
    const retryAfter =
      retryAfterHeader === null ? undefined : Number(retryAfterHeader)
    if (response.status === 429)
      throw new SpotifyError(
        "rate_limited",
        "Spotify rate limit reached",
        retryAfter !== undefined &&
          Number.isFinite(retryAfter) &&
          retryAfter >= 0
          ? retryAfter
          : undefined
      )
    if (response.status === 400) {
      const body: unknown = await response
        .clone()
        .json()
        .catch(() => null)
      if (isObject(body) && body.error === "invalid_grant")
        throw new SpotifyError(
          "authorization",
          "Spotify authorization was revoked or expired"
        )
    }
    if (response.status === 401 || response.status === 403)
      throw new SpotifyError("authorization", "Spotify authorization failed")
    if (response.status >= 500)
      throw new SpotifyError("temporary", "Spotify is temporarily unavailable")
    throw new SpotifyError("provider", `Spotify returned ${response.status}`)
  }

  async function tokenRequest(
    body: URLSearchParams
  ): Promise<Record<string, unknown>> {
    const credentials = btoa(`${options.clientId}:${options.clientSecret}`)
    const response = await providerRequest(
      "https://accounts.spotify.com/api/token",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      }
    )
    return readObject(response)
  }

  async function apiRequest(
    path: string,
    accessToken: string
  ): Promise<Record<string, unknown>> {
    const url = new URL(path, "https://api.spotify.com")
    if (
      url.origin !== "https://api.spotify.com" ||
      !url.pathname.startsWith("/v1/")
    )
      throw new SpotifyError(
        "invalid_response",
        "Invalid Spotify pagination URL"
      )
    const response = await providerRequest(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    return readObject(response)
  }

  async function apiPost(
    path: string,
    accessToken: string,
    body: unknown
  ): Promise<Record<string, unknown>> {
    const url = new URL(path, "https://api.spotify.com")
    if (
      url.origin !== "https://api.spotify.com" ||
      !url.pathname.startsWith("/v1/")
    )
      throw new SpotifyError("invalid_response", "Invalid Spotify URL")
    const response = await providerRequest(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
    return readObject(response)
  }

  async function refresh(
    ownerId: string,
    force = false
  ): Promise<{ connection: SpotifyConnection; accessToken: string }> {
    configured()
    let connection = await options.store.get(ownerId)
    if (!connection) {
      accessTokens.delete(ownerId)
      throw new SpotifyError("not_connected", "Spotify is not connected")
    }
    if (connection.needsReconnect) {
      accessTokens.delete(ownerId)
      throw new SpotifyError(
        "reconnect_needed",
        "Spotify needs to be reconnected"
      )
    }
    const cached = accessTokens.get(ownerId)
    if (
      !force &&
      cached &&
      cached.encryptedRefreshToken === connection.encryptedRefreshToken &&
      cached.expiresAt > now()
    )
      return { connection, accessToken: cached.accessToken }
    accessTokens.delete(ownerId)

    const refreshToken = await decryptToken(
      connection.encryptedRefreshToken,
      options.encryptionKey
    )
    let token: Record<string, unknown>
    try {
      token = await tokenRequest(
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        })
      )
    } catch (error) {
      if (error instanceof SpotifyError && error.code === "authorization") {
        await markReconnect(ownerId, connection.encryptedRefreshToken)
        throw new SpotifyError(
          "reconnect_needed",
          "Spotify needs to be reconnected"
        )
      }
      throw error
    }
    const accessToken = requiredString(token.access_token)
    if (!accessToken)
      throw new SpotifyError(
        "invalid_response",
        "Spotify returned no access token"
      )
    if (typeof token.refresh_token === "string" && token.refresh_token) {
      const encrypted = await encryptToken(
        token.refresh_token,
        options.encryptionKey
      )
      const updated = await options.store.replaceRefreshToken(
        ownerId,
        connection.encryptedRefreshToken,
        encrypted
      )
      if (!updated) {
        const latest = await options.store.get(ownerId)
        if (!latest || latest.needsReconnect)
          throw new SpotifyError(
            "reconnect_needed",
            "Spotify connection changed during refresh"
          )
        connection = latest
      } else {
        connection = { ...connection, encryptedRefreshToken: encrypted }
      }
    }
    const expiresIn = token.expires_in
    if (
      typeof expiresIn === "number" &&
      Number.isFinite(expiresIn) &&
      expiresIn > 60
    )
      accessTokens.set(ownerId, {
        encryptedRefreshToken: connection.encryptedRefreshToken,
        accessToken,
        expiresAt: now() + (expiresIn - 60) * 1000,
      })
    return { connection, accessToken }
  }

  async function authorizedApiRequest(ownerId: string, path: string) {
    const { connection, accessToken } = await refresh(ownerId)
    try {
      return await apiRequest(path, accessToken)
    } catch (error) {
      if (error instanceof SpotifyError && error.code === "authorization") {
        await markReconnect(ownerId, connection.encryptedRefreshToken)
        throw new SpotifyError(
          "reconnect_needed",
          "Spotify needs to be reconnected"
        )
      }
      throw error
    }
  }

  async function connect(
    ownerId: string,
    code: string
  ): Promise<SpotifyConnectionStatus> {
    configured()
    accessTokens.delete(ownerId)
    const token = await tokenRequest(
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: options.redirectUri,
      })
    )
    const accessToken = requiredString(token.access_token)
    const refreshToken = requiredString(token.refresh_token)
    if (!accessToken || !refreshToken)
      throw new SpotifyError(
        "invalid_response",
        "Spotify returned incomplete credentials"
      )
    const grantedScopes = requiredString(token.scope)?.split(/\s+/u) ?? []
    if (spotifyScopes.some((scope) => !grantedScopes.includes(scope)))
      throw new SpotifyError(
        "authorization",
        "Spotify did not grant the required permissions"
      )
    const profile = await apiRequest("/v1/me", accessToken)
    const spotifyUserId = requiredString(profile.id)
    const accountId = requiredString(profile.account_id) ?? spotifyUserId
    if (!accountId || !spotifyUserId)
      throw new SpotifyError(
        "invalid_response",
        "Spotify returned no account ID"
      )
    const existing = await options.store.get(ownerId)
    if (existing && existing.accountId !== accountId)
      throw new SpotifyError(
        "authorization",
        "Disconnect the previous Spotify account before changing accounts"
      )
    const displayName =
      typeof profile.display_name === "string" ? profile.display_name : null
    await options.store.save({
      ownerId,
      accountId,
      spotifyUserId,
      displayName,
      encryptedRefreshToken: await encryptToken(
        refreshToken,
        options.encryptionKey
      ),
      scopes: grantedScopes.join(" "),
      connectedAt: now(),
      needsReconnect: false,
    })
    return { status: "connected", accountId, displayName }
  }

  async function status(ownerId: string): Promise<SpotifyConnectionStatus> {
    const connection = await options.store.get(ownerId)
    if (!connection) return { status: "disconnected" }
    if (connection.needsReconnect)
      return {
        status: "reconnect_needed",
        accountId: connection.accountId,
        displayName: connection.displayName,
      }
    try {
      await refresh(ownerId, true)
      return {
        status: "connected",
        accountId: connection.accountId,
        displayName: connection.displayName,
      }
    } catch (error) {
      if (error instanceof SpotifyError && error.code === "reconnect_needed")
        return {
          status: "reconnect_needed",
          accountId: connection.accountId,
          displayName: connection.displayName,
        }
      throw error
    }
  }

  async function playlists(
    ownerId: string
  ): Promise<readonly SpotifyPlaylist[]> {
    const { connection, accessToken } = await refresh(ownerId)
    const items: SpotifyPlaylist[] = []
    let next: string | null = "/v1/me/playlists?limit=50"
    while (next) {
      let raw: Record<string, unknown>
      try {
        raw = await apiRequest(next, accessToken)
      } catch (error) {
        if (error instanceof SpotifyError && error.code === "authorization") {
          await markReconnect(ownerId, connection.encryptedRefreshToken)
          throw new SpotifyError(
            "reconnect_needed",
            "Spotify needs to be reconnected"
          )
        }
        throw error
      }
      const page = readPage(raw)
      for (const value of page.items) {
        if (!isObject(value) || !isObject(value.owner)) continue
        const id = requiredString(value.id)
        const name = requiredString(value.name)
        const playlistOwnerId = requiredString(value.owner.id)
        if (!id || !name || !playlistOwnerId) continue
        items.push({
          id,
          name,
          public: typeof value.public === "boolean" ? value.public : null,
          collaborative: value.collaborative === true,
          ownerId: playlistOwnerId,
        })
      }
      next = page.next
    }
    return items
  }

  async function playlist(
    ownerId: string,
    playlistId: string
  ): Promise<SpotifyPlaylist> {
    if (!/^[A-Za-z0-9]+$/u.test(playlistId))
      throw new SpotifyError("invalid_response", "Invalid playlist ID")
    const { connection, accessToken } = await refresh(ownerId)
    let raw: Record<string, unknown>
    try {
      raw = await apiRequest(`/v1/playlists/${playlistId}`, accessToken)
    } catch (error) {
      if (error instanceof SpotifyError && error.code === "authorization") {
        await markReconnect(ownerId, connection.encryptedRefreshToken)
        throw new SpotifyError(
          "reconnect_needed",
          "Spotify needs to be reconnected"
        )
      }
      throw error
    }
    const result = parsePlaylist(raw)
    if (!result || result.ownerId !== connection.spotifyUserId)
      throw new SpotifyError(
        "authorization",
        "Playlist is not owned by the connected Spotify account"
      )
    return result
  }

  async function createPrivatePlaylist(
    ownerId: string,
    name: string
  ): Promise<SpotifyPlaylist> {
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > 100)
      throw new SpotifyError(
        "invalid_response",
        "Playlist name must be 1 to 100 characters"
      )
    const { connection, accessToken } = await refresh(ownerId)
    let raw: Record<string, unknown>
    try {
      raw = await apiPost("/v1/me/playlists", accessToken, {
        name: trimmed,
        public: false,
      })
    } catch (error) {
      if (error instanceof SpotifyError && error.code === "authorization") {
        await markReconnect(ownerId, connection.encryptedRefreshToken)
        throw new SpotifyError(
          "reconnect_needed",
          "Spotify needs to be reconnected"
        )
      }
      throw error
    }
    const result = parsePlaylist(raw)
    if (
      !result ||
      result.ownerId !== connection.spotifyUserId ||
      result.public !== false
    )
      throw new SpotifyError(
        "invalid_response",
        "Spotify did not create a private playlist for this account"
      )
    return result
  }

  async function savedTracksPage(
    ownerId: string,
    cursor?: string
  ): Promise<SpotifyPage<SpotifySavedTrack>> {
    if (cursor) {
      const url = new URL(cursor, "https://api.spotify.com")
      if (
        url.origin !== "https://api.spotify.com" ||
        url.pathname !== "/v1/me/tracks"
      )
        throw new SpotifyError(
          "invalid_response",
          "Invalid saved tracks cursor"
        )
    }
    const raw = await authorizedApiRequest(
      ownerId,
      cursor ?? "/v1/me/tracks?limit=50"
    )
    const page = readPage(raw)
    const items: SpotifySavedTrack[] = []
    for (const value of page.items) {
      if (!isObject(value) || !isObject(value.track)) continue
      const id = originalTrackId(value.track)
      const name = requiredString(value.track.name)
      const addedAt = requiredString(value.added_at)
      if (!id || !name || !addedAt) continue
      const artists = Array.isArray(value.track.artists)
        ? value.track.artists
        : []
      items.push({
        id,
        name,
        artistNames: artists.flatMap((artist) =>
          isObject(artist) && typeof artist.name === "string"
            ? [artist.name]
            : []
        ),
        isrc: isObject(value.track.external_ids)
          ? requiredString(value.track.external_ids.isrc)
          : null,
        durationMs:
          typeof value.track.duration_ms === "number" &&
          Number.isSafeInteger(value.track.duration_ms) &&
          value.track.duration_ms >= 0
            ? value.track.duration_ms
            : null,
        addedAt,
      })
    }
    return { items, next: page.next, total: page.total }
  }

  async function withAccessToken<T>(
    ownerId: string,
    operation: (accessToken: string) => Promise<T>
  ): Promise<T> {
    const { connection, accessToken } = await refresh(ownerId)
    try {
      return await operation(accessToken)
    } catch (error) {
      if (error instanceof SpotifyError && error.code === "authorization") {
        await markReconnect(ownerId, connection.encryptedRefreshToken)
        throw new SpotifyError(
          "reconnect_needed",
          "Spotify needs to be reconnected"
        )
      }
      throw error
    }
  }

  function requireSpotifyId(id: string, kind: string) {
    if (!/^[A-Za-z0-9]+$/u.test(id))
      throw new SpotifyError("invalid_response", `Invalid ${kind} ID`)
  }

  async function isTrackLiked(
    ownerId: string,
    trackId: string
  ): Promise<boolean> {
    requireSpotifyId(trackId, "track")
    return withAccessToken(ownerId, async (accessToken) => {
      const url = new URL("https://api.spotify.com/v1/me/library/contains")
      url.searchParams.set("uris", `spotify:track:${trackId}`)
      const response = await providerRequest(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const result: unknown = await response.json().catch(() => null)
      if (
        !Array.isArray(result) ||
        result.length !== 1 ||
        typeof result[0] !== "boolean"
      )
        throw new SpotifyError(
          "invalid_response",
          "Spotify returned an invalid library membership result"
        )
      return result[0]
    })
  }

  async function isTrackInPlaylist(
    ownerId: string,
    playlistId: string,
    trackId: string
  ): Promise<boolean> {
    requireSpotifyId(playlistId, "playlist")
    requireSpotifyId(trackId, "track")
    return withAccessToken(ownerId, async (accessToken) => {
      let next: string | null = `/v1/playlists/${playlistId}/items?limit=50`
      const seen = new Set<string>()
      while (next) {
        const url = new URL(next, "https://api.spotify.com")
        if (
          url.origin !== "https://api.spotify.com" ||
          url.pathname !== `/v1/playlists/${playlistId}/items` ||
          seen.has(url.toString())
        )
          throw new SpotifyError(
            "invalid_response",
            "Spotify returned an invalid playlist page URL"
          )
        seen.add(url.toString())
        const page = readPage(await apiRequest(url.toString(), accessToken))
        for (const entry of page.items) {
          if (!isObject(entry)) continue
          const item = isObject(entry.item) ? entry.item : entry.track
          if (
            isObject(item) &&
            item.type === "track" &&
            originalTrackId(item) === trackId
          )
            return true
        }
        next = page.next
      }
      return false
    })
  }

  async function addTrackToPlaylist(
    ownerId: string,
    playlistId: string,
    trackId: string
  ): Promise<void> {
    requireSpotifyId(playlistId, "playlist")
    requireSpotifyId(trackId, "track")
    await withAccessToken(ownerId, async (accessToken) => {
      const result = await apiPost(
        `/v1/playlists/${playlistId}/items`,
        accessToken,
        {
          uris: [`spotify:track:${trackId}`],
        }
      )
      if (!requiredString(result.snapshot_id))
        throw new SpotifyError(
          "invalid_response",
          "Spotify returned no playlist snapshot"
        )
    })
  }

  async function disconnect(ownerId: string): Promise<void> {
    accessTokens.delete(ownerId)
    await options.store.disconnect(ownerId)
  }

  return {
    connect: (ownerId: string, code: string) =>
      Effect.tryPromise({
        try: () => connect(ownerId, code),
        catch: toSpotifyError,
      }),
    status: (ownerId: string) =>
      Effect.tryPromise({ try: () => status(ownerId), catch: toSpotifyError }),
    playlists: (ownerId: string) =>
      Effect.tryPromise({
        try: () => playlists(ownerId),
        catch: toSpotifyError,
      }),
    playlist: (ownerId: string, playlistId: string) =>
      Effect.tryPromise({
        try: () => playlist(ownerId, playlistId),
        catch: toSpotifyError,
      }),
    createPrivatePlaylist: (ownerId: string, name: string) =>
      Effect.tryPromise({
        try: () => createPrivatePlaylist(ownerId, name),
        catch: toSpotifyError,
      }),
    savedTracksPage: (ownerId: string, cursor?: string) =>
      Effect.tryPromise({
        try: () => savedTracksPage(ownerId, cursor),
        catch: toSpotifyError,
      }),
    isTrackLiked: (ownerId: string, trackId: string) =>
      Effect.tryPromise({
        try: () => isTrackLiked(ownerId, trackId),
        catch: toSpotifyError,
      }),
    isTrackInPlaylist: (ownerId: string, playlistId: string, trackId: string) =>
      Effect.tryPromise({
        try: () => isTrackInPlaylist(ownerId, playlistId, trackId),
        catch: toSpotifyError,
      }),
    addTrackToPlaylist: (
      ownerId: string,
      playlistId: string,
      trackId: string
    ) =>
      Effect.tryPromise({
        try: () => addTrackToPlaylist(ownerId, playlistId, trackId),
        catch: toSpotifyError,
      }),
    disconnect: (ownerId: string) =>
      Effect.tryPromise({
        try: () => disconnect(ownerId),
        catch: toSpotifyError,
      }),
  }
}

/** Relinked responses represent the original saved/playlist item, not its playable replacement. */
function originalTrackId(track: Record<string, unknown>): string | null {
  if (isObject(track.linked_from)) {
    const original = requiredString(track.linked_from.id)
    if (!original)
      throw new SpotifyError(
        "invalid_response",
        "Spotify returned an invalid original track ID"
      )
    return original
  }
  return requiredString(track.id)
}

function parsePlaylist(value: Record<string, unknown>): SpotifyPlaylist | null {
  if (!isObject(value.owner)) return null
  const id = requiredString(value.id)
  const name = requiredString(value.name)
  const ownerId = requiredString(value.owner.id)
  if (!id || !name || !ownerId) return null
  return {
    id,
    name,
    ownerId,
    public: typeof value.public === "boolean" ? value.public : null,
    collaborative: value.collaborative === true,
  }
}

function toSpotifyError(cause: unknown): SpotifyError {
  return cause instanceof SpotifyError
    ? cause
    : new SpotifyError(
        "temporary",
        "Spotify connection storage failed",
        undefined,
        { cause }
      )
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function readObject(
  response: Response
): Promise<Record<string, unknown>> {
  const value: unknown = await response.json().catch(() => null)
  if (!isObject(value))
    throw new SpotifyError("invalid_response", "Spotify returned invalid JSON")
  return value
}

function readPage(raw: Record<string, unknown>): {
  items: unknown[]
  next: string | null
  total: number
} {
  if (
    !Array.isArray(raw.items) ||
    (raw.next !== null && typeof raw.next !== "string") ||
    typeof raw.total !== "number"
  )
    throw new SpotifyError(
      "invalid_response",
      "Spotify returned an invalid page"
    )
  return { items: raw.items, next: raw.next, total: raw.total }
}

async function importEncryptionKey(encoded: string): Promise<CryptoKey> {
  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = new Uint8Array(
      Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
    )
  } catch {
    throw new SpotifyError("configuration", "Spotify encryption key is invalid")
  }
  if (bytes.length !== 32)
    throw new SpotifyError(
      "configuration",
      "Spotify encryption key must be 32 bytes"
    )
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ])
}

async function encryptToken(
  token: string,
  encodedKey: string
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await importEncryptionKey(encodedKey),
    new TextEncoder().encode(token)
  )
  return `${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...new Uint8Array(ciphertext)))}`
}

async function decryptToken(
  encrypted: string,
  encodedKey: string
): Promise<string> {
  const [encodedIv, encodedCiphertext] = encrypted.split(".")
  if (!encodedIv || !encodedCiphertext)
    throw new SpotifyError(
      "reconnect_needed",
      "Spotify credentials are invalid"
    )
  try {
    const iv = Uint8Array.from(atob(encodedIv), (character) =>
      character.charCodeAt(0)
    )
    const ciphertext = Uint8Array.from(atob(encodedCiphertext), (character) =>
      character.charCodeAt(0)
    )
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      await importEncryptionKey(encodedKey),
      ciphertext
    )
    return new TextDecoder().decode(plaintext)
  } catch (cause) {
    throw new SpotifyError(
      "reconnect_needed",
      "Spotify credentials cannot be read",
      undefined,
      { cause }
    )
  }
}
