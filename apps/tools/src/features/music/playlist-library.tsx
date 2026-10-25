import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { errorReason } from "@mdoultremont/tools-contracts"
import { api, errorMessage } from "@/features/api"
import { Button, buttonVariants } from "@/features/ui/button"
import { Spinner } from "@/features/ui/spinner"

export type PlaylistLibrary<Playlist> =
  | { readonly status: "loading" }
  | {
      readonly status: "error"
      readonly message: string
      readonly reconnect: boolean
    }
  | {
      readonly status: "ready"
      readonly playlists: readonly Playlist[]
      /** Set when Spotify names could not be read and IDs stand in for them. */
      readonly namesMissing: boolean
    }

/** What a library shows of a Spotify playlist. */
export interface SpotifyDetails {
  readonly name: string
  readonly imageUrl: string | null
}

/** Reads Spotify playlist details; `null` when Spotify cannot be reached. */
const spotifyDetails = () =>
  api.music.spotify
    .playlists()
    .then(
      (result) =>
        new Map(result.items.map((playlist) => [playlist.id, playlist]))
    )
    .catch(() => null)

/**
 * A playlist list the sidebar and pages share, loaded once with Spotify details.
 * `playlists` builds the list; `spotify` falls back to the playlist ID as name.
 */
export function createPlaylistLibrary<Configuration, Playlist>({
  label,
  configuration,
  playlists,
}: {
  label: string
  configuration: () => Promise<Configuration>
  playlists: (
    configuration: Configuration,
    spotify: (playlistId: string) => SpotifyDetails
  ) => readonly Playlist[]
}) {
  const Context = createContext<{
    readonly library: PlaylistLibrary<Playlist>
    /** Bumped after every change, so views holding their own copy can reload. */
    readonly revision: number
    readonly reload: () => void
  } | null>(null)

  function Provider({ children }: { children: ReactNode }) {
    const [library, setLibrary] = useState<PlaylistLibrary<Playlist>>({
      status: "loading",
    })
    const [revision, setRevision] = useState(0)
    useEffect(() => {
      const request = new AbortController()
      Promise.all([configuration(), spotifyDetails()])
        .then(([loaded, details]) => {
          if (request.signal.aborted) return
          setLibrary({
            status: "ready",
            namesMissing: details === null,
            playlists: playlists(loaded, (playlistId) => {
              const found = details?.get(playlistId)
              return {
                name: found?.name ?? playlistId,
                imageUrl: found?.imageUrl ?? null,
              }
            }),
          })
        })
        .catch((cause: unknown) => {
          if (!request.signal.aborted)
            setLibrary({
              status: "error",
              message: errorMessage(cause, `${label} could not be loaded`),
              reconnect: ["NotConnected", "ReconnectNeeded"].includes(
                errorReason(cause) ?? ""
              ),
            })
        })
      return () => request.abort()
    }, [revision])
    const reload = useCallback(() => setRevision((value) => value + 1), [])
    return <Context value={{ library, revision, reload }}>{children}</Context>
  }

  function useLibrary() {
    const value = useContext(Context)
    if (!value) throw new Error(`${label} need their library provider`)
    return value
  }

  return { Provider, useLibrary }
}

/** What a playlist page shows while its library loads or after it failed. */
export function LibraryFallback({
  library,
  reload,
}: {
  library: Exclude<PlaylistLibrary<unknown>, { status: "ready" }>
  reload: () => void
}) {
  if (library.status === "loading")
    return (
      <output className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner aria-hidden="true" />
        Loading playlist…
      </output>
    )
  return (
    <div className="space-y-3 rounded-xl border p-6">
      <p role="alert">{library.message}</p>
      {library.reconnect ? (
        <a
          href="/music/settings"
          className={buttonVariants({ variant: "outline" })}
        >
          Connect Spotify in Settings
        </a>
      ) : (
        <Button variant="outline" onClick={reload}>
          Try again
        </Button>
      )}
    </div>
  )
}
