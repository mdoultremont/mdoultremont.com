import { ratesAt, samplesFor } from "./sampling.ts"
import type { FlightMetrics, TrackPoint } from "./types.ts"

export interface ProfilePoint {
  /** Index into the original track points. */
  i: number
  tS: number
  altM: number | null
  speedKmh: number
  varioMps: number
  distKm: number
}

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

/** Largest triangle three buckets; input must be ordered by x with finite x/y. */
export function downsampleLttb<T>(
  data: readonly T[],
  targetCount: number,
  x: (point: T) => number,
  y: (point: T) => number
): T[] {
  if (!Number.isInteger(targetCount) || targetCount < 2)
    throw new RangeError("The target count must be an integer of at least two.")
  if (data.length <= targetCount) return [...data]
  if (targetCount === 2) return [data[0]!, data[data.length - 1]!]
  const result: T[] = [data[0]!]
  const bucketSize = (data.length - 2) / (targetCount - 2)
  let selected = 0
  for (let bucket = 0; bucket < targetCount - 2; bucket++) {
    const averageStart = Math.floor((bucket + 1) * bucketSize) + 1
    const averageEnd = Math.min(
      Math.floor((bucket + 2) * bucketSize) + 1,
      data.length
    )
    let avgX = 0
    let avgY = 0
    for (let i = averageStart; i < averageEnd; i++) {
      avgX += x(data[i]!)
      avgY += y(data[i]!)
    }
    const count = averageEnd - averageStart
    avgX /= count
    avgY /= count
    const rangeStart = Math.floor(bucket * bucketSize) + 1
    const rangeEnd = Math.min(
      Math.floor((bucket + 1) * bucketSize) + 1,
      data.length - 1
    )
    const a = data[selected]!
    let maxArea = -1
    let next = rangeStart
    for (let i = rangeStart; i < rangeEnd; i++) {
      const b = data[i]!
      const area = Math.abs(
        (x(a) - avgX) * (y(b) - y(a)) - (x(a) - x(b)) * (avgY - y(a))
      )
      if (area > maxArea) {
        maxArea = area
        next = i
      }
    }
    result.push(data[next]!)
    selected = next
  }
  result.push(data[data.length - 1]!)
  return result
}
