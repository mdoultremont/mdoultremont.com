import { describe, expect, it } from "vitest"
import { downsampleLttb } from "./downsample"

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
