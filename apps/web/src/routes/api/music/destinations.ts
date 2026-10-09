import { createFileRoute } from "@tanstack/react-router"
import {
  deleteDestination,
  getDestinations,
  putDestination,
} from "@/backend/entrypoints/http/destinations.server"

export const Route = createFileRoute("/api/music/destinations")({
  server: {
    handlers: {
      GET: ({ request }) => getDestinations(request),
      PUT: ({ request }) => putDestination(request),
      DELETE: ({ request }) => deleteDestination(request),
    },
  },
})
