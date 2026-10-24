import { expect, test } from "@playwright/test"
import type {
  Ingestion,
  Source,
  SourceId,
} from "@mdoultremont/tools-contracts/music"

const source = (sourceId: SourceId): Source => ({
  sourceId,
  enabled: true,
  snapshotId: null,
  createdAt: 1,
  updatedAt: 1,
  present: 0,
  removed: 0,
  latest: null,
})

for (const width of [1280, 390]) {
  test(`owner manages sources and reads every enabled source at width ${width}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    let sources: Source[] = [source({ kind: "liked" })]
    const writes: { action: string; input: Record<string, unknown> }[] = []
    const playlists = [
      { id: "shazam", name: "My Shazam Tracks" },
      { id: "destination", name: "Jazz destination" },
      { id: "review", name: "Review playlist" },
    ].map((playlist) => ({
      ...playlist,
      ownerId: "owner",
      public: false,
      collaborative: false,
    }))
    const actions: Record<string, (input: Record<string, unknown>) => unknown> =
      {
        "sources/get": () => ({ sources }),
        "spotify/playlists": () => ({ items: playlists }),
        "destinations/get": () => ({
          destinations: [
            {
              playlistId: "destination",
              description: "Jazz",
              enabled: false,
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          reviewPlaylistId: "review",
          ready: false,
        }),
        "sources/add": (input) => {
          sources.push({
            ...source({
              kind: "playlist",
              playlistId: String(input.playlistId),
            }),
            present: 20,
          })
          return { status: "added" }
        },
        "sources/setEnabled": (input) => {
          sources = sources.map((item) =>
            JSON.stringify(item.sourceId) === JSON.stringify(input.sourceId)
              ? { ...item, enabled: Boolean(input.enabled) }
              : item
          )
          return { enabled: Boolean(input.enabled) }
        },
        "sources/remove": (input) => {
          sources = sources.filter(
            (item) =>
              item.sourceId.kind !== "playlist" ||
              item.sourceId.playlistId !== input.playlistId
          )
          return { status: "removed" }
        },
        "ingestion/start": (input) => {
          const ingestions: Ingestion[] = sources
            .filter((item) => item.enabled)
            .map((item, index) => ({
              id: `read-${String(input.kind)}-${index}`,
              ownerId: "owner",
              source: item.sourceId,
              snapshotId: null,
              kind: input.kind as "full" | "incremental",
              status: "completed",
              cursor: null,
              pages: 1,
              seen: 20,
              added: 2,
              removed: 1,
              total: 20,
              error: null,
              startedAt: 1,
              updatedAt: 2,
              finishedAt: 2,
            }))
          sources = sources.map((item) => ({
            ...item,
            latest:
              ingestions.find(
                (entry) =>
                  JSON.stringify(entry.source) === JSON.stringify(item.sourceId)
              ) ?? item.latest,
          }))
          return { ingestions }
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
      if (
        [
          "sources/add",
          "sources/setEnabled",
          "sources/remove",
          "ingestion/start",
        ].includes(action)
      )
        writes.push({ action, input })
      await route.fulfill({ json: { json: actions[action]!(input) } })
    })
    await page.goto("/music/input")
    await page.waitForLoadState("networkidle")
    await page.evaluate(async (modulePath) => {
      const module = await import(modulePath)
      module.mountSourcesPanel()
    }, "/tests/browser/support/mount-sources.tsx")
    const panel = page.getByRole("region", { name: "Sources" })
    const liked = panel.getByRole("listitem").filter({ hasText: "Liked Songs" })
    await expect(
      liked.getByRole("checkbox", { name: "Use Liked Songs as a source" })
    ).toBeChecked()
    await expect(liked.getByRole("button", { name: "Remove" })).toHaveCount(0)
    const picker = panel.getByRole("combobox", {
      name: "Search Spotify playlists",
    })
    await picker.fill("Jazz")
    await expect(
      page.getByRole("option", { name: "Jazz destination" })
    ).toHaveCount(0)
    await expect(page.getByRole("option", { name: /Create/ })).toHaveCount(0)
    await picker.fill("Review")
    await expect(
      page.getByRole("option", { name: "Review playlist" })
    ).toHaveCount(0)
    await picker.fill("Shazam")
    await page.getByRole("option", { name: "My Shazam Tracks" }).click()
    await panel.getByRole("button", { name: "Add source", exact: true }).click()
    const shazam = panel
      .getByRole("listitem")
      .filter({ hasText: "My Shazam Tracks" })
    await expect(shazam.getByText("20 present")).toBeVisible()
    await panel.getByRole("button", { name: "Read everything again" }).click()
    await expect(shazam.getByRole("status")).toContainText("2 new · 1 removed")
    await panel.screenshot({ path: testInfo.outputPath("sources.png") })
    await liked.getByRole("checkbox").click()
    await expect(liked.getByText("Paused", { exact: true })).toBeVisible()
    await panel
      .getByRole("button", { name: "Check for new", exact: true })
      .click()
    await expect(shazam.getByRole("status")).toContainText("Read changes")
    await shazam.getByRole("checkbox").click()
    await expect(
      panel.getByRole("button", { name: "Check for new", exact: true })
    ).toBeDisabled()
    await shazam.getByRole("checkbox").click()
    await expect(shazam.getByRole("checkbox")).toBeChecked()
    await shazam.getByRole("button", { name: "Remove" }).click()
    await expect(shazam).toHaveCount(0)
    expect(writes).toEqual([
      { action: "sources/add", input: { playlistId: "shazam" } },
      { action: "ingestion/start", input: { kind: "full" } },
      {
        action: "sources/setEnabled",
        input: { sourceId: { kind: "liked" }, enabled: false },
      },
      { action: "ingestion/start", input: { kind: "incremental" } },
      {
        action: "sources/setEnabled",
        input: {
          sourceId: { kind: "playlist", playlistId: "shazam" },
          enabled: false,
        },
      },
      {
        action: "sources/setEnabled",
        input: {
          sourceId: { kind: "playlist", playlistId: "shazam" },
          enabled: true,
        },
      },
      { action: "sources/remove", input: { playlistId: "shazam" } },
    ])
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
  })
}
