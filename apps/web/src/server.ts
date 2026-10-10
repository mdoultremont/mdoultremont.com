import handler, { createServerEntry } from "@tanstack/react-start/server-entry"
import { runScheduled } from "@/backend/entrypoints/cron"
import { consumeQueue } from "@/backend/entrypoints/queue"

const server = createServerEntry({
  fetch(request) {
    return handler.fetch(request)
  },
})

export default {
  ...server,
  queue: consumeQueue,
  scheduled: runScheduled,
}
