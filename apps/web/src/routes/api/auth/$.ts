import { createFileRoute } from "@tanstack/react-router"
import { handleAuthRequest } from "@/backend/entrypoints/http/auth.server"

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleAuthRequest(request),
      POST: ({ request }) => handleAuthRequest(request),
    },
  },
})
