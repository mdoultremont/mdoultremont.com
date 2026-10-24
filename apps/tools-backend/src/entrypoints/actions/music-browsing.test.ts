import { Schema } from "effect"
import { describe, expect, test } from "vitest"
import { musicActions } from "@mdoultremont/tools-contracts/music"

const decode = Schema.decodeUnknownSync(
  musicActions.spotify.playlistTracks.input
)

describe("playlist tracks input", () => {
  test("accepts an initial read and its own Spotify continuation", () => {
    expect(decode({ playlistId: "jazz123" })).toEqual({ playlistId: "jazz123" })
    const input = {
      playlistId: "jazz123",
      cursor:
        "https://api.spotify.com/v1/playlists/jazz123/items?offset=50&limit=50",
    }
    expect(decode(input)).toEqual(input)
  })

  test("refuses foreign, cross-playlist, malformed, and non-pagination cursors", () => {
    for (const cursor of [
      "https://evil.example/v1/playlists/jazz123/items?offset=50",
      "https://api.spotify.com/v1/playlists/other/items?offset=50",
      "https://api.spotify.com/v1/me/tracks?offset=50",
      "/v1/playlists/jazz123/items?offset=-1",
      "/v1/playlists/jazz123/items?offset=1.5",
      "/v1/playlists/jazz123/items?offset=50&offset=100",
      "/v1/playlists/jazz123/items?offset=50&limit=0",
      "/v1/playlists/jazz123/items?offset=50&limit=51",
      "/v1/playlists/jazz123/items?offset=50&fields=items",
      "/v1/playlists/jazz123/items?offset=50#fragment",
      "https://user:password@api.spotify.com/v1/playlists/jazz123/items?offset=50",
    ])
      expect(() => decode({ playlistId: "jazz123", cursor })).toThrow(/Invalid/)
    for (const playlistId of ["", "../other", "has spaces", "a?offset=2"])
      expect(() => decode({ playlistId })).toThrow(/Invalid/)
  })
})
