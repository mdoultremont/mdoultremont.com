import { createFileRoute } from "@tanstack/react-router"
import { spotifyPlaylists } from "@/backend/entrypoints/http/music/spotify.server"

export const Route = createFileRoute("/api/apps/music/spotify/playlists")({
  server: { handlers: { GET: ({ request }) => spotifyPlaylists(request) } },
})
