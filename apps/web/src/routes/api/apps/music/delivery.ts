import { createFileRoute } from "@tanstack/react-router"
import {
  getDelivery,
  postDelivery,
  putDelivery,
} from "@/server/entrypoints/http/music/delivery.server"

export const Route = createFileRoute("/api/apps/music/delivery")({
  server: {
    handlers: {
      GET: ({ request }) => getDelivery(request),
      POST: ({ request }) => postDelivery(request),
      PUT: ({ request }) => putDelivery(request),
    },
  },
})
