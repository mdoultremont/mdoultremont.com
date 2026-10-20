import { computeMetrics } from "./metrics.ts"
import { buildProfile } from "./profile.ts"
import type { TrackPoint } from "./types.ts"

export function analyzeTrack(points: readonly TrackPoint[]) {
  if (points.length < 2) return null
  const metrics = computeMetrics(points)
  return { metrics, profile: buildProfile(points, metrics) }
}
