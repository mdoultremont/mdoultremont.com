import { createFileRoute } from "@tanstack/react-router"
import {
  getClassification,
  postReclassify,
} from "@/server/entrypoints/http/music/classification.server"

export const Route = createFileRoute("/api/apps/music/classification")({
  server: {
    handlers: {
      GET: ({ request }) => getClassification(request),
      POST: ({ request }) => postReclassify(request),
    },
  },
})
