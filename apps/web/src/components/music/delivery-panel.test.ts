import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import type { DeliveryStatus } from "@/backend/features/music/delivery"
import { DeliveryPanel } from "./delivery-panel"

const render = (status: DeliveryStatus) =>
  renderToStaticMarkup(
    createElement(DeliveryPanel, { csrfToken: "csrf", initialStatus: status })
  )

describe("delivery panel", () => {
  test("offers Write now while decisions wait to be written", () => {
    const html = render({
      automatic: false,
      delivered: 0,
      toWrite: 12,
      lastDeliveredAt: null,
    })
    expect(html).toContain("12 tracks are decided and ready to write")
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Write now/)
    expect(html).not.toContain("checked")
  })

  test("shows automatic delivery at work", () => {
    const html = render({
      automatic: true,
      delivered: 40,
      toWrite: 3,
      lastDeliveredAt: 1,
    })
    expect(html).toContain("Writing to Spotify: 3 left")
    expect(html).toContain('checked=""')
  })

  test("has nothing to write once everything is delivered", () => {
    const html = render({
      automatic: false,
      delivered: 40,
      toWrite: 0,
      lastDeliveredAt: null,
    })
    expect(html).toContain("Everything decided is in your playlists")
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Write now/)
  })
})
