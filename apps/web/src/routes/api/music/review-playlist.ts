import { createFileRoute } from "@tanstack/react-router"
import { putReviewPlaylist } from "@/backend/entrypoints/http/music/destinations.server"

export const Route = createFileRoute("/api/music/review-playlist")({
  server: { handlers: { PUT: ({ request }) => putReviewPlaylist(request) } },
})
