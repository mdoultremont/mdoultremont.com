import { createFileRoute } from "@tanstack/react-router"
import { beginGitHubSignIn } from "@/backend/entrypoints/app-auth.server"

export const Route = createFileRoute("/api/auth/github")({
  server: {
    handlers: {
      GET: ({ request }) => beginGitHubSignIn(request),
      ANY: () =>
        new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "GET" },
        }),
    },
  },
})
