import { expect, test } from "@playwright/test"

test("back office lists users and invitations together, with actions in a row menu", async ({
  page,
}) => {
  const day = 24 * 60 * 60 * 1000
  const now = Date.now()
  const directory = {
    users: [
      {
        id: "owner",
        name: "Matthieu d'Oultremont",
        email: "hello@mdoultremont.com",
        image: null,
        providers: ["github"],
        apps: ["flights", "music", "backOffice"],
      },
      {
        id: "friend",
        name: "Ada Lovelace",
        email: "ada@example.com",
        image: null,
        providers: ["spotify"],
        apps: ["music"],
      },
    ],
    invitations: [
      {
        id: "invitation",
        email: "grace@example.com",
        apps: ["flights"],
        createdAt: now - day,
        expiresAt: now + 6 * day,
        expired: false,
      },
    ],
  }
  const writes: { url: string; method: string; body: unknown }[] = []
  await page.route("**/api/back-office/**", async (route) => {
    const request = route.request()
    if (request.method() === "GET") {
      await route.fulfill({ json: directory })
      return
    }
    writes.push({
      url: new URL(request.url()).pathname,
      method: request.method(),
      body: request.postDataJSON(),
    })
    await route.fulfill({ json: { status: "saved" } })
  })

  await page.goto("/music")
  await page.evaluate(async (modulePath) => {
    const module = await import(modulePath)
    module.mountUsersPanel("owner")
  }, "/tests/browser/support/mount-users.tsx")

  const table = page.getByRole("region", { name: "Users and invitations" })
  await expect(table.getByRole("row")).toHaveCount(4)
  await expect(
    table.getByRole("row", { name: /grace@example.com/ })
  ).toContainText("Pending")
  await expect(table.getByRole("checkbox")).toHaveCount(0)
  if (process.env.SCREENSHOT)
    await page.screenshot({ path: process.env.SCREENSHOT, fullPage: true })

  await page.getByRole("button", { name: "Actions for Ada Lovelace" }).click()
  await page.getByRole("menuitem", { name: "Edit access" }).click()
  const dialog = page.getByRole("dialog", { name: "Edit access" })
  await dialog.getByRole("checkbox", { name: "Flights" }).click()
  await dialog.getByRole("button", { name: "Save" }).click()
  await expect(dialog).toBeHidden()
  expect(writes.at(-1)).toEqual({
    url: "/api/back-office/users",
    method: "PUT",
    body: { userId: "friend", apps: ["music", "flights"] },
  })

  await page
    .getByRole("button", { name: "Actions for Matthieu d'Oultremont" })
    .click()
  await expect(page.getByRole("menuitem")).toHaveText(["Edit access"])
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menu")).toBeHidden()

  await page
    .getByRole("button", { name: "Actions for grace@example.com" })
    .click()
  await expect(page.getByRole("menuitem")).toHaveText([
    "Send a new link",
    "Revoke",
  ])
  await page.getByRole("menuitem", { name: "Revoke" }).click()
  expect(writes.at(-1)).toEqual({
    url: "/api/back-office/invitations",
    method: "DELETE",
    body: { invitationId: "invitation" },
  })
})
