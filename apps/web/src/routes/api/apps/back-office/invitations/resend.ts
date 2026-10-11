import { createFileRoute } from "@tanstack/react-router"
import { postInvitationResend } from "@/backend/entrypoints/http/back-office/users.server"

export const Route = createFileRoute(
  "/api/apps/back-office/invitations/resend"
)({
  server: {
    handlers: { POST: ({ request }) => postInvitationResend(request) },
  },
})
