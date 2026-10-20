import { ratesAt, samplesFor } from "./sampling.ts"
import type { FlightMetrics, ProfilePoint, TrackPoint } from "./types.ts"

export function buildProfile(
  points: readonly TrackPoint[],
  metrics: FlightMetrics
): ProfilePoint[] {
  const samples = samplesFor(points).filter(
    (sample) =>
      sample.index >= metrics.takeoffIndex &&
      sample.index <= metrics.landingIndex
  )
  const startDistance = samples[0]?.distanceM ?? 0
  return samples.map((sample, index) => {
    const rates = ratesAt(samples, index)
    return {
      i: sample.index,
      tS: (sample.point[0] - metrics.takeoffAt.getTime()) / 1000,
      altM: sample.altM,
      speedKmh: rates.speedMps * 3.6,
      varioMps: rates.varioMps,
      distKm: (sample.distanceM - startDistance) / 1000,
    }
  })
}
