import { createFileRoute } from "@tanstack/react-router"
import { spotifyPlaylists } from "@/backend/entrypoints/http/spotify.server"

export const Route = createFileRoute("/api/spotify/playlists")({
  server: { handlers: { GET: ({ request }) => spotifyPlaylists(request) } },
})
