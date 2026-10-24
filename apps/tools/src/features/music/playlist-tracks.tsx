import { Clock3Icon, Music2Icon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { api, errorMessage } from "@/features/api"
import { errorReason } from "@mdoultremont/tools-contracts"
import type { SourceId } from "@mdoultremont/tools-contracts/music"
import { Button, buttonVariants } from "@/features/ui/button"
import { Spinner } from "@/features/ui/spinner"
import { TrackPlayButton } from "./player"

type TrackPage = Awaited<ReturnType<typeof api.music.spotify.likedTracks>>
type More =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string; reconnect: boolean }
type View =
  | { kind: "loading" }
  | { kind: "error"; message: string; reconnect: boolean }
  | { kind: "ready"; page: TrackPage; more: More }

export function PlaylistTracks({
  collection,
  name,
}: {
  collection: SourceId
  name: string
}) {
  const [view, setView] = useState<View>({ kind: "loading" })
  const [attempt, setAttempt] = useState(0)
  const controller = useRef<AbortController | null>(null)

  function read(cursor?: string, signal?: AbortSignal) {
    return collection.kind === "liked"
      ? api.music.spotify.likedTracks({ cursor }, { signal })
      : api.music.spotify.playlistTracks(
          { playlistId: collection.playlistId, cursor },
          { signal }
        )
  }

  useEffect(() => {
    const request = new AbortController()
    controller.current = request
    read(undefined, request.signal)
      .then((page) => {
        if (!request.signal.aborted)
          setView({ kind: "ready", page, more: { kind: "idle" } })
      })
      .catch((cause: unknown) => {
        if (!request.signal.aborted)
          setView({
            kind: "error",
            message: errorMessage(cause, "Tracks could not be loaded"),
            reconnect: needsConnection(cause),
          })
      })
    return () => request.abort()
  }, [attempt])

  async function loadMore() {
    if (
      view.kind !== "ready" ||
      !view.page.next ||
      view.more.kind === "loading"
    )
      return
    const request = controller.current
    if (!request || request.signal.aborted) return
    setView({ ...view, more: { kind: "loading" } })
    try {
      const next = await read(view.page.next, request.signal)
      if (!request.signal.aborted)
        setView({
          kind: "ready",
          page: {
            items: [...view.page.items, ...next.items],
            next: next.next,
            total: next.total,
          },
          more: { kind: "idle" },
        })
    } catch (cause) {
      if (!request.signal.aborted)
        setView({
          ...view,
          more: {
            kind: "error",
            message: errorMessage(cause, "More tracks could not be loaded"),
            reconnect: needsConnection(cause),
          },
        })
    }
  }

  if (view.kind === "loading")
    return (
      <output className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Spinner aria-hidden="true" />
        Loading tracks…
      </output>
    )
  if (view.kind === "error")
    return (
      <div className="space-y-3 rounded-xl border p-6">
        <p role="alert">{view.message}</p>
        {view.reconnect ? (
          <a
            href="/music/settings"
            className={buttonVariants({ variant: "outline" })}
          >
            Check Spotify connection
          </a>
        ) : (
          <Button
            variant="outline"
            onClick={() => {
              setView({ kind: "loading" })
              setAttempt((value) => value + 1)
            }}
          >
            Try again
          </Button>
        )}
      </div>
    )

  const { page, more } = view
  return (
    <section aria-label={name + " tracks"} className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-xl font-medium">{name}</h2>
        <output aria-live="polite" className="text-sm text-muted-foreground">
          {page.items.length} {page.items.length === 1 ? "track" : "tracks"}{" "}
          loaded
          {" · "}
          {page.total} Spotify {page.total === 1 ? "item" : "items"}
        </output>
      </div>
      {page.items.length === 0 ? (
        <div className="rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
          <Music2Icon aria-hidden="true" className="mx-auto mb-3 size-6" />
          {page.next
            ? "No available tracks on this page. Continue to see more."
            : "No available tracks in this playlist."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <table className="w-full table-fixed text-sm">
            <caption className="sr-only">
              Tracks in {name}, in Spotify order
            </caption>
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th
                  scope="col"
                  className="hidden w-12 px-4 py-3 text-right sm:table-cell"
                >
                  #
                </th>
                <th scope="col" className="w-12 px-2 py-3">
                  <span className="sr-only">Playback</span>
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Track
                </th>
                <th
                  scope="col"
                  className="w-20 px-4 py-3 text-right font-medium"
                >
                  <Clock3Icon aria-hidden="true" className="ml-auto size-4" />
                  <span className="sr-only">Duration</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {page.items.map((track, index) => (
                <tr key={index} className="hover:bg-muted/30">
                  <td className="hidden px-4 py-3 text-right text-muted-foreground tabular-nums sm:table-cell">
                    {index + 1}
                  </td>
                  <td className="px-2 py-3">
                    <TrackPlayButton trackId={track.id} name={track.name} />
                  </td>
                  <td
                    className="px-4 py-3"
                    aria-label={
                      track.name +
                      " by " +
                      (track.artistNames.join(", ") || "Unknown artist")
                    }
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                        {track.artworkUrl ? (
                          <img
                            src={track.artworkUrl}
                            alt=""
                            loading="lazy"
                            className="size-full object-cover"
                          />
                        ) : (
                          <Music2Icon
                            aria-hidden="true"
                            className="size-4 text-muted-foreground"
                          />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium" title={track.name}>
                          {track.name}
                        </p>
                        <p
                          className="truncate text-muted-foreground"
                          title={track.artistNames.join(", ")}
                        >
                          {track.artistNames.join(", ") || "Unknown artist"}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                    {duration(track.durationMs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {more.kind === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          {more.message}
        </p>
      ) : null}
      {more.kind === "error" && more.reconnect ? (
        <a
          href="/music/settings"
          className={buttonVariants({ variant: "outline" })}
        >
          Check Spotify connection
        </a>
      ) : page.next ? (
        <Button
          variant="outline"
          disabled={more.kind === "loading"}
          onClick={() => void loadMore()}
        >
          {more.kind === "loading" ? (
            <>
              <Spinner aria-hidden="true" />
              Loading more…
            </>
          ) : more.kind === "error" ? (
            "Try loading more again"
          ) : (
            "Load more"
          )}
        </Button>
      ) : null}
      {more.kind === "loading" ? (
        <output className="sr-only">Loading more tracks</output>
      ) : null}
    </section>
  )
}

function duration(milliseconds: number | null) {
  if (milliseconds === null) return "-"
  const seconds = Math.floor(milliseconds / 1000)
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0")
}

function needsConnection(cause: unknown) {
  const reason = errorReason(cause)
  return reason === "NotConnected" || reason === "ReconnectNeeded"
}
