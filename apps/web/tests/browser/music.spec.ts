import { expect, test } from "@playwright/test"

test("anonymous visitors see GitHub sign-in without private controls", async ({
  page,
}) => {
  await page.goto("/music")

  await expect(
    page.getByRole("heading", { name: "Music control" })
  ).toBeVisible()
  await expect(
    page.getByRole("link", { name: "Continue with GitHub" })
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0)
})
