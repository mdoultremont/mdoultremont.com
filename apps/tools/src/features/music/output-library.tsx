import { api } from "@/features/api"
import { createPlaylistLibrary } from "./playlist-library"

/** A destination, or the review playlist that catches tracks no destination accepts. */
export interface OutputPlaylist {
  readonly playlistId: string
  readonly name: string
  readonly description: string
  readonly enabled: boolean
  readonly role: "destination" | "review"
}

const { Provider, useLibrary } = createPlaylistLibrary({
  label: "Output playlists",
  configuration: () => api.music.destinations.get(),
  playlists: (configuration, name): readonly OutputPlaylist[] => {
    const review = configuration.reviewPlaylistId
    return [
      ...configuration.destinations
        .filter((destination) => destination.playlistId !== review)
        .map((destination) => ({
          playlistId: destination.playlistId,
          name: name(destination.playlistId),
          description: destination.description,
          enabled: destination.enabled,
          role: "destination" as const,
        })),
      ...(review
        ? [
            {
              playlistId: review,
              name: name(review),
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

export const OutputLibraryProvider = Provider
export const useOutputLibrary = useLibrary
export const outputPath = (playlistId: string) => `/music/output/${playlistId}`
