import { createFileRoute } from "@tanstack/react-router"
import { postPrivateDestination } from "@/backend/entrypoints/http/destinations.server"

export const Route = createFileRoute("/api/music/destinations/create")({
  server: {
    handlers: { POST: ({ request }) => postPrivateDestination(request) },
  },
})
