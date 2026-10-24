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
import { AudioLinesIcon, PauseIcon, PlayIcon } from "lucide-react"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/features/ui/select"
import { Spinner } from "@/features/ui/spinner"
import {
  deriveView,
  initialPlayerState,
  nextPollDelay,
  playerReducer,
  type PlayerCommand,
  type PlayerEvent,
  type PlayerFailure,
  type PlayerState,
} from "./player-state"

type PlayerClient = {
  readonly status: () => Promise<PlayerStatus>
  readonly play: (input: {
    deviceId: string
    trackId: string
  }) => Promise<CommandAccepted>
  readonly pause: (input: { deviceId: string }) => Promise<CommandAccepted>
  readonly resume: (input: { deviceId: string }) => Promise<CommandAccepted>
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

  async function command(request: PlayerCommand) {
    if (document.visibilityState === "hidden") return
    const previous = stateRef.current
    sendEvent({ type: "start", command: request, now: Date.now() })
    const current = stateRef.current
    if (current.epoch === previous.epoch) return
    const epoch = current.epoch
    const generation = lifecycle.current
    scheduleRef.current()
    try {
      if (request.kind === "play")
        await client.play({
          deviceId: request.deviceId,
          trackId: request.trackId,
        })
      else await client[request.kind]({ deviceId: request.deviceId })
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
  const view = deriveView(state, now)
  return {
    state,
    view,
    chooseDevice: (deviceId: string | null) =>
      sendEvent({ type: "choose", deviceId }),
    refresh: () => scheduleRef.current(true),
    playTrack: (trackId: string) => {
      const target = deriveView(stateRef.current, Date.now()).target
      if (target) void command({ kind: "play", trackId, deviceId: target.id })
    },
    pause: () => {
      const deviceId = deriveView(stateRef.current, Date.now()).currentDeviceId
      if (deviceId) void command({ kind: "pause", deviceId })
    },
    resume: () => {
      const deviceId = deriveView(stateRef.current, Date.now()).currentDeviceId
      if (deviceId) void command({ kind: "resume", deviceId })
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

export function PlayerBar() {
  const { state, view, chooseDevice, refresh, pause, resume } = usePlayer()
  const item = view.playback?.item
  const busy = state.pending !== null
  return (
    <section
      aria-label="Spotify player"
      className="flex min-w-0 flex-col gap-3 rounded-xl border bg-muted/20 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Spotify player</h2>
        <Button
          type="button"
          variant="ghost"
          disabled={
            busy ||
            view.rateLimited ||
            view.status === "connection_lost" ||
            view.status === "needs_permission"
          }
          onClick={refresh}
        >
          Refresh playback
        </Button>
      </div>
      {view.status === "loading" ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Spinner aria-hidden="true" />
          Loading playback…
        </p>
      ) : null}
      {view.status === "needs_permission" ? (
        <p>
          Connect Spotify again to allow playback control.{" "}
          <a
            className="underline underline-offset-4"
            href="/api/music/spotify/connect"
          >
            Allow playback
          </a>
        </p>
      ) : null}
      {view.status === "connection_lost" ? (
        <p>
          Spotify needs to be connected again.{" "}
          <a
            className="underline underline-offset-4"
            href="/api/music/spotify/connect"
          >
            Connect Spotify
          </a>
        </p>
      ) : null}
      {view.status === "ready" ? (
        <div className="grid min-w-0 items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,auto)]">
          <div className="flex min-w-0 items-center gap-3">
            {item?.kind === "track" && item.imageUrl ? (
              <img
                src={item.imageUrl}
                alt=""
                className="size-12 shrink-0 rounded-md object-cover"
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">
                {item?.kind === "track"
                  ? item.name
                  : item?.kind === "other"
                    ? "Other Spotify content"
                    : "Nothing playing"}
              </p>
              {item?.kind === "track" ? (
                <p className="truncate text-sm text-muted-foreground">
                  {item.artistNames.join(", ")}
                </p>
              ) : null}
              {view.playback ? (
                <p
                  className="truncate text-sm text-muted-foreground"
                  title={view.playback.device.name}
                >
                  {view.playback.playing ? "Playing" : "Paused"} on{" "}
                  {view.playback.device.name}
                </p>
              ) : null}
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={
                view.playback?.playing ? "Pause playback" : "Resume playback"
              }
              disabled={
                view.playback?.playing ? !view.canPause : !view.canResume
              }
              onClick={view.playback?.playing ? pause : resume}
            >
              {view.playback?.playing ? (
                <PauseIcon aria-hidden="true" />
              ) : (
                <PlayIcon aria-hidden="true" />
              )}
            </Button>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <span
              id="player-device-label"
              className="text-sm text-muted-foreground"
            >
              Play tracks on
            </span>
            <Select
              value={view.target?.id ?? null}
              onValueChange={chooseDevice}
              disabled={busy || state.stale}
            >
              <SelectTrigger
                aria-labelledby="player-device-label"
                className="w-full min-w-0"
              >
                <SelectValue className="min-w-0">
                  <span className="truncate">
                    {view.target?.name ?? "Choose a device"}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {view.devices.map((device, index) => (
                  <SelectItem
                    key={
                      device.controllable ? device.id : `unavailable-${index}`
                    }
                    value={
                      device.controllable ? device.id : { unavailable: index }
                    }
                    disabled={!device.controllable}
                  >
                    {device.name}
                    {!device.controllable
                      ? ` (${device.why === "restricted" ? "restricted" : "unavailable"})`
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {view.devices.length === 0 ? (
            <p className="text-sm text-muted-foreground sm:col-span-2">
              No devices found. Open Spotify on a device, then refresh playback.
            </p>
          ) : view.devices.every((device) => !device.controllable) ? (
            <p className="text-sm text-muted-foreground sm:col-span-2">
              These devices cannot be controlled. Open Spotify on another
              device, then refresh playback.
            </p>
          ) : view.missingChoice ? (
            <p className="text-sm text-muted-foreground sm:col-span-2">
              The selected device is unavailable. Choose a device to play
              tracks.
            </p>
          ) : null}
        </div>
      ) : null}
      <output aria-live="polite" className="block text-sm empty:hidden">
        {busy ? (
          <span className="flex items-center gap-2">
            <Spinner aria-hidden="true" />
            {state.pending?.stage === "sending"
              ? "Sending request…"
              : "Request sent. Waiting for Spotify…"}
          </span>
        ) : null}
        {state.unconfirmed ? (
          <span className="block">
            Request sent. Spotify hasn&apos;t confirmed the change.
          </span>
        ) : null}
        {state.stale ? (
          <span className="block">
            Playback is out of date. Refresh before controlling Spotify.
          </span>
        ) : null}
        {state.notice ? <span className="block">{state.notice}</span> : null}
        {view.rateLimited ? (
          <span className="block">
            Spotify has asked us to wait. Playback will refresh after the rate
            limit expires.
          </span>
        ) : null}
      </output>
      <p className="text-xs text-muted-foreground">
        Playback control requires Spotify Premium and an available Spotify
        device. Spotify app access may also be limited to approved users.
      </p>
    </section>
  )
}

export function TrackPlayButton({
  trackId,
  name,
}: {
  readonly trackId: string
  readonly name: string
}) {
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
      title={
        view.canPlay
          ? `Play on ${view.target?.name}`
          : "Choose an available device and refresh playback to play"
      }
      disabled={!view.canPlay}
      onClick={() => playTrack(trackId)}
      data-playing={playing || undefined}
    >
      {playing ? (
        <AudioLinesIcon aria-hidden="true" />
      ) : (
        <PlayIcon aria-hidden="true" />
      )}
    </Button>
  )
}
