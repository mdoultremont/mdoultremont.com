import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import type { EnrichmentStatus } from "@/backend/features/music/enrichment"
import { EnrichmentPanel } from "./enrichment-panel"

const status: EnrichmentStatus = {
  enriched: 120,
  withAnalysis: 80,
  notFound: 6,
  ambiguous: 2,
  failed: 0,
  pending: 40,
  withoutIsrc: 3,
}

const render = (value: EnrichmentStatus) =>
  renderToStaticMarkup(createElement(EnrichmentPanel, { initialStatus: value }))

describe("enrichment panel", () => {
  test("shows lookups in progress and why tracks lack recording data", () => {
    const html = render(status)
    expect(html).toContain("120 with recording data")
    expect(html).toContain("Looking up recordings: 40 waiting")
    expect(html).toContain("Not on MusicBrainz")
    expect(html).not.toMatch(/<button[^>]*disabled=""/)
  })

  test("offers no retry when every lookup resolved", () => {
    const html = render({ ...status, notFound: 0, ambiguous: 0, pending: 0 })
    expect(html).toContain("All liked tracks have been looked up")
    expect(html).toMatch(/<button[^>]*disabled=""/)
  })
})
