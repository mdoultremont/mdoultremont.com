import { createFileRoute } from "@tanstack/react-router"
import { imageRequestWidths } from "../features/images/images"
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
const placeholderSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"><rect width="1" height="1" fill="#e8e6e0"/></svg>'

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

  const allowedWidths = imageRequestWidths(source, image)
  if (!allowedWidths.includes(width))
    return new Response("Image width not found", { status: 404 })

  const sourceUrl = new URL(source, url)
  sourceUrl.searchParams.set("v", version)
  try {
    const transformed = await fetch(sourceUrl, {
      cf: {
        image: {
          width: Math.min(width, image.width),
          fit: "scale-down",
          format: "webp",
          quality: 80,
        },
        cacheTtl: cacheMaxAge,
      },
    })
    if (transformed.ok) {
      const headers = new Headers(transformed.headers)
      headers.set("Cache-Control", `public, max-age=${cacheMaxAge}, immutable`)
      return new Response(transformed.body, {
        status: transformed.status,
        statusText: transformed.statusText,
        headers,
      })
    }

    console.error("Image transform failed", {
      source,
      width,
      version,
      status: transformed.status,
    })
  } catch (error) {
    console.error("Image transform failed", {
      source,
      width,
      version,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return new Response(placeholderSvg, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "image/svg+xml",
    },
  })
}
