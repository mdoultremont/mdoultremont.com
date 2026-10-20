import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { computeMetrics } from "./metrics.ts"
import { buildProfile } from "./profile.ts"
import { parseTrackFile } from "./parse.ts"
import { prepareFlight, measuredColumns } from "./prepare.ts"
import { buildPreview } from "./preview.ts"
import type { TrackPoint } from "./types.ts"

const track = (name: string) =>
  parseTrackFile(
    name,
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")
  ).points

describe("saved flight preparation", () => {
  it.each(["flight.gpx", "spike.gpx"])(
    "preserves measurements, profile and original airborne indices for %s",
    (name) => {
      const points = track(name)
      const raw = JSON.stringify(points)
      const metrics = computeMetrics(points)
      const baseline = { metrics, profile: buildProfile(points, metrics) }
      const prepared = prepareFlight(points)
      expect(prepared.metrics).toEqual(baseline.metrics)
      expect(prepared.analysis!.profile).toEqual(baseline.profile)
      expect(
        prepared.preview.every((p) =>
          baseline.profile.some((sample) => sample.i === p.i)
        )
      ).toBe(true)
      expect(prepared.preview[0]!.i).toBe(baseline.metrics.takeoffIndex)
      expect(prepared.preview.at(-1)!.i).toBe(baseline.metrics.landingIndex)
      expect(measuredColumns(prepared.metrics!).takeoffAt).toBe(
        points[prepared.analysis!.takeoffIndex]![0]
      )
      expect(JSON.stringify(points)).toBe(raw)
      expect(prepared.preview.some((p) => p.i === 45)).toBe(
        name !== "spike.gpx"
      )
    }
  )
  it("centers a single recorded position and empty tracks have no invented measurements", () => {
    expect(prepareFlight([])).toEqual({
      metrics: null,
      analysis: null,
      preview: [],
    })
    expect(prepareFlight([[1000, 90, 180, null, null]])).toMatchObject({
      metrics: { durationS: 0, distanceM: 0, maxAltM: null },
      analysis: null,
      preview: [{ i: 0, x: 50, y: 50 }],
    })
  })
  it("bounds numeric geometry, preserves endpoints and is deterministic for long tracks", () => {
    const points = Array.from({ length: 10000 }, (_, i): TrackPoint => [
      i * 1000,
      46 + i / 1e6,
      6 + Math.sin(i) / 1e5,
      1000,
      null,
    ])
    const p = prepareFlight(points).preview
    expect(p).toHaveLength(120)
    expect(p[0]!.i).toBe(0)
    expect(p.at(-1)!.i).toBe(9999)
    expect(p).toEqual(prepareFlight(points).preview)
    for (const v of p) {
      expect(v.x).toBeGreaterThanOrEqual(4)
      expect(v.x).toBeLessThanOrEqual(96)
      expect(v.y).toBeGreaterThanOrEqual(4)
      expect(v.y).toBeLessThanOrEqual(96)
      expect(Number.isFinite(v.x) && Number.isFinite(v.y)).toBe(true)
    }
  })
  it("unwraps antimeridian tracks and keeps polar and degenerate tracks finite", () => {
    const points: TrackPoint[] = [
      [0, 0, 179.9, null, null],
      [1000, 0.1, -179.9, null, null],
      [2000, 0.2, -179.8, null, null],
    ]
    const p = buildPreview(points, [0, 1, 2])
    expect(p[0]!.x).toBeLessThan(p[1]!.x)
    expect(p[1]!.x).toBeLessThan(p[2]!.x)
    expect(p[0]!.y).toBeGreaterThan(p[2]!.y)
    for (const lat of [-90, 90, 46]) {
      const same: TrackPoint[] = [
        [0, lat, 1, null, null],
        [1000, lat, 1, null, null],
      ]
      expect(buildPreview(same, [0, 1])).toEqual([
        { i: 0, x: 50, y: 50 },
        { i: 1, x: 50, y: 50 },
      ])
    }
  })
})
