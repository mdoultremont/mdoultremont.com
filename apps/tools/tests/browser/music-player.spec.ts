import { expect, test, type Page } from "@playwright/test"
import type { PlayerStatus } from "@mdoultremont/tools-contracts/music"
import {
  fixturePlayerStatus,
  fixtureTracks,
  musicFixtureResponses,
} from "./support/music-fixtures"

import { fakeSpotify } from "./support/fake-spotify"

async function mountMusic(page: Page) {
  await page.goto("/music/settings")
  await page.waitForLoadState("networkidle")
  await page.evaluate(async (modulePath) => {
    const { mountMusic: mount } = await import(modulePath)
    await mount()
  }, "/tests/browser/support/mount-music.tsx")
  await expect(
    page.getByRole("region", { name: "Liked Songs tracks", exact: true })
  ).toBeVisible()
}

async function fixtureMusic(
  page: Page,
  initialStatus: PlayerStatus = fixturePlayerStatus
) {
  await fakeSpotify(page)
  let status = initialStatus
  const commands: { action: string; input: Record<string, unknown> }[] = []
  let statusReads = 0
  await page.route("**/api/rpc/music/**", async (route) => {
    const action = new URL(route.request().url()).pathname.replace(
      "/api/rpc/music/",
      ""
    )
    const input = route.request().postDataJSON()?.json ?? {}
    if (action === "player/token")
      return route.fulfill({
        json: { json: { accessToken: "fixture-sdk-token" } },
      })
    if (action === "player/status") {
      statusReads++
      return route.fulfill({ json: { json: status } })
    }
    if (action.startsWith("player/")) {
      commands.push({ action, input })
      return route.fulfill({ json: { json: { status: "accepted" } } })
    }
    const response = musicFixtureResponses[action]
    if (!response) throw new Error("Missing music fixture for " + action)
    return route.fulfill({ json: { json: response(input) } })
  })
  return {
    commands,
    statusReads: () => statusReads,
    setStatus: (next: PlayerStatus) => {
      status = next
    },
  }
}

test("each duplicate row plays exactly its track on the chosen device", async ({
  page,
}) => {
  const fixture = await fixtureMusic(page)
  await page.route("**/api/rpc/music/spotify/likedTracks", (route) =>
    route.fulfill({
      json: {
        json: {
          items: [fixtureTracks[1], fixtureTracks[1]],
          next: null,
          total: 2,
        },
      },
    })
  )
  await mountMusic(page)
  const chooser = page.getByRole("button", { name: /^Play tracks on/ })
  await chooser.click()
  await page.getByRole("menuitemradio", { name: "Phone", exact: true }).click()
  expect(fixture.commands).toEqual([])
  const rows = page.getByRole("button", {
    name: "Play Open Eye Signal",
    exact: true,
  })
  await expect(rows).toHaveCount(2)
  await rows.nth(1).click()
  await expect(
    page.getByRole("region", { name: "Spotify player", exact: true })
  ).toHaveAttribute("aria-busy", "true")
  expect(fixture.commands).toEqual([
    {
      action: "player/play",
      input: { deviceId: "fixture-phone", trackId: "track2", nextTrackIds: [] },
    },
  ])
  await expect(rows.nth(0)).toBeDisabled()
  await expect(rows.nth(1)).toBeDisabled()
  fixture.setStatus({
    ...fixturePlayerStatus,
    playback: {
      ...fixturePlayerStatus.playback,
      device: { id: "fixture-phone", name: "Phone", restricted: false },
      item: {
        kind: "track",
        id: "track2",
        name: "Open Eye Signal",
        artistNames: ["Jon Hopkins"],
        imageUrl: null,
        durationMs: null,
      },
    },
  })
  await expect(rows.nth(0)).toHaveAttribute("data-playing", "true")
  await expect(rows.nth(1)).toHaveAttribute("data-playing", "true")
})

test("pause uses the current playback device even with a different track target", async ({
  page,
}) => {
  const fixture = await fixtureMusic(page)
  await mountMusic(page)
  await page.getByRole("button", { name: /^Play tracks on/ }).click()
  await page.getByRole("menuitemradio", { name: "Phone", exact: true }).click()
  await page.getByRole("button", { name: "Pause playback" }).click()
  await expect(
    page.getByRole("region", { name: "Spotify player", exact: true })
  ).toHaveAttribute("aria-busy", "true")
  expect(fixture.commands).toEqual([
    { action: "player/pause", input: { deviceId: "fixture-speaker" } },
  ])
  fixture.setStatus({
    ...fixturePlayerStatus,
    playback: { ...fixturePlayerStatus.playback, playing: false },
  })
  await expect(
    page.getByRole("button", { name: "Resume playback" })
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Resume playback" })
  ).toBeEnabled()
})

test("one player preserves the chosen target through input, output, and settings navigation", async ({
  page,
}) => {
  const fixture = await fixtureMusic(page)
  await mountMusic(page)
  const chooser = page.getByRole("button", { name: /^Play tracks on/ })
  await chooser.click()
  await page.getByRole("menuitemradio", { name: "Phone", exact: true }).click()
  const reads = fixture.statusReads()
  for (const [path, heading] of [
    ["output", "Output playlists"],
    ["settings", "Settings"],
    ["input/liked", "Liked Songs"],
  ]) {
    await page
      .locator(`a[data-sidebar="menu-button"][href="/music/${path}"]`)
      .click()
    await expect(
      page.getByRole("heading", { level: 1, name: heading, exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole("region", { name: "Spotify player", exact: true })
    ).toHaveCount(1)
    await expect(chooser).toHaveAccessibleName(`Play tracks on ${"Phone"}`)
  }
  expect(fixture.statusReads()).toBe(reads)
  expect(fixture.commands).toEqual([])
  await page.getByRole("button", { name: "Play A Walk", exact: true }).click()
  await expect
    .poll(() => fixture.commands)
    .toEqual([
      {
        action: "player/play",
        input: {
          deviceId: "fixture-phone",
          trackId: "track4",
          nextTrackIds: [],
        },
      },
    ])
})

test("missing playback permission leaves browsing available and every row disabled", async ({
  page,
}) => {
  const fixture = await fixtureMusic(page, { status: "needs_permission" })
  await mountMusic(page)
  await expect(
    page.getByRole("link", { name: "Allow playback" })
  ).toHaveAttribute("href", "/api/music/spotify/connect")
  const rows = page
    .getByRole("region", { name: "Liked Songs tracks", exact: true })
    .getByRole("button", { name: /^Play / })
  await expect(rows).toHaveCount(4)
  for (const row of await rows.all()) await expect(row).toBeDisabled()
  await page.getByRole("link", { name: "Discoveries" }).click()
  await expect(
    page.getByRole("heading", { level: 1, name: /Discoveries/ })
  ).toBeVisible()
  expect(fixture.commands).toEqual([])
  expect(fixture.statusReads()).toBe(1)
})

test("mobile player and row controls stay within the page without covering tracks", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await fixtureMusic(page)
  await mountMusic(page)
  const player = page.getByRole("region", {
    name: "Spotify player",
    exact: true,
  })
  await expect(
    page.getByRole("button", { name: /^Play tracks on/ })
  ).toBeVisible()
  const tracks = await page
    .getByRole("region", { name: "Liked Songs tracks", exact: true })
    .boundingBox()
  const bar = await player.boundingBox()
  expect(bar!.y).toBeGreaterThanOrEqual(tracks!.y + tracks!.height)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page
    .getByRole("button", { name: "Pause playback" })
    .scrollIntoViewIfNeeded()
  await expect(
    page.getByRole("button", { name: "Pause playback" })
  ).toBeInViewport()
  await page.setViewportSize({ width: 320, height: 844 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
})

test("playlist tracks can take over playback in this browser while another device is active", async ({
  page,
}) => {
  const fixture = await fixtureMusic(page)
  await mountMusic(page)
  await expect
    .poll(() => page.evaluate(() => window.fakeSpotify?.connected))
    .toBe(true)
  fixture.setStatus({
    ...fixturePlayerStatus,
    devices: [
      ...fixturePlayerStatus.devices,
      {
        controllable: true,
        id: "browser-device",
        name: "Tools browser player",
        type: "Computer",
        active: false,
      },
    ],
  })
  await page.evaluate(() =>
    window.fakeSpotify.emit("ready", { device_id: "browser-device" })
  )
  const chooser = page.getByRole("button", { name: /^Play tracks on/ })
  await expect(chooser).toHaveAccessibleName(
    `Play tracks on ${"Living room speaker"}`
  )
  await chooser.click()
  await page
    .getByRole("menuitemradio", { name: "This browser", exact: true })
    .click()
  await page.getByRole("button", { name: "Play A Walk", exact: true }).click()
  await expect
    .poll(() => fixture.commands)
    .toEqual([
      {
        action: "player/play",
        input: {
          deviceId: "browser-device",
          trackId: "track4",
          nextTrackIds: [],
        },
      },
    ])
  expect(await page.evaluate(() => window.fakeSpotify.activatedInGesture)).toBe(
    true
  )
  await expect(
    page.getByRole("button", { name: "Pause playback" })
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Play A Walk", exact: true })
  ).not.toHaveAttribute("data-playing", "true")
  fixture.setStatus({
    ...fixturePlayerStatus,
    playback: {
      ...fixturePlayerStatus.playback,
      device: {
        id: "browser-device",
        name: "Tools browser player",
        restricted: false,
      },
      item: {
        kind: "track",
        id: "track4",
        name: "A Walk",
        artistNames: ["Tycho"],
        imageUrl: null,
        durationMs: null,
      },
    },
  })
  await expect(
    page.getByRole("button", { name: "Play A Walk", exact: true })
  ).toHaveAttribute("data-playing", "true")
})

test("a row queues the tracks after it and Next skips on the current device", async ({
  page,
}) => {
  const fixture = await fixtureMusic(page)
  await mountMusic(page)
  await page
    .getByRole("button", { name: "Play Open Eye Signal", exact: true })
    .click()
  await expect
    .poll(() => fixture.commands)
    .toEqual([
      {
        action: "player/play",
        input: {
          deviceId: "fixture-speaker",
          trackId: "track2",
          nextTrackIds: ["track3", "track4"],
        },
      },
    ])
  fixture.setStatus({
    ...fixturePlayerStatus,
    playback: {
      ...fixturePlayerStatus.playback,
      item: {
        kind: "track",
        id: "track2",
        name: "Open Eye Signal",
        artistNames: ["Jon Hopkins"],
        imageUrl: null,
        durationMs: null,
      },
    },
  })
  const player = page.getByRole("region", {
    name: "Spotify player",
    exact: true,
  })
  await expect(player.getByText("Open Eye Signal")).toBeVisible()
  await player.getByRole("button", { name: "Next track" }).click()
  await expect
    .poll(() => fixture.commands.at(-1))
    .toEqual({ action: "player/next", input: { deviceId: "fixture-speaker" } })
  fixture.setStatus({
    ...fixturePlayerStatus,
    playback: {
      ...fixturePlayerStatus.playback,
      item: {
        kind: "track",
        id: "track3",
        name: "Blue in Green",
        artistNames: ["Miles Davis"],
        imageUrl: null,
        durationMs: null,
      },
    },
  })
  await expect(player.getByText("Blue in Green")).toBeVisible()
  await expect(
    page.getByText("Request sent. Waiting for Spotify…")
  ).toHaveCount(0)
})
