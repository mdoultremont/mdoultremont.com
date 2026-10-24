import { createFileRoute } from "@tanstack/react-router"
import { OutputPlaylists } from "@/features/music/output-playlists"

export const Route = createFileRoute("/_apps/music/output")({
  validateSearch: (search: Record<string, unknown>): { playlist?: string } => ({
    playlist: typeof search.playlist === "string" ? search.playlist : undefined,
  }),
  component: OutputPlaylistsRoute,
})

function OutputPlaylistsRoute() {
  const { playlist } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <OutputPlaylists
      selected={playlist}
      onSelect={(key) => void navigate({ search: { playlist: key } })}
    />
  )
}
