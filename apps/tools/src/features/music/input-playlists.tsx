import { useState } from "react"
import { api } from "@/features/api"
import { IngestionPanel } from "./ingestion-panel"
import { PlaylistPage, type PlaylistLibrary } from "./playlist-page"

export function InputPlaylists({
  selected,
  onSelect,
}: {
  selected?: string
  onSelect: (key: string) => void
}) {
  const [revision, setRevision] = useState(0)
  return (
    <PlaylistPage
      title="Input playlists"
      description="Browse the tracks your music pipeline reads from Spotify."
      load={loadInputPlaylists}
      selected={selected}
      onSelect={onSelect}
      revision={revision}
    >
      <details className="rounded-xl border p-4">
        <summary className="cursor-pointer rounded text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Manage input sources
        </summary>
        <div className="mt-4">
          <IngestionPanel onChange={() => setRevision((value) => value + 1)} />
        </div>
      </details>
    </PlaylistPage>
  )
}

async function loadInputPlaylists(): Promise<PlaylistLibrary> {
  const [configuration, playlists] = await Promise.all([
    api.music.sources.get(),
    api.music.spotify
      .playlists()
      .then((result) => result.items)
      .catch(() => null),
  ])
  const names = new Map(
    playlists?.map((playlist) => [playlist.id, playlist.name])
  )
  return {
    entries: configuration.sources.map((source) => ({
      collection: source.sourceId,
      name:
        source.sourceId.kind === "liked"
          ? "Liked Songs"
          : (names.get(source.sourceId.playlistId) ??
            source.sourceId.playlistId),
      description:
        source.sourceId.kind === "liked"
          ? "Your saved tracks on Spotify."
          : source.enabled
            ? ""
            : "This source is paused. You can still browse its tracks.",
      enabled: source.enabled,
      role: "source",
    })),
    ...(playlists === null
      ? {
          warning:
            "Spotify playlist names could not be loaded. Playlist IDs are shown instead.",
        }
      : {}),
  }
}
