import { createFileRoute } from "@tanstack/react-router"
import { beginSpotifyConnection } from "@/server/entrypoints/http/music/spotify.server"

export const Route = createFileRoute("/api/music/spotify/connect")({
  server: {
    handlers: { GET: ({ request }) => beginSpotifyConnection(request) },
  },
})
