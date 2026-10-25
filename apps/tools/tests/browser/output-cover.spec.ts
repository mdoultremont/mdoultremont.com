import { expect, test, type Page } from "@playwright/test"
import { musicFixtureResponses } from "./support/music-fixtures"

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
)

async function openJazz(page: Page, upload: (input: unknown) => unknown) {
  await page.route("**/api/rpc/music/**", async (route) => {
    const action = new URL(route.request().url()).pathname.replace(
      "/api/rpc/music/",
      ""
    )
    const input = route.request().postDataJSON()?.json ?? {}
    if (action === "spotify/setPlaylistCover") {
      const failure = upload(input)
      if (failure)
        return route.fulfill({ status: 409, json: { json: failure } })
      return route.fulfill({ json: { json: { status: "accepted" } } })
    }
    await route.fulfill({
      json: { json: musicFixtureResponses[action]!(input) },
    })
  })
  await page.goto("/music/settings")
  await page.waitForLoadState("networkidle")
  await page.evaluate(async (modulePath) => {
    const m = await import(modulePath)
    await m.mountMusic()
  }, "/tests/browser/support/mount-music.tsx")
  await page
    .locator('a[data-sidebar="menu-button"][href="/music/output/jazz"]')
    .click()
  await page.getByRole("button", { name: "Late night jazz actions" }).click()
  await page.getByRole("menuitem", { name: "Change cover" }).click()
  const dialog = page.getByRole("dialog", { name: "Change cover" })
  await dialog
    .getByLabel("Image")
    .setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: png })
  await expect(dialog.getByRole("img", { name: "New cover" })).toBeVisible()
  await dialog.getByRole("button", { name: "Upload to Spotify" }).click()
  return dialog
}

test("uploads a square JPEG cover and shows it before Spotify catches up", async ({
  page,
}) => {
  const uploads: { playlistId: string; image: string }[] = []
  const dialog = await openJazz(page, (input) => {
    uploads.push(input as { playlistId: string; image: string })
  })
  await expect(dialog).toBeHidden()
  expect(uploads).toHaveLength(1)
  expect(uploads[0]!.playlistId).toBe("jazz")
  expect(uploads[0]!.image).toMatch(/^\/9j\/[A-Za-z0-9+/]+={0,2}$/u)
  const uploaded = "data:image/jpeg;base64," + uploads[0]!.image
  await expect(
    page.locator('a[data-sidebar="menu-button"][href="/music/output/jazz"] img')
  ).toHaveAttribute("src", uploaded)
  await expect(page.locator("h1 img")).toHaveAttribute("src", uploaded)
})

test("offers to reconnect when Spotify lacks the cover permission", async ({
  page,
}) => {
  const dialog = await openJazz(page, () => ({
    defined: false,
    code: "CONFLICT",
    status: 409,
    message: "Connect Spotify again to allow changing playlist covers",
    data: { reason: "CoverPermissionMissing" },
  }))
  await expect(
    dialog.getByRole("link", { name: "Connect Spotify again" })
  ).toHaveAttribute("href", "/api/music/spotify/connect")
  await expect(page.locator("h1 img")).toHaveCount(0)
})
