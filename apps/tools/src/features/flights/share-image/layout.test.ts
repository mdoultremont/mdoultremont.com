import { describe, expect, it } from "vitest"
import { fitText, projectTrack, shareStats } from "./layout"
import type { FlightDetail } from "@/features/flights/api"

describe("share image layout", () => {
  it("selects the five public stats and handles missing data", () => {
    const stats = shareStats({
      durationS: 3600,
      distanceM: 12345,
      maxAltM: null,
      maxSpeedMps: 10,
      elevationGainM: 200,
    } as FlightDetail["flight"])
    expect(stats.map((s) => s.label)).toEqual([
      "AIR TIME",
      "DISTANCE",
      "MAX ALTITUDE",
      "MAX SPEED",
      "ELEVATION GAIN",
    ])
    expect(stats[0]!.value).toBe("1:00")
    expect(stats[2]!.value).toBe("—")
    expect(stats[3]!.value).toContain("36.0")
  })
  it("fits long names without splitting surrogate pairs", () => {
    const fit = fitText(
      "🪂".repeat(50),
      100,
      40,
      20,
      (s, size) => Array.from(s).length * size
    )
    expect(fit.size).toBe(20)
    expect(Array.from(fit.text).length * fit.size).toBeLessThanOrEqual(100)
    expect(fit.text.endsWith("…")).toBe(true)
    expect(fitText("Annecy", 500, 60, 26, (s, n) => s.length * n)).toEqual({
      text: "Annecy",
      size: 60,
    })
  })
  it("centers stationary tracks and accepts empty tracks", () => {
    expect(projectTrack([], 1080, 800)).toEqual([])
    expect(projectTrack([[0, 45, 6, null, null]], 1080, 800)).toEqual([
      { x: 540, y: 400 },
    ])
  })
  it("keeps polar and dateline tracks finite and inside padding", () => {
    const projected = projectTrack(
      [
        [0, 90, 179.9, 0, null],
        [1000, 89, -179.9, 0, null],
        [2000, 88, -179.8, 0, null],
      ],
      1080,
      800,
      80
    )
    for (const p of projected) {
      expect(p.x).toBeGreaterThanOrEqual(79.999)
      expect(p.x).toBeLessThanOrEqual(1000.001)
      expect(p.y).toBeGreaterThanOrEqual(79.999)
      expect(p.y).toBeLessThanOrEqual(720.001)
    }
    expect(projected[1]!.x).toBeGreaterThan(projected[0]!.x)
  })
})
