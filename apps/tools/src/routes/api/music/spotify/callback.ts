import { createFileRoute } from "@tanstack/react-router"
import { completeSpotifyConnection } from "@/server/entrypoints/http/music/spotify.server"

export const Route = createFileRoute("/api/music/spotify/callback")({
  server: {
    handlers: { GET: ({ request }) => completeSpotifyConnection(request) },
  },
})
