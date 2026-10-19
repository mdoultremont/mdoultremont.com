import { createFileRoute } from "@tanstack/react-router"
import { acceptInvitationLink } from "@mdoultremont/tools-backend/http"

export const Route = createFileRoute("/api/invitations/accept")({
  server: { handlers: { GET: ({ request }) => acceptInvitationLink(request) } },
})
