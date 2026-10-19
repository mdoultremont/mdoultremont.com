import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("cloudflare:workers", () => ({ env: {} }))
import { code, makeHarness, origin, seedUser } from "./testing"

let api: ReturnType<typeof makeHarness>
beforeEach(() => {
  api = makeHarness()
  seedUser(api.d1, "admin", ["backOffice", "music"])
  seedUser(api.d1, "friend", ["flights"])
  api.signIn(["backOffice"], "admin")
})
afterEach(() => api.close())

describe("back office actions", () => {
  test("list users with their app access", async () => {
    const { users, invitations } = await api.client.backOffice.users.list()
    expect(invitations).toEqual([])
    expect(users).toContainEqual(
      expect.objectContaining({
        id: "friend",
        apps: ["flights"],
        providers: [],
      })
    )
  })

  test("invite by email, resend and revoke", async () => {
    expect(
      await code(
        api.client.backOffice.invitations.create({ email: "nope", apps: [] })
      )
    ).toBe("BAD_REQUEST")
    expect(
      await api.client.backOffice.invitations.create({
        email: "grace@example.com",
        apps: ["flights"],
      })
    ).toEqual({ status: "sent" })
    const [sent] = api.emails.mock.calls.at(-1)!
    expect(sent.to).toBe("grace@example.com")
    expect(sent.text).toContain(`${origin}/api/invitations/accept?token=`)

    const [invitation] = (await api.client.backOffice.users.list()).invitations
    expect(invitation).toMatchObject({
      email: "grace@example.com",
      apps: ["flights"],
    })
    expect(
      await api.client.backOffice.invitations.resend({
        invitationId: invitation!.id,
      })
    ).toEqual({ status: "sent" })
    expect(api.emails).toHaveBeenCalledTimes(2)
    const revoked = await api.request(
      `/api/v1/back-office/invitations/${invitation!.id}`,
      { method: "DELETE", headers: { Origin: origin } }
    )
    expect(await revoked.json()).toEqual({ status: "revoked" })
    expect(
      await code(
        api.client.backOffice.invitations.revoke({
          invitationId: invitation!.id,
        })
      )
    ).toBe("NOT_FOUND")
  })

  test("change access and remove users, protecting the caller's own", async () => {
    const access = await api.request(
      "/api/v1/back-office/users/friend/access",
      {
        method: "PUT",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ apps: ["flights", "music"] }),
      }
    )
    expect(await access.json()).toEqual({ status: "saved" })
    const friend = (await api.client.backOffice.users.list()).users.find(
      (user) => user.id === "friend"
    )
    expect(new Set(friend?.apps)).toEqual(new Set(["flights", "music"]))

    const own = await api.client.backOffice.users
      .setAccess({ userId: "admin", apps: ["music"] })
      .catch((error: unknown) => error)
    expect(own).toMatchObject({
      code: "CONFLICT",
      message:
        "You cannot remove yourself or your own access to the back office",
    })
    expect(
      await code(
        api.client.backOffice.users.setAccess({
          userId: "friend",
          apps: ["nope"],
        } as never)
      )
    ).toBe("BAD_REQUEST")
    expect(
      await code(api.client.backOffice.users.remove({ userId: "ghost" }))
    ).toBe("NOT_FOUND")
    expect(
      await api.client.backOffice.users.remove({ userId: "friend" })
    ).toEqual({
      status: "removed",
    })
    expect(
      (await api.client.backOffice.users.list()).users.map((user) => user.id)
    ).toEqual(["admin"])
  })
})
