import type {
  NowPlaying,
  Playback,
  PlayerDevice,
  PlayerStatus,
} from "@mdoultremont/tools-contracts/music"

export type QueuedTrack = Extract<NowPlaying, { kind: "track" }>

export type PlayerCommand =
  | {
      readonly kind: "play"
      readonly deviceId: string
      readonly trackId: string
      readonly nextTrackIds: readonly string[]
    }
  | { readonly kind: "pause"; readonly deviceId: string }
  | { readonly kind: "resume"; readonly deviceId: string }
  | {
      readonly kind: "next"
      readonly deviceId: string
      /** The track playing when skipping, so confirmation can see it change. */
      readonly fromTrackId: string | null
    }

export interface PlayerFailure {
  readonly reason?: string
  readonly message: string
  readonly retryAfterSeconds?: number
}

export type BrowserDevice =
  | { readonly status: "connecting" }
  | { readonly status: "ready"; readonly deviceId: string }
  | { readonly status: "unavailable"; readonly message: string }

export interface PlayerState {
  readonly browser: BrowserDevice
  readonly unavailableBrowserIds: readonly string[]
  readonly server:
    | { readonly status: "loading" }
    | {
        readonly status: "loaded"
        readonly data: PlayerStatus
        /** When this status was observed, to advance playback progress locally. */
        readonly at: number
      }
    | { readonly status: "failed" }
  readonly stale: boolean
  readonly chosenDeviceId: string | null
  readonly pending: {
    readonly command: PlayerCommand
    readonly stage: "sending" | "confirming"
    /** When the owner asked, so the intended playback starts from that moment. */
    readonly startedAt: number
    readonly acceptedAt: number
    readonly checks: number
  } | null
  /** The tracks of the last list played from, so Next can show its track before Spotify confirms. */
  readonly queue: readonly QueuedTrack[]
  readonly unconfirmed: boolean
  readonly notice: string | null
  readonly connectionLost: boolean
  readonly epoch: number
  readonly appliedSeq: number
  readonly pausedUntil: number
}

export const initialPlayerState: PlayerState = {
  browser: { status: "connecting" },
  unavailableBrowserIds: [],
  server: { status: "loading" },
  stale: false,
  chosenDeviceId: null,
  pending: null,
  queue: [],
  unconfirmed: false,
  notice: null,
  connectionLost: false,
  epoch: 0,
  appliedSeq: 0,
  pausedUntil: 0,
}

export type PlayerEvent =
  | { readonly type: "browser"; readonly device: BrowserDevice }
  | { readonly type: "choose"; readonly deviceId: string | null }
  | { readonly type: "hidden" }
  | {
      readonly type: "start"
      readonly command: PlayerCommand
      /** For a play command: the played track, then the tracks queued after it. */
      readonly queue?: readonly QueuedTrack[]
      readonly now: number
    }
  | { readonly type: "accepted"; readonly epoch: number; readonly now: number }
  | {
      readonly type: "rejected"
      readonly epoch: number
      readonly failure: PlayerFailure
      readonly now: number
    }
  | {
      readonly type: "loaded"
      readonly epoch: number
      readonly seq: number
      readonly data: PlayerStatus
      readonly now: number
    }
  | {
      readonly type: "failed"
      readonly epoch: number
      readonly seq: number
      readonly failure: PlayerFailure
      readonly now: number
    }

export function confirms(command: PlayerCommand, status: PlayerStatus) {
  if (
    status.status !== "ready" ||
    status.playback?.device.id !== command.deviceId
  )
    return false
  const playback = status.playback
  if (command.kind === "pause") return !playback.playing
  if (command.kind === "resume") return playback.playing
  if (command.kind === "next")
    return (
      playback.item?.kind === "track" &&
      playback.item.id !== null &&
      playback.item.id !== command.fromTrackId
    )
  return (
    playback.playing &&
    playback.item?.kind === "track" &&
    playback.item.id !== null &&
    playback.item.id === command.trackId
  )
}

function failed(
  state: PlayerState,
  failure: PlayerFailure,
  now: number
): PlayerState {
  const lost =
    failure.reason === "NotConnected" || failure.reason === "ReconnectNeeded"
  const retryAfter = failure.retryAfterSeconds
  return {
    ...state,
    connectionLost: lost,
    notice: failure.message,
    pausedUntil:
      failure.reason === "RateLimited"
        ? now +
          (retryAfter !== undefined &&
          Number.isFinite(retryAfter) &&
          retryAfter >= 0
            ? retryAfter
            : 30) *
            1000
        : state.pausedUntil,
  }
}

function reconcile(state: PlayerState, data?: PlayerStatus): PlayerState {
  const pending = state.pending
  if (data?.status === "needs_permission") return { ...state, pending: null }
  if (pending?.stage !== "confirming") return state
  if (data && confirms(pending.command, data))
    return { ...state, pending: null, unconfirmed: false }
  if (pending.checks >= 1) return { ...state, pending: null, unconfirmed: true }
  return { ...state, pending: { ...pending, checks: pending.checks + 1 } }
}

export function playerReducer(
  state: PlayerState,
  event: PlayerEvent
): PlayerState {
  if (event.type === "browser") {
    const device = event.device
    const previousId =
      state.browser.status === "ready" ? state.browser.deviceId : null
    const unavailable =
      previousId &&
      (device.status !== "ready" || device.deviceId !== previousId)
        ? [...state.unavailableBrowserIds, previousId]
        : state.unavailableBrowserIds
    return {
      ...state,
      browser: device,
      unavailableBrowserIds:
        device.status === "ready"
          ? unavailable.filter((id) => id !== device.deviceId)
          : unavailable,
    }
  }
  if (event.type === "choose")
    return { ...state, chosenDeviceId: event.deviceId }
  if (event.type === "hidden") return { ...state, stale: true }
  if (event.type === "start") {
    if (state.pending?.stage === "sending") return state
    const view = deriveView(state, event.now)
    const command = event.command
    const enabled =
      command.kind === "play"
        ? view.canPlay && view.target?.id === command.deviceId
        : view.currentDeviceId === command.deviceId &&
          {
            pause: view.canPause,
            resume: view.canResume,
            next: view.canNext,
          }[command.kind]
    if (!enabled) return state
    return {
      ...state,
      epoch: state.epoch + 1,
      pending: {
        command,
        stage: "sending",
        startedAt: event.now,
        acceptedAt: 0,
        checks: 0,
      },
      queue: command.kind === "play" ? (event.queue ?? []) : state.queue,
      notice: null,
      unconfirmed: false,
    }
  }
  if (event.epoch !== state.epoch) return state
  if (event.type === "accepted")
    return state.pending?.stage === "sending"
      ? {
          ...state,
          pending: {
            ...state.pending,
            stage: "confirming",
            acceptedAt: event.now,
          },
        }
      : state
  if (event.type === "rejected")
    return state.pending?.stage === "sending"
      ? failed({ ...state, pending: null }, event.failure, event.now)
      : state
  if (event.seq <= state.appliedSeq) return state
  if (event.type === "loaded")
    return reconcile(
      {
        ...state,
        server: { status: "loaded", data: event.data, at: event.now },
        stale: false,
        notice: null,
        connectionLost: false,
        appliedSeq: event.seq,
      },
      event.data
    )
  const next = reconcile(
    failed(
      {
        ...state,
        server:
          state.server.status === "loaded"
            ? state.server
            : { status: "failed" },
        stale: true,
        appliedSeq: event.seq,
      },
      event.failure,
      event.now
    )
  )
  return next.connectionLost ? { ...next, pending: null } : next
}

export function deriveView(state: PlayerState, now: number) {
  const data = state.server.status === "loaded" ? state.server.data : null
  const ready = data?.status === "ready" ? data : null
  const browserId =
    state.browser.status === "ready" ? state.browser.deviceId : null
  const devices: readonly PlayerDevice[] = (ready?.devices ?? [])
    .filter(
      (device) =>
        !device.controllable || !state.unavailableBrowserIds.includes(device.id)
    )
    .map((device) =>
      device.controllable && device.id === browserId
        ? { ...device, name: "This browser" }
        : device
    )
  const controllable = devices.filter((device) => device.controllable)
  const target =
    (state.chosenDeviceId === null
      ? (controllable.find((device) => device.active) ??
        controllable.find((device) => device.id === browserId))
      : controllable.find((device) => device.id === state.chosenDeviceId)) ??
    null
  const playback = intended(state)?.playback ?? null
  const currentDeviceId = playback?.device.id ?? null
  const blocked =
    !ready || state.stale || state.connectionLost || state.pausedUntil > now
  const currentControllable =
    currentDeviceId !== null &&
    !state.unavailableBrowserIds.includes(currentDeviceId) &&
    !playback?.device.restricted
  return {
    status: state.connectionLost
      ? ("connection_lost" as const)
      : (data?.status ?? state.server.status),
    devices,
    target,
    playback,
    currentDeviceId,
    missingChoice: state.chosenDeviceId !== null && target === null,
    canPlay: !blocked && target !== null,
    canPause:
      !blocked &&
      currentControllable &&
      playback?.playing === true &&
      playback.allows.pause,
    canResume:
      !blocked &&
      currentControllable &&
      playback?.playing === false &&
      playback.allows.resume,
    canNext:
      !blocked &&
      currentControllable &&
      playback?.item?.kind === "track" &&
      playback.allows.next,
    rateLimited: state.pausedUntil > now,
  }
}

/** Advances an observed position to `at`, while the track plays. */
function positionAt(playback: Playback, observedAt: number, at: number) {
  if (playback.progressMs === null) return null
  const elapsed = playback.playing ? Math.max(0, at - observedAt) : 0
  const duration =
    playback.item?.kind === "track" ? playback.item.durationMs : null
  return Math.min(duration ?? Infinity, playback.progressMs + elapsed)
}

/**
 * The playback to show: what Spotify reported, or, while a command waits for
 * confirmation, what it asked for. `at` is when that playback was true. An
 * unconfirmed or refused command ends the pending state, so the view falls
 * back to what Spotify reports.
 */
function intended(
  state: PlayerState
): { readonly playback: Playback | null; readonly at: number } | null {
  if (state.server.status !== "loaded" || state.server.data.status !== "ready")
    return null
  const observed = state.server.data.playback
  const at = state.server.at
  const pending = state.pending
  if (!pending) return { playback: observed, at }
  const command = pending.command
  const startedAt = pending.startedAt
  if (command.kind === "pause" || command.kind === "resume")
    return observed
      ? {
          playback: {
            ...observed,
            playing: command.kind === "resume",
            progressMs: positionAt(observed, at, startedAt),
          },
          at: startedAt,
        }
      : { playback: observed, at }
  const playedIndex = state.queue.findIndex(
    (entry) =>
      entry.id ===
      (command.kind === "play" ? command.trackId : command.fromTrackId)
  )
  const track =
    playedIndex === -1
      ? undefined
      : state.queue[command.kind === "play" ? playedIndex : playedIndex + 1]
  if (!track) return { playback: observed, at }
  const device = state.server.data.devices.find(
    (entry) => entry.controllable && entry.id === command.deviceId
  )
  const base: Playback | null =
    observed?.device.id === command.deviceId
      ? observed
      : device
        ? {
            device: {
              id: command.deviceId,
              name: device.name,
              restricted: false,
            },
            allows: { pause: true, resume: true, next: true },
            playing: true,
            item: null,
            progressMs: 0,
          }
        : null
  if (!base) return { playback: observed, at }
  return {
    playback: { ...base, playing: true, item: track, progressMs: 0 },
    at: startedAt,
  }
}

/** Where the playing track is now, advanced from the last observation while it plays. */
export function playbackProgress(state: PlayerState, now: number) {
  const shown = intended(state)
  if (!shown) return null
  const { playback, at } = shown
  const item = playback?.item
  if (
    !playback ||
    item?.kind !== "track" ||
    item.durationMs === null ||
    playback.progressMs === null
  )
    return null
  return {
    track: item.id ?? item.name,
    positionMs: positionAt(playback, at, now) ?? 0,
    durationMs: item.durationMs,
    playing: playback.playing,
  }
}

export function nextPollDelay(state: PlayerState, now: number): number | null {
  if (
    state.connectionLost ||
    (state.server.status === "loaded" &&
      state.server.data.status === "needs_permission") ||
    state.pending?.stage === "sending"
  )
    return null
  if (state.pausedUntil > now) return state.pausedUntil - now
  if (state.pending?.stage === "confirming")
    return Math.max(
      0,
      state.pending.acceptedAt +
        (state.pending.checks === 0 ? 1000 : 3000) -
        now
    )
  return 20_000
}
