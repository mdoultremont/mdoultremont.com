import { computeMetrics } from "./metrics.ts"
import { buildProfile } from "./profile.ts"
import { buildPreview } from "./preview.ts"
import type { FlightMetrics, TrackPoint } from "./types.ts"

export const ANALYSIS_VERSION = 1

export function prepareFlight(points: readonly TrackPoint[]) {
  if (!points.length) return { metrics: null, analysis: null, preview: [] }
  const metrics = computeMetrics(points)
  if (points.length === 1)
    return { metrics, analysis: null, preview: buildPreview(points, [0]) }
  const profile = buildProfile(points, metrics)
  return {
    metrics,
    analysis: {
      takeoffIndex: metrics.takeoffIndex,
      landingIndex: metrics.landingIndex,
      takeoffAt: metrics.takeoffAt.getTime(),
      profile,
    },
    preview: buildPreview(
      points,
      profile.map((point) => point.i)
    ),
  }
}

export const measuredColumns = (m: FlightMetrics) => ({
  takeoffAt: m.takeoffAt.getTime(),
  landingAt: m.landingAt.getTime(),
  durationS: Math.round(m.durationS),
  takeoffLat: m.takeoff.lat,
  takeoffLon: m.takeoff.lon,
  landingLat: m.landing.lat,
  landingLon: m.landing.lon,
  distanceM: m.distanceM,
  maxAltM: m.maxAltM,
  avgAltM: m.avgAltM,
  maxSpeedMps: m.maxSpeedMps,
  elevationGainM: m.elevationGainM,
  maxClimbMps: m.maxClimbMps,
  maxSinkMps: m.maxSinkMps,
})
