import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
const spikeGpx = readFileSync(
  new URL("./fixtures/spike.gpx", import.meta.url),
  "utf8"
)
import { flightPoints, START_MS } from "./fixtures/synthetic.ts"
import { computeMetrics } from "./metrics.ts"
import { parseGpx } from "./parse-gpx.ts"
import type { TrackPoint } from "./types.ts"

describe("flight metrics", () => {
  it("trims launch walking and post-landing ground time", () => {
    const metrics = computeMetrics(flightPoints())
    expect(metrics.takeoffIndex).toBe(20)
    expect(metrics.landingIndex).toBe(80)
    expect(metrics.takeoffAt.getTime()).toBe(START_MS + 20_000)
    expect(metrics.landingAt.getTime()).toBe(START_MS + 80_000)
    expect(metrics.durationS).toBe(60)
    expect(metrics.distanceM).toBeCloseTo(600, 0)
    expect(metrics.takeoff.lat).toBeCloseTo(46 + 20 / 111_195, 8)
    expect(metrics.landing.lat).toBeCloseTo(46 + 620 / 111_195, 8)
    expect(metrics.maxAltM).toBe(1060)
    expect(metrics.avgAltM).toBeGreaterThan(1000)
    expect(metrics.avgAltM).toBeLessThan(1060)
    expect(metrics.elevationGainM).toBe(60)
    expect(metrics.maxSpeedMps).toBeCloseTo(10, 2)
    expect(metrics.maxClimbMps).toBeCloseTo(2, 8)
    expect(metrics.maxSinkMps).toBeCloseTo(1, 8)
  })
  it.each([false, true])(
    "excludes flat vehicle travel separated by a ground stop (drive first: %s)",
    (driveFirst) => {
      let metres = 0
      const points = Array.from({ length: 721 }, (_, t): TrackPoint => {
        const flight = driveFirst ? t > 420 && t <= 720 : t > 60 && t <= 360
        const driving = driveFirst ? t > 60 && t <= 360 : t > 420
        metres += flight ? 10 : driving ? 15 : 0
        const elapsed = driveFirst ? t - 420 : t - 60
        const alt = flight ? 1000 + Math.min(elapsed, 300 - elapsed) : 1000
        return [t * 1000, 46 + metres / 111_195, 6, alt, null]
      })
      expect(computeMetrics(points)).toMatchObject({
        durationS: 300,
        takeoffIndex: driveFirst ? 420 : 60,
        landingIndex: driveFirst ? 720 : 360,
      })
    }
  )
  it("detects altitude-only flight with sustained vertical movement", () => {
    const points = flightPoints().map((p): TrackPoint => [
      p[0],
      46,
      6,
      p[3],
      null,
    ])
    const metrics = computeMetrics(points)
    expect(metrics.takeoffIndex).toBe(20)
    expect(metrics.landingIndex).toBe(80)
    expect(metrics.distanceM).toBe(0)
  })
  it("produces consistent results with sparse and irregular sampling", () => {
    for (const points of [
      flightPoints(5),
      flightPoints().filter((_, i) => i % 3 === 0 || [20, 80, 100].includes(i)),
    ]) {
      const metrics = computeMetrics(points)
      expect(metrics.durationS).toBeGreaterThanOrEqual(58)
      expect(metrics.durationS).toBeLessThanOrEqual(62)
      expect(metrics.maxSpeedMps).toBeCloseTo(10, 2)
      expect(metrics.maxClimbMps).toBeCloseTo(2, 5)
    }
  })
  it("trims ground time in a 30-second logger track", () => {
    const points = Array.from({ length: 15 }, (_, i): TrackPoint => [
      i * 30_000,
      46 + (i * 60 + Math.max(0, Math.min(i - 2, 10)) * 240) / 111_195,
      6,
      1000 + Math.max(0, Math.min(i - 2, 10)) * 30,
      null,
    ])
    expect(computeMetrics(points)).toMatchObject({
      takeoffIndex: 2,
      landingIndex: 12,
      durationS: 300,
    })
  })
  it("interpolates a five-second time window rather than averaging sample counts", () => {
    const points: TrackPoint[] = [
      [0, 46, 6, 100, null],
      [1000, 46 + 20 / 111_195, 6, 110, null],
      [10_000, 46 + 65 / 111_195, 6, 119, null],
    ]
    const metrics = computeMetrics(points)
    expect(metrics.maxSpeedMps).toBeCloseTo(5, 3)
    expect(metrics.maxClimbMps).toBeCloseTo(1, 8)
  })
  it("smooths a plausible one-second speed burst over a full five-second window", () => {
    const points = Array.from({ length: 11 }, (_, i): TrackPoint => [
      i * 1000,
      46 + (i === 0 ? 0 : 30) / 111_195,
      6,
      100,
      null,
    ])
    expect(computeMetrics(points).maxSpeedMps).toBeCloseTo(6, 3)
  })
  it("rejects an isolated GPS spike from distance, altitude, speed, gain, and climb", () => {
    const metrics = computeMetrics(parseGpx(spikeGpx).points)
    expect(metrics.distanceM).toBeCloseTo(600, 0)
    expect(metrics.maxSpeedMps).toBeCloseTo(10, 2)
    expect(metrics.maxAltM).toBe(1060)
    expect(metrics.elevationGainM).toBe(60)
    expect(metrics.maxClimbMps).toBeCloseTo(2, 5)
  })
  it("ignores implausible segments even when they are not isolated", () => {
    const points: TrackPoint[] = [
      [0, 0, 0, null, null],
      [5000, 1, 0, null, null],
      [10000, 2, 0, null, null],
    ]
    const metrics = computeMetrics(points)
    expect(metrics.distanceM).toBe(0)
    expect(metrics.maxSpeedMps).toBe(0)
  })
  it("uses GPS before pressure altitude, then pressure when GPS is absent", () => {
    const points = flightPoints().map((p): TrackPoint => [
      p[0],
      p[1],
      p[2],
      null,
      p[3],
    ])
    expect(computeMetrics(points).maxAltM).toBe(1060)
    const gpsPreferred = points.map((p): TrackPoint => [
      p[0],
      p[1],
      p[2],
      100,
      9000,
    ])
    expect(computeMetrics(gpsPreferred).maxAltM).toBe(100)
  })
  it.each([1, 20])(
    "uses one altitude source when %s GPS fixes are missing",
    (missing) => {
      const points = flightPoints().map((p, i): TrackPoint => [
        p[0],
        p[1],
        p[2],
        i >= 40 && i < 40 + missing ? null : p[3],
        p[3]! + 5000,
      ])
      const metrics = computeMetrics(points)
      expect(metrics.maxAltM).toBe(missing === 1 ? 1060 : 6060)
      expect(metrics.maxClimbMps).toBeCloseTo(2, 5)
      expect(metrics.maxSinkMps).toBeCloseTo(1, 5)
    }
  )
  it("suppresses sub-two-metre altitude oscillations without losing a gradual climb", () => {
    const alts = [
      100, 100.8, 100, 101, 100.5, 100, 100.5, 101, 101.5, 102, 103, 104, 103.5,
      104, 102, 102.5, 102,
    ]
    const points = alts.map((alt, i): TrackPoint => [
      i * 1000,
      46 + (i * 10) / 111_195,
      6,
      alt,
      null,
    ])
    expect(computeMetrics(points).elevationGainM).toBe(4)
  })
  it("falls back to first/last fix when sustained flight cannot be found", () => {
    const points: TrackPoint[] = [
      [0, 46, 6, null, null],
      [2000, 46, 6, null, null],
    ]
    expect(computeMetrics(points)).toMatchObject({
      takeoffIndex: 0,
      landingIndex: 1,
      durationS: 2,
      distanceM: 0,
      maxAltM: null,
      avgAltM: null,
      elevationGainM: null,
      maxClimbMps: null,
      maxSinkMps: null,
    })
  })
  it("computes a short two-fix flight and preserves below-sea-level altitude", () => {
    const points: TrackPoint[] = [
      [0, 46, 6, -20, null],
      [2000, 46.0001, 6, -10, null],
    ]
    expect(computeMetrics(points)).toMatchObject({
      durationS: 2,
      maxAltM: -10,
      avgAltM: -15,
      elevationGainM: 10,
      maxClimbMps: 5,
    })
  })
  it.each<{ points: TrackPoint[]; message: RegExp }>([
    { points: [], message: /at least two/ },
    {
      points: [
        [1, 46, 6, null, null],
        [0, 46, 6, null, null],
      ],
      message: /increasing timestamps/,
    },
    {
      points: [
        [0, 100, 6, null, null],
        [1000, 46, 6, null, null],
      ],
      message: /valid coordinates/,
    },
  ])("rejects insufficient or invalid points", ({ points, message }) => {
    expect(() => computeMetrics(points)).toThrow(message)
  })
})
