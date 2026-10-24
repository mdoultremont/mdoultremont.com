import { expect, test, type Page } from "@playwright/test"
import type { PlayerStatus } from "@mdoultremont/tools-contracts/music"
import {
  fixturePlayerStatus,
  fixtureTracks,
  musicFixtureResponses,
} from "./support/music-fixtures"

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
  let status = initialStatus
  const commands: { action: string; input: Record<string, unknown> }[] = []
  let statusReads = 0
  await page.route("**/api/rpc/music/**", async (route) => {
    const action = new URL(route.request().url()).pathname.replace(
      "/api/rpc/music/",
      ""
    )
    const input = route.request().postDataJSON()?.json ?? {}
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
  const chooser = page.getByRole("combobox", { name: "Play tracks on" })
  await chooser.focus()
  await page.keyboard.press("ArrowDown")
  await page.getByRole("option", { name: "Phone", exact: true }).click()
  expect(fixture.commands).toEqual([])
  const rows = page.getByRole("button", {
    name: "Play Open Eye Signal",
    exact: true,
  })
  await expect(rows).toHaveCount(2)
  await rows.nth(1).click()
  await expect(
    page.getByText("Request sent. Waiting for Spotify…")
  ).toBeVisible()
  expect(fixture.commands).toEqual([
    {
      action: "player/play",
      input: { deviceId: "fixture-phone", trackId: "track2" },
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
  await page.getByRole("combobox", { name: "Play tracks on" }).click()
  await page.getByRole("option", { name: "Phone", exact: true }).click()
  await page.getByRole("button", { name: "Pause playback" }).click()
  await expect(
    page.getByText("Request sent. Waiting for Spotify…")
  ).toBeVisible()
  expect(fixture.commands).toEqual([
    { action: "player/pause", input: { deviceId: "fixture-speaker" } },
  ])
  fixture.setStatus({
    ...fixturePlayerStatus,
    playback: { ...fixturePlayerStatus.playback, playing: false },
  })
  await expect(page.getByText("Paused on Living room speaker")).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Resume playback" })
  ).toBeEnabled()
})

test("one player preserves the chosen target through input, output, and settings navigation", async ({
  page,
}) => {
  const fixture = await fixtureMusic(page)
  await mountMusic(page)
  const chooser = page.getByRole("combobox", { name: "Play tracks on" })
  await chooser.click()
  await page.getByRole("option", { name: "Phone", exact: true }).click()
  const reads = fixture.statusReads()
  for (const section of ["output", "settings", "input"]) {
    await page
      .locator(`a[data-sidebar="menu-button"][href="/music/${section}"]`)
      .click()
    await expect(
      page.getByRole("heading", {
        name:
          section === "settings"
            ? "Settings"
            : `${section === "input" ? "Input" : "Output"} playlists`,
        exact: true,
      })
    ).toBeVisible()
    await expect(
      page.getByRole("region", { name: "Spotify player", exact: true })
    ).toHaveCount(1)
    await expect(chooser).toContainText("Phone")
  }
  expect(fixture.statusReads()).toBe(reads)
  expect(fixture.commands).toEqual([])
  await page.getByRole("button", { name: "Play A Walk", exact: true }).click()
  await expect
    .poll(() => fixture.commands)
    .toEqual([
      {
        action: "player/play",
        input: { deviceId: "fixture-phone", trackId: "track4" },
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
  await page.getByRole("button", { name: /Discoveries/ }).click()
  await expect(
    page.getByRole("heading", { name: "Discoveries", exact: true })
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
    page.getByRole("combobox", { name: "Play tracks on" })
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
