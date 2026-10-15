import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import type { ClassificationStatus } from "@/backend/features/music/classification"
import { ClassificationPanel } from "./classification-panel"

const status: ClassificationStatus = {
  ready: true,
  decided: 3,
  toDestinations: 1,
  toReview: 2,
  withoutRecordingData: 1,
  waitingForEnrichment: 0,
  pending: 4,
  outdated: 0,
  recent: [
    {
      trackId: "t1",
      name: "Blue in Green",
      artistNames: ["Miles Davis"],
      destinationIds: ["jazz"],
      review: false,
      reason: "classified",
      probabilities: { jazz: 0.91, party: 0.04 },
      classifiedAt: 3,
    },
    {
      trackId: "t2",
      name: "Unclear",
      artistNames: ["Someone"],
      destinationIds: [],
      review: true,
      reason: "classified",
      probabilities: { jazz: 0.31, party: 0.12 },
      classifiedAt: 2,
    },
    {
      trackId: "t3",
      name: "Local file",
      artistNames: ["Me"],
      destinationIds: [],
      review: true,
      reason: "no_recording_data",
      probabilities: {},
      classifiedAt: 1,
    },
  ],
}

const render = (value: ClassificationStatus) =>
  renderToStaticMarkup(
    createElement(ClassificationPanel, {
      initialStatus: value,
      initialPlaylistNames: { jazz: "Late Jazz", party: "Party" },
    })
  )

describe("classification panel", () => {
  test("explains that nothing runs before Ready", () => {
    const html = render({ ...status, ready: false, recent: [] })
    expect(html).toContain("Paused")
    expect(html).toContain("Ready: start classifying")
  })

  test("shows each decision with playlist names and confidence", () => {
    const html = render(status)
    expect(html).toContain("Classifying: 4 tracks waiting")
    expect(html).toContain("Late Jazz 91%")
    expect(html).toContain("Review (best: Late Jazz 31%)")
    expect(html).toContain("Review (no recording data)")
    expect(html).toContain("Pause classification")
  })

  test("points out decisions made before the playlists changed", () => {
    expect(render({ ...status, outdated: 2 })).toContain(
      "2 decisions were made before your playlists changed"
    )
  })
})
