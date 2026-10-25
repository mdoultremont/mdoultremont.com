import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { PlayIcon } from "lucide-react"
import { Option, Schema } from "effect"
import {
  ActionErrorDataSchema,
  errorReason,
} from "@mdoultremont/tools-contracts"
import type {
  CommandAccepted,
  PlayerStatus,
} from "@mdoultremont/tools-contracts/music"
import { api, errorMessage } from "@/features/api"
import { Button } from "@/features/ui/button"
import {
  deriveView,
  initialPlayerState,
  nextPollDelay,
  playerReducer,
  type PlayerCommand,
  type PlayerEvent,
  type PlayerFailure,
  type PlayerState,
  type QueuedTrack,
} from "./player-state"

import { useBrowserPlayer } from "./browser-player"

type PlayerClient = {
  readonly token: () => Promise<{ readonly accessToken: string }>
  readonly status: () => Promise<PlayerStatus>
  readonly play: (input: {
    deviceId: string
    trackId: string
    nextTrackIds?: readonly string[]
  }) => Promise<CommandAccepted>
  readonly pause: (input: { deviceId: string }) => Promise<CommandAccepted>
  readonly resume: (input: { deviceId: string }) => Promise<CommandAccepted>
  readonly next: (input: { deviceId: string }) => Promise<CommandAccepted>
}

function playerFailure(cause: unknown): PlayerFailure {
  const data =
    typeof cause === "object" && cause !== null && "data" in cause
      ? Option.getOrUndefined(
          Schema.decodeUnknownOption(ActionErrorDataSchema)(cause.data)
        )
      : undefined
  return {
    reason: errorReason(cause),
    message: errorMessage(
      cause,
      "Spotify playback could not be updated. Refresh to try again."
    ),
    retryAfterSeconds: data?.retryAfterSeconds,
  }
}

/** A hung request would otherwise keep every control disabled until reload. */
const commandTimeoutMilliseconds = 15_000

function withTimeout<A>(request: Promise<A>, milliseconds: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            "Spotify did not answer in time. Refresh to check playback."
          )
        ),
      milliseconds
    )
  })
  return Promise.race([request, timeout]).finally(() => clearTimeout(timer))
}

function usePlayerController(client: PlayerClient, initialState: PlayerState) {
  const [state, dispatch] = useReducer(playerReducer, initialState)
  const [now, setNow] = useState(() => Date.now())
  const stateRef = useRef(initialState)
  const sequence = useRef(initialState.appliedSeq)
  const lifecycle = useRef(0)
  const scheduleRef = useRef<(immediate?: boolean) => void>(() => {})
  const sendEvent = useCallback((event: PlayerEvent) => {
    stateRef.current = playerReducer(stateRef.current, event)
    dispatch(event)
    setNow(Date.now())
  }, [])

  useEffect(() => {
    const generation = ++lifecycle.current
    let timer: ReturnType<typeof setTimeout> | undefined
    let inFlight: { seq: number; epoch: number } | null = null
    let visibilityVersion = 0
    const visible = () => document.visibilityState !== "hidden"
    let readOnVisible = false
    const active = () => lifecycle.current === generation
    function schedule(immediate = false) {
      clearTimeout(timer)
      if (!active() || !visible()) return
      const current = stateRef.current
      const time = Date.now()
      const delay = nextPollDelay(current, time)
      if (delay === null) return
      if (inFlight !== null && inFlight.epoch !== current.epoch) {
        inFlight = null
        readOnVisible = false
      }
      if (inFlight !== null) {
        readOnVisible ||= immediate
        return
      }
      timer = setTimeout(
        () => void load(),
        immediate && current.pausedUntil <= time ? 0 : delay
      )
    }
    async function load() {
      if (!active() || !visible()) return
      const time = Date.now()
      const current = stateRef.current
      if (nextPollDelay(current, time) === null || current.pausedUntil > time) {
        schedule()
        return
      }
      const seq = ++sequence.current
      const epoch = current.epoch
      const visibility = visibilityVersion
      inFlight = { seq, epoch }
      try {
        const data = await client.status()
        if (active() && visible() && visibility === visibilityVersion)
          sendEvent({ type: "loaded", data, seq, epoch, now: Date.now() })
      } catch (cause) {
        if (active() && visible() && visibility === visibilityVersion)
          sendEvent({
            type: "failed",
            failure: playerFailure(cause),
            seq,
            epoch,
            now: Date.now(),
          })
      } finally {
        if (active() && inFlight?.seq === seq) {
          inFlight = null
          const immediate = readOnVisible
          readOnVisible = false
          schedule(immediate)
        }
      }
    }
    function visibilityChanged() {
      if (!visible()) {
        sendEvent({ type: "hidden" })
        ++visibilityVersion
        inFlight = null
        readOnVisible = false
        clearTimeout(timer)
      } else {
        setNow(Date.now())
        schedule(true)
      }
    }
    scheduleRef.current = schedule
    document.addEventListener("visibilitychange", visibilityChanged)
    schedule(true)
    return () => {
      ++lifecycle.current
      clearTimeout(timer)
      scheduleRef.current = () => {}
      document.removeEventListener("visibilitychange", visibilityChanged)
    }
  }, [client, sendEvent])

  const refresh = useCallback(() => scheduleRef.current(true), [])
  const view = deriveView(state, now)
  const token = useCallback(() => client.token(), [client])
  const browserPlayer = useBrowserPlayer(
    view.status === "ready",
    token,
    sendEvent,
    refresh
  )

  async function command(
    request: PlayerCommand,
    queue?: readonly QueuedTrack[]
  ) {
    if (document.visibilityState === "hidden") return
    const previous = stateRef.current
    sendEvent({ type: "start", command: request, queue, now: Date.now() })
    const current = stateRef.current
    if (current.epoch === previous.epoch) return
    const epoch = current.epoch
    const generation = lifecycle.current
    scheduleRef.current()
    try {
      const activation =
        current.browser.status === "ready" &&
        current.browser.deviceId === request.deviceId &&
        request.kind !== "pause"
          ? browserPlayer.current?.activateElement()
          : undefined
      await withTimeout(
        Promise.resolve(activation).then(() =>
          request.kind === "play"
            ? client.play({
                deviceId: request.deviceId,
                trackId: request.trackId,
                nextTrackIds: request.nextTrackIds,
              })
            : client[request.kind]({ deviceId: request.deviceId })
        ),
        commandTimeoutMilliseconds
      )
      if (generation === lifecycle.current)
        sendEvent({ type: "accepted", epoch, now: Date.now() })
    } catch (cause) {
      if (generation === lifecycle.current)
        sendEvent({
          type: "rejected",
          epoch,
          failure: playerFailure(cause),
          now: Date.now(),
        })
    } finally {
      if (generation === lifecycle.current) scheduleRef.current()
    }
  }
  return {
    state,
    view,
    chooseDevice: (deviceId: string | null) =>
      sendEvent({ type: "choose", deviceId }),
    refresh,
    /** Plays `track`, then `nextTracks` (at most 99 are queued). */
    playTrack: (
      track: QueuedTrack,
      nextTracks: readonly QueuedTrack[] = []
    ) => {
      const target = deriveView(stateRef.current, Date.now()).target
      const queued = nextTracks
        .filter((next) => next.id !== null && /^[A-Za-z0-9]+$/u.test(next.id))
        .slice(0, 99)
      if (target && track.id)
        void command(
          {
            kind: "play",
            trackId: track.id,
            nextTrackIds: queued.flatMap((next) => (next.id ? [next.id] : [])),
            deviceId: target.id,
          },
          [track, ...queued]
        )
    },
    pause: () => {
      const deviceId = deriveView(stateRef.current, Date.now()).currentDeviceId
      if (deviceId) void command({ kind: "pause", deviceId })
    },
    resume: () => {
      const deviceId = deriveView(stateRef.current, Date.now()).currentDeviceId
      if (deviceId) void command({ kind: "resume", deviceId })
    },
    next: () => {
      const current = deriveView(stateRef.current, Date.now())
      const item = current.playback?.item
      if (current.currentDeviceId)
        void command({
          kind: "next",
          deviceId: current.currentDeviceId,
          fromTrackId: item?.kind === "track" ? item.id : null,
        })
    },
  }
}

const PlayerContext = createContext<ReturnType<
  typeof usePlayerController
> | null>(null)

const playerClient = api.music.player

export function PlayerProvider({
  children,
  client = playerClient,
  initialState = initialPlayerState,
}: {
  readonly children?: ReactNode
  readonly client?: PlayerClient
  readonly initialState?: PlayerState
}) {
  return (
    <PlayerContext value={usePlayerController(client, initialState)}>
      {children}
    </PlayerContext>
  )
}

export function usePlayer() {
  const player = useContext(PlayerContext)
  if (!player) throw new Error("Player controls need a PlayerProvider")
  return player
}

export function TrackPlayButton({
  track,
  nextTracks,
}: {
  readonly track: QueuedTrack & { readonly id: string }
  /** The tracks that follow in the list, queued so Next continues through them. */
  readonly nextTracks?: () => readonly QueuedTrack[]
}) {
  const trackId = track.id
  const name = track.name
  const { state, view, playTrack } = usePlayer()
  const item = view.playback?.item
  const playing =
    !state.stale &&
    !state.connectionLost &&
    view.playback?.playing &&
    item?.kind === "track" &&
    item.id !== null &&
    item.id === trackId
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={`Play ${name}`}
      aria-description={playing ? "Currently playing" : undefined}
      title={
        view.canPlay
          ? `Play on ${view.target?.name}`
          : "Choose an available device and refresh playback to play"
      }
      disabled={!view.canPlay}
      onClick={() => playTrack(track, nextTracks?.())}
      data-playing={playing || undefined}
    >
      {playing ? <PlayingBars /> : <PlayIcon aria-hidden="true" />}
    </Button>
  )
}

/** An equalizer that moves while the track plays. Durations differ so the bars never fall in step. */
function PlayingBars() {
  return (
    <span
      aria-hidden="true"
      data-slot="playing-bars"
      className="flex h-3.5 items-end gap-[2px]"
    >
      {["0.8s", "1.1s", "0.95s", "1.25s"].map((duration, index) => (
        <span
          key={duration}
          className="h-full w-[2.5px] origin-bottom animate-equalize rounded-full bg-current motion-reduce:animate-none"
          style={{
            animationDuration: duration,
            animationDelay: `-${index * 350}ms`,
          }}
        />
      ))}
    </span>
  )
}
