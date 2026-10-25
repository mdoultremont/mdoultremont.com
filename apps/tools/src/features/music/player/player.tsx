import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  AudioLinesIcon,
  Music2Icon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  SkipForwardIcon,
  SpeakerIcon,
} from "lucide-react"
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
import { cn } from "@/features/ui/lib/utils"
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
    /** Plays `trackId`, then `nextTrackIds` (at most 99 are queued). */
    playTrack: (trackId: string, nextTrackIds: readonly string[] = []) => {
      const target = deriveView(stateRef.current, Date.now()).target
      if (target)
        void command({
          kind: "play",
          trackId,
          nextTrackIds: nextTrackIds
            .filter((id) => /^[A-Za-z0-9]+$/u.test(id))
            .slice(0, 99),
          deviceId: target.id,
        })
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

/**
 * The compact player. `sidebar` stacks it to fit the sidebar footer; `bar`
 * lays it out in one row for the bottom of the page.
 */
export function MiniPlayer({
  variant,
}: {
  readonly variant: "sidebar" | "bar"
}) {
  const { state, view, chooseDevice, refresh, pause, resume, next } =
    usePlayer()
  const labelId = useId()
  const item = view.playback?.item
  const busy = state.pending !== null
  const stacked = variant === "sidebar"
  return (
    <section
      aria-label="Spotify player"
      className={cn(
        "flex min-w-0 gap-x-3 gap-y-2 rounded-lg border bg-background p-2.5 text-sm text-foreground shadow-xs",
        stacked ? "flex-col" : "flex-row flex-wrap items-center"
      )}
    >
      <h2 className="sr-only">Spotify player</h2>
      {view.status === "loading" ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Spinner aria-hidden="true" />
          Loading playback…
        </p>
      ) : null}
      {view.status === "needs_permission" ? (
        <p className="text-muted-foreground">
          Connect Spotify again to allow playback control. Playback requires
          Spotify Premium.{" "}
          <a
            className="text-foreground underline underline-offset-4"
            href="/api/music/spotify/connect"
          >
            Allow playback
          </a>
        </p>
      ) : null}
      {view.status === "connection_lost" ? (
        <p className="text-muted-foreground">
          Connect Spotify to control playback.{" "}
          <a
            className="text-foreground underline underline-offset-4"
            href="/api/music/spotify/connect"
          >
            Connect Spotify
          </a>
        </p>
      ) : null}
      {view.status === "ready" ? (
        <>
          <div
            className={cn(
              "flex min-w-0 items-center gap-2.5",
              !stacked && "flex-1 basis-48"
            )}
          >
            <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
              {item?.kind === "track" && item.imageUrl ? (
                <img
                  src={item.imageUrl}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                <Music2Icon
                  aria-hidden="true"
                  className="size-4 text-muted-foreground"
                />
              )}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate font-medium">
                {item?.kind === "track"
                  ? item.name
                  : item?.kind === "other"
                    ? "Other Spotify content"
                    : "Nothing playing"}
              </p>
              {item?.kind === "track" ? (
                <p className="truncate text-xs text-muted-foreground">
                  {item.artistNames.join(", ")}
                </p>
              ) : null}
              {view.playback ? (
                <p
                  className="truncate text-xs text-muted-foreground"
                  title={view.playback.device.name}
                >
                  {view.playback.playing ? "Playing" : "Paused"} on{" "}
                  {view.playback.device.name}
                </p>
              ) : null}
            </div>
          </div>
          <div
            className={cn(
              "flex min-w-0 items-center gap-1",
              stacked ? "w-full flex-wrap" : "shrink-0"
            )}
          >
            <span id={labelId} className="sr-only">
              Play tracks on
            </span>
            <Select
              value={state.chosenDeviceId ?? view.target?.id ?? null}
              onValueChange={chooseDevice}
              disabled={busy || state.stale}
            >
              <SelectTrigger
                aria-labelledby={labelId}
                size="sm"
                className={cn(
                  "min-w-0 border-transparent bg-transparent shadow-none hover:bg-muted",
                  stacked ? "order-last mt-1 w-full" : "w-40"
                )}
              >
                <SpeakerIcon
                  aria-hidden="true"
                  className="text-muted-foreground"
                />
                <SelectValue className="min-w-0 flex-1 text-left">
                  <span className="truncate">
                    {view.target?.name ?? "Choose a device"}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {view.missingChoice ? (
                  <SelectItem value={state.chosenDeviceId} disabled>
                    Selected device (unavailable)
                  </SelectItem>
                ) : null}
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
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={stacked ? "order-1 ml-auto" : undefined}
              aria-label="Refresh playback"
              title="Refresh playback"
              disabled={busy || view.rateLimited}
              onClick={refresh}
            >
              <RefreshCwIcon aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
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
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Next track"
              title="Next track"
              disabled={!view.canNext}
              onClick={next}
            >
              <SkipForwardIcon aria-hidden="true" />
            </Button>
          </div>
        </>
      ) : null}
      <PlayerMessages className={stacked ? undefined : "basis-full"} />
    </section>
  )
}

function PlayerMessages({ className }: { readonly className?: string }) {
  const { state, view } = usePlayer()
  const busy = state.pending !== null
  const ready = view.status === "ready"
  const deviceHint = !ready
    ? null
    : view.devices.length === 0
      ? "No devices found. Open Spotify on a device, then refresh playback."
      : view.devices.every((device) => !device.controllable)
        ? "These devices cannot be controlled. Open Spotify on another device, then refresh playback."
        : view.missingChoice
          ? "The selected device is unavailable. Choose a device to play tracks."
          : null
  const browserHint = !ready
    ? null
    : state.browser.status === "connecting"
      ? "Connecting this browser to Spotify…"
      : state.browser.status === "unavailable"
        ? state.browser.message
        : null
  return (
    <output
      aria-live="polite"
      className={cn(
        "block text-xs text-muted-foreground empty:hidden",
        className
      )}
    >
      {deviceHint ? <span className="block">{deviceHint}</span> : null}
      {browserHint ? <span className="block">{browserHint}</span> : null}
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
  )
}

export function TrackPlayButton({
  trackId,
  name,
  nextTrackIds,
}: {
  readonly trackId: string
  readonly name: string
  /** The tracks that follow in the list, queued so Next continues through them. */
  readonly nextTrackIds?: () => readonly string[]
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
      aria-description={playing ? "Currently playing" : undefined}
      title={
        view.canPlay
          ? `Play on ${view.target?.name}`
          : "Choose an available device and refresh playback to play"
      }
      disabled={!view.canPlay}
      onClick={() => playTrack(trackId, nextTrackIds?.())}
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
