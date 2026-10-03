import { Effect, Layer } from "effect"
import { describe, expect, test, vi } from "vitest"
import {
  BaselineClock,
  BaselineError,
  BaselineQueue,
  BaselineSpotify,
  BaselineStore,
  processLikesBaselinePage,
  retryLikesBaseline,
  startLikesBaseline,
  type BaselineRun,
} from "./likes-baseline"

const ownerId = "owner-42"
const accountId = "spotify-42"
const cutoff = "2026-01-01T12:00:00.000Z"

function setup() {
  let now = Date.parse(cutoff)
  let run: BaselineRun | null = null
  const historical = new Set<string>()
  const pages = new Map<
    string,
    {
      items: { id: string; addedAt: string }[]
      next: string | null
      total: number
    }
  >()
  const send = vi.fn<(_id: string) => Effect.Effect<void, BaselineError>>(
    (_id) => Effect.void
  )
  const read = vi.fn<
    (
      _owner: string,
      cursor: string | null
    ) => Effect.Effect<
      {
        items: { id: string; addedAt: string }[]
        next: string | null
        total: number
      },
      BaselineError
    >
  >((_owner, cursor) => {
    const page = pages.get(cursor ?? "first")
    return page
      ? Effect.succeed(page)
      : Effect.fail(new BaselineError("spotify", "Page unavailable"))
  })
  const store = {
    createOrGet: (input: {
      id: string
      ownerId: string
      accountId: string
      cutoff: string
      now: number
    }) =>
      Effect.sync(() => {
        run ??= {
          ...input,
          status: "queued",
          cursor: null,
          pages: 0,
          scanned: 0,
          recorded: 0,
          recent: 0,
          total: null,
          error: null,
          updatedAt: input.now,
        }
        return run
      }),
    latest: () => Effect.sync(() => run),
    get: () => Effect.sync(() => run),
    commitPage: (input: {
      run: BaselineRun
      historicalIds: readonly string[]
      scanned: number
      recent: number
      total: number
      next: string | null
      now: number
    }) =>
      Effect.sync(() => {
        if (
          !run ||
          run.cursor !== input.run.cursor ||
          run.pages !== input.run.pages ||
          run.status === "completed"
        )
          return null
        for (const id of input.historicalIds) historical.add(id)
        run = {
          ...run,
          status: input.next ? "running" : "completed",
          cursor: input.next,
          pages: run.pages + 1,
          scanned: run.scanned + input.scanned,
          recorded: historical.size,
          recent: run.recent + input.recent,
          total: input.total,
          updatedAt: input.now,
        }
        return run
      }),
    fail: (runId: string, message: string, at: number) =>
      Effect.sync(() => {
        if (run?.id === runId)
          run = { ...run, status: "failed", error: message, updatedAt: at }
      }),
    resume: () =>
      Effect.sync(() => {
        if (run?.status === "failed")
          run = { ...run, status: "queued", error: null }
        return run
      }),
  }
  const layer = Layer.mergeAll(
    Layer.succeed(BaselineStore, store),
    Layer.succeed(BaselineSpotify, { savedTracksPage: read }),
    Layer.succeed(BaselineQueue, { send }),
    Layer.succeed(BaselineClock, {
      now: () => Effect.succeed(now),
      id: () => Effect.succeed("run-1"),
    })
  )
  const runEffect = <A, E>(
    effect: Effect.Effect<
      A,
      E,
      BaselineStore | BaselineSpotify | BaselineQueue | BaselineClock
    >
  ) => Effect.runPromise(Effect.provide(effect, layer))
  return {
    runEffect,
    pages,
    send,
    read,
    store,
    historical,
    getRun: () => run,
    setNow: (value: number) => {
      now = value
    },
  }
}

describe("initial Liked Songs baseline", () => {
  test("captures the cutoff before queueing and resumes a pre-existing run", async () => {
    const harness = setup()
    harness.setNow(Date.parse(cutoff) + 456)
    const first = await harness.runEffect(
      startLikesBaseline(ownerId, accountId)
    )
    harness.setNow(Date.parse(cutoff) + 60_000)
    const second = await harness.runEffect(
      startLikesBaseline(ownerId, accountId)
    )
    expect(second.id).toBe(first.id)
    expect(second.cutoff).toBe(cutoff)
    expect(harness.send).toHaveBeenCalledTimes(2)
  })

  test("advances one page at a time and leaves cutoff ties for catch-up", async () => {
    const harness = setup()
    harness.pages.set("first", {
      items: [
        { id: "newer", addedAt: "2026-01-01T12:00:01.000Z" },
        { id: "tie", addedAt: cutoff },
        { id: "old-1", addedAt: "2025-12-31T00:00:00.000Z" },
      ],
      next: "page-2",
      total: 4,
    })
    harness.pages.set("page-2", {
      items: [{ id: "old-2", addedAt: "2025-12-30T00:00:00.000Z" }],
      next: null,
      total: 4,
    })
    await harness.runEffect(startLikesBaseline(ownerId, accountId))
    expect(
      (await harness.runEffect(processLikesBaselinePage("run-1")))?.status
    ).toBe("running")
    expect(
      (await harness.runEffect(processLikesBaselinePage("run-1")))?.status
    ).toBe("completed")
    expect(harness.getRun()).toMatchObject({
      pages: 2,
      scanned: 4,
      recorded: 2,
      recent: 2,
      cursor: null,
    })
    expect([...harness.historical]).toEqual(["old-1", "old-2"])
    expect(harness.read.mock.calls.map((call) => call[1])).toEqual([
      null,
      "page-2",
    ])
    expect(harness.send).toHaveBeenCalledTimes(2)
  })

  test("retries after interruption without advancing the cursor or double counting", async () => {
    const harness = setup()
    harness.pages.set("first", {
      items: [{ id: "old", addedAt: "2025-12-31T00:00:00.000Z" }],
      next: "page-2",
      total: 2,
    })
    harness.pages.set("page-2", {
      items: [{ id: "old", addedAt: "2025-12-31T00:00:00.000Z" }],
      next: null,
      total: 2,
    })
    await harness.runEffect(startLikesBaseline(ownerId, accountId))
    harness.read.mockImplementationOnce(() =>
      Effect.fail(new BaselineError("spotify", "Interrupted"))
    )
    await expect(
      harness.runEffect(processLikesBaselinePage("run-1"))
    ).rejects.toThrow("Interrupted")
    expect(harness.getRun()).toMatchObject({
      status: "queued",
      pages: 0,
      recorded: 0,
    })
    await harness.runEffect(processLikesBaselinePage("run-1"))
    await harness.runEffect(processLikesBaselinePage("run-1"))
    await harness.runEffect(processLikesBaselinePage("run-1"))
    expect(harness.getRun()).toMatchObject({
      status: "completed",
      pages: 2,
      recorded: 1,
    })
    expect(harness.read).toHaveBeenCalledTimes(3)
  })

  test("redelivery after a queue failure uses the committed cursor", async () => {
    const harness = setup()
    harness.pages.set("first", { items: [], next: "page-2", total: 0 })
    harness.pages.set("page-2", { items: [], next: null, total: 0 })
    await harness.runEffect(startLikesBaseline(ownerId, accountId))
    harness.send.mockImplementationOnce(() =>
      Effect.fail(new BaselineError("queue", "Queue unavailable"))
    )
    await expect(
      harness.runEffect(processLikesBaselinePage("run-1"))
    ).rejects.toThrow("Queue unavailable")
    expect(harness.getRun()).toMatchObject({
      status: "running",
      cursor: "page-2",
      pages: 1,
    })
    await harness.runEffect(processLikesBaselinePage("run-1"))
    expect(harness.read.mock.calls.map((call) => call[1])).toEqual([
      null,
      "page-2",
    ])
    expect(harness.getRun()).toMatchObject({ status: "completed", pages: 2 })
  })

  test("requeues a failed run while preserving its cutoff and progress", async () => {
    const harness = setup()
    await harness.runEffect(startLikesBaseline(ownerId, accountId))
    await harness.runEffect(
      harness.store.fail("run-1", "Reconnect Spotify", Date.parse(cutoff) + 1)
    )
    const resumed = await harness.runEffect(retryLikesBaseline("run-1"))
    expect(resumed).toMatchObject({ status: "queued", cutoff, error: null })
    expect(harness.send).toHaveBeenCalledTimes(2)
  })

  test("reports an enqueue failure as a retryable run failure", async () => {
    const harness = setup()
    harness.send.mockImplementationOnce(() =>
      Effect.fail(new BaselineError("queue", "Queue unavailable"))
    )
    await expect(
      harness.runEffect(startLikesBaseline(ownerId, accountId))
    ).rejects.toThrow("Queue unavailable")
    expect(harness.getRun()).toMatchObject({
      status: "failed",
      error: "Background work could not be queued. Retry initialization.",
      cutoff,
    })
    await harness.runEffect(retryLikesBaseline("run-1"))
    expect(harness.getRun()).toMatchObject({
      status: "queued",
      error: null,
      cutoff,
    })
  })
})
