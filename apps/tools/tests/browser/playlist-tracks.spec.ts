import { expect, test } from "@playwright/test"
import { musicFixtureResponses } from "./support/music-fixtures"

test.beforeEach(async ({ page }) => {
  await page.route("**/api/rpc/music/player/**", (route) => {
    const action = new URL(route.request().url()).pathname.replace(
      "/api/rpc/music/",
      ""
    )
    return route.fulfill({
      json: { json: musicFixtureResponses[action]!({}) },
    })
  })
})

const track = {
  id: "one",
  name: "Blue in Green",
  artistNames: ["Miles Davis"],
  isrc: null,
  durationMs: 337000,
  addedAt: "2026-10-01T10:00:00Z",
  artworkUrl: null,
}
const cursor =
  "https://api.spotify.com/v1/playlists/jazz/items?offset=50&limit=50"

test("preserves duplicates, loads past an empty page, and retries a failed page only on request", async ({
  page,
}) => {
  let continuationCalls = 0
  await page.route("**/api/rpc/music/spotify/playlistTracks", async (route) => {
    const input = route.request().postDataJSON().json
    if (!input.cursor)
      return route.fulfill({
        json: { json: { items: [], next: cursor, total: 3 } },
      })
    continuationCalls++
    if (continuationCalls === 1)
      return route.fulfill({
        status: 503,
        json: {
          json: {
            code: "SERVICE_UNAVAILABLE",
            message: "Spotify is unavailable",
          },
        },
      })
    return route.fulfill({
      json: { json: { items: [track, track], next: null, total: 3 } },
    })
  })
  await page.goto("/music/settings")
  await page.waitForLoadState("networkidle")
  await page.evaluate(async (modulePath) => {
    const m = await import(modulePath)
    m.mountPlaylistTracks()
  }, "/tests/browser/support/mount-playlist-tracks.tsx")
  await expect(page.getByRole("alert")).toBeVisible()
  await expect(
    page.getByText("No available tracks on this page.")
  ).toBeVisible()
  await page.waitForTimeout(500)
  expect(continuationCalls).toBe(1)
  await page.getByRole("button", { name: "Try loading more again" }).click()
  await expect(page.getByText("Blue in Green", { exact: true })).toHaveCount(2)
  await expect(page.getByText("Miles Davis", { exact: true })).toHaveCount(2)
  await expect(page.getByText("5:37", { exact: true })).toHaveCount(2)
  await expect(
    page.getByText("2 tracks loaded · 3 Spotify items")
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Try loading more again" })
  ).toHaveCount(0)
  await expect(page.getByText("Loading more tracks…")).toHaveCount(0)
})

test("selection changes discard a delayed response", async ({ page }) => {
  let release: (() => void) | undefined
  const delayed = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/api/rpc/music/spotify/playlistTracks", async (route) => {
    const input = route.request().postDataJSON().json
    if (input.playlistId === "jazz") await delayed
    await route.fulfill({
      json: {
        json: {
          items: [
            {
              ...track,
              id: input.playlistId,
              name:
                input.playlistId === "jazz"
                  ? "Old response"
                  : "Current response",
            },
          ],
          next: null,
          total: 1,
        },
      },
    })
  })
  await page.goto("/music/settings")
  await page.waitForLoadState("networkidle")
  await page.evaluate(async (modulePath) => {
    const m = await import(modulePath)
    m.mountPlaylistTracks()
  }, "/tests/browser/support/mount-playlist-tracks.tsx")
  await expect(page.getByRole("status")).toContainText("Loading tracks")
  await page.getByRole("button", { name: "Choose other playlist" }).click()
  await expect(
    page.getByText("Current response", { exact: true })
  ).toBeVisible()
  release?.()
  await expect(page.getByText("Old response", { exact: true })).toHaveCount(0)
})

for (const reason of ["NotConnected", "ReconnectNeeded", "RateLimited"]) {
  test(`a later-page ${reason} failure preserves loaded tracks and offers recovery`, async ({
    page,
  }) => {
    let continuationCalls = 0
    await page.route("**/api/rpc/music/spotify/playlistTracks", (route) => {
      const input = route.request().postDataJSON().json
      if (!input.cursor)
        return route.fulfill({
          json: { json: { items: [track], next: cursor, total: 2 } },
        })
      expect(input.cursor).toBe(cursor)
      continuationCalls++
      if (continuationCalls === 1)
        return route.fulfill({
          status: 409,
          json: {
            json: {
              defined: false,
              code: "CONFLICT",
              status: 409,
              message: "Spotify needs attention",
              data: { reason },
            },
          },
        })
      return route.fulfill({
        json: {
          json: {
            items: [{ ...track, id: "two", name: "So What" }],
            next: null,
            total: 2,
          },
        },
      })
    })
    await page.goto("/music/settings")
    await page.waitForLoadState("networkidle")
    await page.evaluate(async (modulePath) => {
      const m = await import(modulePath)
      m.mountPlaylistTracks()
    }, "/tests/browser/support/mount-playlist-tracks.tsx")
    await expect(page.getByText("Blue in Green", { exact: true })).toBeVisible()
    await expect(page.getByRole("alert")).toHaveText("Spotify needs attention")
    await page.waitForTimeout(500)
    expect(continuationCalls).toBe(1)
    await expect(page.getByText("Blue in Green", { exact: true })).toBeVisible()
    await expect(
      page.getByText("1 track loaded · 2 Spotify items")
    ).toBeVisible()
    const reconnect = page.getByRole("link", {
      name: "Check Spotify connection",
    })
    const retry = page.getByRole("button", { name: "Try loading more again" })
    if (reason === "RateLimited") {
      await expect(reconnect).toHaveCount(0)
      await retry.click()
      await expect(
        page.getByText("Blue in Green", { exact: true })
      ).toBeVisible()
      await expect(page.getByText("So What", { exact: true })).toBeVisible()
      await expect(
        page.getByText("2 tracks loaded · 2 Spotify items")
      ).toBeVisible()
      await expect(page.getByRole("alert")).toHaveCount(0)
    } else {
      await expect(reconnect).toHaveAttribute("href", "/music/settings")
      await expect(retry).toHaveCount(0)
    }
  })
}

test("a reconnect failure links to connection settings", async ({ page }) => {
  await page.route("**/api/rpc/music/spotify/playlistTracks", (route) =>
    route.fulfill({
      status: 409,
      json: {
        json: {
          defined: false,
          code: "CONFLICT",
          status: 409,
          message: "Reconnect Spotify",
          data: { reason: "ReconnectNeeded" },
        },
      },
    })
  )
  await page.goto("/music/settings")
  await page.waitForLoadState("networkidle")
  await page.evaluate(async (modulePath) => {
    const m = await import(modulePath)
    m.mountPlaylistTracks()
  }, "/tests/browser/support/mount-playlist-tracks.tsx")
  await expect(page.getByRole("alert")).toHaveText("Reconnect Spotify")
  await expect(
    page.getByRole("link", { name: "Check Spotify connection" })
  ).toHaveAttribute("href", "/music/settings")
})
