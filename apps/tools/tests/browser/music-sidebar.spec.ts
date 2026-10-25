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

test("sidebar lists input and output playlists, each opening its own page, plus suggestions and settings", async ({
  page,
}) => {
  await page.evaluate(async (modulePath) => {
    const m = await import(modulePath)
    await m.mountMusic()
  }, "/tests/browser/support/mount-music.tsx")
  await expect(
    page.locator('a[data-sidebar="menu-button"][href="/music/input/liked"]')
  ).toHaveAttribute("aria-current", "page")
  await expect(
    page.getByRole("heading", { level: 1, name: "Liked Songs", exact: true })
  ).toBeVisible()
  await expect(
    page
      .getByRole("region", { name: "Liked Songs tracks", exact: true })
      .getByText("Radiohead", { exact: true })
  ).toBeVisible()
  const discoveries = page.locator(
    'a[data-sidebar="menu-button"][href="/music/input/inbox"]'
  )
  await expect(
    page.getByRole("listitem").filter({ has: discoveries })
  ).toContainText("Paused")
  await discoveries.focus()
  await page.keyboard.press("Enter")
  await expect(
    page.getByRole("heading", { level: 1, name: /Discoveries/ })
  ).toContainText("Paused")
  await expect(
    page.getByText("2 tracks loaded · 2 Spotify items")
  ).toBeVisible()
  const jazz = page.locator(
    'a[data-sidebar="menu-button"][href="/music/output/jazz"]'
  )
  await jazz.click()
  await expect(jazz).toHaveAttribute("aria-current", "page")
  await expect(
    page.getByRole("heading", { level: 1, name: "Late night jazz" })
  ).toBeVisible()
  await expect(
    page
      .locator("header")
      .getByRole("button", { name: "Late night jazz actions" })
  ).toBeVisible()
  await expect(page.getByText("Blue in Green", { exact: true })).toBeVisible()
  await expect(page.getByText("1 track loaded · 1 Spotify item")).toBeVisible()
  const review = page.locator(
    'a[data-sidebar="menu-button"][href="/music/output/review"]'
  )
  await review.click()
  await expect(
    page.getByRole("heading", { level: 1, name: /To discover/ })
  ).toContainText("Review")
  await expect(
    page.getByText("No available tracks in this playlist.")
  ).toBeVisible()
  const suggest = page.locator(
    'a[data-sidebar="menu-button"][href="/music/output"]'
  )
  await expect(suggest).toHaveText("Suggest playlists")
  await suggest.click()
  await expect(suggest).toHaveAttribute("aria-current", "page")
  await expect(
    page.getByRole("region", { name: "Suggested playlists", exact: true })
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
  await expect(page.locator('[data-sidebar="group-label"]')).toHaveText([
    "Input playlists",
    "Output playlists",
  ])
  const footer = page.locator('[data-sidebar="footer"]')
  const settings = footer.locator('a[href="/music/settings"]')
  await expect(settings).toHaveText("Settings")
  const [settingsBox, playerBox] = await Promise.all([
    settings.boundingBox(),
    page
      .getByRole("region", { name: "Spotify player", exact: true })
      .boundingBox(),
  ])
  expect(settingsBox!.y + settingsBox!.height).toBeLessThanOrEqual(playerBox!.y)
})

test("the page scrolls inside the panel while the sidebar and header stay put", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 600 })
  await page.evaluate(async (modulePath) => {
    const m = await import(modulePath)
    await m.mountMusic()
  }, "/tests/browser/support/mount-music.tsx")
  await page
    .locator('a[data-sidebar="menu-button"][href="/music/settings"]')
    .click()
  await expect(
    page.getByRole("heading", { name: "Classification", exact: true })
  ).toBeVisible()
  const scroller = page.locator('[data-slot="app-scroll-area"]')
  expect(
    await scroller.evaluate(
      (element) => element.scrollHeight > element.clientHeight
    )
  ).toBe(true)
  await scroller.evaluate((element) => element.scrollTo(0, 400))
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  await expect(
    page.getByRole("button", { name: "Toggle Sidebar" })
  ).toBeInViewport()
  await expect(
    page.getByRole("region", { name: "Spotify player", exact: true })
  ).toBeInViewport()
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
    page
      .getByRole("region", { name: "Liked Songs tracks", exact: true })
      .getByText("Everything In Its Right Place", { exact: true })
  ).toBeVisible()
  await page.getByRole("button", { name: "Toggle Sidebar" }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await page
    .locator('a[data-sidebar="menu-button"][href="/music/output/jazz"]')
    .click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(
    page.getByRole("heading", { level: 1, name: "Late night jazz" })
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true)
})

test("input playlists are added from the sidebar and removed from their page", async ({
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
  await page.getByRole("button", { name: "Add input playlist" }).click()
  const dialog = page.getByRole("dialog", { name: "Add input playlist" })
  await dialog
    .getByRole("combobox", { name: "Search Spotify playlists" })
    .fill("Fresh")
  await page.getByRole("option", { name: "Fresh finds" }).click()
  await dialog
    .getByRole("button", { name: "Add playlist", exact: true })
    .click()
  await expect(dialog).toHaveCount(0)
  await expect(
    page.getByRole("heading", { level: 1, name: "Fresh finds" })
  ).toBeVisible()
  const sidebarLinks = page.locator('a[data-sidebar="menu-button"]')
  await expect(sidebarLinks.filter({ hasText: "Fresh finds" })).toHaveAttribute(
    "aria-current",
    "page"
  )
  await expect(sidebarLinks.filter({ hasText: "Liked Songs" })).toHaveCount(1)
  await page.getByRole("button", { name: "Fresh finds actions" }).click()
  await page.getByRole("menuitem", { name: "Remove input playlist" }).click()
  await page
    .getByRole("alertdialog", { name: "Remove Fresh finds?" })
    .getByRole("button", { name: "Remove", exact: true })
    .click()
  await expect(sidebarLinks.filter({ hasText: "Fresh finds" })).toHaveCount(0)
  await expect(
    page.getByRole("heading", { level: 1, name: "Liked Songs" })
  ).toBeVisible()
})
