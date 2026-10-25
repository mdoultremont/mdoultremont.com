import { describe, expect, test } from "vitest"
import type { PlayerStatus } from "@mdoultremont/tools-contracts/music"
import {
  confirms,
  deriveView,
  initialPlayerState,
  nextPollDelay,
  playbackProgress,
  playerReducer,
  type PlayerCommand,
  type PlayerState,
} from "./player-state"

const device = {
  controllable: true,
  id: "current",
  name: "Kitchen",
  type: "Speaker",
  active: true,
} as const
const ready: PlayerStatus = {
  status: "ready",
  devices: [
    device,
    { ...device, id: "selected", name: "Office", active: false },
  ],
  playback: {
    playing: false,
    device: { id: "current", name: "Kitchen", restricted: false },
    item: {
      kind: "track",
      id: "trackA",
      name: "Song",
      artistNames: ["Artist"],
      imageUrl: null,
      durationMs: null,
    },
    progressMs: null,
    allows: { pause: true, resume: true, next: true },
  },
}
const play: PlayerCommand = {
  kind: "play",
  deviceId: "current",
  trackId: "trackA",
  nextTrackIds: [],
}
const loaded = (data: PlayerStatus = ready) =>
  playerReducer(initialPlayerState, {
    type: "loaded",
    data,
    epoch: 0,
    seq: 1,
    now: 0,
  })
const start = (state: PlayerState, command: PlayerCommand = play) =>
  playerReducer(state, { type: "start", command, now: 0 })
const accepted = (state: PlayerState) =>
  playerReducer(state, { type: "accepted", epoch: state.epoch, now: 100 })
const observe = (
  state: PlayerState,
  data = ready,
  seq = state.appliedSeq + 1,
  now = 1100
) =>
  playerReducer(state, { type: "loaded", data, seq, epoch: state.epoch, now })
const playing: PlayerStatus = {
  ...ready,
  playback: { ...ready.playback!, playing: true },
}

describe("player state", () => {
  test("drops reads from before a command and applies only the newest observation", () => {
    let state = start(loaded())
    const before = state
    state = playerReducer(state, {
      type: "loaded",
      epoch: 0,
      seq: 100,
      data: playing,
      now: 0,
    })
    expect(state).toBe(before)
    state = observe(state, playing, 4)
    expect(deriveView(state, 0).playback?.playing).toBe(true)
    expect(observe(state, ready, 3)).toBe(state)
    expect(
      playerReducer(state, {
        type: "failed",
        epoch: state.epoch,
        seq: 2,
        failure: { message: "late failure" },
        now: 0,
      })
    ).toBe(state)
  })

  test("an accepted command does not invent playback and requires the requested device and track", () => {
    let state = accepted(start(loaded()))
    expect(deriveView(state, 100).playback?.playing).toBe(false)
    expect(state.pending?.stage).toBe("confirming")
    expect(nextPollDelay(state, 100)).toBe(1000)
    expect(
      confirms(play, {
        ...playing,
        playback: {
          ...playing.playback!,
          device: { id: "selected", name: "Office", restricted: false },
        },
      })
    ).toBe(false)
    expect(
      confirms(play, {
        ...playing,
        playback: {
          ...playing.playback!,
          item: {
            kind: "track",
            id: null,
            name: "Local",
            artistNames: [],
            imageUrl: null,
            durationMs: null,
          },
        },
      })
    ).toBe(false)
    state = observe(state)
    expect(state.pending).not.toBeNull()
    expect(nextPollDelay(state, 1100)).toBe(2000)
    state = observe(state, playing)
    expect(state.pending).toBeNull()
    expect(state.unconfirmed).toBe(false)
    expect(deriveView(state, 1100).playback?.playing).toBe(true)
  })

  test("two unconfirmed reads end reconciliation without retrying the command", () => {
    let state = accepted(start(loaded()))
    state = observe(state)
    state = observe(state)
    expect(state.pending).toBeNull()
    expect(state.unconfirmed).toBe(true)
    expect(deriveView(state, 3000).playback?.playing).toBe(false)
    expect(nextPollDelay(state, 3000)).toBe(20_000)
  })

  test("blocks a second command synchronously, including while confirming", () => {
    let state = start(loaded())
    expect(start(state, { kind: "resume", deviceId: "current" })).toBe(state)
    state = accepted(state)
    expect(start(state)).toBe(state)
    expect(nextPollDelay(start(loaded()), 0)).toBeNull()
  })

  test("never falls back to another active device after an explicit selection vanishes", () => {
    let state = playerReducer(loaded(), {
      type: "choose",
      deviceId: "selected",
    })
    expect(deriveView(state, 0).target?.id).toBe("selected")
    state = observe(state, { ...ready, devices: [device] })
    expect(deriveView(state, 0)).toMatchObject({
      target: null,
      missingChoice: true,
      canPlay: false,
      canResume: true,
    })
    state = playerReducer(state, { type: "choose", deviceId: null })
    expect(deriveView(state, 0).target?.id).toBe("current")
  })

  test("restricted and unidentified devices cannot become track targets", () => {
    const state = loaded({
      status: "ready",
      playback: null,
      devices: [
        {
          controllable: false,
          why: "restricted",
          active: true,
          name: "TV",
          type: "TV",
        },
        {
          controllable: false,
          why: "unidentified",
          active: false,
          name: "Other",
          type: "Unknown",
        },
      ],
    })
    expect(deriveView(state, 0)).toMatchObject({
      target: null,
      canPlay: false,
      canPause: false,
      canResume: false,
    })
    expect(start(state)).toBe(state)
  })

  test("pause and resume use the observed device regardless of the future track target", () => {
    const state = playerReducer(loaded(playing), {
      type: "choose",
      deviceId: "selected",
    })
    expect(deriveView(state, 0)).toMatchObject({
      currentDeviceId: "current",
      canPause: true,
      target: { id: "selected" },
    })
    expect(start(state, { kind: "pause", deviceId: "selected" })).toBe(state)
    const pending = start(state, { kind: "pause", deviceId: "current" })
    expect(pending.pending?.command).toEqual({
      kind: "pause",
      deviceId: "current",
    })
    expect(confirms({ kind: "pause", deviceId: "current" }, ready)).toBe(true)
    expect(confirms({ kind: "resume", deviceId: "current" }, playing)).toBe(
      true
    )
  })

  test("current restrictions and nullable IDs disable current-device commands", () => {
    for (const playback of [
      { ...ready.playback!, device: { ...ready.playback!.device, id: null } },
      {
        ...ready.playback!,
        device: { ...ready.playback!.device, restricted: true },
      },
      {
        ...ready.playback!,
        progressMs: null,
        allows: { pause: false, resume: false, next: false },
      },
    ]) {
      expect(deriveView(loaded({ ...ready, playback }), 0).canResume).toBe(
        false
      )
      expect(
        deriveView(
          loaded({ ...ready, playback: { ...playback, playing: true } }),
          0
        ).canPause
      ).toBe(false)
    }
  })

  test("a failed read keeps the observation stale and disables commands until a fresh read", () => {
    let state = playerReducer(loaded(), {
      type: "failed",
      epoch: 0,
      seq: 2,
      now: 0,
      failure: { message: "Unavailable" },
    })
    expect(deriveView(state, 0)).toMatchObject({
      canPlay: false,
      canResume: false,
      playback: ready.playback,
    })
    expect(start(state)).toBe(state)
    state = observe(state)
    expect(state.stale).toBe(false)
    expect(deriveView(state, 0).canPlay).toBe(true)
  })

  test.each([ready, playing])(
    "hiding invalidates playback freshness until a new observation",
    (data) => {
      const state = playerReducer(loaded(data), { type: "hidden" })
      expect(state.stale).toBe(true)
      expect(deriveView(state, 0)).toMatchObject({
        playback: data.playback,
        canPlay: false,
        canPause: false,
        canResume: false,
      })
      expect(start(state)).toBe(state)
      expect(start(state, { kind: "pause", deviceId: "current" })).toBe(state)
      expect(start(state, { kind: "resume", deviceId: "current" })).toBe(state)
      expect(observe(state, data, state.appliedSeq)).toBe(state)
      const fresh = observe(state, data)
      expect(fresh.stale).toBe(false)
      expect(deriveView(fresh, 0)).toMatchObject({
        canPlay: true,
        canPause: data.playback!.playing,
        canResume: !data.playback!.playing,
      })
    }
  )

  test("hiding preserves the chosen device and pending command without confirming playback", () => {
    const pending = start(loaded())
    const chosen = playerReducer(pending, {
      type: "choose",
      deviceId: "selected",
    })
    const hidden = playerReducer(chosen, { type: "hidden" })
    expect(hidden).toEqual({ ...chosen, stale: true })
    const confirming = accepted(hidden)
    expect(confirming.stale).toBe(true)
    expect(confirming.pending?.stage).toBe("confirming")
    expect(deriveView(confirming, 100).canPlay).toBe(false)
    const fresh = observe(confirming, playing)
    expect(fresh.pending).toBeNull()
    expect(fresh.stale).toBe(false)
    expect(fresh.chosenDeviceId).toBe("selected")
  })

  for (const retryAfterSeconds of [undefined, 9]) {
    test(`rate limits reads and commands for ${retryAfterSeconds ?? 30} seconds`, () => {
      const failure = {
        reason: "RateLimited",
        message: "Wait",
        retryAfterSeconds,
      }
      const state = playerReducer(loaded(), {
        type: "failed",
        epoch: 0,
        seq: 2,
        now: 1000,
        failure,
      })
      const wait = (retryAfterSeconds ?? 30) * 1000
      expect(nextPollDelay(state, 1000)).toBe(wait)
      const fresh = observe(state)
      expect(deriveView(fresh, 1000).canPlay).toBe(false)
      expect(start(fresh)).toBe(fresh)
      expect(deriveView(fresh, 1000 + wait).canPlay).toBe(true)
      const pending = start(loaded())
      const rejected = playerReducer(pending, {
        type: "rejected",
        epoch: pending.epoch,
        now: 1000,
        failure,
      })
      expect(rejected.pending).toBeNull()
      expect(nextPollDelay(rejected, 1000)).toBe(wait)
      expect(deriveView(rejected, 1000).canResume).toBe(false)
    })
  }

  test("stops polling on missing scopes and lost connections", () => {
    expect(nextPollDelay(loaded({ status: "needs_permission" }), 0)).toBeNull()
    for (const reason of ["NotConnected", "ReconnectNeeded"]) {
      const state = playerReducer(loaded(), {
        type: "failed",
        epoch: 0,
        seq: 2,
        now: 0,
        failure: { reason, message: "Reconnect" },
      })
      expect(deriveView(state, 0).status).toBe("connection_lost")
      expect(nextPollDelay(state, 0)).toBeNull()
      expect(deriveView(state, 0).canPlay).toBe(false)
    }
  })
})

const browserReady = (state: PlayerState) =>
  playerReducer(state, {
    type: "browser",
    device: { status: "ready", deviceId: "browser" },
  })

describe("browser playback device", () => {
  const browser = {
    ...device,
    id: "browser",
    name: "Tools browser player",
    active: false,
  }

  test("prefers the active device and defaults to this browser only after Spotify lists it", () => {
    let state = browserReady(loaded({ ...ready, devices: [device, browser] }))
    expect(deriveView(state, 0).target?.id).toBe("current")
    state = observe(state, {
      ...ready,
      playback: null,
      devices: [{ ...device, active: false }, browser],
    })
    expect(deriveView(state, 0).target).toMatchObject({
      id: "browser",
      name: "This browser",
    })
    expect(deriveView(state, 0).playback).toBeNull()
    state = observe(state, { ...ready, playback: null, devices: [] })
    expect(deriveView(state, 0).canPlay).toBe(false)
  })

  test("browser readiness and SDK errors never confirm an accepted track request", () => {
    let state = browserReady(
      loaded({ ...ready, playback: null, devices: [browser] })
    )
    state = accepted(
      start(state, {
        kind: "play",
        deviceId: "browser",
        trackId: "trackA",
        nextTrackIds: [],
      })
    )
    state = browserReady(state)
    expect(state.pending?.stage).toBe("confirming")
    expect(deriveView(state, 0).playback).toBeNull()
    state = observe(state, {
      ...playing,
      playback: {
        ...playing.playback!,
        device: {
          id: "browser",
          name: "Tools browser player",
          restricted: false,
        },
      },
      devices: [browser],
    })
    expect(state.pending).toBeNull()
    expect(deriveView(state, 0).playback?.playing).toBe(true)
  })

  test("unavailable browser devices remain unavailable through stale server lists and preserve an explicit choice", () => {
    let state = playerReducer(
      browserReady(loaded({ ...ready, devices: [device, browser] })),
      { type: "choose", deviceId: "browser" }
    )
    state = playerReducer(state, {
      type: "browser",
      device: { status: "unavailable", message: "Offline" },
    })
    state = observe(state, { ...ready, devices: [device, browser] })
    expect(deriveView(state, 0)).toMatchObject({
      target: null,
      missingChoice: true,
      canPlay: false,
    })
    expect(deriveView(state, 0).devices).toEqual([device])
    state = browserReady(state)
    expect(deriveView(state, 0).target?.id).toBe("browser")
  })

  test("next is confirmed once a different track plays on the current device", () => {
    const next: PlayerCommand = {
      kind: "next",
      deviceId: "current",
      fromTrackId: "trackA",
    }
    expect(deriveView(loaded(), 0).canNext).toBe(true)
    expect(
      deriveView(
        loaded({
          ...ready,
          playback: {
            ...ready.playback!,
            allows: { ...ready.playback!.allows, next: false },
          },
        }),
        0
      ).canNext
    ).toBe(false)
    expect(
      start(loaded(), { ...next, deviceId: "selected" }).pending
    ).toBeNull()
    let state = accepted(start(loaded(), next))
    expect(state.pending?.command).toEqual(next)
    state = observe(state, playing)
    expect(state.pending?.stage).toBe("confirming")
    const skipped: PlayerStatus = {
      ...playing,
      playback: {
        ...playing.playback!,
        item: { ...(playing.playback!.item as object), id: "trackB" } as never,
      },
    }
    expect(confirms(next, skipped)).toBe(true)
    state = observe(state, skipped)
    expect(state.pending).toBeNull()
    expect(state.unconfirmed).toBe(false)
  })

  test("progress advances from the observation while playing and holds while paused", () => {
    const observed = {
      ...playing,
      playback: { ...playing.playback!, progressMs: 10_000 },
    }
    const withDuration: PlayerStatus = {
      ...observed,
      playback: {
        ...observed.playback,
        item: {
          ...(playing.playback!.item as object),
          durationMs: 12_000,
        } as never,
      },
    }
    const state = playerReducer(initialPlayerState, {
      type: "loaded",
      data: withDuration,
      epoch: 0,
      seq: 1,
      now: 1000,
    })
    expect(playbackProgress(state, 2500)?.positionMs).toBe(11_500)
    expect(playbackProgress(state, 60_000)?.positionMs).toBe(12_000)
    const paused = playerReducer(initialPlayerState, {
      type: "loaded",
      data: {
        ...withDuration,
        playback: { ...withDuration.playback!, playing: false },
      } as PlayerStatus,
      epoch: 0,
      seq: 1,
      now: 1000,
    })
    expect(playbackProgress(paused, 60_000)?.positionMs).toBe(10_000)
    expect(playbackProgress(loaded(), 0)).toBeNull()
  })
})
