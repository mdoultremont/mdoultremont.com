import { createFileRoute } from "@tanstack/react-router"
import { disconnectSpotify } from "@/backend/entrypoints/spotify.server"

export const Route = createFileRoute("/api/spotify/disconnect")({
  server: { handlers: { POST: ({ request }) => disconnectSpotify(request) } },
})
