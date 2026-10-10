import { createFileRoute } from "@tanstack/react-router"
import {
  getIngestion,
  postIngestion,
} from "@/backend/entrypoints/http/music/ingestion.server"

export const Route = createFileRoute("/api/music/ingestion")({
  server: {
    handlers: {
      GET: ({ request }) => getIngestion(request),
      POST: ({ request }) => postIngestion(request),
    },
  },
})
