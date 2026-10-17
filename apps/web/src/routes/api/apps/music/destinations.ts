import { createFileRoute } from "@tanstack/react-router"
import {
  deleteDestination,
  getDestinations,
  putDestination,
} from "@/server/entrypoints/http/music/destinations.server"

export const Route = createFileRoute("/api/apps/music/destinations")({
  server: {
    handlers: {
      GET: ({ request }) => getDestinations(request),
      PUT: ({ request }) => putDestination(request),
      DELETE: ({ request }) => deleteDestination(request),
    },
  },
})
