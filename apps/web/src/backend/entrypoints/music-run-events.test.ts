import { RunTrackError } from "@/backend/workflows/music-runs"
import { Effect } from "effect"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { consumeMusicBatch, scheduledMusic } from "./music-run-events"

const mocks = vi.hoisted(() => ({
  start: vi.fn<() => Promise<null>>(),
  recover: vi.fn<() => Promise<void>>(),
  process: vi.fn<() => Effect.Effect<void, Error>>(),
  fail: vi.fn<() => Promise<void>>(),
  baseline: vi.fn<() => Promise<void>>(),
}))
vi.mock("../modules/music-run-runtime", () => ({
  musicRunRuntime: () => ({
    start: mocks.start,
    recover: mocks.recover,
    process: mocks.process,
    store: { fail: mocks.fail },
  }),
}))
vi.mock("./likes-baseline-queue", () => ({
  consumeLikesBaselineBatch: mocks.baseline,
}))
beforeEach(() => {
  vi.resetAllMocks()
  mocks.process.mockReturnValue(Effect.void)
  mocks.start.mockResolvedValue(null)
})
const bindings = { GITHUB_OWNER_ID: "owner" } as Cloudflare.Env

describe("music event boundaries", () => {
  test("cron starts only for configured owner and recovers existing work before gated catch-up", async () => {
    await scheduledMusic(
      {} as ScheduledController,
      { GITHUB_OWNER_ID: "" } as Cloudflare.Env
    )
    expect(mocks.start).not.toHaveBeenCalled()
    await scheduledMusic({} as ScheduledController, bindings)
    expect(mocks.recover).toHaveBeenCalledWith("owner")
    expect(mocks.start).toHaveBeenCalledWith("owner", "catchup", true)
  })
  test("queue acknowledges completed work and retries failures before persisting exhausted failure", async () => {
    const message = {
      body: { kind: "music-run", runId: "run" },
      attempts: 1,
      ack: vi.fn<() => void>(),
      retry: vi.fn<() => void>(),
    }
    const batch = { messages: [message] } as unknown as MessageBatch<unknown>
    await consumeMusicBatch(batch, bindings)
    expect(message.ack).toHaveBeenCalledOnce()
    mocks.process.mockReturnValue(Effect.fail(new Error("provider down")))
    await consumeMusicBatch(batch, bindings)
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 2 })
    message.attempts = 10
    await consumeMusicBatch(batch, bindings)
    expect(mocks.fail).toHaveBeenCalledWith(
      "run",
      expect.stringContaining("recover unfinished tracks")
    )
  })
  test("baseline messages retain their separate dispatch path", async () => {
    const batch = {
      messages: [{ body: { kind: "likes-baseline", runId: "baseline" } }],
    } as unknown as MessageBatch<unknown>
    await consumeMusicBatch(batch, bindings)
    expect(mocks.baseline).toHaveBeenCalled()
    expect(mocks.process).not.toHaveBeenCalled()
  })
})

test("queue honors provider backoff and stops permanent failures immediately", async () => {
  const message = {
    body: { kind: "music-run", runId: "run" },
    attempts: 1,
    ack: vi.fn<() => void>(),
    retry: vi.fn<() => void>(),
  }
  const batch = { messages: [message] } as unknown as MessageBatch<unknown>
  mocks.process.mockReturnValue(
    Effect.fail(new RunTrackError("rate limited", true, 120))
  )
  await consumeMusicBatch(batch, bindings)
  expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 120 })
  message.retry.mockClear()
  mocks.process.mockReturnValue(
    Effect.fail(new RunTrackError("Reconnect Spotify", false))
  )
  await consumeMusicBatch(batch, bindings)
  expect(message.retry).not.toHaveBeenCalled()
  expect(mocks.fail).toHaveBeenCalledWith("run", "Reconnect Spotify")
  expect(message.ack).toHaveBeenCalledOnce()
})
