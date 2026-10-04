import handler, { createServerEntry } from "@tanstack/react-start/server-entry"
import {
  consumeMusicBatch,
  scheduledMusic,
} from "@/backend/entrypoints/music-run-events"

const server = createServerEntry({
  fetch(request) {
    return handler.fetch(request)
  },
})

export default {
  ...server,
  queue: consumeMusicBatch,
  scheduled: scheduledMusic,
}
