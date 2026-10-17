import { createFileRoute } from "@tanstack/react-router"
import { acceptInvitationLink } from "@/server/entrypoints/http/invitations.server"

export const Route = createFileRoute("/api/invitations/accept")({
  server: { handlers: { GET: ({ request }) => acceptInvitationLink(request) } },
})
