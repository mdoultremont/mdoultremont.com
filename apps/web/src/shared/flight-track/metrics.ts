import { ratesAt, samplesFor, type Sample } from "./sampling.ts"
import type { FlightMetrics, TrackPoint } from "./types.ts"

const DETECTION_WINDOW_MS = 10_000
const FLIGHT_SPEED_MPS = 3
const FLIGHT_ALTITUDE_CHANGE_M = 5

function activityBounds(samples: readonly Sample[]): [number, number] {
  const intervals = samples
    .slice(1)
    .map((sample, i) => sample.point[0] - samples[i]!.point[0])
  // Sorting this new local array supports the app’s ES2022 target.
  // oxlint-disable-next-line unicorn/no-array-sort
  intervals.sort((a, b) => a - b)
  const medianMs =
    intervals[Math.floor(intervals.length / 2)] ?? DETECTION_WINDOW_MS
  const windowMs = Math.max(DETECTION_WINDOW_MS, medianMs)
  const gapLimitMs = Math.max(20_000, 3 * medianMs)
  let first: number | undefined
  let last: number | undefined
  let end = 1
  // Prefix counts keep sustained-speed detection linear for high frequency logs.
  const slowSegments = [0]
  const inactiveSegments = [0]
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!
    const b = samples[i]!
    const speed =
      (b.distanceM - a.distanceM) / ((b.point[0] - a.point[0]) / 1000)
    slowSegments.push(slowSegments[i - 1]! + (speed > FLIGHT_SPEED_MPS ? 0 : 1))
    const aAlt = a.altM
    const bAlt = b.altM
    const verticalMotion =
      aAlt !== null && bAlt !== null && Math.abs(bAlt - aAlt) > 0.05
    inactiveSegments.push(
      inactiveSegments[i - 1]! +
        (speed > FLIGHT_SPEED_MPS || verticalMotion ? 0 : 1)
    )
  }
  for (let start = 0; start < samples.length - 1; start++) {
    end = Math.max(end, start + 1)
    while (
      end < samples.length &&
      samples[end]!.point[0] - samples[start]!.point[0] < windowMs
    )
      end++
    if (end === samples.length) break
    const startAlt = samples[start]!.altM
    const endAlt = samples[end]!.altM
    const sustainedSpeed = slowSegments[end] === slowSegments[start]
    const altitudeChange =
      startAlt !== null &&
      endAlt !== null &&
      Math.abs(endAlt - startAlt) > FLIGHT_ALTITUDE_CHANGE_M &&
      inactiveSegments[end] === inactiveSegments[start]
    // Require observations throughout the sampling-adapted detection window.
    const gapMs = samples[end]!.point[0] - samples[start]!.point[0]
    if ((sustainedSpeed || altitudeChange) && gapMs <= gapLimitMs) {
      first ??= start
      last = end
    }
  }
  return first === undefined || last === undefined
    ? [0, samples.length - 1]
    : [first, last]
}

/** Ground stops separate runs; choose the run with the strongest altitude range.
 * A stop of 30 seconds also separates top-landings/relaunches. Without altitude
 * evidence (or a stop), speed alone cannot distinguish a glider from a vehicle.
 */
function airborneBounds(samples: readonly Sample[]): [number, number] {
  const runs: [number, number][] = []
  let start = 0
  let stopStart: number | undefined
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!
    const b = samples[i]!
    const dt = (b.point[0] - a.point[0]) / 1000
    const aAlt = a.altM
    const bAlt = b.altM
    const quiet =
      aAlt === null || bAlt === null || Math.abs(bAlt - aAlt) / dt < 0.2
    if ((b.distanceM - a.distanceM) / dt < 1.5 && quiet) {
      stopStart ??= i - 1
    } else {
      if (
        stopStart !== undefined &&
        a.point[0] - samples[stopStart]!.point[0] >= 30_000
      ) {
        if (stopStart > start) runs.push([start, stopStart])
        start = i - 1
      }
      stopStart = undefined
    }
  }
  const end =
    stopStart !== undefined &&
    samples.at(-1)!.point[0] - samples[stopStart]!.point[0] >= 30_000
      ? stopStart
      : samples.length - 1
  if (end > start) runs.push([start, end])
  let best: [number, number] = [0, samples.length - 1]
  let bestRange = -1
  let bestDuration = -1
  for (const [from, to] of runs) {
    const [a, b] = activityBounds(samples.slice(from, to + 1))
    const bounds: [number, number] = [from + a, from + b]
    let min = Infinity
    let max = -Infinity
    for (let i = bounds[0]; i <= bounds[1]; i++) {
      const alt = samples[i]!.altM
      if (alt !== null) {
        min = Math.min(min, alt)
        max = Math.max(max, alt)
      }
    }
    const range = max - min > FLIGHT_ALTITUDE_CHANGE_M ? max - min : 0
    const duration = samples[bounds[1]]!.point[0] - samples[bounds[0]]!.point[0]
    if (range > bestRange || (range === bestRange && duration > bestDuration)) {
      best = bounds
      bestRange = range
      bestDuration = duration
    }
  }
  return best
}

/** Reversal hysteresis: commit a climb only once its rise reaches two metres. */
function elevationGain(samples: readonly Sample[]): number {
  let valley: number | undefined
  let peak: number | undefined
  let climbing = false
  let gain = 0
  for (const sample of samples) {
    const value = sample.altM
    if (value === null) continue
    if (valley === undefined || peak === undefined) {
      valley = value
      peak = value
      continue
    }
    if (!climbing) {
      valley = Math.min(valley, value)
      if (value - valley >= 2) {
        climbing = true
        peak = value
      }
    } else {
      peak = Math.max(peak, value)
      if (peak - value >= 2) {
        gain += peak - valley
        valley = value
        peak = value
        climbing = false
      }
    }
  }
  return gain + (climbing ? peak! - valley! : 0)
}

export function computeMetrics(points: readonly TrackPoint[]): FlightMetrics {
  const samples = samplesFor(points)
  const [start, end] = airborneBounds(samples)
  const airborne = samples.slice(start, end + 1)
  const takeoff = samples[start]!
  const landing = samples[end]!
  const altitudes = airborne
    .map((sample) => sample.altM)
    .filter((value): value is number => value !== null)
  let maxSpeedMps = 0
  let maxClimbMps = 0
  let maxSinkMps = 0
  const durationMs = landing.point[0] - takeoff.point[0]
  for (let i = start + 1; i <= end; i++) {
    // Full windows prevent a single short, noisy segment from setting the record.
    if (durationMs >= 5000 && samples[i]!.point[0] - takeoff.point[0] < 5000)
      continue
    const rates = ratesAt(samples, i, start)
    maxSpeedMps = Math.max(maxSpeedMps, rates.speedMps)
    maxClimbMps = Math.max(maxClimbMps, rates.varioMps)
    maxSinkMps = Math.max(maxSinkMps, -rates.varioMps)
  }
  return {
    takeoffIndex: takeoff.index,
    landingIndex: landing.index,
    takeoffAt: new Date(takeoff.point[0]),
    landingAt: new Date(landing.point[0]),
    durationS: durationMs / 1000,
    takeoff: { lat: takeoff.point[1], lon: takeoff.point[2] },
    landing: { lat: landing.point[1], lon: landing.point[2] },
    distanceM: landing.distanceM - takeoff.distanceM,
    maxAltM: altitudes.length
      ? altitudes.reduce((max, value) => Math.max(max, value), -Infinity)
      : null,
    avgAltM: altitudes.length
      ? altitudes.reduce((sum, value) => sum + value, 0) / altitudes.length
      : null,
    maxSpeedMps,
    elevationGainM: altitudes.length ? elevationGain(airborne) : null,
    maxClimbMps: altitudes.length ? maxClimbMps : null,
    maxSinkMps: altitudes.length ? maxSinkMps : null,
  }
}
