import { expect, test, type Page } from "@playwright/test"
import { destinationSuggestionFixtures } from "./support/music-fixtures"

async function mount(
  page: Page,
  overrides: Record<string, (input: Record<string, unknown>) => unknown> = {}
) {
  const fixtures: Record<string, (input: Record<string, unknown>) => unknown> =
    { ...destinationSuggestionFixtures(), ...overrides }
  const calls: { action: string; input: Record<string, unknown> }[] = []
  await page.route("**/api/rpc/music/**", async (route) => {
    const action = new URL(route.request().url()).pathname.replace(
      "/api/rpc/music/",
      ""
    )
    const input = route.request().postDataJSON()?.json ?? {}
    calls.push({ action, input })
    const response = fixtures[action]
    if (!response) throw new Error("Missing music fixture for " + action)
    await route.fulfill({ json: { json: await response(input) } })
  })
  await page.goto("/music/output")
  await page.waitForLoadState("networkidle")
  await page.evaluate(async (modulePath) => {
    const { mountMusic } = await import(modulePath)
    await mountMusic("/music/output")
  }, "/tests/browser/support/mount-music.tsx")
  const panel = page.getByRole("region", {
    name: "Suggested playlists",
    exact: true,
  })
  await expect(panel).toBeVisible()
  return { panel, calls }
}

test("suggests on demand, dismisses locally and creates a paused destination", async ({
  page,
}) => {
  const { panel, calls } = await mount(page)
  expect(
    calls.filter((call) => call.action === "destinations/suggest")
  ).toEqual([])
  await panel
    .getByRole("button", { name: "Suggest playlists", exact: true })
    .click()
  await expect(
    panel.getByText("Based on recording analysis for 80 of 123", {
      exact: false,
    })
  ).toBeVisible()
  const relaxed = panel
    .getByRole("listitem")
    .filter({ hasText: "Relaxed listening" })
  const electronic = panel
    .getByRole("listitem")
    .filter({ hasText: "Electronic" })
  await expect(
    relaxed.getByText("Estimated fit: 32 collected tracks")
  ).toBeVisible()
  await electronic.getByRole("button", { name: "Dismiss" }).click()
  await expect(electronic).toHaveCount(0)
  expect(calls.filter((call) => call.action === "destinations/create")).toEqual(
    []
  )
  await relaxed.getByRole("button", { name: "Create destination" }).click()
  await expect(panel.getByRole("status")).toContainText(
    "Created “Relaxed listening” as a paused destination"
  )
  await expect(
    panel.getByText("You have handled every suggestion.", { exact: false })
  ).toBeVisible()
  const created = page.locator(
    'a[data-sidebar="menu-button"][href="/music/output/suggested"]'
  )
  await expect(created).toHaveText("Relaxed listening")
  await expect(
    page.getByRole("listitem").filter({ has: created })
  ).toContainText("Paused")
  expect(calls.filter((call) => call.action === "destinations/create")).toEqual(
    [
      {
        action: "destinations/create",
        input: {
          name: "Relaxed listening",
          description: "Relaxed tracks with a calm mood.",
          enabled: false,
        },
      },
    ]
  )
  expect(
    calls.some((call) => /delivery|classification/.test(call.action))
  ).toBe(false)
})

test("prevents repeated generation and acceptance while requests are pending", async ({
  page,
}) => {
  let resolveSuggest!: (result: unknown) => void
  let resolveCreate!: (result: unknown) => void
  const fixtures = destinationSuggestionFixtures()
  const { panel, calls } = await mount(page, {
    "destinations/suggest": () =>
      new Promise((resolve) => {
        resolveSuggest = resolve
      }),
    "destinations/create": () =>
      new Promise((resolve) => {
        resolveCreate = resolve
      }),
  })
  await panel
    .getByRole("button", { name: "Suggest playlists", exact: true })
    .click()
  await expect(
    panel.getByRole("button", { name: "Suggesting playlists…" })
  ).toBeDisabled()
  resolveSuggest(fixtures["destinations/suggest"]())
  const item = panel
    .getByRole("listitem")
    .filter({ hasText: "Relaxed listening" })
  await item.getByRole("button", { name: "Create destination" }).click()
  await expect(
    item.getByRole("button", { name: "Creating destination…" })
  ).toBeDisabled()
  await expect(
    panel.getByRole("button", { name: "Suggest playlists", exact: true })
  ).toBeDisabled()
  resolveCreate(
    fixtures["destinations/create"]({
      name: "Relaxed listening",
      description: "Relaxed tracks with a calm mood.",
      enabled: false,
    })
  )
  await expect(panel.getByRole("status")).toContainText("Created")
  expect(
    calls.filter((call) => call.action === "destinations/create")
  ).toHaveLength(1)
})

for (const [status, message] of [
  ["empty_pool", "Your input pool is empty."],
  ["no_recording_data", "No usable recording analysis yet."],
  ["ready", "No suggestions to show."],
]) {
  test(`explains ${status} without a blank list`, async ({ page }) => {
    const { panel } = await mount(page, {
      "destinations/suggest": () => ({
        status,
        eligibleTracks: status === "empty_pool" ? 0 : 12,
        analyzedTracks: status === "ready" ? 8 : 0,
        suggestions: [],
      }),
    })
    await panel
      .getByRole("button", { name: "Suggest playlists", exact: true })
      .click()
    await expect(panel.getByText(message, { exact: false })).toBeVisible()
    await expect(panel.getByRole("listitem")).toHaveCount(0)
    await expect(
      panel.getByRole("button", { name: "Suggest playlists", exact: true })
    ).toBeEnabled()
  })
}

test("reports a model failure and allows a fresh request", async ({ page }) => {
  const { panel } = await mount(page)
  await page.route(
    "**/api/rpc/music/destinations/suggest",
    (route) =>
      route.fulfill({
        status: 503,
        json: {
          json: {
            defined: false,
            code: "SERVICE_UNAVAILABLE",
            status: 503,
            message:
              "Playlist suggestions could not be generated. Try again later.",
          },
        },
      }),
    { times: 1 }
  )
  await panel
    .getByRole("button", { name: "Suggest playlists", exact: true })
    .click()
  await expect(panel.getByRole("alert")).toContainText(
    "Playlist suggestions could not be generated"
  )
  await panel
    .getByRole("button", { name: "Suggest playlists", exact: true })
    .click()
  await expect(panel.getByRole("listitem")).toHaveCount(2)
})

test("keeps the suggestion and offers reconnect when Spotify cannot create the playlist", async ({
  page,
}) => {
  const { panel } = await mount(page)
  await page.route("**/api/rpc/music/destinations/create", (route) =>
    route.fulfill({
      status: 409,
      json: {
        json: {
          defined: false,
          code: "CONFLICT",
          status: 409,
          message: "Reconnect Spotify to continue",
          data: { reason: "ReconnectNeeded" },
        },
      },
    })
  )
  await panel
    .getByRole("button", { name: "Suggest playlists", exact: true })
    .click()
  const item = panel
    .getByRole("listitem")
    .filter({ hasText: "Relaxed listening" })
  await item.getByRole("button", { name: "Create destination" }).click()
  await expect(panel.getByRole("alert")).toContainText("Reconnect Spotify")
  await expect(
    panel.getByRole("link", { name: "Reconnect Spotify" })
  ).toHaveAttribute("href", "/api/music/spotify/connect")
  await expect(
    item.getByRole("button", { name: "Create destination" })
  ).toBeEnabled()
})
