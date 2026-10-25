import { useState } from "react"
import { PlaylistPage, loadOutputPlaylists } from "./playlist-page"
import { SuggestedPlaylists } from "./suggested-playlists"

export function OutputPlaylists({
  selected,
  onSelect,
}: {
  selected?: string
  onSelect: (key: string) => void
}) {
  const [revision, setRevision] = useState(0)
  return (
    <PlaylistPage
      title="Output playlists"
      description="Browse the tracks in your destinations and review playlist."
      load={loadOutputPlaylists}
      selected={selected}
      onSelect={onSelect}
      revision={revision}
    >
      <SuggestedPlaylists onCreate={() => setRevision((value) => value + 1)} />
    </PlaylistPage>
  )
}
