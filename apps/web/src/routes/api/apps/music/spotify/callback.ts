import { createFileRoute } from "@tanstack/react-router"
import { completeSpotifyConnection } from "@/backend/entrypoints/http/music/spotify.server"

export const Route = createFileRoute("/api/apps/music/spotify/callback")({
  server: {
    handlers: { GET: ({ request }) => completeSpotifyConnection(request) },
  },
})
