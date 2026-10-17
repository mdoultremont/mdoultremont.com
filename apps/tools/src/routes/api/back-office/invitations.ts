import { createFileRoute } from "@tanstack/react-router"
import {
  deleteInvitation,
  postInvitation,
} from "@/server/entrypoints/http/back-office/users.server"

export const Route = createFileRoute("/api/back-office/invitations")({
  server: {
    handlers: {
      POST: ({ request }) => postInvitation(request),
      DELETE: ({ request }) => deleteInvitation(request),
    },
  },
})
