import { expect, test } from "@playwright/test"

test("owner configures a destination and a distinct review playlist", async ({
  page,
}) => {
  const destinations: {
    playlistId: string
    description: string
    enabled: boolean
    createdAt: number
    updatedAt: number
  }[] = []
  let reviewPlaylistId: string | null = null
  const writes: {
    method: string
    csrf: string | undefined
    body: Record<string, unknown>
  }[] = []
  await page.route("**/api/music/destinations", async (route) => {
    const request = route.request()
    if (request.method() === "GET") {
      await route.fulfill({ json: { destinations, reviewPlaylistId } })
      return
    }
    const body = request.postDataJSON() as Record<string, unknown>
    writes.push({
      method: request.method(),
      csrf: request.headers()["x-csrf-token"],
      body,
    })
    if (request.method() === "PUT") {
      const index = destinations.findIndex(
        (item) => item.playlistId === body.playlistId
      )
      const destination = {
        playlistId: String(body.playlistId),
        description: String(body.description),
        enabled: Boolean(body.enabled),
        createdAt: 1,
        updatedAt: 1,
      }
      if (index >= 0) destinations[index] = destination
      else destinations.push(destination)
    }
    await route.fulfill({ json: { ok: true } })
  })
  await page.route("**/api/music/review-playlist", async (route) => {
    const request = route.request()
    const body = request.postDataJSON() as { playlistId: string | null }
    writes.push({
      method: request.method(),
      csrf: request.headers()["x-csrf-token"],
      body,
    })
    reviewPlaylistId = body.playlistId
    await route.fulfill({ json: { reviewPlaylistId } })
  })
  await page.route("**/api/spotify/playlists", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            id: "jazz",
            name: "Jazz",
            ownerId: "owner",
            public: false,
            collaborative: false,
          },
          {
            id: "review",
            name: "Review",
            ownerId: "owner",
            public: false,
            collaborative: false,
          },
        ],
      },
    })
  })

  await page.goto("/music")
  await page.evaluate(async (modulePath) => {
    const module = await import(modulePath)
    module.mountDestinationPanel()
  }, "/tests/browser/support/mount-destinations.tsx")

  const panel = page.getByRole("region", { name: "Playlist destinations" })
  await expect(
    panel.getByRole("heading", { name: "Attach an existing playlist" })
  ).toBeVisible()
  await panel.getByLabel("Spotify playlist").first().selectOption("jazz")
  await panel
    .getByLabel("Classification description")
    .first()
    .fill("Improvised acoustic music")
  await panel.getByRole("button", { name: "Attach destination" }).click()
  await expect(panel.getByText("Improvised acoustic music")).toBeVisible()
  await panel.getByLabel("Spotify playlist").last().selectOption("review")
  await panel.getByRole("button", { name: "Save review playlist" }).click()
  await expect(panel.getByLabel("Spotify playlist").last()).toHaveValue(
    "review"
  )
  expect(writes).toEqual([
    {
      method: "PUT",
      csrf: "test-csrf",
      body: {
        playlistId: "jazz",
        description: "Improvised acoustic music",
        enabled: true,
      },
    },
    { method: "PUT", csrf: "test-csrf", body: { playlistId: "review" } },
  ])
})
