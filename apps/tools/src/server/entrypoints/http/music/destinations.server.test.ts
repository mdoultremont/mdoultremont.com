import { Effect, Option } from "effect"
import { beforeEach, describe, expect, test, vi } from "vitest"

const auth = vi.hoisted(() => ({
  requireCurrentUser:
    vi.fn<() => Promise<{ id: string; apps: ReadonlyArray<string> }>>(),
}))
vi.mock("cloudflare:workers", () => ({ env: {} }))
vi.mock("../auth.server", () => ({
  userFromRequest: () =>
    Effect.promise(() =>
      auth.requireCurrentUser().then(Option.some, () => Option.none())
    ),
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
  auth.requireCurrentUser.mockRejectedValue(new Error("No session"))
})

describe("private destination API", () => {
  test("requires sign-in before every read or write", async () => {
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

  test("refuses users without music access", async () => {
    auth.requireCurrentUser.mockResolvedValue({
      id: "user",
      apps: ["backOffice"],
    })
    const response = await getDestinations(
      new Request("https://portfolio.example/api/music/destinations")
    )
    expect(response.status).toBe(403)
  })

  test("refuses a change from another site before reading its input", async () => {
    auth.requireCurrentUser.mockResolvedValue({ id: "owner", apps: ["music"] })
    const request = new Request(
      "https://portfolio.example/api/music/destinations",
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://attacker.example",
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
