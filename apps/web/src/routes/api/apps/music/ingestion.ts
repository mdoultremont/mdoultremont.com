import { createFileRoute } from "@tanstack/react-router"
import {
  getIngestion,
  postIngestion,
} from "@/server/entrypoints/http/music/ingestion.server"

export const Route = createFileRoute("/api/apps/music/ingestion")({
  server: {
    handlers: {
      GET: ({ request }) => getIngestion(request),
      POST: ({ request }) => postIngestion(request),
    },
  },
})
