import { createFileRoute } from "@tanstack/react-router"
import { musicRunsHttp } from "../../../backend/entrypoints/music-runs.server"

export const Route = createFileRoute("/api/music/runs")({
  server: {
    handlers: {
      GET: ({ request }) => musicRunsHttp(request),
      POST: ({ request }) => musicRunsHttp(request),
      PUT: ({ request }) => musicRunsHttp(request),
    },
  },
})
