import { Effect, Option } from "effect"
import { beforeEach, describe, expect, test, vi } from "vitest"

const auth = vi.hoisted(() => ({
  currentUser:
    vi.fn<() => Promise<{ id: string; apps: ReadonlyArray<string> }>>(),
}))
vi.mock("cloudflare:workers", () => ({ env: {} }))
vi.mock("../auth.server", () => ({
  userFromRequest: () =>
    Effect.promise(() =>
      auth.currentUser().then(Option.some, () => Option.none())
    ),
}))

import {
  deleteInvitation,
  deleteUser,
  getUsers,
  postInvitation,
  postInvitationResend,
  putUserAccess,
} from "./users.server"

const handlers = [
  getUsers,
  putUserAccess,
  deleteUser,
  postInvitation,
  postInvitationResend,
  deleteInvitation,
]

const request = (method: string, origin?: string) =>
  new Request("https://mdoultremont.com/api/apps/back-office/users", {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(origin === undefined ? {} : { Origin: origin }),
    },
    ...(method === "GET" ? {} : { body: "{}" }),
  })

beforeEach(() => {
  vi.resetAllMocks()
  auth.currentUser.mockRejectedValue(new Error("No session"))
})

describe("back office users API", () => {
  test("requires sign-in, then back office access", async () => {
    for (const handle of handlers) {
      const response = await handle(
        request(handle === getUsers ? "GET" : "POST")
      )
      expect(response.status).toBe(401)
    }
    auth.currentUser.mockResolvedValue({ id: "friend", apps: ["music"] })
    for (const handle of handlers) {
      const response = await handle(
        request(handle === getUsers ? "GET" : "POST")
      )
      expect(response.status).toBe(403)
      expect(response.headers.get("Cache-Control")).toBe("no-store")
    }
  })

  test("refuses changes from another site", async () => {
    auth.currentUser.mockResolvedValue({ id: "owner", apps: ["backOffice"] })
    for (const handle of handlers.filter((handler) => handler !== getUsers)) {
      const response = await handle(request("POST", "https://attacker.example"))
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({
        error: "Request verification failed",
      })
    }
  })
})
