import { Effect } from "effect"
import { beforeEach, describe, expect, test, vi } from "vitest"
import {
  createSpotifyModule,
  spotifyScopes,
  type SpotifyConnection,
  type SpotifyConnectionStore,
} from "./spotify"
import {
  createSpotifyOAuthState,
  verifySpotifyOAuthState,
} from "./spotify-oauth-state"

const encryptionKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))

function testSetup() {
  let connection: SpotifyConnection | null = null
  const store: SpotifyConnectionStore = {
    get: vi.fn<SpotifyConnectionStore["get"]>(async () => connection),
    save: vi.fn<SpotifyConnectionStore["save"]>(async (value) => {
      connection = value
    }),
    replaceRefreshToken: vi.fn<SpotifyConnectionStore["replaceRefreshToken"]>(
      async (_ownerId, previous, next) => {
        if (!connection || connection.encryptedRefreshToken !== previous)
          return false
        connection = { ...connection, encryptedRefreshToken: next }
        return true
      }
    ),
    markReconnect: vi.fn<SpotifyConnectionStore["markReconnect"]>(
      async (_ownerId, expected) => {
        if (connection?.encryptedRefreshToken === expected)
          connection = { ...connection, needsReconnect: true }
      }
    ),
    disconnect: vi.fn<SpotifyConnectionStore["disconnect"]>(async () => {
      connection = null
    }),
  }
  const fetcher = vi.fn<typeof fetch>()
  const spotify = createSpotifyModule({
    store,
    clientId: "client",
    clientSecret: "secret",
    redirectUri: "https://example.com/api/spotify/callback",
    encryptionKey,
    fetch: fetcher,
    now: () => 1_000,
  })
  return { store, fetcher, spotify, getConnection: () => connection }
}

function json(value: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(value, { status, headers })
}

async function connect(setup: ReturnType<typeof testSetup>) {
  setup.fetcher.mockResolvedValueOnce(
    json({
      access_token: "access-one",
      refresh_token: "refresh-one",
      scope: spotifyScopes.join(" "),
    })
  )
  setup.fetcher.mockResolvedValueOnce(
    json({
      account_id: "spotify-42",
      id: "spotify-user-42",
      display_name: "Music Owner",
    })
  )
  return Effect.runPromise(setup.spotify.connect("github-42", "code-123"))
}

beforeEach(() => vi.resetAllMocks())

describe("Spotify OAuth and connection", () => {
  test("binds callback state to its initiating app session and expires it", async () => {
    const state = await createSpotifyOAuthState("session-a", 1_000_000)
    expect(await verifySpotifyOAuthState(state, "session-a", 1_000_001)).toBe(
      true
    )
    expect(await verifySpotifyOAuthState(state, "session-b", 1_000_001)).toBe(
      false
    )
    expect(
      await verifySpotifyOAuthState(`${state}x`, "session-a", 1_000_001)
    ).toBe(false)
    expect(await verifySpotifyOAuthState(state, "session-a", 1_601_000)).toBe(
      false
    )
  })

  test("exchanges the code with exact scopes and stores only encrypted refresh credentials", async () => {
    const setup = testSetup()
    const result = await connect(setup)
    expect(result).toEqual({
      status: "connected",
      accountId: "spotify-42",
      displayName: "Music Owner",
    })
    const authorize = setup.fetcher.mock.calls[0]
    expect(authorize?.[0]).toBe("https://accounts.spotify.com/api/token")
    expect(String(authorize?.[1]?.body)).toContain(
      "grant_type=authorization_code"
    )
    expect(String(authorize?.[1]?.body)).toContain(
      "redirect_uri=https%3A%2F%2Fexample.com%2Fapi%2Fspotify%2Fcallback"
    )
    expect(setup.getConnection()?.encryptedRefreshToken).not.toContain(
      "refresh-one"
    )
    expect(setup.getConnection()?.needsReconnect).toBe(false)
  })

  test("refreshes after reconnect-free storage reload and keeps a rotated token", async () => {
    const setup = testSetup()
    await connect(setup)
    setup.fetcher.mockResolvedValueOnce(
      json({ access_token: "access-two", refresh_token: "refresh-two" })
    )
    setup.fetcher.mockResolvedValueOnce(
      json({ items: [], next: null, total: 0 })
    )
    await Effect.runPromise(setup.spotify.playlists("github-42"))
    expect(setup.store.replaceRefreshToken).toHaveBeenCalledOnce()
    expect(setup.getConnection()?.encryptedRefreshToken).not.toContain(
      "refresh-two"
    )
    setup.fetcher.mockResolvedValueOnce(json({ access_token: "access-three" }))
    setup.fetcher.mockResolvedValueOnce(
      json({ items: [], next: null, total: 0 })
    )
    await Effect.runPromise(setup.spotify.playlists("github-42"))
    const refreshRequest = setup.fetcher.mock.calls[4]
    expect(String(refreshRequest?.[1]?.body)).toContain(
      "refresh_token=refresh-two"
    )
  })

  test("marks revoked authorization as reconnect needed", async () => {
    const setup = testSetup()
    await connect(setup)
    setup.fetcher.mockResolvedValueOnce(json({ error: "invalid_grant" }, 400))
    const status = await Effect.runPromise(setup.spotify.status("github-42"))
    expect(status.status).toBe("reconnect_needed")
    expect(setup.getConnection()?.needsReconnect).toBe(true)
  })

  test("keeps a newer connection when a stale refresh is revoked", async () => {
    const setup = testSetup()
    await connect(setup)
    const stale = setup.getConnection()!
    setup.fetcher.mockImplementationOnce(async () => {
      await setup.store.save({
        ...stale,
        encryptedRefreshToken: "newer-connection-token",
      })
      return json({ error: "invalid_grant" }, 400)
    })
    const status = await Effect.runPromise(setup.spotify.status("github-42"))
    expect(status.status).toBe("reconnect_needed")
    expect(setup.getConnection()?.needsReconnect).toBe(false)
  })

  test("rejects missing required scopes and a different account on reconnect", async () => {
    const setup = testSetup()
    setup.fetcher.mockResolvedValueOnce(
      json({
        access_token: "a",
        refresh_token: "r",
        scope: "user-library-read",
      })
    )
    await expect(
      Effect.runPromise(setup.spotify.connect("github-42", "code"))
    ).rejects.toMatchObject({ code: "authorization" })
    await connect(setup)
    setup.fetcher.mockResolvedValueOnce(
      json({
        access_token: "a",
        refresh_token: "r",
        scope: spotifyScopes.join(" "),
      })
    )
    setup.fetcher.mockResolvedValueOnce(
      json({ account_id: "someone-else", id: "someone-else" })
    )
    await expect(
      Effect.runPromise(setup.spotify.connect("github-42", "code"))
    ).rejects.toMatchObject({ code: "authorization" })
  })

  test("disconnect removes credentials without touching the app session", async () => {
    const setup = testSetup()
    await connect(setup)
    await Effect.runPromise(setup.spotify.disconnect("github-42"))
    expect(setup.getConnection()).toBeNull()
    expect(setup.store.disconnect).toHaveBeenCalledWith("github-42")
  })
})

describe("Spotify reads", () => {
  test("validates playlist ownership before use as a destination", async () => {
    const setup = testSetup()
    await connect(setup)
    setup.fetcher.mockResolvedValueOnce(json({ access_token: "fresh" }))
    setup.fetcher.mockResolvedValueOnce(
      json({
        id: "abc123",
        name: "My list",
        public: false,
        collaborative: false,
        owner: { id: "spotify-user-42" },
      })
    )
    expect(
      await Effect.runPromise(setup.spotify.playlist("github-42", "abc123"))
    ).toMatchObject({ id: "abc123", ownerId: "spotify-user-42" })
    setup.fetcher.mockResolvedValueOnce(json({ access_token: "fresh" }))
    setup.fetcher.mockResolvedValueOnce(
      json({
        id: "abc123",
        name: "Followed",
        public: true,
        collaborative: false,
        owner: { id: "other-user" },
      })
    )
    await expect(
      Effect.runPromise(setup.spotify.playlist("github-42", "abc123"))
    ).rejects.toMatchObject({ code: "authorization" })
  })

  test("creates a private playlist and verifies Spotify returned it private and owner-owned", async () => {
    const setup = testSetup()
    await connect(setup)
    setup.fetcher.mockResolvedValueOnce(json({ access_token: "fresh" }))
    setup.fetcher.mockResolvedValueOnce(
      json(
        {
          id: "new123",
          name: "New list",
          public: false,
          collaborative: false,
          owner: { id: "spotify-user-42" },
        },
        201
      )
    )
    const playlist = await Effect.runPromise(
      setup.spotify.createPrivatePlaylist("github-42", " New list ")
    )
    expect(playlist.public).toBe(false)
    const createCall = setup.fetcher.mock.calls[3]
    expect(createCall?.[0]).toBe("https://api.spotify.com/v1/me/playlists")
    expect(createCall?.[1]?.method).toBe("POST")
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      name: "New list",
      public: false,
    })
  })

  test("follows playlist pagination and maps only useful fields", async () => {
    const setup = testSetup()
    await connect(setup)
    setup.fetcher.mockResolvedValueOnce(json({ access_token: "fresh" }))
    setup.fetcher.mockResolvedValueOnce(
      json({
        items: [
          {
            id: "one",
            name: "Jazz",
            public: false,
            collaborative: false,
            owner: { id: "spotify-42" },
          },
        ],
        next: "https://api.spotify.com/v1/me/playlists?offset=1&limit=50",
        total: 2,
      })
    )
    setup.fetcher.mockResolvedValueOnce(
      json({
        items: [
          {
            id: "two",
            name: "Rock",
            public: true,
            collaborative: false,
            owner: { id: "spotify-42" },
          },
        ],
        next: null,
        total: 2,
      })
    )
    expect(
      await Effect.runPromise(setup.spotify.playlists("github-42"))
    ).toMatchObject([{ id: "one" }, { id: "two" }])
  })

  test("reads a bounded Liked Songs page and its next cursor", async () => {
    const setup = testSetup()
    await connect(setup)
    setup.fetcher.mockResolvedValueOnce(json({ access_token: "fresh" }))
    setup.fetcher.mockResolvedValueOnce(
      json({
        items: [
          {
            added_at: "2026-01-01T00:00:00Z",
            track: {
              id: "track-1",
              name: "Song",
              artists: [{ name: "Artist" }],
              external_ids: { isrc: "BEABC2600001" },
              duration_ms: 234567,
            },
          },
        ],
        next: "https://api.spotify.com/v1/me/tracks?offset=50&limit=50",
        total: 51,
      })
    )
    const page = await Effect.runPromise(
      setup.spotify.savedTracksPage("github-42")
    )
    expect(page).toEqual({
      items: [
        {
          id: "track-1",
          name: "Song",
          artistNames: ["Artist"],
          isrc: "BEABC2600001",
          durationMs: 234567,
          addedAt: "2026-01-01T00:00:00Z",
        },
      ],
      next: "https://api.spotify.com/v1/me/tracks?offset=50&limit=50",
      total: 51,
    })
  })

  test("translates rate limits and rejects foreign pagination URLs", async () => {
    const setup = testSetup()
    await connect(setup)
    setup.fetcher.mockResolvedValueOnce(json({ access_token: "fresh" }))
    setup.fetcher.mockResolvedValueOnce(
      json({ error: "rate" }, 429, { "Retry-After": "7" })
    )
    await expect(
      Effect.runPromise(setup.spotify.playlists("github-42"))
    ).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: 7 })
    await expect(
      Effect.runPromise(
        setup.spotify.savedTracksPage(
          "github-42",
          "https://attacker.example/steal"
        )
      )
    ).rejects.toMatchObject({ code: "invalid_response" })
  })
})

describe("Spotify playlist delivery boundary", () => {
  test("reuses a bounded access token while checking durable connection state each time", async () => {
    const setup = testSetup()
    await connect(setup)
    setup.fetcher.mockResolvedValueOnce(
      json({ access_token: "fresh", expires_in: 3600 })
    )
    setup.fetcher.mockResolvedValueOnce(json([true]))
    expect(
      await Effect.runPromise(
        setup.spotify.isTrackLiked("github-42", "track123")
      )
    ).toBe(true)
    setup.fetcher.mockResolvedValueOnce(json([false]))
    expect(
      await Effect.runPromise(
        setup.spotify.isTrackLiked("github-42", "track456")
      )
    ).toBe(false)
    expect(
      setup.fetcher.mock.calls.filter(
        (call) => call[0] === "https://accounts.spotify.com/api/token"
      )
    ).toHaveLength(2)
    expect(setup.store.get).toHaveBeenCalledTimes(3)

    await Effect.runPromise(setup.spotify.disconnect("github-42"))
    await expect(
      Effect.runPromise(setup.spotify.isTrackLiked("github-42", "track123"))
    ).rejects.toMatchObject({ code: "not_connected" })
    expect(setup.fetcher).toHaveBeenCalledTimes(5)

    await connect(setup)
    setup.fetcher.mockResolvedValueOnce(
      json({ access_token: "new", expires_in: 3600 })
    )
    setup.fetcher.mockResolvedValueOnce(json([true]))
    expect(
      await Effect.runPromise(
        setup.spotify.isTrackLiked("github-42", "track123")
      )
    ).toBe(true)
    expect(
      setup.fetcher.mock.calls.filter(
        (call) => call[0] === "https://accounts.spotify.com/api/token"
      )
    ).toHaveLength(4)
  })

  test("status verifies refresh authorization even while an access token is cached", async () => {
    const setup = testSetup()
    await connect(setup)
    setup.fetcher.mockResolvedValueOnce(
      json({ access_token: "fresh", expires_in: 3600 })
    )
    setup.fetcher.mockResolvedValueOnce(json([true]))
    await Effect.runPromise(setup.spotify.isTrackLiked("github-42", "track123"))
    setup.fetcher.mockResolvedValueOnce(json({ error: "invalid_grant" }, 400))
    expect(
      await Effect.runPromise(setup.spotify.status("github-42"))
    ).toMatchObject({ status: "reconnect_needed" })
    expect(setup.getConnection()?.needsReconnect).toBe(true)
  })

  test("checks current library membership using the 2026 library endpoint", async () => {
    const setup = testSetup()
    await connect(setup)
    setup.fetcher.mockResolvedValueOnce(json({ access_token: "fresh" }))
    setup.fetcher.mockResolvedValueOnce(json([true]))
    expect(
      await Effect.runPromise(
        setup.spotify.isTrackLiked("github-42", "track123")
      )
    ).toBe(true)
    const request = setup.fetcher.mock.calls[3]
    const url = new URL(String(request?.[0]))
    expect(url.pathname).toBe("/v1/me/library/contains")
    expect(url.searchParams.get("uris")).toBe("spotify:track:track123")
  })

  test("searches every playlist page by exact track ID and uses /items", async () => {
    const setup = testSetup()
    await connect(setup)
    setup.fetcher.mockResolvedValueOnce(json({ access_token: "fresh" }))
    setup.fetcher.mockResolvedValueOnce(
      json({
        items: [
          { item: { id: "remaster456", type: "track", name: "Same Song" } },
        ],
        next: "https://api.spotify.com/v1/playlists/list123/items?limit=50&offset=50",
        total: 51,
      })
    )
    setup.fetcher.mockResolvedValueOnce(
      json({
        items: [{ item: { id: "track123", type: "track", name: "Same Song" } }],
        next: null,
        total: 51,
      })
    )
    expect(
      await Effect.runPromise(
        setup.spotify.isTrackInPlaylist("github-42", "list123", "track123")
      )
    ).toBe(true)
    expect(setup.fetcher.mock.calls[3]?.[0]).toBe(
      "https://api.spotify.com/v1/playlists/list123/items?limit=50"
    )
    expect(setup.fetcher.mock.calls[4]?.[0]).toBe(
      "https://api.spotify.com/v1/playlists/list123/items?limit=50&offset=50"
    )
  })

  test("returns absent after scanning all pages and accepts older track field", async () => {
    const setup = testSetup()
    await connect(setup)
    setup.fetcher.mockResolvedValueOnce(json({ access_token: "fresh" }))
    setup.fetcher.mockResolvedValueOnce(
      json({
        items: [{ track: { id: "other123", type: "track" } }],
        next: null,
        total: 1,
      })
    )
    expect(
      await Effect.runPromise(
        setup.spotify.isTrackInPlaylist("github-42", "list123", "track123")
      )
    ).toBe(false)
  })

  test("adds one exact track URI through the 2026 /items endpoint", async () => {
    const setup = testSetup()
    await connect(setup)
    setup.fetcher.mockResolvedValueOnce(json({ access_token: "fresh" }))
    setup.fetcher.mockResolvedValueOnce(
      json({ snapshot_id: "snapshot123" }, 201)
    )
    await Effect.runPromise(
      setup.spotify.addTrackToPlaylist("github-42", "list123", "track123")
    )
    const request = setup.fetcher.mock.calls[3]
    expect(request?.[0]).toBe(
      "https://api.spotify.com/v1/playlists/list123/items"
    )
    expect(request?.[1]?.method).toBe("POST")
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({
      uris: ["spotify:track:track123"],
    })
    expect(setup.fetcher).toHaveBeenCalledTimes(4)
  })

  test("translates an uncertain write for workflow reconciliation and rate limits", async () => {
    const setup = testSetup()
    await connect(setup)
    setup.fetcher.mockResolvedValueOnce(json({ access_token: "fresh" }))
    setup.fetcher.mockRejectedValueOnce(
      new Error("connection reset after remote commit")
    )
    await expect(
      Effect.runPromise(
        setup.spotify.addTrackToPlaylist("github-42", "list123", "track123")
      )
    ).rejects.toMatchObject({ code: "temporary" })
    setup.fetcher.mockResolvedValueOnce(json({ access_token: "fresh" }))
    setup.fetcher.mockResolvedValueOnce(
      json({ error: "rate" }, 429, { "Retry-After": "5" })
    )
    await expect(
      Effect.runPromise(
        setup.spotify.isTrackInPlaylist("github-42", "list123", "track123")
      )
    ).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: 5 })
  })

  test("rejects invalid IDs before any Spotify request", async () => {
    const setup = testSetup()
    await connect(setup)
    await expect(
      Effect.runPromise(
        setup.spotify.addTrackToPlaylist("github-42", "list/123", "track123")
      )
    ).rejects.toMatchObject({ code: "invalid_response" })
    expect(setup.fetcher).toHaveBeenCalledTimes(2)
  })
})

test("relinked replacement B preserves original A for discovery, library checks, membership, and writes", async () => {
  const setup = testSetup()
  await connect(setup)
  setup.fetcher.mockResolvedValueOnce(
    json({ access_token: "fresh", expires_in: 3600 })
  )
  const relinked = {
    id: "B",
    type: "track",
    name: "Song",
    artists: [],
    linked_from: { id: "A", type: "track" },
  }
  setup.fetcher.mockResolvedValueOnce(
    json({
      items: [{ added_at: "2026-10-03T00:00:00Z", track: relinked }],
      next: null,
      total: 1,
    })
  )
  const page = await Effect.runPromise(
    setup.spotify.savedTracksPage("github-42")
  )
  expect(page.items[0]!.id).toBe("A")
  setup.fetcher.mockResolvedValueOnce(json([true]))
  expect(
    await Effect.runPromise(
      setup.spotify.isTrackLiked("github-42", page.items[0]!.id)
    )
  ).toBe(true)
  expect(String(setup.fetcher.mock.calls.at(-1)![0])).toContain(
    "uris=spotify%3Atrack%3AA"
  )
  for (const field of ["item", "track"]) {
    setup.fetcher.mockResolvedValueOnce(
      json({ items: [{ [field]: relinked }], next: null, total: 1 })
    )
    expect(
      await Effect.runPromise(
        setup.spotify.isTrackInPlaylist("github-42", "list123", "A")
      )
    ).toBe(true)
    setup.fetcher.mockResolvedValueOnce(
      json({ items: [{ [field]: relinked }], next: null, total: 1 })
    )
    expect(
      await Effect.runPromise(
        setup.spotify.isTrackInPlaylist("github-42", "list123", "B")
      )
    ).toBe(false)
  }
  setup.fetcher.mockResolvedValueOnce(json({ snapshot_id: "snapshot" }))
  await Effect.runPromise(
    setup.spotify.addTrackToPlaylist("github-42", "list123", page.items[0]!.id)
  )
  expect(JSON.parse(String(setup.fetcher.mock.calls.at(-1)![1]!.body))).toEqual(
    { uris: ["spotify:track:A"] }
  )
})
