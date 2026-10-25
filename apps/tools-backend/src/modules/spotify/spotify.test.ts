import { assert, describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Effect, Layer, Option, Redacted } from "effect"
import { FetchHttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { vi } from "vitest"
import { TokenCipher } from "#backend/modules/token-cipher"
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
          SPOTIFY_REDIRECT_URI:
            "https://example.com/api/music/spotify/callback",
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
            "redirect_uri=https%3A%2F%2Fexample.com%2Fapi%2Fmusic%2Fspotify%2Fcallback"
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

  it.effect(
    "requires reconnecting an older connection before creating a private playlist without permission",
    () => {
      const setup = testSetup()
      return setup.run(
        Effect.gen(function* () {
          const spotify = yield* Spotify
          yield* connect(setup)
          setup.setConnection({
            ...setup.getConnection()!,
            scopes: "user-library-read playlist-read-private",
          })
          setup.fetcher.mockResolvedValueOnce(json({ access_token: "fresh" }))
          expect(
            (yield* failureReason(
              spotify.createPrivatePlaylist("github-42", "New list")
            ))._tag
          ).toBe("ReconnectNeeded")
          expect(setup.getConnection()?.needsReconnect).toBe(true)
          expect(
            setup.fetcher.mock.calls.some(([url]) =>
              String(url).endsWith("/v1/me/playlists")
            )
          ).toBe(false)
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
                description:
                  'Late &amp; slow, <a href="spotify:artist:x">Miles</a> &#x27;59',
                images: [
                  { url: "http://insecure.example/cover.jpg" },
                  { url: "https://i.scdn.co/image/jazz", height: 640 },
                ],
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
          {
            id: "one",
            description: "Late & slow, Miles '59",
            imageUrl: "https://i.scdn.co/image/jazz",
          },
          { id: "two", description: null, imageUrl: null },
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

describe("Spotify playlist covers", () => {
  const cover = "/9j/4AAQSkZJRgABAQ=="

  it.effect(
    "asks to reconnect for cover uploads without breaking the connection",
    () => {
      const setup = testSetup()
      return setup.run(
        Effect.gen(function* () {
          const spotify = yield* Spotify
          yield* connect(setup)
          setup.fetcher.mockResolvedValueOnce(json({ access_token: "fresh" }))
          const calls = setup.fetcher.mock.calls.length
          expect(
            (yield* failureReason(
              spotify.setPlaylistCover("github-42", "jazz", cover)
            ))._tag
          ).toBe("CoverPermissionMissing")
          expect(
            setup.fetcher.mock.calls
              .slice(calls)
              .some(([url]) => String(url).includes("/images"))
          ).toBe(false)
          expect(setup.getConnection()?.needsReconnect).toBe(false)
        })
      )
    }
  )

  it.effect("uploads the cover as a base64 JPEG body", () => {
    const setup = testSetup()
    return setup.run(
      Effect.gen(function* () {
        const spotify = yield* Spotify
        yield* connect(setup)
        const connection = setup.getConnection()!
        setup.setConnection({
          ...connection,
          scopes: connection.scopes + " ugc-image-upload",
        })
        setup.fetcher.mockResolvedValueOnce(json({ access_token: "fresh" }))
        setup.fetcher.mockResolvedValueOnce(new Response(null, { status: 202 }))
        yield* spotify.setPlaylistCover("github-42", "jazz", cover)
        const [url, init] = setup.fetcher.mock.calls.at(-1)!
        expect(String(url)).toBe(
          "https://api.spotify.com/v1/playlists/jazz/images"
        )
        expect(init?.method).toBe("PUT")
        expect(new Headers(init?.headers).get("content-type")).toBe(
          "image/jpeg"
        )
        expect(requestBody(setup, -1)).toBe(cover)
      })
    )
  })

  it.effect("rejects a payload that is not a small base64 JPEG", () => {
    const setup = testSetup()
    return setup.run(
      Effect.gen(function* () {
        const spotify = yield* Spotify
        yield* connect(setup)
        const calls = setup.fetcher.mock.calls.length
        for (const image of [
          "iVBORw0KGgo=",
          "/9j/" + "A".repeat(256 * 1024),
          "/9j/<script>",
        ])
          expect(
            (yield* failureReason(
              spotify.setPlaylistCover("github-42", "jazz", image)
            ))._tag
          ).toBe("InvalidInput")
        expect(setup.fetcher.mock.calls.length).toBe(calls)
      })
    )
  })
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

for (const reader of ["saved", "item", "track"] as const) {
  it.effect(
    `${reader} pages keep valid tracks with malformed optional artwork`,
    () => {
      const setup = testSetup()
      return setup.run(
        Effect.gen(function* () {
          const spotify = yield* Spotify
          yield* connect(setup)
          setup.fetcher.mockResolvedValueOnce(
            json({ access_token: "fresh", expires_in: 3600 })
          )
          const artworkUrl = "https://i.scdn.co/image/album"
          const albums = [
            [undefined, undefined],
            [null, undefined],
            ["invalid", undefined],
            [{}, undefined],
            [{ images: null }, undefined],
            [{ images: "invalid" }, undefined],
            [{ images: [null] }, undefined],
            [{ images: [{}] }, undefined],
            [{ images: [{ url: null }] }, undefined],
            [{ images: [{ url: 42 }] }, undefined],
            [{ images: [{ url: "invalid" }] }, undefined],
            [{ images: [{ url: "https://" }] }, undefined],
            [{ images: [{ url: "http://example.com/artwork" }] }, undefined],
            [{ images: [{ url: artworkUrl }] }, artworkUrl],
            [
              { images: [null, {}, { url: 42 }, { url: artworkUrl }] },
              artworkUrl,
            ],
          ] as const
          const addedAt = "2026-10-03T00:00:00Z"
          setup.fetcher.mockResolvedValueOnce(
            json({
              items: albums.map(([album], index) => ({
                added_at: addedAt,
                [reader === "saved" ? "track" : reader]: {
                  id: "song" + index,
                  type: "track",
                  name: "Song",
                  artists: [{ name: "Artist" }],
                  external_ids: { isrc: "BEABC2600001" },
                  duration_ms: 234567,
                  album,
                },
              })),
              next: null,
              total: albums.length,
            })
          )
          const page = yield* reader === "saved"
            ? spotify.savedTracksPage("github-42")
            : spotify.playlistTracksPage("github-42", "shazam")
          expect(page).toEqual({
            items: albums.map(([, expectedArtworkUrl], index) => ({
              id: "song" + index,
              name: "Song",
              artistNames: ["Artist"],
              isrc: "BEABC2600001",
              durationMs: 234567,
              addedAt,
              ...(expectedArtworkUrl ? { artworkUrl: expectedArtworkUrl } : {}),
            })),
            next: null,
            total: albums.length,
          })
        })
      )
    }
  )
}

describe("Spotify source playlists", () => {
  it.effect(
    "reads saved-track metadata from both playlist item shapes and skips unavailable items",
    () => {
      const setup = testSetup()
      return setup.run(
        Effect.gen(function* () {
          const spotify = yield* Spotify
          yield* connect(setup)
          setup.fetcher.mockResolvedValueOnce(
            json({ access_token: "fresh", expires_in: 3600 })
          )
          const track = {
            id: "replacement",
            type: "track",
            name: "Song",
            artists: [{ name: "Artist" }],
            external_ids: { isrc: "BEABC2600001" },
            duration_ms: 234567,
            linked_from: { id: "original" },
            is_local: false,
            is_playable: true,
          }
          setup.fetcher.mockResolvedValueOnce(
            json({
              items: [
                {
                  added_at: "2026-10-03T00:00:00Z",
                  item: track,
                  is_local: false,
                },
                {
                  added_at: null,
                  item: null,
                  track: { ...track, id: "old", linked_from: null },
                },
                { added_at: null, item: { ...track, type: "episode" } },
                { added_at: null, item: { ...track, is_local: true } },
                { added_at: null, item: { ...track, is_playable: false } },
                { added_at: null, item: track, is_local: true },
                { added_at: null, item: null },
              ],
              next: "https://api.spotify.com/v1/playlists/shazam/items?offset=50&limit=50",
              total: 51,
            })
          )
          expect(
            yield* spotify.playlistTracksPage("github-42", "shazam")
          ).toEqual({
            items: [
              {
                id: "original",
                name: "Song",
                artistNames: ["Artist"],
                isrc: "BEABC2600001",
                durationMs: 234567,
                addedAt: "2026-10-03T00:00:00Z",
              },
              {
                id: "old",
                name: "Song",
                artistNames: ["Artist"],
                isrc: "BEABC2600001",
                durationMs: 234567,
                addedAt: "1970-01-01T00:00:00Z",
              },
            ],
            next: "https://api.spotify.com/v1/playlists/shazam/items?offset=50&limit=50",
            total: 51,
          })
          expect(requestUrl(setup, 3)).toBe(
            "https://api.spotify.com/v1/playlists/shazam/items?limit=50"
          )
          setup.fetcher.mockResolvedValueOnce(
            json({ items: [], next: null, total: 51 })
          )
          yield* spotify.playlistTracksPage(
            "github-42",
            "shazam",
            "https://api.spotify.com/v1/playlists/shazam/items?offset=50&limit=50"
          )
          expect(requestUrl(setup, 4)).toContain("offset=50")
          setup.fetcher.mockResolvedValueOnce(json({ snapshot_id: "version1" }))
          expect(yield* spotify.playlistSnapshot("github-42", "shazam")).toBe(
            "version1"
          )
          expect(requestUrl(setup, 5)).toBe(
            "https://api.spotify.com/v1/playlists/shazam?fields=snapshot_id"
          )
        })
      )
    }
  )

  it.effect(
    "rejects foreign, cross-playlist, and cross-endpoint cursors",
    () => {
      const setup = testSetup()
      return setup.run(
        Effect.gen(function* () {
          const spotify = yield* Spotify
          for (const cursor of [
            "https://evil.example/v1/playlists/shazam/items?offset=50",
            "https://api.spotify.com/v1/playlists/other/items?offset=50",
            "https://api.spotify.com/v1/me/tracks?offset=50",
          ])
            expect(
              (yield* failureReason(
                spotify.playlistTracksPage("github-42", "shazam", cursor)
              ))._tag
            ).toBe("InvalidInput")
          expect(setup.fetcher).not.toHaveBeenCalled()
          yield* connect(setup)
          setup.fetcher.mockResolvedValueOnce(json({ access_token: "fresh" }))
          setup.fetcher.mockResolvedValueOnce(
            json({ items: [], next: "https://evil.example/steal", total: 0 })
          )
          expect(
            (yield* failureReason(
              spotify.playlistTracksPage("github-42", "shazam")
            ))._tag
          ).toBe("InvalidResponse")
        })
      )
    }
  )
})

const playbackDevice = {
  id: "speaker/?=opaque",
  name: "Kitchen",
  type: "Speaker",
  is_active: true,
  is_restricted: false,
}
const currentPlayback = {
  is_playing: false,
  device: playbackDevice,
  currently_playing_type: "track",
  progress_ms: 70_000,
  item: {
    id: "trackA",
    name: "Song",
    duration_ms: 251_000,
    artists: [{ name: "Artist" }],
    album: { images: [{ url: "https://image.example/album.jpg" }] },
  },
  actions: {},
}
const playbackScopes =
  "streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state"

function grantPlayback(setup: Setup) {
  const connection = setup.getConnection()!
  setup.setConnection({
    ...connection,
    scopes: `${connection.scopes} ${playbackScopes}`,
  })
}

function servePlayback(
  setup: Setup,
  playback: unknown = currentPlayback,
  devices: readonly unknown[] = [playbackDevice],
  write: () => Response = () => new Response(null, { status: 204 })
) {
  setup.fetcher.mockImplementation(async (url, init) => {
    const path = new URL(String(url)).pathname
    if (path === "/api/token")
      return json({ access_token: "player-token", expires_in: 3600 })
    if (init?.method === "PUT" || init?.method === "POST") return write()
    if (path.endsWith("/devices")) return json({ devices })
    if (path.endsWith("/player"))
      return playback instanceof Response ? playback.clone() : json(playback)
    return json({ items: [], next: null, total: 0 })
  })
}

const playerWrites = (setup: Setup) =>
  setup.fetcher.mock.calls.filter(
    ([url, init]) =>
      String(url).includes("/me/player") &&
      (init?.method === "PUT" || init?.method === "POST")
  )

describe("Spotify Connect player", () => {
  it.effect(
    "requires the SDK scopes on old playback grants and renews access tokens without returning refresh credentials",
    () => {
      const setup = testSetup()
      return setup.run(
        Effect.gen(function* () {
          yield* connect(setup)
          const connection = setup.getConnection()!
          setup.setConnection({
            ...connection,
            scopes: `${connection.scopes} user-read-playback-state user-modify-playback-state`,
          })
          servePlayback(setup)
          const spotify = yield* Spotify
          expect(yield* spotify.playerStatus("github-42")).toEqual({
            status: "needs_permission",
          })
          expect(
            (yield* failureReason(spotify.playbackToken("github-42")))._tag
          ).toBe("PlaybackPermissionMissing")
          grantPlayback(setup)
          expect(yield* spotify.playbackToken("github-42")).toEqual({
            accessToken: "player-token",
          })
          yield* TestClock.adjust(3_600_000)
          setup.fetcher.mockResolvedValueOnce(
            json({
              access_token: "renewed-player-token",
              refresh_token: "renewed-refresh",
              expires_in: 3600,
            })
          )
          expect(yield* spotify.playbackToken("github-42")).toEqual({
            accessToken: "renewed-player-token",
          })
        })
      )
    }
  )

  it.effect(
    "requests playback scopes while accepting old grants and keeping ingestion usable",
    () => {
      const setup = testSetup()
      return setup.run(
        Effect.gen(function* () {
          const spotify = yield* Spotify
          const scopes = new URL(spotify.authorizationUrl("state")).searchParams
            .get("scope")!
            .split(" ")
          expect(scopes).toEqual([
            ...spotifyScopes,
            "ugc-image-upload",
            ...playbackScopes.split(" "),
          ])
          yield* connect(setup)
          servePlayback(setup)
          expect(yield* spotify.playerStatus("github-42")).toEqual({
            status: "needs_permission",
          })
          for (const effect of [
            spotify.play("github-42", "speaker", ["trackA"]),
            spotify.pause("github-42", "speaker"),
            spotify.resume("github-42", "speaker"),
          ]) {
            expect((yield* failureReason(effect))._tag).toBe(
              "PlaybackPermissionMissing"
            )
          }
          expect(
            setup.fetcher.mock.calls.some(([url]) =>
              String(url).includes("/me/player")
            )
          ).toBe(false)
          expect(setup.getConnection()?.needsReconnect).toBe(false)
          expect((yield* spotify.savedTracksPage("github-42")).items).toEqual(
            []
          )
        })
      )
    }
  )

  it.effect(
    "reads playback and devices with one refresh; only 204 means idle",
    () => {
      const setup = testSetup()
      return setup.run(
        Effect.gen(function* () {
          yield* connect(setup)
          grantPlayback(setup)
          servePlayback(setup, new Response(null, { status: 204 }), [
            { ...playbackDevice, id: null },
            { ...playbackDevice, id: null, is_restricted: true },
            playbackDevice,
          ])
          const spotify = yield* Spotify
          expect(yield* spotify.playerStatus("github-42")).toEqual({
            status: "ready",
            playback: null,
            devices: [
              {
                controllable: false,
                why: "unidentified",
                name: "Kitchen",
                type: "Speaker",
                active: true,
              },
              {
                controllable: false,
                why: "restricted",
                name: "Kitchen",
                type: "Speaker",
                active: true,
              },
              {
                controllable: true,
                id: playbackDevice.id,
                name: "Kitchen",
                type: "Speaker",
                active: true,
              },
            ],
          })
          expect(tokenCalls(setup)).toHaveLength(2)
          for (const invalid of [
            new Response("", { status: 200 }),
            json({}),
            json(null),
          ]) {
            servePlayback(setup, invalid)
            expect(
              (yield* failureReason(spotify.playerStatus("github-42")))._tag
            ).toBe("InvalidResponse")
          }
          expect(tokenCalls(setup)).toHaveLength(2)
        })
      )
    }
  )

  for (const [label, item, type, expected] of [
    [
      "local track",
      { ...currentPlayback.item, id: null },
      "track",
      {
        kind: "track",
        id: null,
        name: "Song",
        artistNames: ["Artist"],
        imageUrl: "https://image.example/album.jpg",
        durationMs: 251_000,
      },
    ],
    [
      "relinked track",
      { ...currentPlayback.item, linked_from: { id: "original" } },
      "track",
      {
        kind: "track",
        id: "original",
        name: "Song",
        artistNames: ["Artist"],
        imageUrl: "https://image.example/album.jpg",
        durationMs: 251_000,
      },
    ],
    [
      "malformed relink",
      { ...currentPlayback.item, linked_from: "bad" },
      "track",
      {
        kind: "track",
        id: null,
        name: "Song",
        artistNames: ["Artist"],
        imageUrl: "https://image.example/album.jpg",
        durationMs: 251_000,
      },
    ],
    [
      "missing relink ID",
      { ...currentPlayback.item, linked_from: {} },
      "track",
      {
        kind: "track",
        id: null,
        name: "Song",
        artistNames: ["Artist"],
        imageUrl: "https://image.example/album.jpg",
        durationMs: 251_000,
      },
    ],
    ["episode", null, "episode", { kind: "other" }],
  ] as const) {
    it.effect(`reads ${label} without inventing an identity`, () => {
      const setup = testSetup()
      return setup.run(
        Effect.gen(function* () {
          yield* connect(setup)
          grantPlayback(setup)
          servePlayback(setup, {
            ...currentPlayback,
            item,
            currently_playing_type: type,
            actions: {
              pausing: true,
              disallows: { resuming: true, skipping_next: true },
            },
          })
          const spotify = yield* Spotify
          const status = yield* spotify.playerStatus("github-42")
          expect(status.status).toBe("ready")
          if (status.status !== "ready") return
          expect(status.playback?.item).toEqual(expected)
          expect(status.playback?.progressMs).toBe(70_000)
          expect(status.playback?.allows).toEqual({
            pause: false,
            resume: false,
            next: false,
          })
        })
      )
    })
  }

  it.effect(
    "sends one exact track URI and encodes opaque device IDs, rejecting invalid tracks before requests",
    () => {
      const setup = testSetup()
      return setup.run(
        Effect.gen(function* () {
          yield* connect(setup)
          grantPlayback(setup)
          servePlayback(setup)
          const spotify = yield* Spotify
          const count = setup.fetcher.mock.calls.length
          expect(
            (yield* failureReason(
              spotify.play("github-42", playbackDevice.id, ["bad/id"])
            ))._tag
          ).toBe("InvalidInput")
          expect(setup.fetcher.mock.calls).toHaveLength(count)
          yield* spotify.play("github-42", playbackDevice.id, ["trackA"])
          expect(playerWrites(setup)).toHaveLength(1)
          expect(
            new URL(requestUrl(setup, -1)).searchParams.get("device_id")
          ).toBe(playbackDevice.id)
          expect(JSON.parse(requestBody(setup, -1))).toEqual({
            uris: ["spotify:track:trackA"],
          })
          expect(
            setup.fetcher.mock.calls.some(
              ([url, init]) =>
                String(url).includes("/me/player") && init?.method === "GET"
            )
          ).toBe(false)
        })
      )
    }
  )

  for (const [status, body, reason] of [
    [403, { error: { reason: "PREMIUM_REQUIRED" } }, "PremiumRequired"],
    [403, { error: { reason: "UNKNOWN" } }, "PlaybackRefused"],
    [403, "malformed", "PlaybackRefused"],
    [404, {}, "DeviceUnavailable"],
    [429, {}, "RateLimited"],
    [401, {}, "ReconnectNeeded"],
  ] as const) {
    it.effect(`classifies player ${status} as ${reason}`, () => {
      const setup = testSetup()
      return setup.run(
        Effect.gen(function* () {
          yield* connect(setup)
          grantPlayback(setup)
          servePlayback(setup, currentPlayback, [], () =>
            body === "malformed"
              ? new Response("not json", { status })
              : json(body, status, { "Retry-After": "9" })
          )
          const spotify = yield* Spotify
          const error = yield* Effect.flip(
            spotify.play("github-42", "speaker", ["trackA"])
          )
          expect(error.reason._tag).toBe(reason)
          expect(error.retryAfterSeconds).toBe(status === 429 ? 9 : undefined)
          expect(error.retryable).toBe(status === 429)
          expect(setup.getConnection()?.needsReconnect).toBe(status === 401)
          expect(playerWrites(setup)).toHaveLength(1)
        })
      )
    })
  }

  for (const kind of ["pause", "resume"] as const) {
    for (const nested of [false, true]) {
      it.effect(
        `${kind} accepts an already satisfied request with ${nested ? "nested" : "flat"} action restrictions without writing`,
        () => {
          const setup = testSetup()
          return setup.run(
            Effect.gen(function* () {
              yield* connect(setup)
              grantPlayback(setup)
              const restriction = {
                [kind === "pause" ? "pausing" : "resuming"]: true,
              }
              servePlayback(setup, {
                ...currentPlayback,
                is_playing: kind === "resume",
                actions: nested ? { disallows: restriction } : restriction,
              })
              const spotify = yield* Spotify
              yield* spotify[kind]("github-42", playbackDevice.id)
              expect(playerWrites(setup)).toHaveLength(0)
            })
          )
        }
      )
    }

    it.effect(
      `${kind} only addresses the current device, respects restrictions, and skips an already satisfied request`,
      () => {
        const setup = testSetup()
        return setup.run(
          Effect.gen(function* () {
            yield* connect(setup)
            grantPlayback(setup)
            servePlayback(setup)
            const spotify = yield* Spotify
            expect(
              (yield* failureReason(spotify[kind]("github-42", "different")))
                ._tag
            ).toBe("DeviceUnavailable")
            servePlayback(setup, new Response(null, { status: 204 }))
            expect(
              (yield* failureReason(
                spotify[kind]("github-42", playbackDevice.id)
              ))._tag
            ).toBe("DeviceUnavailable")
            const desired = kind === "resume"
            servePlayback(setup, { ...currentPlayback, is_playing: desired })
            yield* spotify[kind]("github-42", playbackDevice.id)
            expect(playerWrites(setup)).toHaveLength(0)
            for (const restriction of [
              { device: { ...playbackDevice, is_restricted: true } },
              { actions: { [desired ? "resuming" : "pausing"]: true } },
              {
                actions: {
                  disallows: { [desired ? "resuming" : "pausing"]: true },
                },
              },
            ]) {
              servePlayback(setup, {
                ...currentPlayback,
                is_playing: !desired,
                ...restriction,
              })
              expect(
                (yield* failureReason(
                  spotify[kind]("github-42", playbackDevice.id)
                ))._tag
              ).toBe("PlaybackRefused")
            }
            expect(playerWrites(setup)).toHaveLength(0)
            servePlayback(setup, { ...currentPlayback, is_playing: !desired })
            yield* spotify[kind]("github-42", playbackDevice.id)
            expect(playerWrites(setup)).toHaveLength(1)
            const request = playerWrites(setup)[0]!
            expect(
              new URL(String(request[0])).searchParams.get("device_id")
            ).toBe(playbackDevice.id)
            expect(new URL(String(request[0])).pathname).toBe(
              `/v1/me/player/${desired ? "play" : "pause"}`
            )
            expect(request[1]?.body == null || request[1]?.body === "").toBe(
              true
            )
          })
        )
      }
    )
  }

  it.effect("queues the following tracks behind the requested one", () => {
    const setup = testSetup()
    return setup.run(
      Effect.gen(function* () {
        yield* connect(setup)
        grantPlayback(setup)
        servePlayback(setup)
        const spotify = yield* Spotify
        expect(
          (yield* failureReason(
            spotify.play("github-42", playbackDevice.id, ["trackA", "bad/id"])
          ))._tag
        ).toBe("InvalidInput")
        expect(playerWrites(setup)).toHaveLength(0)
        yield* spotify.play("github-42", playbackDevice.id, [
          "trackA",
          "trackB",
          "trackC",
        ])
        expect(JSON.parse(requestBody(setup, -1))).toEqual({
          uris: [
            "spotify:track:trackA",
            "spotify:track:trackB",
            "spotify:track:trackC",
          ],
        })
      })
    )
  })

  it.effect(
    "skips to the next track only on the current device when Spotify allows it",
    () => {
      const setup = testSetup()
      return setup.run(
        Effect.gen(function* () {
          yield* connect(setup)
          grantPlayback(setup)
          servePlayback(setup)
          const spotify = yield* Spotify
          expect(
            (yield* failureReason(spotify.next("github-42", "different")))._tag
          ).toBe("DeviceUnavailable")
          servePlayback(setup, {
            ...currentPlayback,
            actions: { disallows: { skipping_next: true } },
          })
          expect(
            (yield* failureReason(spotify.next("github-42", playbackDevice.id)))
              ._tag
          ).toBe("PlaybackRefused")
          expect(playerWrites(setup)).toHaveLength(0)
          servePlayback(setup)
          yield* spotify.next("github-42", playbackDevice.id)
          const request = playerWrites(setup)[0]!
          expect(request[1]?.method).toBe("POST")
          expect(new URL(String(request[0])).pathname).toBe(
            "/v1/me/player/next"
          )
          expect(
            new URL(String(request[0])).searchParams.get("device_id")
          ).toBe(playbackDevice.id)
        })
      )
    }
  )

  it.effect("leaves non-player 404 behavior unchanged", () => {
    const setup = testSetup()
    return setup.run(
      Effect.gen(function* () {
        yield* connect(setup)
        setup.fetcher.mockResolvedValueOnce(json({ access_token: "fresh" }))
        setup.fetcher.mockResolvedValueOnce(json({}, 404))
        const spotify = yield* Spotify
        expect(
          (yield* failureReason(spotify.playlists("github-42")))._tag
        ).toBe("Rejected")
        expect(setup.getConnection()?.needsReconnect).toBe(false)
      })
    )
  })
})
