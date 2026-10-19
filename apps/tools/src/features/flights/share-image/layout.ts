import type { TrackPoint } from "@mdoultremont/flight-track"
import type { FlightDetail } from "@/features/flights/api"
import {
  formatAltitude,
  formatDistance,
  formatDuration,
  formatSpeed,
} from "@/features/flights/format"

export const IMAGE_WIDTH = 1080
export const IMAGE_HEIGHT = 1350
export function shareStats(flight: FlightDetail["flight"]) {
  const stats: [string, number | null, (value: number) => string][] = [
    ["AIR TIME", flight.durationS, formatDuration],
    ["DISTANCE", flight.distanceM, formatDistance],
    ["MAX ALTITUDE", flight.maxAltM, formatAltitude],
    ["MAX SPEED", flight.maxSpeedMps, formatSpeed],
    ["ELEVATION GAIN", flight.elevationGainM, formatAltitude],
  ]
  return stats.map(([label, value, format]) => ({
    label,
    value: value === null ? "—" : format(value),
  }))
}

/** Deterministic text fitting, including single unbroken names and emoji. */
export function fitText(
  text: string,
  width: number,
  preferred: number,
  minimum: number,
  measure: (text: string, size: number) => number
) {
  let size = preferred
  while (size > minimum && measure(text, size) > width) size--
  if (measure(text, size) <= width) return { text, size }
  const chars = Array.from(text)
  while (chars.length && measure(chars.join("") + "…", size) > width)
    chars.pop()
  return { text: chars.join("") + "…", size }
}

/** Web Mercator fit with longitude unwrapping, so dateline flights stay local. */
export function projectTrack(
  points: readonly TrackPoint[],
  width: number,
  height: number,
  padding = 80
) {
  let previous = points[0]?.[2] ?? 0
  const projected = points.map((p) => {
    let lon = p[2]
    while (lon - previous > 180) lon -= 360
    while (lon - previous < -180) lon += 360
    previous = lon
    const lat =
      (Math.max(-85.051129, Math.min(85.051129, p[1])) * Math.PI) / 180
    return {
      x: (lon * Math.PI) / 180,
      y: -Math.log(Math.tan(Math.PI / 4 + lat / 2)),
    }
  })
  if (!projected.length) return []
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity
  for (const p of projected) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  const scale = Math.min(
    (width - padding * 2) / Math.max(maxX - minX, 1e-9),
    (height - padding * 2) / Math.max(maxY - minY, 1e-9)
  )
  return projected.map((p) => ({
    x: width / 2 + (p.x - (minX + maxX) / 2) * scale,
    y: height / 2 + (p.y - (minY + maxY) / 2) * scale,
  }))
}
