import { useEffect, useState, type ReactNode } from "react"
import { api, errorMessage } from "@/features/api"
import { PageHeader } from "@/features/apps/shell"
import { errorReason } from "@mdoultremont/tools-contracts"
import { Button, buttonVariants } from "@/features/ui/button"
import { Spinner } from "@/features/ui/spinner"
import { PlaylistBrowser, type PlaylistEntry } from "./playlist-browser"

export interface PlaylistLibrary {
  readonly entries: readonly PlaylistEntry[]
  readonly warning?: string
}
type View =
  | { kind: "loading" }
  | { kind: "error"; message: string; reconnect: boolean }
  | { kind: "ready"; library: PlaylistLibrary }

export function PlaylistPage({
  title,
  description,
  load,
  selected,
  onSelect,
  children,
  revision = 0,
}: {
  title: string
  description: string
  load: () => Promise<PlaylistLibrary>
  selected?: string
  onSelect: (key: string) => void
  children?: ReactNode
  revision?: number
}) {
  const [view, setView] = useState<View>({ kind: "loading" })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const request = new AbortController()
    load()
      .then((library) => {
        if (!request.signal.aborted) setView({ kind: "ready", library })
      })
      .catch((cause: unknown) => {
        if (!request.signal.aborted)
          setView({
            kind: "error",
            message: errorMessage(cause, "Playlists could not be loaded"),
            reconnect: ["NotConnected", "ReconnectNeeded"].includes(
              errorReason(cause) ?? ""
            ),
          })
      })
    return () => request.abort()
  }, [load, attempt, revision])

  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      {children}
      {view.kind === "loading" ? (
        <output className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner aria-hidden="true" />
          Loading playlists…
        </output>
      ) : view.kind === "error" ? (
        <div className="space-y-3 rounded-xl border p-6">
          <p role="alert">{view.message}</p>
          {view.reconnect ? (
            <a
              href="/music/settings"
              className={buttonVariants({ variant: "outline" })}
            >
              Connect Spotify in Settings
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
      ) : (
        <>
          {view.library.warning ? (
            <output className="block text-sm text-muted-foreground">
              {view.library.warning}
            </output>
          ) : null}
          {view.library.entries.length ? (
            <PlaylistBrowser
              entries={view.library.entries}
              selected={selected}
              onSelect={onSelect}
            />
          ) : (
            <div className="space-y-3 rounded-xl border border-dashed p-8 text-center">
              <h2 className="font-heading text-lg font-medium">
                No playlists configured
              </h2>
              <p className="text-sm text-muted-foreground">
                Choose output playlists in Settings or manage your input
                sources.
              </p>
              <a
                href="/music/settings"
                className={buttonVariants({ variant: "outline" })}
              >
                Open Settings
              </a>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export async function loadOutputPlaylists(): Promise<PlaylistLibrary> {
  const [configuration, playlists] = await Promise.all([
    api.music.destinations.get(),
    api.music.spotify
      .playlists()
      .then((result) => result.items)
      .catch(() => null),
  ])
  const names = new Map(
    playlists?.map((playlist) => [playlist.id, playlist.name])
  )
  const entries: PlaylistEntry[] = configuration.destinations
    .filter(
      (destination) => destination.playlistId !== configuration.reviewPlaylistId
    )
    .map((destination) => ({
      collection: { kind: "playlist", playlistId: destination.playlistId },
      name: names.get(destination.playlistId) ?? destination.playlistId,
      description: destination.description,
      enabled: destination.enabled,
      role: "destination",
    }))
  if (configuration.reviewPlaylistId) {
    entries.push({
      collection: {
        kind: "playlist",
        playlistId: configuration.reviewPlaylistId,
      },
      name:
        names.get(configuration.reviewPlaylistId) ??
        configuration.reviewPlaylistId,
      description:
        "Tracks without an accepted destination arrive here for review.",
      enabled: true,
      role: "review",
    })
  }
  return {
    entries,
    ...(playlists === null
      ? {
          warning:
            "Spotify playlist names could not be loaded. Playlist IDs are shown instead.",
        }
      : {}),
  }
}
