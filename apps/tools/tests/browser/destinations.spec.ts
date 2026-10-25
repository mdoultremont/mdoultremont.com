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
  const writes: { action: string; input: Record<string, unknown> }[] = []
  const spotifyPlaylists = [
    {
      id: "jazz",
      name: "Jazz",
      ownerId: "owner",
      public: false,
      collaborative: false,
      description: "Late-night trio recordings",
      imageUrl: null,
    },
    {
      id: "review",
      name: "Review",
      ownerId: "owner",
      public: false,
      collaborative: false,
      description: null,
      imageUrl: null,
    },
  ]
  const actions: Record<string, (input: Record<string, unknown>) => unknown> = {
    "destinations/get": () => ({
      destinations,
      reviewPlaylistId,
      ready: false,
    }),
    "spotify/playlists": () => ({ items: spotifyPlaylists }),
    "destinations/save": (input) => {
      const destination = {
        playlistId: String(input.playlistId),
        description: String(input.description),
        enabled: Boolean(input.enabled),
        createdAt: 1,
        updatedAt: 1,
      }
      const index = destinations.findIndex(
        (item) => item.playlistId === destination.playlistId
      )
      if (index >= 0) destinations[index] = destination
      else destinations.push(destination)
      return { destination }
    },
    "destinations/create": (input) => {
      const name = String(input.name)
      const description = String(input.description)
      const destination = {
        playlistId: "private-created",
        description,
        enabled: Boolean(description.trim()),
        createdAt: 1,
        updatedAt: 1,
      }
      destinations.push(destination)
      spotifyPlaylists.push({
        id: "private-created",
        name,
        ownerId: "owner",
        public: false,
        collaborative: false,
        description: null,
        imageUrl: null,
      })
      return { playlist: { id: "private-created", name }, destination }
    },
    "destinations/setReviewPlaylist": (input) => {
      reviewPlaylistId =
        typeof input.playlistId === "string" ? input.playlistId : null
      return { reviewPlaylistId }
    },
  }
  await page.route("**/api/rpc/music/**", async (route) => {
    const action = new URL(route.request().url()).pathname.replace(
      "/api/rpc/music/",
      ""
    )
    const input = (route.request().postDataJSON()?.json ?? {}) as Record<
      string,
      unknown
    >
    if (!action.endsWith("/get") && action !== "spotify/playlists")
      writes.push({ action, input })
    await route.fulfill({ json: { json: actions[action]!(input) } })
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
  await expect(jazz.getByText("Late-night trio recordings")).toBeVisible()
  await jazz.getByRole("button", { name: "Edit description" }).click()
  await jazz
    .getByLabel("Which tracks belong here?")
    .fill("Improvised acoustic music")
  await jazz.getByRole("button", { name: "Save description" }).click()
  await expect(jazz.getByText("Improvised acoustic music")).toBeVisible()
  await jazz.getByRole("button", { name: "Use playlist" }).click()
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
      action: "destinations/save",
      input: {
        playlistId: "jazz",
        description: "Late-night trio recordings",
        enabled: false,
      },
    },
    {
      action: "destinations/save",
      input: {
        playlistId: "jazz",
        description: "Improvised acoustic music",
        enabled: false,
      },
    },
    {
      action: "destinations/save",
      input: {
        playlistId: "jazz",
        description: "Improvised acoustic music",
        enabled: true,
      },
    },
    {
      action: "destinations/create",
      input: { name: "Focus mix", description: "" },
    },
  ])
})
