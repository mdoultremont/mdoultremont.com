import { createFileRoute } from "@tanstack/react-router"
import { spotifySavedTracks } from "@/server/entrypoints/http/music/spotify.server"

export const Route = createFileRoute("/api/music/spotify/liked-tracks")({
  server: { handlers: { GET: ({ request }) => spotifySavedTracks(request) } },
})
