import { createFileRoute } from "@tanstack/react-router"
import {
  getClassification,
  postReclassify,
} from "@/backend/entrypoints/http/music/classification.server"

export const Route = createFileRoute("/api/music/classification")({
  server: {
    handlers: {
      GET: ({ request }) => getClassification(request),
      POST: ({ request }) => postReclassify(request),
    },
  },
})
