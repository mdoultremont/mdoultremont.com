import { createFileRoute } from "@tanstack/react-router"
import {
  beginLikesBaseline,
  likesBaselineStatus,
} from "../../../backend/entrypoints/likes-baseline.server"

export const Route = createFileRoute("/api/music/baseline")({
  server: {
    handlers: {
      GET: ({ request }) => likesBaselineStatus(request),
      POST: ({ request }) => beginLikesBaseline(request),
    },
  },
})
