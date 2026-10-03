import { beforeEach, describe, expect, test, vi } from "vitest"
import { musicRunsHttp } from "./music-runs.server"

const mocks = vi.hoisted(() => ({
  owner: vi.fn<() => Promise<{ id: string }>>(),
  start: vi.fn<() => Promise<{ id: string; status: string }>>(),
  status: vi.fn<() => Promise<object>>(),
  enabled: vi.fn<() => Promise<void>>(),
}))
vi.mock("cloudflare:workers", () => ({ env: {} }))
vi.mock("./app-auth.server", () => ({ requireCurrentOwner: mocks.owner }))
vi.mock("../modules/music-run-runtime", () => ({
  musicRunRuntime: () => ({
    start: mocks.start,
    store: { status: mocks.status, setEnabled: mocks.enabled },
  }),
}))
beforeEach(() => {
  vi.resetAllMocks()
  mocks.owner.mockResolvedValue({ id: "owner" })
  mocks.status.mockResolvedValue({
    automationEnabled: false,
    runs: [],
    policy: "dry-run",
  })
  mocks.start.mockResolvedValue({ id: "run", status: "queued" })
})
function request(method: string, body?: unknown, verified = true) {
  return new Request("https://example.com/api/music/runs", {
    method,
    headers: verified
      ? {
          Origin: "https://example.com",
          Cookie: "music_csrf=token",
          "X-CSRF-Token": "token",
          "Content-Type": "application/json",
        }
      : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
describe("private music run boundary", () => {
  test("anonymous callers cannot read status or start/change automation", async () => {
    mocks.owner.mockRejectedValue(new Error("not owner"))
    for (const method of ["GET", "POST", "PUT"])
      expect((await musicRunsHttp(request(method))).status).toBe(401)
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.status).not.toHaveBeenCalled()
    expect(mocks.enabled).not.toHaveBeenCalled()
  })
  test("mutations require origin and CSRF, then return a queued run immediately", async () => {
    expect(
      (await musicRunsHttp(request("POST", { mode: "catchup" }, false))).status
    ).toBe(403)
    expect(mocks.start).not.toHaveBeenCalled()
    const response = await musicRunsHttp(request("POST", { mode: "full" }))
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({
      run: { id: "run", status: "queued" },
    })
    expect(mocks.start).toHaveBeenCalledWith("owner", "full")
  })
  test("pause only updates scheduled-start setting and invalid modes are rejected", async () => {
    expect(
      (await musicRunsHttp(request("PUT", { enabled: false }))).status
    ).toBe(200)
    expect(mocks.enabled).toHaveBeenCalledWith("owner", false)
    expect(
      (await musicRunsHttp(request("POST", { mode: "unknown" }))).status
    ).toBe(400)
    expect(mocks.start).not.toHaveBeenCalled()
  })
})
