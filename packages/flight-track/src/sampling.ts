import { haversineDistance } from "./geo.ts"
import { validCoordinates } from "./normalize.ts"
import { TrackParseError, type TrackPoint } from "./types.ts"

export const MAX_SEGMENT_SPEED_MPS = 40
export const SMOOTHING_WINDOW_MS = 5_000
export interface Sample {
  point: TrackPoint
  altM: number | null
  index: number
  distanceM: number
}
const distance = (a: TrackPoint, b: TrackPoint): number =>
  haversineDistance(a[1], a[2], b[1], b[2])
const speed = (a: TrackPoint, b: TrackPoint): number =>
  distance(a, b) / ((b[0] - a[0]) / 1000)

/** Reject isolated bad fixes; retain original indices for map/chart synchronization. */
export function samplesFor(points: readonly TrackPoint[]): Sample[] {
  if (points.length < 2)
    throw new TrackParseError("A flight needs at least two track points.")
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!
    if (
      !Number.isFinite(point[0]) ||
      !validCoordinates(point[1], point[2]) ||
      (point[3] !== null && !Number.isFinite(point[3])) ||
      (point[4] !== null && !Number.isFinite(point[4])) ||
      (i > 0 && point[0] <= points[i - 1]![0])
    ) {
      throw new TrackParseError(
        "Track points must have valid coordinates, altitudes, and increasing timestamps."
      )
    }
  }
  // Keep gaps in the chosen source; never introduce a sensor-offset jump.
  const source =
    points.filter((point) => point[3] !== null).length / points.length >= 0.9
      ? 3
      : 4
  const samples: Sample[] = []
  for (let index = 0; index < points.length; index++) {
    const point = points[index]!
    const previous = samples.at(-1)?.point
    const next = points[index + 1]
    if (
      previous &&
      next &&
      speed(previous, point) > MAX_SEGMENT_SPEED_MPS &&
      speed(point, next) > MAX_SEGMENT_SPEED_MPS &&
      speed(previous, next) <= MAX_SEGMENT_SPEED_MPS
    )
      continue
    const segmentM =
      previous && speed(previous, point) <= MAX_SEGMENT_SPEED_MPS
        ? distance(previous, point)
        : 0
    samples.push({
      point,
      altM: point[source],
      index,
      distanceM: (samples.at(-1)?.distanceM ?? 0) + segmentM,
    })
  }
  return samples
}

export interface Rates {
  speedMps: number
  varioMps: number
}
/** A trailing time window, interpolated at its boundary; O(log n) per lookup. */
export function ratesAt(
  samples: readonly Sample[],
  index: number,
  startIndex = 0
): Rates {
  const current = samples[index]!
  const target = Math.max(
    samples[startIndex]!.point[0],
    current.point[0] - SMOOTHING_WINDOW_MS
  )
  const durationS = (current.point[0] - target) / 1000
  if (durationS <= 0) return { speedMps: 0, varioMps: 0 }
  let low = startIndex
  let high = index
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2)
    if (samples[mid]!.point[0] <= target) low = mid
    else high = mid - 1
  }
  const before = samples[low]!
  const after = samples[Math.min(low + 1, index)]!
  const span = after.point[0] - before.point[0]
  const fraction = span === 0 ? 0 : (target - before.point[0]) / span
  const startDistance =
    before.distanceM + fraction * (after.distanceM - before.distanceM)
  const beforeAlt = before.altM
  const afterAlt = after.altM
  const endAlt = current.altM
  const startAlt =
    beforeAlt === null || afterAlt === null
      ? null
      : beforeAlt + fraction * (afterAlt - beforeAlt)
  return {
    speedMps: (current.distanceM - startDistance) / durationS,
    varioMps:
      startAlt === null || endAlt === null
        ? 0
        : (endAlt - startAlt) / durationS,
  }
}
