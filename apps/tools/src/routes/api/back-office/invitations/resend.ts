import { createFileRoute } from "@tanstack/react-router"
import { postInvitationResend } from "@/server/entrypoints/http/back-office/users.server"

export const Route = createFileRoute("/api/back-office/invitations/resend")({
  server: {
    handlers: { POST: ({ request }) => postInvitationResend(request) },
  },
})
