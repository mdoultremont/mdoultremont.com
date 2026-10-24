import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import type { Ingestion, Source } from "@mdoultremont/tools-contracts/music"
import { IngestionPanel } from "./ingestion-panel"

const ingestion: Ingestion = {
  id: "ing-1",
  ownerId: "owner",
  source: { kind: "liked" },
  snapshotId: null,
  kind: "full",
  status: "running",
  cursor: "cursor-50",
  pages: 1,
  seen: 50,
  added: 50,
  removed: 0,
  total: 2340,
  error: null,
  startedAt: 1,
  updatedAt: 2,
  finishedAt: null,
}
const source = (
  latest: Ingestion | null,
  present = 0,
  removed = 0
): Source => ({
  sourceId: latest?.source ?? { kind: "liked" },
  enabled: true,
  snapshotId: null,
  createdAt: 1,
  updatedAt: 1,
  present,
  removed,
  latest,
})
const render = (sources: readonly Source[]) =>
  renderToStaticMarkup(
    createElement(IngestionPanel, {
      initialStatus: { sources, present: 0, removed: 0 },
    })
  )

describe("sources panel", () => {
  test("keeps Liked Songs as a source with no remove button", () => {
    const html = render([source(null)])
    expect(html).toContain("Liked Songs")
    expect(html).toContain("No tracks read yet")
    expect(html).not.toContain(">Remove<")
  })
  test("shows per-source progress and disables manual reads while reading", () => {
    const html = render([source(ingestion, 50)])
    expect(html).toContain("Reading all tracks: 50 of 2340 tracks read")
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Check for new/)
  })
  test("shows completed removals and a paused playlist source", () => {
    const html = render([
      source(
        {
          ...ingestion,
          status: "completed",
          removed: 3,
          added: 4,
          finishedAt: 3,
        },
        2337,
        3
      ),
      {
        ...source(null, 20),
        sourceId: { kind: "playlist", playlistId: "shazam" },
        enabled: false,
      },
    ])
    expect(html).toContain("4 new · 3 removed")
    expect(html).toContain("2337 present · 3 removed")
    expect(html).toContain("Paused")
    expect(html).toContain(">Remove<")
  })
  test("explains an ingestion failure", () => {
    const html = render([
      source({
        ...ingestion,
        status: "failed",
        error: "Spotify needs to be reconnected",
      }),
    ])
    expect(html).toContain("stopped after 50 of 2340 tracks read")
    expect(html).toContain("Spotify needs to be reconnected")
  })
  test("explains unchanged playlists and disables reads when every source is paused", () => {
    const html = render([
      {
        ...source({
          ...ingestion,
          source: { kind: "playlist", playlistId: "shazam" },
          status: "completed",
          pages: 0,
          seen: 0,
          added: 0,
          total: null,
          finishedAt: 3,
        }),
        enabled: false,
      },
    ])
    expect(html).toContain("No changes")
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Read everything again/)
  })
})
