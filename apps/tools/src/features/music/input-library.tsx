import type { Source, SourceId } from "@mdoultremont/tools-contracts/music"
import { api } from "@/features/api"
import { createPlaylistLibrary } from "./playlist-library"

export interface InputPlaylist {
  readonly key: string
  readonly source: Source
  readonly name: string
}

/** The URL segment of a source: `liked`, or the Spotify playlist ID. */
export const inputKey = (id: SourceId) =>
  id.kind === "liked" ? "liked" : id.playlistId

const { Provider, useLibrary } = createPlaylistLibrary({
  label: "Input playlists",
  configuration: () => api.music.sources.get(),
  playlists: (configuration, spotify): readonly InputPlaylist[] =>
    configuration.sources.map((source) => ({
      key: inputKey(source.sourceId),
      source,
      name:
        source.sourceId.kind === "liked"
          ? "Liked Songs"
          : spotify(source.sourceId.playlistId).name,
    })),
})

export const InputLibraryProvider = Provider
export const useInputLibrary = useLibrary
