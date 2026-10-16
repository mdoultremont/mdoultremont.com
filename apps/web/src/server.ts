import handler, { createServerEntry } from "@tanstack/react-start/server-entry"
import { runScheduled } from "@/server/entrypoints/cron"
import { createApi } from "@/server/entrypoints/http/hono"
import { consumeQueue } from "@/server/entrypoints/queue"

/** Hono owns /api/*; whatever it does not match falls through to TanStack. */
const api = createApi((request) => handler.fetch(request))

const server = createServerEntry({
  fetch(request) {
    return new URL(request.url).pathname.startsWith("/api/")
      ? api.fetch(request)
      : handler.fetch(request)
  },
})

export default {
  ...server,
  queue: consumeQueue,
  scheduled: runScheduled,
}
