import { assert, describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Effect, Layer, Option, Redacted } from "effect"
import { FetchHttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { vi } from "vitest"
import { TokenCipher } from "@/backend/primitives/token-cipher"
import {
  createSpotifyOAuthState,
  Spotify,
  type SpotifyConnection,
  SpotifyConnections,
  spotifyScopes,
  verifySpotifyOAuthState,
} from "."

const encryptionKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))

type Store = SpotifyConnections["Service"]

/** An in-memory connection row, a mocked `fetch`, and the Spotify layer wired to both. */
function testSetup() {
  let connection: SpotifyConnection | null = null
  const store = {
    get: vi.fn<Store["get"]>((_ownerId: string) =>
      Effect.sync(() => Option.fromNullishOr(connection))
    ),
    save: vi.fn<Store["save"]>((value: SpotifyConnection) =>
      Effect.sync(() => {
        connection = value
      })
    ),
    replaceRefreshToken: vi.fn<Store["replaceRefreshToken"]>(
      (_ownerId: string, previous: string, next: string) =>
        Effect.sync(() => {
          if (connection?.encryptedRefreshToken !== previous) return false
          connection = { ...connection, encryptedRefreshToken: next }
          return true
        })
    ),
    markReconnect: vi.fn<Store["markReconnect"]>(
      (_ownerId: string, expected: string) =>
        Effect.sync(() => {
          if (connection?.encryptedRefreshToken === expected)
            connection = { ...connection, needsReconnect: true }
        })
    ),
    disconnect: vi.fn<Store["disconnect"]>((_ownerId: string) =>
      Effect.sync(() => {
        connection = null
      })
    ),
  }
  const fetcher = vi.fn<typeof fetch>()
  const layer = Spotify.layerNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(SpotifyConnections, SpotifyConnections.of(store)),
        TokenCipher.layer(Redacted.make(encryptionKey)),
        FetchHttpClient.layer
      )
    ),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          SPOTIFY_CLIENT_ID: "client",
          SPOTIFY_CLIENT_SECRET: "secret",
          SPOTIFY_REDIRECT_URI: "https://example.com/api/spotify/callback",
        })
      )
    )
  )
  return {
    store,
    fetcher,
    getConnection: () => connection,
    setConnection: (value: SpotifyConnection) => {
      connection = value
    },
    /** Runs a test body with one Spotify instance, so its token cache spans the whole test. */
    run: <A, E>(body: Effect.Effect<A, E, Spotify>) =>
      body.pipe(
        Effect.provide(layer),
        Effect.provideService(FetchHttpClient.Fetch, fetcher)
      ),
  }
}

type Setup = ReturnType<typeof testSetup>

function json(value: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(value, { status, headers })
}

function requestUrl(setup: Setup, index: number) {
  return String(setup.fetcher.mock.calls.at(index)?.[0])
}

function requestBody(setup: Setup, index: number) {
  const body = setup.fetcher.mock.calls.at(index)?.[1]?.body
  return body instanceof Uint8Array
    ? new TextDecoder().decode(body)
    : String(body)
}

const tokenCalls = (setup: Setup) =>
  setup.fetcher.mock.calls.filter(
    (call) => String(call[0]) === "https://accounts.spotify.com/api/token"
  )

const connect = (setup: Setup) =>
  Effect.gen(function* () {
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
    const spotify = yield* Spotify
    return yield* spotify.connect("github-42", "code-123")
  })

type SpotifyService = Spotify["Service"]

const isLiked = (spotify: SpotifyService, trackId: string) =>
  Effect.map(spotify.likedTracks("github-42", [trackId]), (liked) =>
    liked.has(trackId)
  )

const inPlaylist = (
  spotify: SpotifyService,
  playlistId: string,
  trackId: string
) =>
  Effect.map(spotify.playlistTrackIds("github-42", playlistId), (ids) =>
    ids.has(trackId)
  )

/** Runs an effect expected to fail and returns the Spotify error reason tag. */
const failureReason = <A>(
  effect: Effect.Effect<A, { readonly reason: { readonly _tag: string } }>
) => Effect.map(Effect.flip(effect), (error) => error.reason)

describe("Spotify OAuth and connection", () => {
  it.effect(
    "binds callback state to its initiating app session and expires it",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(1_000_000)
        const state = yield* createSpotifyOAuthState("session-a")
        yield* TestClock.adjust(1)
        assert.isTrue(yield* verifySpotifyOAuthState(state, "session-a"))
        assert.isFalse(yield* verifySpotifyOAuthState(state, "session-b"))
        assert.isFalse(yield* verifySpotifyOAuthState(`${state}x`, "session-a"))
        yield* TestClock.setTime(1_601_000)
        assert.isFalse(yield* verifySpotifyOAuthState(state, "session-a"))
      })
  )

  it.effect(
    "exchanges the code with exact scopes and stores only encrypted refresh credentials",
    () => {
      const setup = testSetup()
      return setup.run(
        Effect.gen(function* () {
          const result = yield* connect(setup)
          assert.deepStrictEqual(result, {
            status: "connected",
            accountId: "spotify-42",
            displayName: "Music Owner",
          })
          expect(requestUrl(setup, 0)).toBe(
            "https://accounts.spotify.com/api/token"
          )
          expect(requestBody(setup, 0)).toContain(
            "grant_type=authorization_code"
          )
          expect(requestBody(setup, 0)).toContain(
            "redirect_uri=https%3A%2F%2Fexample.com%2Fapi%2Fspotify%2Fcallback"
          )
          expect(setup.getConnection()?.encryptedRefreshToken).not.toContain(
            "refresh-one"
          )
          expect(setup.getConnection()?.needsReconnect).toBe(false)
        })
      )
    }
  )

  it.effect(
    "refreshes after reconnect-free storage reload and keeps a rotated token",
    () => {
      const setup = testSetup()
      return setup.run(
        Effect.gen(function* () {
          const spotify = yield* Spotify
          yield* connect(setup)
          setup.fetcher.mockResolvedValueOnce(
            json({ access_token: "access-two", refresh_token: "refresh-two" })
          )
          setup.fetcher.mockResolvedValueOnce(
            json({ items: [], next: null, total: 0 })
          )
          yield* spotify.playlists("github-42")
          expect(setup.store.replaceRefreshToken).toHaveBeenCalledOnce()
          expect(setup.getConnection()?.encryptedRefreshToken).not.toContain(
            "refresh-two"
          )
          setup.fetcher.mockResolvedValueOnce(
            json({ access_token: "access-three" })
          )
          setup.fetcher.mockResolvedValueOnce(
            json({ items: [], next: null, total: 0 })
          )
          yield* spotify.playlists("github-42")
          expect(requestBody(setup, 4)).toContain("refresh_token=refresh-two")
        })
      )
    }
  )

  it.effect("marks revoked authorization as reconnect needed", () => {
    const setup = testSetup()
    return setup.run(
      Effect.gen(function* () {
        const spotify = yield* Spotify
        yield* connect(setup)
        setup.fetcher.mockResolvedValueOnce(
          json({ error: "invalid_grant" }, 400)
        )
        const status = yield* spotify.status("github-42")
        assert.strictEqual(status.status, "reconnect_needed")
        assert.isTrue(setup.getConnection()?.needsReconnect)
      })
    )
  })

  it.effect("keeps a newer connection when a stale refresh is revoked", () => {
    const setup = testSetup()
    return setup.run(
      Effect.gen(function* () {
        const spotify = yield* Spotify
        yield* connect(setup)
        const stale = setup.getConnection()!
        setup.fetcher.mockImplementationOnce(async () => {
          setup.setConnection({
            ...stale,
            encryptedRefreshToken: "newer-connection-token",
          })
          return json({ error: "invalid_grant" }, 400)
        })
        const status = yield* spotify.status("github-42")
        assert.strictEqual(status.status, "reconnect_needed")
        assert.isFalse(setup.getConnection()?.needsReconnect)
      })
    )
  })

  it.effect(
    "rejects missing required scopes and a different account on reconnect",
    () => {
      const setup = testSetup()
      return setup.run(
        Effect.gen(function* () {
          const spotify = yield* Spotify
          setup.fetcher.mockResolvedValueOnce(
            json({
              access_token: "a",
              refresh_token: "r",
              scope: "user-library-read",
            })
          )
          const missingScopes = yield* failureReason(
            spotify.connect("github-42", "code")
          )
          assert.strictEqual(missingScopes._tag, "AccessDenied")
          yield* connect(setup)
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
          const otherAccount = yield* failureReason(
            spotify.connect("github-42", "code")
          )
          assert.strictEqual(otherAccount._tag, "AccessDenied")
        })
      )
    }
  )

  it.effect(
    "disconnect removes credentials without touching the app session",
    () => {
      const setup = testSetup()
      return setup.run(
        Effect.gen(function* () {
          const spotify = yield* Spotify
          yield* connect(setup)
          yield* spotify.disconnect("github-42")
          assert.isNull(setup.getConnection())
          expect(setup.store.disconnect).toHaveBeenCalledWith("github-42")
        })
      )
    }
  )
})

describe("Spotify reads", () => {
  it.effect("validates playlist ownership before use as a destination", () => {
    const setup = testSetup()
    return setup.run(
      Effect.gen(function* () {
        const spotify = yield* Spotify
        yield* connect(setup)
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
        expect(yield* spotify.playlist("github-42", "abc123")).toMatchObject({
          id: "abc123",
          ownerId: "spotify-user-42",
        })
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
        const reason = yield* failureReason(
          spotify.playlist("github-42", "abc123")
        )
        assert.strictEqual(reason._tag, "AccessDenied")
      })
    )
  })

  it.effect(
    "creates a private playlist and verifies Spotify returned it private and owner-owned",
    () => {
      const setup = testSetup()
      return setup.run(
        Effect.gen(function* () {
          const spotify = yield* Spotify
          yield* connect(setup)
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
          const playlist = yield* spotify.createPrivatePlaylist(
            "github-42",
            " New list "
          )
          assert.isFalse(playlist.public)
          expect(requestUrl(setup, 3)).toBe(
            "https://api.spotify.com/v1/me/playlists"
          )
          expect(setup.fetcher.mock.calls[3]?.[1]?.method).toBe("POST")
          expect(JSON.parse(requestBody(setup, 3))).toEqual({
            name: "New list",
            public: false,
          })
        })
      )
    }
  )

  it.effect("follows playlist pagination and maps only useful fields", () => {
    const setup = testSetup()
    return setup.run(
      Effect.gen(function* () {
        const spotify = yield* Spotify
        yield* connect(setup)
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
        expect(yield* spotify.playlists("github-42")).toMatchObject([
          { id: "one" },
          { id: "two" },
        ])
      })
    )
  })

  it.effect("reads a bounded Liked Songs page and its next cursor", () => {
    const setup = testSetup()
    return setup.run(
      Effect.gen(function* () {
        const spotify = yield* Spotify
        yield* connect(setup)
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
        assert.deepStrictEqual(yield* spotify.savedTracksPage("github-42"), {
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
    )
  })

  it.effect(
    "translates rate limits and rejects foreign pagination URLs",
    () => {
      const setup = testSetup()
      return setup.run(
        Effect.gen(function* () {
          const spotify = yield* Spotify
          yield* connect(setup)
          setup.fetcher.mockResolvedValueOnce(json({ access_token: "fresh" }))
          setup.fetcher.mockResolvedValueOnce(
            json({ error: "rate" }, 429, { "Retry-After": "7" })
          )
          expect(
            yield* failureReason(spotify.playlists("github-42"))
          ).toMatchObject({ _tag: "RateLimited", retryAfterSeconds: 7 })
          const foreign = yield* failureReason(
            spotify.savedTracksPage(
              "github-42",
              "https://attacker.example/steal"
            )
          )
          assert.strictEqual(foreign._tag, "InvalidInput")
        })
      )
    }
  )
})

describe("Spotify playlist delivery boundary", () => {
  it.effect(
    "reuses a bounded access token while checking durable connection state each time",
    () => {
      const setup = testSetup()
      return setup.run(
        Effect.gen(function* () {
          const spotify = yield* Spotify
          yield* connect(setup)
          setup.fetcher.mockResolvedValueOnce(
            json({ access_token: "fresh", expires_in: 3600 })
          )
          setup.fetcher.mockResolvedValueOnce(json([true]))
          assert.isTrue(yield* isLiked(spotify, "track123"))
          setup.fetcher.mockResolvedValueOnce(json([false]))
          assert.isFalse(yield* isLiked(spotify, "track456"))
          expect(tokenCalls(setup)).toHaveLength(2)
          expect(setup.store.get).toHaveBeenCalledTimes(3)

          yield* spotify.disconnect("github-42")
          const reason = yield* failureReason(isLiked(spotify, "track123"))
          assert.strictEqual(reason._tag, "NotConnected")
          expect(setup.fetcher).toHaveBeenCalledTimes(5)

          yield* connect(setup)
          setup.fetcher.mockResolvedValueOnce(
            json({ access_token: "new", expires_in: 3600 })
          )
          setup.fetcher.mockResolvedValueOnce(json([true]))
          assert.isTrue(yield* isLiked(spotify, "track123"))
          expect(tokenCalls(setup)).toHaveLength(4)
        })
      )
    }
  )

  it.effect(
    "status verifies refresh authorization even while an access token is cached",
    () => {
      const setup = testSetup()
      return setup.run(
        Effect.gen(function* () {
          const spotify = yield* Spotify
          yield* connect(setup)
          setup.fetcher.mockResolvedValueOnce(
            json({ access_token: "fresh", expires_in: 3600 })
          )
          setup.fetcher.mockResolvedValueOnce(json([true]))
          yield* isLiked(spotify, "track123")
          setup.fetcher.mockResolvedValueOnce(
            json({ error: "invalid_grant" }, 400)
          )
          expect(yield* spotify.status("github-42")).toMatchObject({
            status: "reconnect_needed",
          })
          assert.isTrue(setup.getConnection()?.needsReconnect)
        })
      )
    }
  )

  it.effect(
    "checks current library membership using the 2026 library endpoint",
    () => {
      const setup = testSetup()
      return setup.run(
        Effect.gen(function* () {
          const spotify = yield* Spotify
          yield* connect(setup)
          setup.fetcher.mockResolvedValueOnce(json({ access_token: "fresh" }))
          setup.fetcher.mockResolvedValueOnce(json([true]))
          assert.isTrue(yield* isLiked(spotify, "track123"))
          const url = new URL(requestUrl(setup, 3))
          assert.strictEqual(url.pathname, "/v1/me/library/contains")
          assert.strictEqual(
            url.searchParams.get("uris"),
            "spotify:track:track123"
          )
        })
      )
    }
  )

  it.effect(
    "searches every playlist page by exact track ID and uses /items",
    () => {
      const setup = testSetup()
      return setup.run(
        Effect.gen(function* () {
          const spotify = yield* Spotify
          yield* connect(setup)
          setup.fetcher.mockResolvedValueOnce(json({ access_token: "fresh" }))
          setup.fetcher.mockResolvedValueOnce(
            json({
              items: [
                {
                  item: { id: "remaster456", type: "track", name: "Same Song" },
                },
              ],
              next: "https://api.spotify.com/v1/playlists/list123/items?limit=50&offset=50",
              total: 51,
            })
          )
          setup.fetcher.mockResolvedValueOnce(
            json({
              items: [
                { item: { id: "track123", type: "track", name: "Same Song" } },
              ],
              next: null,
              total: 51,
            })
          )
          assert.isTrue(yield* inPlaylist(spotify, "list123", "track123"))
          expect(requestUrl(setup, 3)).toBe(
            "https://api.spotify.com/v1/playlists/list123/items?limit=50"
          )
          expect(requestUrl(setup, 4)).toBe(
            "https://api.spotify.com/v1/playlists/list123/items?limit=50&offset=50"
          )
        })
      )
    }
  )

  it.effect(
    "returns absent after scanning all pages and accepts older track field",
    () => {
      const setup = testSetup()
      return setup.run(
        Effect.gen(function* () {
          const spotify = yield* Spotify
          yield* connect(setup)
          setup.fetcher.mockResolvedValueOnce(json({ access_token: "fresh" }))
          setup.fetcher.mockResolvedValueOnce(
            json({
              items: [{ track: { id: "other123", type: "track" } }],
              next: null,
              total: 1,
            })
          )
          assert.isFalse(yield* inPlaylist(spotify, "list123", "track123"))
        })
      )
    }
  )

  it.effect("falls back to the older track field when item is null", () => {
    const setup = testSetup()
    return setup.run(
      Effect.gen(function* () {
        const spotify = yield* Spotify
        yield* connect(setup)
        setup.fetcher.mockResolvedValueOnce(json({ access_token: "fresh" }))
        setup.fetcher.mockResolvedValueOnce(
          json({
            items: [{ item: null, track: { id: "track123", type: "track" } }],
            next: null,
            total: 1,
          })
        )
        assert.isTrue(yield* inPlaylist(spotify, "list123", "track123"))
      })
    )
  })

  it.effect("adds one exact track URI through the 2026 /items endpoint", () => {
    const setup = testSetup()
    return setup.run(
      Effect.gen(function* () {
        const spotify = yield* Spotify
        yield* connect(setup)
        setup.fetcher.mockResolvedValueOnce(json({ access_token: "fresh" }))
        setup.fetcher.mockResolvedValueOnce(
          json({ snapshot_id: "snapshot123" }, 201)
        )
        yield* spotify.addTracksToPlaylist("github-42", "list123", ["track123"])
        expect(requestUrl(setup, 3)).toBe(
          "https://api.spotify.com/v1/playlists/list123/items"
        )
        expect(setup.fetcher.mock.calls[3]?.[1]?.method).toBe("POST")
        expect(JSON.parse(requestBody(setup, 3))).toEqual({
          uris: ["spotify:track:track123"],
        })
        expect(setup.fetcher).toHaveBeenCalledTimes(4)
      })
    )
  })

  it.effect(
    "translates an uncertain write for workflow reconciliation and rate limits",
    () => {
      const setup = testSetup()
      return setup.run(
        Effect.gen(function* () {
          const spotify = yield* Spotify
          yield* connect(setup)
          setup.fetcher.mockResolvedValueOnce(json({ access_token: "fresh" }))
          setup.fetcher.mockRejectedValueOnce(
            new Error("connection reset after remote commit")
          )
          const uncertain = yield* failureReason(
            spotify.addTracksToPlaylist("github-42", "list123", ["track123"])
          )
          assert.strictEqual(uncertain._tag, "Unavailable")
          setup.fetcher.mockResolvedValueOnce(json({ access_token: "fresh" }))
          setup.fetcher.mockResolvedValueOnce(
            json({ error: "rate" }, 429, { "Retry-After": "5" })
          )
          expect(
            yield* failureReason(inPlaylist(spotify, "list123", "track123"))
          ).toMatchObject({ _tag: "RateLimited", retryAfterSeconds: 5 })
        })
      )
    }
  )

  it.effect("checks likes 40 at a time and adds tracks 100 at a time", () => {
    const setup = testSetup()
    const ids = Array.from({ length: 150 }, (_, index) => `t${index}`)
    return setup.run(
      Effect.gen(function* () {
        const spotify = yield* Spotify
        yield* connect(setup)
        setup.fetcher.mockResolvedValueOnce(json({ access_token: "fresh" }))
        setup.fetcher.mockResolvedValueOnce(
          json(Array.from({ length: 40 }, (_, index) => index % 2 === 0))
        )
        setup.fetcher.mockResolvedValueOnce(
          json([true, false, true, false, true])
        )
        const liked = yield* spotify.likedTracks("github-42", ids.slice(0, 45))
        assert.strictEqual(liked.size, 23)
        assert.isTrue(liked.has("t44"))
        assert.isFalse(liked.has("t43"))
        expect(
          new URL(requestUrl(setup, 3)).searchParams.get("uris")?.split(",")
        ).toHaveLength(40)

        setup.fetcher.mockResolvedValueOnce(json({ access_token: "fresh" }))
        setup.fetcher.mockResolvedValueOnce(json({ snapshot_id: "a" }, 201))
        setup.fetcher.mockResolvedValueOnce(json({ snapshot_id: "b" }, 201))
        yield* spotify.addTracksToPlaylist("github-42", "list123", ids)
        expect(JSON.parse(requestBody(setup, -2)).uris).toHaveLength(100)
        expect(JSON.parse(requestBody(setup, -1)).uris).toHaveLength(50)
      })
    )
  })

  it.effect("rejects a liked-check answer of the wrong length", () => {
    const setup = testSetup()
    return setup.run(
      Effect.gen(function* () {
        const spotify = yield* Spotify
        yield* connect(setup)
        setup.fetcher.mockResolvedValueOnce(json({ access_token: "fresh" }))
        setup.fetcher.mockResolvedValueOnce(json([true]))
        const reason = yield* failureReason(
          spotify.likedTracks("github-42", ["a", "b"])
        )
        assert.strictEqual(reason._tag, "InvalidResponse")
      })
    )
  })

  it.effect("a 403 refuses that request without asking to reconnect", () => {
    const setup = testSetup()
    return setup.run(
      Effect.gen(function* () {
        const spotify = yield* Spotify
        yield* connect(setup)
        setup.fetcher.mockResolvedValueOnce(json({ access_token: "fresh" }))
        setup.fetcher.mockResolvedValueOnce(json({ error: "forbidden" }, 403))
        const reason = yield* failureReason(
          spotify.addTracksToPlaylist("github-42", "list123", ["track123"])
        )
        assert.strictEqual(reason._tag, "AccessDenied")
        assert.isFalse(setup.getConnection()?.needsReconnect)
      })
    )
  })

  it.effect("rejects invalid IDs before any Spotify request", () => {
    const setup = testSetup()
    return setup.run(
      Effect.gen(function* () {
        const spotify = yield* Spotify
        yield* connect(setup)
        const reason = yield* failureReason(
          spotify.addTracksToPlaylist("github-42", "list/123", ["track123"])
        )
        assert.strictEqual(reason._tag, "InvalidInput")
        expect(setup.fetcher).toHaveBeenCalledTimes(2)
      })
    )
  })
})

it.effect(
  "relinked replacement B preserves original A for discovery, library checks, membership, and writes",
  () => {
    const setup = testSetup()
    return setup.run(
      Effect.gen(function* () {
        const spotify = yield* Spotify
        yield* connect(setup)
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
        const page = yield* spotify.savedTracksPage("github-42")
        assert.strictEqual(page.items[0]!.id, "A")
        setup.fetcher.mockResolvedValueOnce(json([true]))
        assert.isTrue(yield* isLiked(spotify, page.items[0]!.id))
        expect(requestUrl(setup, -1)).toContain("uris=spotify%3Atrack%3AA")
        for (const field of ["item", "track"]) {
          setup.fetcher.mockResolvedValueOnce(
            json({ items: [{ [field]: relinked }], next: null, total: 1 })
          )
          assert.isTrue(yield* inPlaylist(spotify, "list123", "A"))
          setup.fetcher.mockResolvedValueOnce(
            json({ items: [{ [field]: relinked }], next: null, total: 1 })
          )
          assert.isFalse(yield* inPlaylist(spotify, "list123", "B"))
        }
        setup.fetcher.mockResolvedValueOnce(json({ snapshot_id: "snapshot" }))
        yield* spotify.addTracksToPlaylist("github-42", "list123", [
          page.items[0]!.id,
        ])
        expect(JSON.parse(requestBody(setup, -1))).toEqual({
          uris: ["spotify:track:A"],
        })
      })
    )
  }
)
