import { createFileRoute } from "@tanstack/react-router"
import { completeGitHubSignIn } from "@/backend/entrypoints/app-auth.server"

export const Route = createFileRoute("/api/auth/github/callback")({
  server: {
    handlers: {
      GET: ({ request }) => completeGitHubSignIn(request),
      ANY: () =>
        new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "GET" },
        }),
    },
  },
})
