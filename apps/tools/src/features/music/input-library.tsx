import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { errorReason } from "@mdoultremont/tools-contracts"
import type { Source, SourceId } from "@mdoultremont/tools-contracts/music"
import { api, errorMessage } from "@/features/api"

export interface InputPlaylist {
  readonly key: string
  readonly source: Source
  readonly name: string
}

export type InputLibrary =
  | { readonly status: "loading" }
  | {
      readonly status: "error"
      readonly message: string
      readonly reconnect: boolean
    }
  | {
      readonly status: "ready"
      readonly playlists: readonly InputPlaylist[]
      /** Set when Spotify names could not be read and IDs stand in for them. */
      readonly namesMissing: boolean
    }

/** The URL segment of a source: `liked`, or the Spotify playlist ID. */
export const inputKey = (id: SourceId) =>
  id.kind === "liked" ? "liked" : id.playlistId

const LibraryContext = createContext<{
  readonly library: InputLibrary
  /** Bumped after every change, so views holding their own copy can reload. */
  readonly revision: number
  readonly reload: () => void
} | null>(null)

export function InputLibraryProvider({ children }: { children: ReactNode }) {
  const [library, setLibrary] = useState<InputLibrary>({ status: "loading" })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const request = new AbortController()
    Promise.all([
      api.music.sources.get(),
      api.music.spotify
        .playlists()
        .then((result) => result.items)
        .catch(() => null),
    ])
      .then(([configuration, spotifyPlaylists]) => {
        if (request.signal.aborted) return
        const names = new Map(
          spotifyPlaylists?.map((playlist) => [playlist.id, playlist.name])
        )
        setLibrary({
          status: "ready",
          namesMissing: spotifyPlaylists === null,
          playlists: configuration.sources.map((source) => ({
            key: inputKey(source.sourceId),
            source,
            name:
              source.sourceId.kind === "liked"
                ? "Liked Songs"
                : (names.get(source.sourceId.playlistId) ??
                  source.sourceId.playlistId),
          })),
        })
      })
      .catch((cause: unknown) => {
        if (!request.signal.aborted)
          setLibrary({
            status: "error",
            message: errorMessage(cause, "Input playlists could not be loaded"),
            reconnect: ["NotConnected", "ReconnectNeeded"].includes(
              errorReason(cause) ?? ""
            ),
          })
      })
    return () => request.abort()
  }, [revision])
  const reload = useCallback(() => setRevision((value) => value + 1), [])
  return (
    <LibraryContext value={{ library, revision, reload }}>
      {children}
    </LibraryContext>
  )
}

export function useInputLibrary() {
  const value = useContext(LibraryContext)
  if (!value) throw new Error("Input playlists need an InputLibraryProvider")
  return value
}
