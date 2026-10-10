import { expect, test } from "@playwright/test"

test("anonymous visitors see owner sign-in without private controls", async ({
  page,
}) => {
  await page.goto("/music")

  await expect(
    page.getByRole("heading", { name: "Music control" })
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Continue with GitHub" })
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Continue with Spotify" })
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0)
})

test("a refused sign-in explains why", async ({ page }) => {
  await page.goto("/music?error=not_allowed")

  await expect(page.getByRole("alert")).toHaveText(
    "This account is not allowed to use the private area."
  )
})
