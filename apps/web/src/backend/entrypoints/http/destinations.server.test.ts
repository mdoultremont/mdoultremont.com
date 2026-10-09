import { beforeEach, describe, expect, test, vi } from "vitest"

const auth = vi.hoisted(() => ({
  requireCurrentOwner: vi.fn<() => Promise<{ id: string }>>(),
}))
vi.mock("cloudflare:workers", () => ({ env: {} }))
vi.mock("../app-auth.server", () => ({
  requireCurrentOwner: auth.requireCurrentOwner,
}))

import {
  deleteDestination,
  getDestinations,
  postPrivateDestination,
  putDestination,
  putReviewPlaylist,
} from "./destinations.server"

beforeEach(() => {
  vi.resetAllMocks()
  auth.requireCurrentOwner.mockRejectedValue(new Error("No owner session"))
})

describe("private destination API", () => {
  test("requires owner sign-in before every read or write", async () => {
    const base = "https://portfolio.example"
    for (const handle of [
      getDestinations,
      putDestination,
      deleteDestination,
      postPrivateDestination,
      putReviewPlaylist,
    ]) {
      const response = await handle(
        new Request(`${base}/api/music/settings`, {
          method: handle === getDestinations ? "GET" : "PUT",
        })
      )
      expect(response.status).toBe(401)
      expect(response.headers.get("Cache-Control")).toBe("no-store")
    }
  })

  test("requires same-origin CSRF proof before mutation input is processed", async () => {
    auth.requireCurrentOwner.mockResolvedValue({ id: "owner" })
    const request = new Request(
      "https://portfolio.example/api/music/destinations",
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: "music_csrf=token",
        },
        body: JSON.stringify({
          playlistId: "jazz",
          description: "Rule",
          enabled: true,
        }),
      }
    )
    expect((await putDestination(request)).status).toBe(403)
  })
})
