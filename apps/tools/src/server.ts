import handler, { createServerEntry } from "@tanstack/react-start/server-entry"
import { runScheduled } from "@/server/entrypoints/cron"
import { createToolsFetch } from "@/server/entrypoints/http/api"
import { consumeQueue } from "@/server/entrypoints/queue"

const server = createServerEntry({
  fetch: createToolsFetch((request) => handler.fetch(request)),
})

export default {
  ...server,
  queue: consumeQueue,
  scheduled: runScheduled,
}
