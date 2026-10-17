import { describe, expect, it } from "vitest"
import {
  formatDuration,
  formatDistance,
  formatAltitude,
  formatSpeed,
  formatVario,
  formatDate,
  formatDateTime,
} from "./format"
describe("flight formatting", () => {
  it("formats elapsed time without wrapping after 24 hours", () => {
    expect(formatDuration(0)).toBe("0:00")
    expect(formatDuration(7199)).toBe("1:59")
    expect(formatDuration(90000)).toBe("25:00")
  })
  it("converts and rounds metric units", () => {
    expect(formatDistance(12345)).toBe("12.3 km")
    expect(formatAltitude(1234.7)).toBe("1,235 m")
    expect(formatSpeed(10)).toBe("36.0 km/h")
    expect(formatVario(2.34)).toBe("+2.3 m/s")
    expect(formatVario(-1.2)).toBe("-1.2 m/s")
  })
  it("uses UTC consistently for dates", () => {
    const date = "2026-01-01T23:30:00-02:00"
    expect(formatDate(date)).toBe("2 Jan 2026")
    expect(formatDateTime(date)).toBe("2 Jan 2026, 01:30 UTC")
  })
  it("shows missing values clearly", () => {
    for (const format of [
      formatDuration,
      formatDistance,
      formatAltitude,
      formatSpeed,
      formatVario,
    ]) {
      expect(format(null)).toBe("—")
      expect(format(Number.NaN)).toBe("—")
    }
    expect(formatDate("bad")).toBe("—")
    expect(formatDateTime(null)).toBe("—")
  })
})
