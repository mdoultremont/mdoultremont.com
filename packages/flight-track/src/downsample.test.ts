import { describe, expect, it } from "vitest"
import { buildProfile, downsampleLttb } from "./downsample.ts"
import { flightPoints } from "./fixtures/synthetic.ts"
import spikeGpx from "./fixtures/spike.gpx?raw"
import { parseGpx } from "./parse-gpx.ts"
import type { TrackPoint } from "./types.ts"
import { computeMetrics } from "./metrics.ts"

const x = (point: { x: number; y: number }): number => point.x
const y = (point: { x: number; y: number }): number => point.y

describe("LTTB downsampling", () => {
  const data = Array.from({ length: 1000 }, (_, i) => ({
    x: i,
    y: Math.sin(i / 20),
  }))
  it.each([2, 3, 10, 100, 999])(
    "returns exactly %i ordered points including both endpoints",
    (count) => {
      const result = downsampleLttb(data, count, x, y)
      expect(result).toHaveLength(count)
      expect(result[0]).toBe(data[0])
      expect(result.at(-1)).toBe(data.at(-1))
      expect(
        result.every((point, i) => i === 0 || point.x > result[i - 1]!.x)
      ).toBe(true)
    }
  )
  it("preserves a narrow peak", () => {
    const peak = data.map((point, i) => ({ ...point, y: i === 500 ? 100 : 0 }))
    expect(
      downsampleLttb(peak, 20, x, y).some((point) => point.x === 500)
    ).toBe(true)
  })
  it("returns a copy for small or empty inputs", () => {
    expect(downsampleLttb([], 10, x, y)).toEqual([])
    expect(downsampleLttb(data, 2000, x, y)).toEqual(data)
    expect(downsampleLttb(data, 2000, x, y)).not.toBe(data)
  })
  it.each([0, 1, 2.5, NaN, Infinity])(
    "rejects an invalid target %s",
    (target) => {
      expect(() => downsampleLttb(data, target, x, y)).toThrow(RangeError)
    }
  )
})

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
