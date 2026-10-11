import { createFileRoute } from "@tanstack/react-router"
import { beginSpotifyConnection } from "@/backend/entrypoints/http/music/spotify.server"

export const Route = createFileRoute("/api/apps/music/spotify/connect")({
  server: {
    handlers: { GET: ({ request }) => beginSpotifyConnection(request) },
  },
})
