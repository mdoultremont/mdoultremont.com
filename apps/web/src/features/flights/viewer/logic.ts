import {
  buildProfile,
  computeMetrics,
  downsampleLttb,
  type ProfilePoint,
  type TrackPoint,
} from "@/shared/flight-track"

/** Keep original fix indices through filtering and independent series downsampling. */
export function buildViewerSeries(points: readonly TrackPoint[], target = 800) {
  if (points.length < 2)
    return { profile: [], altitude: [], speed: [], vario: [], metrics: null }
  const metrics = computeMetrics(points)
  const profile = buildProfile(points, metrics)
  return {
    metrics,
    profile,
    altitude: downsampleLttb(
      profile,
      target,
      (p) => p.tS,
      (p) => p.altM ?? 0
    ),
    vario: downsampleLttb(
      profile,
      target,
      (p) => p.tS,
      (p) => p.varioMps
    ),
    speed: downsampleLttb(
      profile,
      target,
      (p) => p.tS,
      (p) => p.speedKmh
    ),
  }
}

/** Nearest temporal sample, including when an isolated GPS fix was removed. */
export function nearestProfilePoint(
  profile: readonly ProfilePoint[],
  seconds: number
) {
  if (!profile.length) return undefined
  let lo = 0
  let hi = profile.length - 1
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (profile[mid]!.tS < seconds) lo = mid + 1
    else hi = mid
  }
  const before = profile[Math.max(0, lo - 1)]!
  const after = profile[lo]!
  return Math.abs(before.tS - seconds) <= Math.abs(after.tS - seconds)
    ? before
    : after
}

/** Use projected screen coordinates so selection follows what the pilot sees at any zoom. */
export function nearestPointIndex(
  points: readonly TrackPoint[],
  target: { x: number; y: number },
  project: (coordinate: [number, number]) => { x: number; y: number }
): number | null {
  let nearest: number | null = null
  let distance = Infinity
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!
    const pixel = project([point[2], point[1]])
    const squared = (pixel.x - target.x) ** 2 + (pixel.y - target.y) ** 2
    if (squared < distance) {
      distance = squared
      nearest = i
    }
  }
  return nearest
}

/** Profile ticks retain seconds on short flights rather than repeating minute labels. */
export function formatProfileTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
}
