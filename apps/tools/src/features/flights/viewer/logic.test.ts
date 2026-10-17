import { describe, expect, it } from "vitest"
import type { TrackPoint } from "@/shared/flight-track"
import {
  buildViewerSeries,
  nearestPointIndex,
  nearestProfilePoint,
} from "./logic"

const track: TrackPoint[] = Array.from({ length: 1500 }, (_, i) => [
  Date.UTC(2026, 0, 1) + i * 1000,
  46 + i * 0.00005,
  7,
  900 + Math.sin(i / 20) * 100,
  null,
])
describe("flight viewer synchronization", () => {
  it("bounds chart size and preserves full-track indices and endpoints", () => {
    const series = buildViewerSeries(track)
    expect(series.altitude).toHaveLength(800)
    expect(series.speed).toHaveLength(800)
    expect(series.vario).toHaveLength(800)
    expect(series.vario.at(-1)).toEqual(series.profile.at(-1))
    expect(series.altitude[0]).toEqual(series.profile[0])
    expect(series.altitude.at(-1)).toEqual(series.profile.at(-1))
    for (const sample of series.speed)
      expect(track[sample.i]![0]).toBe(Date.UTC(2026, 0, 1) + sample.i * 1000)
  })
  it("preserves missing observations without mixing altitude sensors", () => {
    const points: TrackPoint[] = track
      .slice(0, 100)
      .map((point, i) => [
        point[0],
        point[1],
        point[2],
        i === 50 ? null : point[3],
        5000,
      ])
    const series = buildViewerSeries(points)
    expect(series.profile.find((point) => point.i === 50)?.altM).toBeNull()
    expect(series.profile.find((point) => point.i === 51)?.altM).toBeLessThan(
      1100
    )
  })
  it("handles missing tracks without computing invalid metrics", () => {
    expect(buildViewerSeries([]).metrics).toBeNull()
    expect(buildViewerSeries([track[0]!]).profile).toEqual([])
  })
  it("looks up the closest full-resolution time and clamps at endpoints", () => {
    const { profile } = buildViewerSeries(track)
    expect(nearestProfilePoint(profile, 12.7)?.tS).toBe(13)
    expect(nearestProfilePoint(profile, -100)).toEqual(profile[0])
    expect(nearestProfilePoint(profile, 99999)).toEqual(profile.at(-1))
    expect(nearestProfilePoint([], 0)).toBeUndefined()
  })
  it("finds the closest projected fix, retaining original index", () => {
    const points: TrackPoint[] = [
      [0, 10, 20, null, null],
      [1000, 30, 40, null, null],
      [2000, 50, 60, null, null],
    ]
    expect(
      nearestPointIndex(points, { x: 41, y: 29 }, ([x, y]) => ({ x, y }))
    ).toBe(1)
    expect(
      nearestPointIndex([], { x: 0, y: 0 }, ([x, y]) => ({ x, y }))
    ).toBeNull()
  })
})
