import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react"
import { api } from "@/features/api"
import { createPlaylistLibrary } from "./playlist-library"

/** A destination, or the review playlist that catches tracks no destination accepts. */
export interface OutputPlaylist {
  readonly playlistId: string
  readonly name: string
  readonly description: string
  readonly enabled: boolean
  readonly role: "destination" | "review"
  readonly imageUrl: string | null
}

const { Provider, useLibrary } = createPlaylistLibrary({
  label: "Output playlists",
  configuration: () => api.music.destinations.get(),
  playlists: (configuration, spotify): readonly OutputPlaylist[] => {
    const review = configuration.reviewPlaylistId
    return [
      ...configuration.destinations
        .filter((destination) => destination.playlistId !== review)
        .map((destination) => ({
          ...spotify(destination.playlistId),
          playlistId: destination.playlistId,
          description: destination.description,
          enabled: destination.enabled,
          role: "destination" as const,
        })),
      ...(review
        ? [
            {
              ...spotify(review),
              playlistId: review,
              description:
                "Tracks without an accepted destination arrive here for review.",
              enabled: true,
              role: "review" as const,
            },
          ]
        : []),
    ]
  },
})

/**
 * Covers uploaded this session, as data URLs. Spotify processes an upload
 * asynchronously, so its playlist reads can return the old cover for a while.
 */
const UploadedCovers = createContext<{
  readonly covers: ReadonlyMap<string, string>
  readonly setCover: (playlistId: string, dataUrl: string) => void
} | null>(null)

export function OutputLibraryProvider({ children }: { children: ReactNode }) {
  const [covers, setCovers] = useState<ReadonlyMap<string, string>>(new Map())
  const setCover = useCallback(
    (playlistId: string, dataUrl: string) =>
      setCovers((current) => new Map(current).set(playlistId, dataUrl)),
    []
  )
  return (
    <UploadedCovers value={{ covers, setCover }}>
      <Provider>{children}</Provider>
    </UploadedCovers>
  )
}

export function useOutputLibrary() {
  const value = useLibrary()
  const uploaded = useContext(UploadedCovers)
  if (!uploaded) throw new Error("Output playlists need their library provider")
  const { library } = value
  return {
    ...value,
    setCover: uploaded.setCover,
    library:
      library.status === "ready" && uploaded.covers.size > 0
        ? {
            ...library,
            playlists: library.playlists.map((playlist) => ({
              ...playlist,
              imageUrl:
                uploaded.covers.get(playlist.playlistId) ?? playlist.imageUrl,
            })),
          }
        : library,
  }
}

export const outputPath = (playlistId: string) => `/music/output/${playlistId}`
