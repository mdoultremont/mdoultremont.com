import { expect, test } from "@playwright/test"
import type { Source } from "@mdoultremont/tools-contracts/music"
import { fixtureSources, musicFixtureResponses } from "./support/music-fixtures"

test.beforeEach(async ({ page }) => {
  await page.route("**/api/rpc/music/**", async (route) => {
    const action = new URL(route.request().url()).pathname.replace(
      "/api/rpc/music/",
      ""
    )
    const input = route.request().postDataJSON()?.json ?? {}
    const response = musicFixtureResponses[action]
    if (!response) throw new Error("Missing music fixture for " + action)
    await route.fulfill({ json: { json: response(input) } })
  })
  await page.goto("/music/settings")
  await page.waitForLoadState("networkidle")
})

test("music sections show configured input, output, and review tracks", async ({
  page,
}) => {
  await page.evaluate(async (modulePath) => {
    const m = await import(modulePath)
    await m.mountMusic()
  }, "/tests/browser/support/mount-music.tsx")
  await expect(
    page.locator('a[data-sidebar="menu-button"][href="/music/input"]')
  ).toHaveAttribute("aria-current", "page")
  await expect(
    page.getByRole("heading", { name: "Liked Songs", exact: true })
  ).toBeVisible()
  await expect(page.getByText("Radiohead", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: /Discoveries/ })).toContainText(
    "Paused"
  )
  await page.getByRole("button", { name: /Discoveries/ }).focus()
  await page.keyboard.press("Enter")
  await expect(
    page.getByRole("heading", { name: "Discoveries", exact: true })
  ).toBeVisible()
  await expect(
    page.getByText("2 tracks loaded · 2 Spotify items")
  ).toBeVisible()
  await page
    .locator('a[data-sidebar="menu-button"][href="/music/output"]')
    .click()
  await expect(
    page.locator('a[data-sidebar="menu-button"][href="/music/output"]')
  ).toHaveAttribute("aria-current", "page")
  await expect(
    page.getByRole("heading", { name: "Late night jazz", exact: true })
  ).toBeVisible()
  await expect(page.getByText("Blue in Green", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: /To discover/ }).click()
  await expect(
    page.getByText("No available tracks in this playlist.")
  ).toBeVisible()
  await page
    .locator('a[data-sidebar="menu-button"][href="/music/settings"]')
    .click()
  await expect(
    page.getByRole("button", { name: "Disconnect Spotify" })
  ).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "Classification", exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("link", { name: "Dashboard", exact: true })
  ).toHaveCount(0)
})

test("mobile navigation closes after selecting a music section", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(async (modulePath) => {
    const m = await import(modulePath)
    await m.mountMusic()
  }, "/tests/browser/support/mount-music.tsx")
  await expect(
    page.getByText("Everything In Its Right Place", { exact: true })
  ).toBeVisible()
  await page.getByRole("button", { name: "Toggle Sidebar" }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await page
    .locator('a[data-sidebar="menu-button"][href="/music/output"]')
    .click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(
    page.getByRole("heading", { name: "Late night jazz", exact: true })
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true)
})

test("source changes refresh the browser without duplicating Liked Songs", async ({
  page,
}) => {
  let sources: Source[] = fixtureSources.map((source) => ({ ...source }))
  await page.route("**/api/rpc/music/sources/**", async (route) => {
    const action = new URL(route.request().url()).pathname.split("/").at(-1)
    const input = route.request().postDataJSON()?.json ?? {}
    if (action === "add")
      sources.push({
        ...fixtureSources[1]!,
        sourceId: { kind: "playlist", playlistId: input.playlistId },
        enabled: true,
      })
    if (action === "remove")
      sources = sources.filter(
        (source) =>
          source.sourceId.kind !== "playlist" ||
          source.sourceId.playlistId !== input.playlistId
      )
    await route.fulfill({
      json: {
        json:
          action === "get"
            ? { sources }
            : { status: action === "add" ? "added" : "removed" },
      },
    })
  })
  await page.evaluate(async (modulePath) => {
    const module = await import(modulePath)
    await module.mountMusic()
  }, "/tests/browser/support/mount-music.tsx")
  await page.getByText("Manage input sources", { exact: true }).click()
  const panel = page.getByRole("region", { name: "Sources", exact: true })
  await panel
    .getByRole("combobox", { name: "Search Spotify playlists" })
    .fill("Fresh")
  await page.getByRole("option", { name: "Fresh finds" }).click()
  await panel.getByRole("button", { name: "Add source", exact: true }).click()
  const chooser = page.getByRole("navigation", { name: "Choose playlist" })
  await expect(
    chooser.getByRole("button", { name: /Fresh finds/ })
  ).toBeVisible()
  await expect(
    chooser.getByRole("button", { name: /Liked Songs/ })
  ).toHaveCount(1)
  await chooser.getByRole("button", { name: /Fresh finds/ }).click()
  await expect(
    page.getByRole("heading", { name: "Fresh finds", exact: true })
  ).toBeVisible()
  await panel
    .getByRole("listitem")
    .filter({ hasText: "Fresh finds" })
    .getByRole("button", { name: "Remove", exact: true })
    .click()
  await expect(
    chooser.getByRole("button", { name: /Fresh finds/ })
  ).toHaveCount(0)
  await expect(
    page.getByRole("heading", { name: "Playlist unavailable" })
  ).toBeVisible()
})
