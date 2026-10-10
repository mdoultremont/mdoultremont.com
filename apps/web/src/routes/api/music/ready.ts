import { createFileRoute } from "@tanstack/react-router"
import { putReady } from "@/backend/entrypoints/http/music/classification.server"

export const Route = createFileRoute("/api/music/ready")({
  server: { handlers: { PUT: ({ request }) => putReady(request) } },
})
