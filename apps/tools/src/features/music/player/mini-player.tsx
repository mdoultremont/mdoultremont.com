import {
  Music2Icon,
  PauseIcon,
  PlayIcon,
  SkipForwardIcon,
  SpeakerIcon,
} from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/features/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/features/ui/dropdown-menu"
import { cn } from "@/features/ui/lib/utils"
import { Spinner } from "@/features/ui/spinner"
import { usePlayer } from "./player"
import { playbackProgress } from "./player-state"

/**
 * The mini player: what plays, its progress, play/pause, next, and where
 * tracks play. `sidebar` stacks it for the sidebar footer; `bar` keeps the
 * controls beside the title at the bottom of the page.
 */
export function MiniPlayer({
  variant,
}: {
  readonly variant: "sidebar" | "bar"
}) {
  const { state, view, pause, resume, next } = usePlayer()
  const item = view.playback?.item
  const busy = state.pending !== null
  const stacked = variant === "sidebar"

  if (view.status !== "ready")
    return (
      <section
        aria-label="Spotify player"
        className="rounded-lg border bg-background p-2.5 text-xs text-muted-foreground shadow-xs"
      >
        <h2 className="sr-only">Spotify player</h2>
        {view.status === "loading" ? (
          <p className="flex items-center gap-2">
            <Spinner aria-hidden="true" />
            Loading playback…
          </p>
        ) : view.status === "needs_permission" ? (
          <p>
            Connect Spotify again to allow playback control. Playback requires
            Spotify Premium.{" "}
            <a
              className="text-foreground underline underline-offset-4"
              href="/api/music/spotify/connect"
            >
              Allow playback
            </a>
          </p>
        ) : (
          <p>
            Connect Spotify to control playback.{" "}
            <a
              className="text-foreground underline underline-offset-4"
              href="/api/music/spotify/connect"
            >
              Connect Spotify
            </a>
          </p>
        )}
        <PlayerMessages />
      </section>
    )

  const controls = (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="secondary"
        size="icon-sm"
        aria-label={
          view.playback?.playing ? "Pause playback" : "Resume playback"
        }
        disabled={view.playback?.playing ? !view.canPause : !view.canResume}
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
      <DeviceMenu
        compact={!stacked}
        className={stacked ? "ml-auto" : undefined}
      />
    </div>
  )

  return (
    <section
      aria-label="Spotify player"
      aria-busy={busy || undefined}
      className="flex min-w-0 flex-col gap-2 rounded-lg border bg-background p-2.5 text-sm text-foreground shadow-xs"
    >
      <h2 className="sr-only">Spotify player</h2>
      <div className="flex min-w-0 items-center gap-2.5">
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
        </div>
        {stacked ? null : controls}
      </div>
      <Progress />
      {stacked ? controls : null}
      <PlayerMessages />
    </section>
  )
}

/** The track position, ticking locally between status reads and reading again once the track should have ended. */
function Progress() {
  const { state, refresh } = usePlayer()
  const [now, setNow] = useState(() => Date.now())
  const progress = playbackProgress(state, now)
  const playing = progress?.playing ?? false
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [playing])
  const remaining = progress ? progress.durationMs - progress.positionMs : null
  const ended = remaining !== null && remaining <= 0
  useEffect(() => {
    if (playing && ended) {
      const timer = setTimeout(refresh, 1500)
      return () => clearTimeout(timer)
    }
  }, [playing, ended, refresh])
  if (!progress) return null
  const percent =
    progress.durationMs > 0
      ? (progress.positionMs / progress.durationMs) * 100
      : 0
  return (
    <div className="flex items-center gap-2 text-[0.6875rem] text-muted-foreground tabular-nums">
      <span>{clock(progress.positionMs)}</span>
      <progress
        aria-label="Track progress"
        aria-valuetext={`${clock(progress.positionMs)} of ${clock(progress.durationMs)}`}
        max={progress.durationMs}
        value={progress.positionMs}
        className="sr-only"
      />
      <div
        aria-hidden="true"
        className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-foreground/70 transition-[width] duration-1000 ease-linear"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span>{clock(progress.durationMs)}</span>
    </div>
  )
}

/** Where the next track plays. Names the device only when it is not this browser. */
function DeviceMenu({
  compact,
  className,
}: {
  /** Hides the device name on small screens, where the title needs the room. */
  readonly compact: boolean
  readonly className?: string
}) {
  const { state, view, chooseDevice, refresh } = usePlayer()
  const browserId =
    state.browser.status === "ready" ? state.browser.deviceId : null
  const elsewhere = view.target !== null && view.target.id !== browserId
  const busy = state.pending !== null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size={elsewhere ? "sm" : "icon-sm"}
            aria-label={`Play tracks on ${view.target?.name ?? "no device"}`}
            title={`Play tracks on ${view.target?.name ?? "no device"}`}
            className={cn(
              "min-w-0",
              elsewhere &&
                "max-w-36 bg-spotify text-black hover:bg-spotify-hover hover:text-black dark:hover:bg-spotify-hover aria-expanded:bg-spotify-hover aria-expanded:text-black",
              view.target === null && "text-muted-foreground",
              className
            )}
          />
        }
      >
        <SpeakerIcon aria-hidden="true" />
        {elsewhere ? (
          <span className={cn("truncate text-xs", compact && "max-sm:hidden")}>
            {view.target?.name}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Play tracks on</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={state.chosenDeviceId ?? view.target?.id ?? ""}
            onValueChange={(value: string) => chooseDevice(value)}
          >
            {view.devices.map((device, index) =>
              device.controllable ? (
                <DropdownMenuRadioItem
                  key={device.id}
                  value={device.id}
                  closeOnClick
                  disabled={busy || state.stale}
                >
                  {device.name}
                </DropdownMenuRadioItem>
              ) : (
                <DropdownMenuRadioItem
                  key={`unavailable-${index}`}
                  value={`unavailable-${index}`}
                  disabled
                >
                  {device.name} (
                  {device.why === "restricted" ? "restricted" : "unavailable"})
                </DropdownMenuRadioItem>
              )
            )}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={busy || view.rateLimited} onClick={refresh}>
          Refresh devices
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Only what needs the owner's attention: why playback cannot happen, or what Spotify refused. */
function PlayerMessages() {
  const { state, view } = usePlayer()
  const ready = view.status === "ready"
  const browserTargeted =
    view.target === null ||
    (state.browser.status === "ready" &&
      view.target.id === state.browser.deviceId)
  const messages = [
    ready && view.devices.length === 0
      ? "No devices found. Open Spotify on a device, then refresh devices."
      : null,
    ready &&
    view.devices.length > 0 &&
    view.devices.every((device) => !device.controllable)
      ? "These devices cannot be controlled. Open Spotify on another device."
      : null,
    ready && view.missingChoice
      ? "The selected device is unavailable. Choose a device to play tracks."
      : null,
    ready && browserTargeted && state.browser.status === "unavailable"
      ? state.browser.message
      : null,
    state.notice,
    view.rateLimited
      ? "Spotify has asked us to wait. Playback will refresh soon."
      : null,
  ].filter((message): message is string => message !== null)
  return (
    <output
      aria-live="polite"
      className="block text-xs text-muted-foreground empty:hidden"
    >
      {messages.map((message) => (
        <span key={message} className="block">
          {message}
        </span>
      ))}
    </output>
  )
}

function clock(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}
