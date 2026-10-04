import { createFileRoute } from "@tanstack/react-router"
import { retryBaseline } from "@/backend/entrypoints/likes-baseline.server"

export const Route = createFileRoute("/api/music/baseline/retry")({
  server: { handlers: { POST: ({ request }) => retryBaseline(request) } },
})
