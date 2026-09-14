import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { handleImageRequest } from "../image-handler"
import { metadata } from "../image-metadata"

export const Route = createFileRoute("/images/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleImageRequest(request, env, metadata),
      ANY: () =>
        new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "GET, HEAD" },
        }),
    },
  },
})
