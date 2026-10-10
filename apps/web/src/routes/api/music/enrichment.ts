import { createFileRoute } from "@tanstack/react-router"
import {
  getEnrichment,
  retryEnrichment,
} from "@/backend/entrypoints/http/music/enrichment.server"

export const Route = createFileRoute("/api/music/enrichment")({
  server: {
    handlers: {
      GET: ({ request }) => getEnrichment(request),
      POST: ({ request }) => retryEnrichment(request),
    },
  },
})
