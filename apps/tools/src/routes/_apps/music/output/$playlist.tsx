import { createFileRoute } from "@tanstack/react-router"
import { OutputPlaylistPage } from "@/features/music/output-playlist-page"

export const Route = createFileRoute("/_apps/music/output/$playlist")({
  component: OutputPlaylistRoute,
})

function OutputPlaylistRoute() {
  const { playlist } = Route.useParams()
  return <OutputPlaylistPage playlistId={playlist} />
}
