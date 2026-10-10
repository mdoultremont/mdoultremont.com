import { createFileRoute } from "@tanstack/react-router"
import {
  getDelivery,
  postDelivery,
  putDelivery,
} from "@/backend/entrypoints/http/music/delivery.server"

export const Route = createFileRoute("/api/music/delivery")({
  server: {
    handlers: {
      GET: ({ request }) => getDelivery(request),
      POST: ({ request }) => postDelivery(request),
      PUT: ({ request }) => putDelivery(request),
    },
  },
})
