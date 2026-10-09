import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import type { Ingestion } from "@/backend/features/music/ingestion"
import { IngestionPanel } from "./ingestion-panel"

const ingestion: Ingestion = {
  id: "ing-1",
  ownerId: "owner",
  kind: "full",
  status: "running",
  cursor: "cursor-50",
  pages: 1,
  seen: 50,
  added: 50,
  unliked: 0,
  total: 2340,
  error: null,
  startedAt: 1,
  updatedAt: 2,
  finishedAt: null,
}

const render = (latest: Ingestion | null, liked = 0, unliked = 0) =>
  renderToStaticMarkup(
    createElement(IngestionPanel, {
      csrfToken: "csrf",
      initialStatus: { latest, liked, unliked },
    })
  )

describe("ingestion panel", () => {
  test("invites the first ingestion when nothing has been read", () => {
    expect(render(null)).toContain("No likes ingested yet")
  })

  test("shows progress and disables starting another while reading", () => {
    const html = render(ingestion, 50)
    expect(html).toContain("Reading all likes: 50 of 2340 likes read")
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Check for new likes/)
  })

  test("summarises a finished full ingestion with un-likes", () => {
    const html = render(
      {
        ...ingestion,
        status: "completed",
        unliked: 3,
        added: 4,
        finishedAt: 3,
      },
      2337,
      3
    )
    expect(html).toContain("4 new · 3 un-liked")
    expect(html).toContain("2337 liked · 3 un-liked")
    expect(html).not.toMatch(/<button[^>]*disabled=""/)
  })

  test("shows why an ingestion stopped", () => {
    const html = render({
      ...ingestion,
      status: "failed",
      error: "Spotify needs to be reconnected",
    })
    expect(html).toContain("stopped after 50 of 2340 likes read")
    expect(html).toContain("Spotify needs to be reconnected")
  })
})
