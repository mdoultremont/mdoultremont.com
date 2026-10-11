import { createFileRoute } from "@tanstack/react-router"
import { acceptInvitationLink } from "@/backend/entrypoints/http/invitations.server"

export const Route = createFileRoute("/api/invitations/accept")({
  server: { handlers: { GET: ({ request }) => acceptInvitationLink(request) } },
})
