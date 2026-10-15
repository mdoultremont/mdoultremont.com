import { createFileRoute } from "@tanstack/react-router"
import { spotifySavedTracks } from "@/backend/entrypoints/http/music/spotify.server"

export const Route = createFileRoute("/api/apps/music/spotify/liked-tracks")({
  server: { handlers: { GET: ({ request }) => spotifySavedTracks(request) } },
})
