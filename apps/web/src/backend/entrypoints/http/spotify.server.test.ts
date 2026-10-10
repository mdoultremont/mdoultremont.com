import { Effect, Option } from "effect"
import { beforeEach, describe, expect, test, vi } from "vitest"
import {
  beginSpotifyConnection,
  completeSpotifyConnection,
  disconnectSpotify,
  spotifyStatus,
} from "./spotify.server"

const mocks = vi.hoisted(() => ({
  owner:
    vi.fn<(request: Request) => Promise<{ id: string; sessionId: string }>>(),
  prepare: vi.fn<() => void>(),
}))

vi.mock("cloudflare:workers", () => ({
  env: {
    DB: { prepare: mocks.prepare },
    SPOTIFY_CLIENT_ID: "client",
    SPOTIFY_CLIENT_SECRET: "secret",
    SPOTIFY_REDIRECT_URI: "https://example.com/api/spotify/callback",
    SPOTIFY_TOKEN_ENCRYPTION_KEY: btoa(
      String.fromCharCode(...new Uint8Array(32).fill(7))
    ),
  },
}))
vi.mock("./auth.server", () => ({
  ownerFromRequest: (request: Request) =>
    Effect.promise(() =>
      mocks.owner(request).then(Option.some, () => Option.none())
    ),
}))

beforeEach(() => {
  vi.resetAllMocks()
  // The owner's session follows the request's test cookie.
  mocks.owner.mockImplementation(async (request) => ({
    id: "owner",
    sessionId:
      /session=([^;]+)/.exec(request.headers.get("Cookie") ?? "")?.[1] ??
      "none",
  }))
})

describe("Spotify private entrypoint", () => {
  test("rejects anonymous connection, callback, status, and disconnect", async () => {
    mocks.owner.mockRejectedValue(new Error("not owner"))
    expect(
      (
        await beginSpotifyConnection(
          new Request("https://example.com/api/spotify/connect")
        )
      ).status
    ).toBe(401)
    expect(
      (
        await completeSpotifyConnection(
          new Request("https://example.com/api/spotify/callback?state=s&code=c")
        )
      ).status
    ).toBe(303)
    expect(
      (
        await spotifyStatus(
          new Request("https://example.com/api/spotify/status")
        )
      ).status
    ).toBe(401)
    expect(
      (
        await disconnectSpotify(
          new Request("https://example.com/api/spotify/disconnect", {
            method: "POST",
          })
        )
      ).status
    ).toBe(401)
    expect(mocks.prepare).not.toHaveBeenCalled()
  })

  test("binds OAuth callback to the same session and state cookie", async () => {
    const start = await beginSpotifyConnection(
      new Request("https://example.com/api/spotify/connect", {
        headers: { Cookie: "session=session-a" },
      })
    )
    expect(start.status).toBe(302)
    const authorizeUrl = new URL(start.headers.get("Location") ?? "")
    const state = authorizeUrl.searchParams.get("state")
    expect(authorizeUrl.searchParams.get("scope")).toContain(
      "user-library-read"
    )
    expect(state).toBeTruthy()
    const stateCookie = start.headers.get("Set-Cookie")?.split(";")[0]
    const callback = `https://example.com/api/spotify/callback?state=${encodeURIComponent(state ?? "")}&code=code`
    const wrongSession = await completeSpotifyConnection(
      new Request(callback, {
        headers: { Cookie: `session=session-b; ${stateCookie}` },
      })
    )
    expect(wrongSession.headers.get("Location")).toContain("spotify=failed")
    const wrongCookie = await completeSpotifyConnection(
      new Request(callback, {
        headers: {
          Cookie: "session=session-a; spotify_oauth_state=forged",
        },
      })
    )
    expect(wrongCookie.headers.get("Location")).toContain("spotify=failed")
    expect(mocks.prepare).not.toHaveBeenCalled()
  })

  test("checks origin before disconnect", async () => {
    const request = new Request("https://example.com/api/spotify/disconnect", {
      method: "POST",
      headers: { Origin: "https://attacker.example" },
    })
    expect((await disconnectSpotify(request)).status).toBe(403)
    expect(mocks.prepare).not.toHaveBeenCalled()
  })
})
