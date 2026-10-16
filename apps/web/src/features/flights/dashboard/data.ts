import type { Dashboard } from "../api"
import {
  formatAltitude,
  formatDistance,
  formatDuration,
  formatSpeed,
  formatVario,
} from "../format"

type Activity = Dashboard["perMonth"][number]
export type ChartPeriod = Activity & { readonly label: string }

const emptyPeriod = (period: string): Activity => ({
  period,
  flights: 0,
  seconds: 0,
  hours: 0,
  distanceM: 0,
})

/** Calendar dates are UTC, including when the browser is across a year boundary. */
export function shapeActivity(
  data: Pick<Dashboard, "perMonth" | "perYear">,
  now: number
) {
  const date = new Date(now)
  const year = date.getUTCFullYear()
  const monthly: ChartPeriod[] = Array.from({ length: 12 }, (_, index) => {
    const month = new Date(Date.UTC(year, date.getUTCMonth() - 11 + index, 1))
    const period = month.toISOString().slice(0, 7)
    return {
      ...(data.perMonth.find((row) => row.period === period) ??
        emptyPeriod(period)),
      label: new Intl.DateTimeFormat("en-GB", {
        month: "short",
        year: "2-digit",
        timeZone: "UTC",
      }).format(month),
    }
  })
  const years = data.perYear.map((row) => Number(row.period))
  const first = Math.min(year, ...years)
  const last = Math.max(year, ...years)
  const yearly: ChartPeriod[] = Array.from(
    { length: last - first + 1 },
    (_, index) => {
      const period = String(first + index)
      return {
        ...(data.perYear.find((row) => row.period === period) ??
          emptyPeriod(period)),
        label: period,
      }
    }
  )
  return {
    monthly,
    yearly,
    currentYearHours:
      data.perYear.find((row) => row.period === String(year))?.hours ?? 0,
    year,
  }
}

const definitions = [
  { metric: "duration", label: "Longest flight", format: formatDuration },
  { metric: "distance", label: "Longest distance", format: formatDistance },
  { metric: "altitude", label: "Highest altitude", format: formatAltitude },
  { metric: "speed", label: "Maximum speed", format: formatSpeed },
  { metric: "climb", label: "Maximum climb", format: formatVario },
  { metric: "gain", label: "Elevation gain", format: formatAltitude },
] as const

export function shapeRecords(records: Dashboard["records"]) {
  return definitions.flatMap((definition) => {
    const record = records.find((row) => row.metric === definition.metric)
    return record && record.value != null && Number.isFinite(record.value)
      ? [
          {
            ...record,
            label: definition.label,
            formattedValue: definition.format(record.value),
          },
        ]
      : []
  })
}

export const formatNumber = (value: number) =>
  value.toLocaleString("en-GB", { maximumFractionDigits: 2 })
