import handler, { createServerEntry } from "@tanstack/react-start/server-entry"
import {
  runScheduled,
  createToolsFetch,
  consumeQueue,
} from "@mdoultremont/tools-backend/worker"

const server = createServerEntry({
  fetch: createToolsFetch((request) => handler.fetch(request)),
})

export default {
  ...server,
  queue: consumeQueue,
  scheduled: runScheduled,
}
