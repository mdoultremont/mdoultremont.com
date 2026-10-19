import { createFileRoute } from "@tanstack/react-router"
import { completeSpotifyConnection } from "@mdoultremont/tools-backend/http"

export const Route = createFileRoute("/api/music/spotify/callback")({
  server: {
    handlers: { GET: ({ request }) => completeSpotifyConnection(request) },
  },
})
