import type { Map as FlightMap } from "maplibre-gl"
import type { FlightDetail } from "@/features/flights/api"
import { formatDate } from "@/features/flights/format"
import {
  fitText,
  IMAGE_HEIGHT,
  IMAGE_WIDTH,
  projectTrack,
  shareStats,
} from "./layout"

function idle(map: FlightMap) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      map.off("idle", done)
      map.off("error", failed)
    }
    const done = () => {
      cleanup()
      resolve()
    }
    const failed = () => {
      cleanup()
      reject(new Error("Map tiles unavailable"))
    }
    const timer = setTimeout(failed, 10000)
    map.once("idle", done)
    map.once("error", failed)
    map.triggerRepaint()
  })
}
function marker(
  ctx: CanvasRenderingContext2D,
  point: { x: number; y: number } | undefined,
  color: string
) {
  if (!point) return
  ctx.beginPath()
  ctx.arc(point.x, point.y, 13, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.strokeStyle = "#fff"
  ctx.lineWidth = 5
  ctx.stroke()
}
async function capture(map: FlightMap, detail: FlightDetail) {
  const container = map.getContainer()
  const oldStyle = container.getAttribute("style")
  const camera = {
    center: map.getCenter(),
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
    padding: map.getPadding(),
  }
  const hover = container.querySelector<HTMLElement>(
    '[aria-label="Selected track position"]'
  )
  const visibility = hover?.style.visibility
  try {
    if (hover) hover.style.visibility = "hidden"
    container.style.cssText +=
      ";position:fixed;left:-12000px;top:0;width:1080px;height:900px;"
    map.resize()
    const { LngLatBounds } = await import("maplibre-gl")
    const bounds = new LngLatBounds()
    for (const p of detail.points) bounds.extend([p[2], p[1]])
    map.fitBounds(bounds, {
      padding: { top: 140, bottom: 170, left: 100, right: 100 },
      duration: 0,
      maxZoom: 15,
      bearing: 0,
      pitch: 0,
    })
    await idle(map)
    // Copy before restoring the live map; DOM markers are composited separately.
    const canvas = document.createElement("canvas")
    canvas.width = 1080
    canvas.height = 900
    const ctx = canvas.getContext("2d")!
    ctx.drawImage(map.getCanvas(), 0, 0, 1080, 900)
    ctx.getImageData(0, 0, 1, 1) // Detect a tainted canvas before composing the final image.
    for (const [index, color] of [
      [detail.analysis?.takeoffIndex ?? 0, "#15803d"],
      [detail.analysis?.landingIndex ?? detail.points.length - 1, "#dc2626"],
    ] as const) {
      const p = detail.points[index]!
      marker(ctx, map.project([p[2], p[1]]), color)
    }
    const attribution =
      container.querySelector(".maplibregl-ctrl-attrib-inner")?.textContent ??
      "OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors"
    return { canvas, attribution }
  } finally {
    if (oldStyle === null) container.removeAttribute("style")
    else container.setAttribute("style", oldStyle)
    map.resize()
    map.jumpTo(camera)
    if (hover) hover.style.visibility = visibility ?? "hidden"
  }
}
export async function renderShareImage(
  detail: FlightDetail,
  map: FlightMap | null
) {
  await document.fonts.ready
  const canvas = document.createElement("canvas")
  canvas.width = IMAGE_WIDTH
  canvas.height = IMAGE_HEIGHT
  const ctx = canvas.getContext("2d")
  if (!ctx)
    throw new Error(
      "Your browser could not create an image. Try another browser."
    )
  const background = ctx.createLinearGradient(0, 0, 1080, 1350)
  background.addColorStop(0, "#244f49")
  background.addColorStop(1, "#0d2926")
  ctx.fillStyle = background
  ctx.fillRect(0, 0, 1080, 1350)
  let fallback = true
  let attribution = "Track illustration · no basemap"
  if (map && detail.points.length >= 2) {
    try {
      const captured = await capture(map, detail)
      ctx.drawImage(captured.canvas, 0, 0)
      attribution = captured.attribution
      fallback = false
    } catch {
      /* Offline tiles and CORS restrictions use the projection below. */
    }
  }
  if (fallback && detail.points.length) {
    const track = projectTrack(detail.points, 1080, 800, 120)
    ctx.beginPath()
    track.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
    ctx.lineJoin = "round"
    ctx.lineCap = "round"
    ctx.lineWidth = 7
    ctx.strokeStyle = "#b4ecd5"
    ctx.stroke()
    marker(ctx, track[detail.analysis?.takeoffIndex ?? 0], "#15803d")
    marker(
      ctx,
      track[detail.analysis?.landingIndex ?? track.length - 1],
      "#dc2626"
    )
  }
  const overlay = ctx.createLinearGradient(0, 450, 0, 900)
  overlay.addColorStop(0, "#0d292600")
  overlay.addColorStop(0.65, "#0d2926ed")
  overlay.addColorStop(1, "#0d2926")
  ctx.fillStyle = overlay
  ctx.fillRect(0, 450, 1080, 900)
  function text(
    value: string,
    x: number,
    y: number,
    size: number,
    color = "#f2f7ed",
    width = 936,
    weight = 500
  ) {
    const fitted = fitText(value, width, size, Math.min(size, 26), (s, n) => {
      ctx!.font = `${weight} ${n}px Inter, sans-serif`
      return ctx!.measureText(s).width
    })
    ctx!.font = `${weight} ${fitted.size}px Inter, sans-serif`
    ctx!.fillStyle = color
    ctx!.fillText(fitted.text, x, y)
  }
  text(
    formatDate(detail.flight.takeoffAt ?? detail.flight.startedAt),
    72,
    795,
    28,
    "#bad5c9"
  )
  text(detail.flight.title, 72, 865, 60, undefined, 936, 600)
  text(
    `→ ${detail.flight.landingName || "Unnamed landing"}`,
    72,
    920,
    38,
    "#d4e8de"
  )
  const stats = shareStats(detail.flight)
  stats.forEach((stat, i) => {
    const x = i < 2 ? 72 + i * 480 : 72 + (i - 2) * 320
    const y = i < 2 ? 1020 : 1160
    text(stat.label, x, y, 20, "#bad5c9", i < 2 ? 440 : 290)
    text(
      stat.value,
      x,
      y + 55,
      i < 2 ? 48 : 36,
      undefined,
      i < 2 ? 440 : 290,
      600
    )
  })
  ctx.strokeStyle = "#bad5c944"
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(72, 1250)
  ctx.lineTo(1008, 1250)
  ctx.stroke()
  text("Flights.", 72, 1305, 30, undefined, 180, 600)
  text(attribution.replace(/\s+/g, " ").trim(), 300, 1305, 16, "#bad5c9", 708)
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value
          ? resolve(value)
          : reject(new Error("Could not export the image.")),
      "image/png"
    )
  )
  return { blob, fallback }
}
