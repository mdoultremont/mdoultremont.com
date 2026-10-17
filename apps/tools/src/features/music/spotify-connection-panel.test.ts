import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import type { SpotifyConnectionStatus } from "@/server/modules/spotify"
import { SpotifyConnectionPanel } from "./spotify-connection-panel"

describe("Spotify connection panel", () => {
  test("offers connection when disconnected", () => {
    const html = renderToStaticMarkup(
      createElement(SpotifyConnectionPanel, {
        initialConnection: { status: "disconnected" },
      })
    )
    expect(html).toContain("Connect Spotify")
    expect(html).not.toContain("View Liked Songs")
  })

  test("shows account controls when connected", () => {
    const html = renderToStaticMarkup(
      createElement(SpotifyConnectionPanel, {
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
        initialConnection: {
          status: "reconnect_needed",
          accountId: "spotify-42",
          displayName: null,
        },
      })
    )
    expect(html).toContain("Reconnect Spotify")
    expect(html).not.toContain("Disconnect Spotify")
  })

  test("shows the rest of the app only once connected", () => {
    expect(renderWithApp({ status: "disconnected" })).not.toContain(
      "Music automation"
    )
    expect(
      renderWithApp({
        status: "connected",
        accountId: "spotify-42",
        displayName: null,
      })
    ).toContain("Music automation")
  })
})

/** Renders the panel around a stand-in for the rest of the music app. */
const renderWithApp = (connection: SpotifyConnectionStatus) =>
  renderToStaticMarkup(
    createElement(
      SpotifyConnectionPanel,
      { initialConnection: connection },
      createElement("p", null, "Music automation")
    )
  )
