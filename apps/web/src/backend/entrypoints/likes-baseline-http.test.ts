import { describe, expect, test, vi } from "vitest"
import { createLikesBaselineHttp } from "./likes-baseline-http"
import type { BaselineRun } from "@/backend/workflows/likes-baseline"

const run: BaselineRun = {
  id: "run-1",
  ownerId: "owner-1",
  accountId: "account-1",
  cutoff: "2026-01-01T00:00:00.000Z",
  status: "queued",
  cursor: null,
  pages: 0,
  scanned: 0,
  recorded: 0,
  recent: 0,
  total: null,
  error: null,
  updatedAt: 1,
}

function request(method: string, csrf = true) {
  return new Request("https://example.com/api/music/baseline", {
    method,
    headers: csrf
      ? {
          Origin: "https://example.com",
          Cookie: "music_csrf=token",
          "X-CSRF-Token": "token",
        }
      : {},
  })
}

function setup() {
  const services = {
    owner: vi.fn<(_request: Request) => Promise<{ id: string } | null>>(
      async () => ({ id: "owner-1" })
    ),
    connection: vi.fn<
      (
        _ownerId: string
      ) => Promise<{ accountId: string; needsReconnect: boolean } | null>
    >(async () => ({ accountId: "account-1", needsReconnect: false })),
    latest: vi.fn<
      (_ownerId: string, _accountId: string) => Promise<BaselineRun | null>
    >(async () => null),
    start: vi.fn<
      (_ownerId: string, _accountId: string) => Promise<BaselineRun>
    >(async () => run),
    retry: vi.fn<(_runId: string) => Promise<BaselineRun | null>>(
      async () => run
    ),
  }
  const handlers = createLikesBaselineHttp(services)
  return { services, handlers, request }
}

describe("baseline entrypoints", () => {
  test("status requires the owner and exposes no run from another account", async () => {
    const harness = setup()
    harness.services.owner.mockResolvedValueOnce(null)
    expect((await harness.handlers.status(harness.request("GET"))).status).toBe(
      401
    )
    expect((await harness.handlers.status(harness.request("GET"))).status).toBe(
      200
    )
    expect(
      await (await harness.handlers.status(harness.request("GET"))).json()
    ).toEqual({ status: "not_started" })
    expect(harness.services.latest).toHaveBeenCalledWith("owner-1", "account-1")
  })

  test("start verifies CSRF, enqueues only for the connected account, and returns a run ID", async () => {
    const harness = setup()
    expect(
      (await harness.handlers.start(harness.request("POST", false))).status
    ).toBe(403)
    expect(harness.services.start).not.toHaveBeenCalled()
    const response = await harness.handlers.start(harness.request("POST"))
    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({
      runId: "run-1",
      status: "queued",
    })
    expect(harness.services.start).toHaveBeenCalledWith("owner-1", "account-1")
  })

  test("retry is scoped to the owner's current account", async () => {
    const harness = setup()
    expect((await harness.handlers.retry(harness.request("POST"))).status).toBe(
      404
    )
    expect(harness.services.retry).not.toHaveBeenCalled()
    harness.services.latest.mockResolvedValueOnce(run)
    expect((await harness.handlers.retry(harness.request("POST"))).status).toBe(
      202
    )
    expect(harness.services.retry).toHaveBeenCalledWith("run-1")
  })
})
