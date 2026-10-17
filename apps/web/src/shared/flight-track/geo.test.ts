import { expect, it } from "vitest"
import { haversineDistance } from "./geo.ts"

it("measures Paris–London within 0.5 percent of 343.5 km", () => {
  expect(
    Math.abs(haversineDistance(48.8566, 2.3522, 51.5074, -0.1278) - 343_500)
  ).toBeLessThan(343_500 * 0.005)
})
it("handles identical fixes, symmetry, dateline crossing, and antipodes", () => {
  expect(haversineDistance(46, 6, 46, 6)).toBe(0)
  expect(haversineDistance(46, 6, 47, 7)).toBeCloseTo(
    haversineDistance(47, 7, 46, 6),
    8
  )
  expect(haversineDistance(0, 179.9, 0, -179.9)).toBeCloseTo(22_239, -1)
  expect(haversineDistance(0, 0, 0, 180)).toBeCloseTo(20_015_114, -1)
})
