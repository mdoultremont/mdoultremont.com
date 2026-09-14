import handler, { createServerEntry } from "@tanstack/react-start/server-entry"
import { env } from "cloudflare:workers"
import { metadata } from "./image-metadata"
import { handleImageRequest } from "./image-handler"

export default createServerEntry({
  async fetch(request) {
    const imageResponse = await handleImageRequest(request, env, metadata)
    return imageResponse ?? handler.fetch(request)
  },
})
