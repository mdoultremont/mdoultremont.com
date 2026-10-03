import { Effect } from "effect"
import { describe, expect, test } from "vitest"
import {
  processMusicRun,
  RunTrackError,
  type MusicRun,
  type MusicRunPorts,
  type RunTrack,
} from "./music-runs"

function setup() {
  const run: MusicRun = {
    id: "run",
    ownerId: "owner",
    accountId: "account",
    mode: "catchup",
    status: "queued",
    phase: "discover",
    cursor: null,
    cutoff: "2026-10-03T12:00:00Z",
    checkpoint: "2026-10-03T11:00:00Z",
    scanned: 0,
    processed: 0,
    delivered: 0,
    error: null,
  }
  const tracks = new Map<string, RunTrack>()
  const finished = new Set<string>()
  const failed = new Set<string>()
  const queued: string[] = []
  const retryAttempts = new Map<string, number>()
  let locked = false
  const ports: MusicRunPorts = {
    get: async () => run,
    acquire: async () => {
      if (locked) return false
      locked = true
      return true
    },
    release: async () => {
      locked = false
    },
    page: async () => ({
      items: [{ id: "new", isrc: null, addedAt: run.checkpoint }],
      next: null,
    }),
    discover: async (_run, items, next) => {
      for (const item of items) tracks.set(item.id, item)
      run.cursor = next
      run.phase = next ? "discover" : "sync"
    },
    pending: async (_run, limit) =>
      [...tracks.values()]
        .filter((track) => !finished.has(track.id) && !failed.has(track.id))
        // oxlint-disable-next-line unicorn/no-array-sort -- sorting a fresh array of pending work
        .sort(
          (a, b) =>
            (retryAttempts.get(a.id) ?? 0) - (retryAttempts.get(b.id) ?? 0)
        )
        .slice(0, limit),
    sync: async () => ({
      scanned: 1,
      delivered: 1,
      skippedUnliked: 0,
      failed: 0,
    }),
    defer: async (_run, track) => {
      const count = (retryAttempts.get(track.id) ?? 0) + 1
      retryAttempts.set(track.id, count)
      return count
    },
    progress: async (_run, track, report) => {
      ;(report.failed ? failed : finished).add(track.id)
      run.processed++
      run.delivered += report.delivered
    },
    complete: async () => {
      run.status = failed.size ? "failed" : "completed"
    },
    enqueue: async (id) => {
      expect(locked).toBe(false)
      queued.push(id)
    },
  }
  return {
    run,
    ports,
    tracks,
    finished,
    failed,
    queued,
    process: () => Effect.runPromise(processMusicRun("run", ports)),
  }
}

describe("bounded music runs", () => {
  test("scans all pages without relying on order and includes cutoff ties and overlap", async () => {
    const state = setup()
    state.ports.page = async (_owner, cursor) =>
      cursor
        ? {
            items: [
              { id: "delayed", isrc: null, addedAt: "2026-10-03T10:59:30Z" },
            ],
            next: null,
          }
        : {
            items: [
              { id: "old", isrc: null, addedAt: "2026-10-02T00:00:00Z" },
              { id: "tie", isrc: null, addedAt: state.run.checkpoint },
              { id: "tie", isrc: null, addedAt: state.run.checkpoint },
            ],
            next: "page2",
          }
    await state.process()
    await state.process()
    expect([...state.tracks.keys()]).toEqual(["tie", "delayed"])
    expect(state.run.phase).toBe("sync")
  })
  test("full runs include historical likes and process at most five tracks per delivery", async () => {
    const state = setup()
    state.run.mode = "full"
    state.ports.page = async () => ({
      items: Array.from({ length: 8 }, (_, i) => ({
        id: String(i),
        isrc: null,
        addedAt: "2020-01-01T00:00:00Z",
      })),
      next: null,
    })
    await state.process()
    await state.process()
    expect(state.finished.size).toBe(5)
    await state.process()
    await state.process()
    expect(state.run.status).toBe("completed")
    expect(state.finished.size).toBe(8)
  })
  test("one failed track remains recoverable while later tracks finish", async () => {
    const state = setup()
    state.run.phase = "sync"
    state.tracks.set("bad", {
      id: "bad",
      isrc: null,
      addedAt: state.run.cutoff,
    })
    state.tracks.set("good", {
      id: "good",
      isrc: null,
      addedAt: state.run.cutoff,
    })
    state.ports.sync = async (_run, track) => {
      if (track.id === "bad") throw new Error("provider down")
      return { scanned: 1, delivered: 1, skippedUnliked: 0, failed: 0 }
    }
    await state.process()
    await state.process()
    expect([...state.finished]).toEqual(["good"])
    expect([...state.failed]).toEqual(["bad"])
    expect(state.run.status).toBe("failed")
  })
  test("concurrent redelivery cannot enter the same run and completion is inert", async () => {
    const state = setup()
    await Promise.all([state.process(), state.process()])
    expect(state.queued).toHaveLength(1)
    await state.process()
    await state.process()
    await state.process()
    expect(state.run.processed).toBe(1)
    expect(state.run.status).toBe("completed")
  })
  test("failed queue send releases the lease so redelivery can resume durable state", async () => {
    const state = setup()
    state.ports.enqueue = async () => {
      throw new Error("queue down")
    }
    await expect(state.process()).rejects.toThrow("queue down")
    state.ports.enqueue = async () => undefined
    await state.process()
    await state.process()
    expect(state.run.status).toBe("completed")
  })
})

test("transient failures request backoff without marking attempted, while later tracks progress", async () => {
  const state = setup()
  state.run.phase = "sync"
  for (let index = 0; index < 6; index++)
    state.tracks.set(String(index), {
      id: String(index),
      isrc: null,
      addedAt: state.run.cutoff,
    })
  state.ports.sync = async (_run, track) => {
    if (track.id !== "5")
      return {
        scanned: 1,
        delivered: 0,
        skippedUnliked: 0,
        failed: 1,
        errors: [new RunTrackError("rate limited", true, 60)],
      }
    return { scanned: 1, delivered: 1, skippedUnliked: 0, failed: 0 }
  }
  await expect(state.process()).rejects.toMatchObject({
    retryable: true,
    retryAfterSeconds: 60,
  })
  expect(state.failed.size).toBe(0)
  await expect(state.process()).rejects.toThrow("rate limited")
  expect([...state.finished]).toEqual(["5"])
  state.ports.sync = async () => ({
    scanned: 1,
    delivered: 1,
    skippedUnliked: 0,
    failed: 0,
  })
  await state.process()
  await state.process()
  expect(state.finished.size).toBe(6)
  expect(state.run.status).toBe("completed")
})

test("repeated transient failures stop at ten durable attempts and permanent failures never retry", async () => {
  const state = setup()
  state.run.phase = "sync"
  state.tracks.set("transient", {
    id: "transient",
    isrc: null,
    addedAt: state.run.cutoff,
  })
  state.tracks.set("permanent", {
    id: "permanent",
    isrc: null,
    addedAt: state.run.cutoff,
  })
  state.ports.sync = async (_run, track) => {
    throw new RunTrackError(track.id, track.id === "transient")
  }
  for (let attempt = 0; attempt < 9; attempt++)
    await expect(state.process()).rejects.toThrow("transient")
  expect([...state.failed]).toEqual(["permanent"])
  await state.process()
  await state.process()
  expect([...state.failed]).toEqual(["permanent", "transient"])
  expect(state.run.status).toBe("failed")
})
