import { Effect } from "effect"
import { describe, expect, test } from "vitest"
import { syncCurrentLikes, type SyncPorts } from "./playlist-sync"

function setup() {
  const likes = [{ id: "spotify-a", isrc: "USABC2400001" }]
  const members = new Map<string, Set<string>>([
    ["electronic", new Set()],
    ["night", new Set()],
    ["review", new Set()],
  ])
  const completed = new Set<string>()
  const decisions = new Map<
    string,
    {
      fingerprint: string
      probabilities: readonly {
        destinationId: string
        yesProbability: number
      }[]
    }
  >()
  let classifyCalls = 0
  const ports: SyncPorts = {
    currentLikes: async () => likes,
    isCurrentlyLiked: async (trackId) =>
      likes.some((track) => track.id === trackId),
    destinations: async () => [
      {
        playlistId: "electronic",
        description: "Electronic music",
        enabled: true,
      },
      { playlistId: "night", description: "Night music", enabled: true },
    ],
    reviewPlaylistId: async () => "review",
    permittedInput: async () => ({
      fingerprint: "cc0-input-v1",
      value: { title: "Night Walk" },
    }),
    classify: async () => {
      classifyCalls++
      return [
        { destinationId: "electronic", yesProbability: 0.94 },
        { destinationId: "night", yesProbability: 0.88 },
      ]
    },
    loadDecision: async (id) => decisions.get(id) ?? null,
    saveDecision: async (id, decision) => {
      decisions.set(id, decision)
    },
    wasDelivered: async (trackId, playlistId) =>
      completed.has(`${trackId}:${playlistId}`),
    markDelivered: async (trackId, playlistId) => {
      completed.add(`${trackId}:${playlistId}`)
    },
    contains: async (playlistId, trackId) =>
      members.get(playlistId)!.has(trackId),
    add: async (playlistId, trackId) => {
      members.get(playlistId)!.add(trackId)
    },
  }
  const run = (mode: "catchup" | "full" | "reclassify") =>
    Effect.runPromise(
      syncCurrentLikes({
        mode,
        ports,
        threshold: 0.8,
        classifierVersion: "jev-eval-v1",
      })
    )
  return {
    likes,
    members,
    completed,
    decisions,
    ports,
    run,
    get classifyCalls() {
      return classifyCalls
    },
  }
}

describe("playlist synchronization", () => {
  test("adds one liked track to every accepted destination, never the review playlist", async () => {
    const state = setup()
    const report = await state.run("reclassify")
    expect([...state.members.get("electronic")!]).toEqual(["spotify-a"])
    expect([...state.members.get("night")!]).toEqual(["spotify-a"])
    expect([...state.members.get("review")!]).toEqual([])
    expect(report).toEqual({
      scanned: 1,
      delivered: 2,
      skippedUnliked: 0,
      failed: 0,
    })
  })

  test("uses review when all decisions abstain", async () => {
    const state = setup()
    state.ports.classify = async () => [
      { destinationId: "electronic", yesProbability: 0.45 },
    ]
    await state.run("full")
    expect([...state.members.get("review")!]).toEqual(["spotify-a"])
    expect([...state.members.get("electronic")!]).toEqual([])
  })

  test("catch-up respects manual removals while a full run restores them using saved decisions", async () => {
    const state = setup()
    await state.run("full")
    state.members.get("electronic")!.clear()
    await state.run("catchup")
    expect([...state.members.get("electronic")!]).toEqual([])
    await state.run("full")
    expect([...state.members.get("electronic")!]).toEqual(["spotify-a"])
    expect(state.classifyCalls).toBe(1)
  })

  test("reclassification ignores saved decisions and never removes old playlist items", async () => {
    const state = setup()
    await state.run("full")
    state.ports.classify = async () => [
      { destinationId: "night", yesProbability: 0.1 },
    ]
    await state.run("reclassify")
    expect([...state.members.get("review")!]).toEqual(["spotify-a"])
    expect([...state.members.get("electronic")!]).toEqual(["spotify-a"])
  })

  test("skips tracks removed from Liked Songs before writing", async () => {
    const state = setup()
    state.ports.isCurrentlyLiked = async () => false
    const report = await state.run("full")
    expect(report.skippedUnliked).toBe(1)
    expect([...state.members.get("electronic")!]).toEqual([])
  })

  test("reconciles an accepted but unacknowledged playlist write on retry", async () => {
    const state = setup()
    let first = true
    state.ports.add = async (playlistId, trackId) => {
      state.members.get(playlistId)!.add(trackId)
      if (first) {
        first = false
        throw new Error("response lost")
      }
    }
    expect((await state.run("full")).failed).toBe(1)
    expect((await state.run("full")).failed).toBe(0)
    expect([...state.members.get("electronic")!]).toEqual(["spotify-a"])
  })
})

test("launch gate discovers and classifies without writing or recording delivery", async () => {
  const state = setup()
  const report = await Effect.runPromise(
    syncCurrentLikes({
      mode: "full",
      ports: state.ports,
      threshold: 0.8,
      classifierVersion: "test",
      writesEnabled: false,
    })
  )
  expect(report.delivered).toBe(0)
  expect(
    [...state.members.values()].every((members) => members.size === 0)
  ).toBe(true)
  expect(state.completed.size).toBe(0)
  await state.run("catchup")
  expect(state.members.get("electronic")!.has("spotify-a")).toBe(true)
})

test("unresolved recordings abstain without calling the classifier", async () => {
  const state = setup()
  state.ports.permittedInput = async () => null
  await state.run("full")
  expect(state.classifyCalls).toBe(0)
  expect([...state.members.get("review")!]).toEqual(["spotify-a"])
})
