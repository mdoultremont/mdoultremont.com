import { createFileRoute } from "@tanstack/react-router"
import { handleAuthRequest } from "@mdoultremont/tools-backend/http"

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleAuthRequest(request),
      POST: ({ request }) => handleAuthRequest(request),
    },
  },
})
