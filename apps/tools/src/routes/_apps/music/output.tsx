import { createFileRoute } from "@tanstack/react-router"
import {
  PlaylistPage,
  loadOutputPlaylists,
} from "@/features/music/playlist-page"

export const Route = createFileRoute("/_apps/music/output")({
  validateSearch: (search: Record<string, unknown>): { playlist?: string } => ({
    playlist: typeof search.playlist === "string" ? search.playlist : undefined,
  }),
  component: OutputPlaylists,
})

function OutputPlaylists() {
  const { playlist } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <PlaylistPage
      title="Output playlists"
      description="Browse the tracks in your destinations and review playlist."
      load={loadOutputPlaylists}
      selected={playlist}
      onSelect={(key) => void navigate({ search: { playlist: key } })}
    />
  )
}
