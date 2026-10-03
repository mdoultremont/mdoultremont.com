import { createFileRoute } from "@tanstack/react-router"
import { beginSpotifyConnection } from "../backend/entrypoints/spotify.server"

export const Route = createFileRoute("/api/spotify/connect")({
  server: {
    handlers: { GET: ({ request }) => beginSpotifyConnection(request) },
  },
})
