import { readFileSync } from "node:fs"
import { expect, it } from "vitest"
import { buildProfile } from "./profile.ts"
import { flightPoints } from "./fixtures/synthetic.ts"
const spikeGpx = readFileSync(
  new URL("./fixtures/spike.gpx", import.meta.url),
  "utf8"
)
import { parseGpx } from "./parse-gpx.ts"
import type { TrackPoint } from "./types.ts"
import { computeMetrics } from "./metrics.ts"

it("builds airborne profiles with original indices, smoothed rates, and cumulative distance", () => {
  const points = flightPoints()
  const profile = buildProfile(points, computeMetrics(points))
  expect(profile).toHaveLength(61)
  expect(profile[0]).toMatchObject({
    i: 20,
    tS: 0,
    altM: 1000,
    distKm: 0,
    speedKmh: 0,
    varioMps: 0,
  })
  expect(profile.at(-1)).toMatchObject({
    i: 80,
    tS: 60,
    altM: 1030,
    varioMps: -1,
  })
  expect(profile.at(-1)?.distKm).toBeCloseTo(0.6, 4)
  expect(profile[10]?.speedKmh).toBeCloseTo(36, 2)
  expect(profile[10]?.varioMps).toBeCloseTo(2, 8)
})
it("keeps missing altitude explicit in profiles", () => {
  const points = flightPoints().map(
    (p) => [p[0], p[1], p[2], null, null] as typeof p
  )
  expect(buildProfile(points, computeMetrics(points))[0]?.altM).toBeNull()
})

it("interpolates profile rates across irregular timestamp intervals", () => {
  const points: TrackPoint[] = [
    [0, 46, 6, 100, null],
    [1000, 46 + 20 / 111_195, 6, 110, null],
    [10_000, 46 + 65 / 111_195, 6, 119, null],
  ]
  const profile = buildProfile(points, computeMetrics(points))
  expect(profile.at(-1)?.speedKmh).toBeCloseTo(18, 3)
  expect(profile.at(-1)?.varioMps).toBeCloseTo(1, 8)
})
it("omits isolated GPS spikes while preserving original indices and distance", () => {
  const points = parseGpx(spikeGpx).points
  const profile = buildProfile(points, computeMetrics(points))
  expect(profile.some((point) => point.i === 45)).toBe(false)
  expect(profile.some((point) => point.i === 46)).toBe(true)
  expect(profile.at(-1)?.i).toBe(80)
  expect(profile.at(-1)?.distKm).toBeCloseTo(0.6, 4)
})
