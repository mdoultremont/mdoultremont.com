import type { TrackPoint } from "./types.ts"

export const PREVIEW_MAX_VERTICES = 120
const fit = (n: number) => Math.max(4, Math.min(96, Math.round(n * 100) / 100))
export interface PreviewVertex {
  readonly i: number
  readonly x: number
  readonly y: number
}

export function buildPreview(
  points: readonly TrackPoint[],
  indices: readonly number[]
): PreviewVertex[] {
  if (!indices.length) return []
  let previous = points[indices[0]!]![2]
  let longitude = previous
  const geographic = indices.map((i) => {
    const point = points[i]!
    const delta = ((point[2] - previous + 540) % 360) - 180
    longitude += delta
    previous = point[2]
    return { i, lon: longitude, lat: Math.max(-89.9, Math.min(89.9, point[1])) }
  })
  let minLat = Infinity,
    maxLat = -Infinity
  for (const p of geographic) {
    minLat = Math.min(minLat, p.lat)
    maxLat = Math.max(maxLat, p.lat)
  }
  const cos = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity
  const projected = geographic.map((p) => {
    const x = p.lon * cos,
      y = -p.lat
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
    return { i: p.i, x, y }
  })
  const span = Math.max(maxX - minX, maxY - minY)
  const scale = span > 0 ? 92 / span : 0
  const fitted = projected.map((p) => ({
    i: p.i,
    x: fit(50 + (p.x - (minX + maxX) / 2) * scale),
    y: fit(50 + (p.y - (minY + maxY) / 2) * scale),
  }))
  if (fitted.length <= PREVIEW_MAX_VERTICES) return fitted
  return Array.from(
    { length: PREVIEW_MAX_VERTICES },
    (_, i) =>
      fitted[
        Math.round((i * (fitted.length - 1)) / (PREVIEW_MAX_VERTICES - 1))
      ]!
  )
}
