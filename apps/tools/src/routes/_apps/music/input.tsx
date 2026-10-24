import { createFileRoute } from "@tanstack/react-router"
import { InputPlaylists } from "@/features/music/input-playlists"

export const Route = createFileRoute("/_apps/music/input")({
  validateSearch: (search: Record<string, unknown>): { playlist?: string } => ({
    playlist: typeof search.playlist === "string" ? search.playlist : undefined,
  }),
  component: InputPlaylistsPage,
})

function InputPlaylistsPage() {
  const { playlist } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <InputPlaylists
      selected={playlist}
      onSelect={(key) => void navigate({ search: { playlist: key } })}
    />
  )
}
