import { createFileRoute } from "@tanstack/react-router"
import { beginSpotifyConnection } from "@mdoultremont/tools-backend/http"

export const Route = createFileRoute("/api/music/spotify/connect")({
  server: {
    handlers: { GET: ({ request }) => beginSpotifyConnection(request) },
  },
})
