import { createFileRoute } from "@tanstack/react-router"
import { spotifyStatus } from "../../../backend/entrypoints/spotify.server"

export const Route = createFileRoute("/api/spotify/status")({
  server: { handlers: { GET: ({ request }) => spotifyStatus(request) } },
})
