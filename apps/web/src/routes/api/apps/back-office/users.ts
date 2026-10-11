import { createFileRoute } from "@tanstack/react-router"
import {
  deleteUser,
  getUsers,
  putUserAccess,
} from "@/backend/entrypoints/http/back-office/users.server"

export const Route = createFileRoute("/api/apps/back-office/users")({
  server: {
    handlers: {
      GET: ({ request }) => getUsers(request),
      PUT: ({ request }) => putUserAccess(request),
      DELETE: ({ request }) => deleteUser(request),
    },
  },
})
