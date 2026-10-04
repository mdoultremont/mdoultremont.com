import { createFileRoute } from "@tanstack/react-router"
import { spotifySavedTracks } from "@/backend/entrypoints/spotify.server"

export const Route = createFileRoute("/api/spotify/liked-tracks")({
  server: { handlers: { GET: ({ request }) => spotifySavedTracks(request) } },
})
