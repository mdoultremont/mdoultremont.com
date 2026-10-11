import { createFileRoute } from "@tanstack/react-router"
import { disconnectSpotify } from "@/backend/entrypoints/http/music/spotify.server"

export const Route = createFileRoute("/api/apps/music/spotify/disconnect")({
  server: { handlers: { POST: ({ request }) => disconnectSpotify(request) } },
})
