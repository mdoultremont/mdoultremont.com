import { Effect, Layer, Option } from "effect"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { UserAuth } from "@/server/actions/auth"

const mocks = vi.hoisted(() => ({
  signedIn: vi.fn<() => string | null>(),
  pending: vi.fn<(token: string) => boolean>(),
  accept: vi.fn<(input: { token: string; userId: string }) => boolean>(),
}))
vi.mock("cloudflare:workers", () => ({ env: {} }))
vi.mock("./auth.server", () => ({
  authLayer: () =>
    Layer.succeed(
      UserAuth,
      UserAuth.of({
        handler: () => Effect.succeed(new Response()),
        currentUser: () => Effect.succeed(Option.none()),
        hasPendingInvitation: (token) =>
          Effect.sync(() => mocks.pending(token)),
        acceptInvitation: (input) => Effect.sync(() => mocks.accept(input)),
        userIds: () => Effect.succeed([]),
      })
    ),
  userFromRequest: () =>
    Effect.sync(() => {
      const id = mocks.signedIn()
      return id === null ? Option.none() : Option.some({ id })
    }),
}))

import { acceptInvitationLink } from "./invitations.server"

const open = (token: string) =>
  acceptInvitationLink(
    new Request(
      `https://mdoultremont.com/api/invitations/accept?token=${token}`
    )
  )

beforeEach(() => {
  vi.resetAllMocks()
  mocks.signedIn.mockReturnValue(null)
  mocks.pending.mockImplementation((token) => token === "valid")
  mocks.accept.mockReturnValue(true)
})

describe("invitation link", () => {
  test("keeps the token for sign-in in a short-lived, HTTP-only cookie", async () => {
    const response = await open("valid")
    expect(response.status).toBe(302)
    expect(response.headers.get("Location")).toBe("/apps?invited=1")
    expect(response.headers.get("Set-Cookie")).toBe(
      "invitation=valid; Path=/api/auth; Max-Age=3600; HttpOnly; SameSite=Lax; Secure"
    )
    expect(mocks.accept).not.toHaveBeenCalled()
  })

  test("accepts straight away for a signed-in user", async () => {
    mocks.signedIn.mockReturnValue("friend")
    const response = await open("valid")
    expect(response.headers.get("Location")).toBe("/apps")
    expect(response.headers.get("Set-Cookie")).toBeNull()
    expect(mocks.accept).toHaveBeenCalledWith({
      token: "valid",
      userId: "friend",
    })
  })

  test("sends an unknown, used or expired link back with an error", async () => {
    const response = await open("stale")
    expect(response.headers.get("Location")).toBe(
      "/apps?error=invitation_invalid"
    )
    expect(response.headers.get("Set-Cookie")).toBeNull()
  })
})
