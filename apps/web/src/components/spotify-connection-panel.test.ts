import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { SpotifyConnectionPanel } from "./spotify-connection-panel"

describe("Spotify connection panel", () => {
  test("offers connection when disconnected", () => {
    const html = renderToStaticMarkup(
      createElement(SpotifyConnectionPanel, {
        csrfToken: "csrf",
        initialConnection: { status: "disconnected" },
      })
    )
    expect(html).toContain("Connect Spotify")
    expect(html).not.toContain("View Liked Songs")
  })

  test("shows account controls when connected", () => {
    const html = renderToStaticMarkup(
      createElement(SpotifyConnectionPanel, {
        csrfToken: "csrf",
        initialConnection: {
          status: "connected",
          accountId: "spotify-42",
          displayName: "Music Owner",
        },
      })
    )
    expect(html).toContain("Music Owner")
    expect(html).toContain("View playlists")
    expect(html).not.toContain("View Liked Songs")
    expect(html).toContain("Disconnect Spotify")
  })

  test("offers reconnection after authorization failure", () => {
    const html = renderToStaticMarkup(
      createElement(SpotifyConnectionPanel, {
        csrfToken: "csrf",
        initialConnection: {
          status: "reconnect_needed",
          accountId: "spotify-42",
          displayName: null,
        },
      })
    )
    expect(html).toContain("Reconnect Spotify")
  })
})
