import { describe, expect, it } from "vitest"
import type { Dashboard } from "../api"
import { shapeActivity, shapeRecords } from "./data"

const period = (key: string, flights = 1, hours = 2) => ({
  period: key,
  flights,
  hours,
  seconds: hours * 3600,
  distanceM: 1000,
})

describe("dashboard activity", () => {
  it("fills twelve UTC months across the year boundary without including older data", () => {
    const result = shapeActivity(
      {
        perMonth: [period("2025-01"), period("2025-12", 3, 4)],
        perYear: [period("2025", 4, 6)],
      },
      Date.parse("2026-01-01T00:15:00Z")
    )
    expect(result.monthly).toHaveLength(12)
    expect(result.monthly[0]).toMatchObject({
      period: "2025-02",
      flights: 0,
      hours: 0,
      label: "Feb 25",
    })
    expect(result.monthly[10]).toMatchObject({
      period: "2025-12",
      flights: 3,
      hours: 4,
    })
    expect(result.monthly[11]).toMatchObject({ period: "2026-01", flights: 0 })
    expect(result.currentYearHours).toBe(0)
    expect(result.year).toBe(2026)
  })
  it("uses the full yearly aggregate rather than the twelve-month subset", () => {
    const input = {
      perMonth: [period("2026-10", 1, 1)],
      perYear: [period("2023", 1, 2), period("2026", 3, 9)],
    }
    const original = JSON.stringify(input)
    const result = shapeActivity(input, Date.parse("2026-10-16T12:00:00Z"))
    expect(result.currentYearHours).toBe(9)
    expect(result.yearly.map((row) => [row.period, row.hours])).toEqual([
      ["2023", 2],
      ["2024", 0],
      ["2025", 0],
      ["2026", 9],
    ])
    expect(JSON.stringify(input)).toBe(original)
  })
  it("handles a logbook without aggregates", () => {
    const result = shapeActivity(
      { perMonth: [], perYear: [] },
      Date.UTC(2026, 9, 16)
    )
    expect(
      result.monthly.every((row) => row.hours === 0 && row.flights === 0)
    ).toBe(true)
    expect(result.yearly).toEqual([
      {
        period: "2026",
        label: "2026",
        flights: 0,
        hours: 0,
        seconds: 0,
        distanceM: 0,
      },
    ])
  })
})

describe("personal record presentation", () => {
  it("orders and formats all six metrics in the API's units", () => {
    const records: Dashboard["records"] = (
      [
        ["gain", 1250],
        ["climb", 2.5],
        ["speed", 10],
        ["altitude", 2400],
        ["distance", 12300],
        ["duration", 5400],
      ] as const
    ).map(([metric, value]) => ({
      metric,
      value,
      flightId: "flight-1",
      date: 0,
      takeoffName: null,
    }))
    const result = shapeRecords(records)
    expect(result.map((record) => record.formattedValue)).toEqual([
      "1:30",
      "12.3 km",
      "2,400 m",
      "36.0 km/h",
      "+2.5 m/s",
      "1,250 m",
    ])
    expect(result.every((record) => record.flightId === "flight-1")).toBe(true)
  })
  it("omits unavailable records while preserving measured zero", () => {
    const base = { flightId: "flight-2", date: 0, takeoffName: null }
    const records = [
      { ...base, metric: "gain", value: 0 },
      { ...base, metric: "altitude", value: null },
      { ...base, metric: "speed", value: Number.NaN },
    ] as unknown as Dashboard["records"]
    expect(shapeRecords(records)).toMatchObject([
      { metric: "gain", formattedValue: "0 m" },
    ])
    expect(shapeRecords([])).toEqual([])
  })
})
