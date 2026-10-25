import { createFileRoute } from "@tanstack/react-router"
import { InputPlaylistPage } from "@/features/music/input-playlist-page"

export const Route = createFileRoute("/_apps/music/input/$playlist")({
  component: InputPlaylistRoute,
})

function InputPlaylistRoute() {
  const { playlist } = Route.useParams()
  return <InputPlaylistPage playlistKey={playlist} />
}
