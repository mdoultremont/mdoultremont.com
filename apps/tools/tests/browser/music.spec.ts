import { expect, test } from "@playwright/test"

for (const path of [
  "/",
  "/music",
  "/music/input",
  "/music/output",
  "/music/settings",
]) {
  test(`anonymous visitors to ${path} see sign-in, not the app`, async ({
    page,
  }) => {
    await page.goto(path)

    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Continue with GitHub" })
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Continue with Spotify" })
    ).toBeVisible()
    await expect(
      page.getByRole("heading", {
        name: /^(Input playlists|Output playlists|Settings)$/,
      })
    ).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0)
  })
}

test("a refused sign-in explains why", async ({ page }) => {
  await page.goto("/music?error=not_allowed")

  await expect(page.getByRole("alert")).toHaveText(
    "This account is not allowed to use the private area."
  )
})

test("Spotify callback results return to connection settings", async ({
  page,
}) => {
  await page.goto("/music?spotify=ingestion_failed")
  await expect(page).toHaveURL(/\/music\/settings\?spotify=ingestion_failed$/)
})
