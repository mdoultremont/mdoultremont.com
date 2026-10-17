import { createFileRoute } from "@tanstack/react-router"
import { postPrivateDestination } from "@/server/entrypoints/http/music/destinations.server"

export const Route = createFileRoute("/api/music/destinations/create")({
  server: {
    handlers: { POST: ({ request }) => postPrivateDestination(request) },
  },
})
