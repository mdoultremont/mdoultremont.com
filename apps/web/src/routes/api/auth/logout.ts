import { createFileRoute } from "@tanstack/react-router"
import { signOut } from "@/backend/entrypoints/http/auth.server"

export const Route = createFileRoute("/api/auth/logout")({
  server: {
    handlers: {
      POST: ({ request }) => signOut(request),
      ANY: () =>
        new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "POST" },
        }),
    },
  },
})
