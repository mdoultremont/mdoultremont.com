import { createFileRoute } from "@tanstack/react-router"
import { completeSpotifyConnection } from "@/backend/entrypoints/spotify.server"

export const Route = createFileRoute("/api/spotify/callback")({
  server: {
    handlers: { GET: ({ request }) => completeSpotifyConnection(request) },
  },
})
