import { expect, test } from "@playwright/test"

test("owner adds playlists, describes them, and chooses tracks needing review", async ({
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
  const spotifyPlaylists = [
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
  ]
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
  await page.route("**/api/music/destinations/create", async (route) => {
    const body = route.request().postDataJSON() as {
      name: string
      description: string
    }
    writes.push({
      method: route.request().method(),
      csrf: route.request().headers()["x-csrf-token"],
      body,
    })
    const destination = {
      playlistId: "private-created",
      description: body.description,
      enabled: Boolean(body.description.trim()),
      createdAt: 1,
      updatedAt: 1,
    }
    destinations.push(destination)
    spotifyPlaylists.push({
      id: "private-created",
      name: body.name,
      ownerId: "owner",
      public: false,
      collaborative: false,
    })
    await route.fulfill({
      status: 201,
      json: {
        playlist: { id: "private-created", name: body.name },
        destination,
      },
    })
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
    await route.fulfill({ json: { items: spotifyPlaylists } })
  })

  await page.goto("/music")
  await page.evaluate(async (modulePath) => {
    const module = await import(modulePath)
    module.mountDestinationPanel()
  }, "/tests/browser/support/mount-destinations.tsx")

  const panel = page.getByRole("region", { name: "Playlists" })
  const picker = panel.getByRole("combobox", {
    name: "Search Spotify playlists",
  })
  const suggestions = page.getByRole("listbox")
  await picker.fill("Jazz")
  await suggestions.getByRole("option", { name: "Jazz" }).click()
  await panel.getByRole("button", { name: "Add playlist" }).click()
  const jazz = panel.getByRole("listitem").filter({ hasText: "Jazz" })
  await expect(
    jazz.getByText("Add a track description to use this playlist")
  ).toBeVisible()
  await expect(
    jazz.getByRole("button", { name: "Use playlist" })
  ).toBeDisabled()
  await jazz.getByRole("button", { name: "Edit description" }).click()
  await jazz
    .getByLabel("Which tracks belong here?")
    .fill("Improvised acoustic music")
  await jazz.getByRole("button", { name: "Save description" }).click()
  await expect(jazz.getByText("Improvised acoustic music")).toBeVisible()
  await expect(jazz.getByRole("button", { name: "Pause" })).toBeEnabled()

  await picker.fill("Focus mix")
  await expect(
    suggestions.getByRole("option", { name: "Create “Focus mix”" })
  ).toBeVisible()
  await picker.press("ArrowDown")
  await picker.press("Enter")
  await expect(panel.getByRole("list").getByText("Focus mix")).toBeVisible()
  await expect(
    panel.getByRole("heading", { name: "Tracks needing review" })
  ).toBeVisible()
  expect(writes).toEqual([
    {
      method: "PUT",
      csrf: "test-csrf",
      body: {
        playlistId: "jazz",
        description: "",
        enabled: false,
      },
    },
    {
      method: "PUT",
      csrf: "test-csrf",
      body: {
        playlistId: "jazz",
        description: "Improvised acoustic music",
        enabled: true,
      },
    },
    {
      method: "POST",
      csrf: "test-csrf",
      body: { name: "Focus mix", description: "" },
    },
  ])
})
