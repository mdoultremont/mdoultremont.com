import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import type { EnrichmentStatus } from "@mdoultremont/tools-contracts/music"
import { EnrichmentPanel } from "./enrichment-panel"

const source = (
  name: EnrichmentStatus["sources"][number]["source"],
  counts: Partial<EnrichmentStatus["sources"][number]> = {}
) => ({
  source: name,
  configured: true,
  found: 0,
  notFound: 0,
  failed: 0,
  pending: 0,
  ...counts,
})

const status: EnrichmentStatus = {
  enriched: 120,
  withAnalysis: 80,
  matchedBySearch: 9,
  withTags: 90,
  notFound: 6,
  ambiguous: 2,
  failed: 0,
  pending: 40,
  withoutIsrc: 3,
  sources: [
    source("lastfm", { found: 84, notFound: 30, pending: 6 }),
    source("discogs", { configured: false }),
    source("listenbrainz", { found: 60, notFound: 60 }),
  ],
}

const settled: EnrichmentStatus = {
  ...status,
  notFound: 0,
  ambiguous: 0,
  pending: 0,
  sources: status.sources.map((entry) => ({
    ...entry,
    notFound: 0,
    failed: 0,
    pending: 0,
  })),
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

  test("shows coverage per source and how to enable a missing one", () => {
    const html = render(status)
    expect(html).toContain("Last.fm")
    expect(html).toContain("84 · 70%")
    expect(html).toContain("Not configured: set DISCOGS_TOKEN")
    expect(html).toContain("90 · 75%")
    expect(html).toContain("Data provided by")
  })

  test("reports tag lookups once recordings are all looked up", () => {
    const html = render({
      ...settled,
      sources: [source("lastfm", { pending: 6 })],
    })
    expect(html).toContain("Looking up tags: 6 lookups waiting")
  })

  test("offers a retry for tag sources that found nothing", () => {
    const html = render({
      ...settled,
      sources: [source("listenbrainz", { notFound: 4 })],
    })
    expect(html).not.toMatch(/<button[^>]*disabled=""/)
  })

  test("offers no retry when every lookup resolved", () => {
    const html = render(settled)
    expect(html).toContain("All liked tracks have been looked up")
    expect(html).toMatch(/<button[^>]*disabled=""/)
  })
})
