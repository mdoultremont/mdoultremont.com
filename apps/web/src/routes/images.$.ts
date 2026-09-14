import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { imageWidths } from "../features/images/images"
import metadata from "virtual:portfolio-images"

export const Route = createFileRoute("/images/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleImageRequest(request),
      ANY: () =>
        new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "GET, HEAD" },
        }),
    },
  },
})

const imagePathPrefix = "/images/"
const cacheMaxAge = 31_536_000

async function handleImageRequest(request: Request) {
  const url = new URL(request.url)

  let source: string
  try {
    source = decodeURIComponent(url.pathname.slice(imagePathPrefix.length - 1))
  } catch {
    return new Response("Invalid image path", { status: 400 })
  }

  const image = metadata[source]
  const widthValues = url.searchParams.getAll("width")
  const versionValues = url.searchParams.getAll("v")
  const version = versionValues[0]
  const width = Number(widthValues[0])

  if (!image || !source.startsWith("/media/"))
    return new Response("Image not found", { status: 404 })
  if (versionValues.length !== 1 || version !== image.version)
    return new Response("Image version not found", { status: 404 })
  if (
    widthValues.length !== 1 ||
    !/^\d+$/.test(widthValues[0] ?? "") ||
    !Number.isSafeInteger(width) ||
    width < 1
  )
    return new Response("Invalid image width", { status: 400 })

  const allowedWidths = imageWidths(source, image)
  if (!allowedWidths.includes(width))
    return new Response("Image width not found", { status: 404 })

  const cacheKey = imageCacheKey(url, source, width, version)
  const cached = await readCache(cacheKey)
  if (cached) return cached

  const original = await env.ASSETS.fetch(new URL(source, url))
  if (!original.ok || !original.body)
    return new Response("Image source unavailable", { status: 404 })

  const fallback = original.clone()
  try {
    const transformed = await env.IMAGES.input(original.body)
      .transform({ width: Math.min(width, image.width) })
      .output({ format: "image/webp", quality: 80 })
    const response = transformed.response({
      headers: {
        "Cache-Control": `public, max-age=${cacheMaxAge}, immutable`,
      },
    })
    await writeCache(cacheKey, response)
    return response
  } catch (error) {
    console.error("Image transform failed", {
      source,
      width,
      version,
      error: error instanceof Error ? error.message : String(error),
    })
    const headers = new Headers(fallback.headers)
    headers.set("Cache-Control", "no-store")
    return new Response(fallback.body, {
      status: fallback.status,
      statusText: fallback.statusText,
      headers,
    })
  }
}

function imageCacheKey(
  requestUrl: URL,
  source: string,
  width: number,
  version: string
) {
  const key = new URL(`https://${requestUrl.host.toLowerCase()}${source}`)
  key.pathname = `${imagePathPrefix.slice(0, -1)}${source}`
  key.searchParams.set("width", String(width))
  key.searchParams.set("v", version)
  return new Request(key)
}

async function readCache(key: Request) {
  if (!("caches" in globalThis)) return undefined
  try {
    return await imageCache().match(key)
  } catch (error) {
    console.warn("Image cache read failed", error)
    return undefined
  }
}

async function writeCache(key: Request, response: Response) {
  if (!("caches" in globalThis)) return
  try {
    await imageCache().put(key, response.clone())
  } catch (error) {
    console.warn("Image cache write failed", error)
  }
}

function imageCache() {
  return (globalThis.caches as CacheStorage & { default: Cache }).default
}
