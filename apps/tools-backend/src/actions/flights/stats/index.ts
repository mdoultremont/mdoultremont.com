import { Clock, Context, Effect, Layer } from "effect"
import { Flights, type Flight } from "#backend/actions/flights/flights"

export interface ActivityPeriod {
  readonly period: string
  readonly flights: number
  readonly seconds: number
  readonly hours: number
  readonly distanceM: number
}
export interface DashboardRecord {
  readonly metric:
    | "duration"
    | "distance"
    | "altitude"
    | "speed"
    | "climb"
    | "gain"
  readonly value: number
  readonly flightId: string
  readonly date: number
  readonly takeoffName: string | null
}
export interface Dashboard {
  readonly totals: {
    readonly flights: number
    readonly hours: number
    readonly distanceM: number
  }
  readonly perMonth: readonly ActivityPeriod[]
  readonly perYear: readonly ActivityPeriod[]
  readonly records: readonly DashboardRecord[]
  readonly recentFlights: readonly {
    readonly id: string
    readonly date: number
    readonly takeoffName: string | null
    readonly durationS: number
    readonly distanceM: number
  }[]
  readonly topSites: readonly {
    readonly name: string
    readonly flights: number
    readonly hours: number
  }[]
}

const sorted = <A>(
  values: readonly A[],
  compare: (a: A, b: A) => number
): A[] =>
  // oxlint-disable-next-line unicorn/no-array-sort -- ES2022: sort a new copy, never the caller's array
  [...values].sort(compare)

const add = (period: ActivityPeriod, flight: Flight): ActivityPeriod => ({
  ...period,
  flights: period.flights + 1,
  seconds: period.seconds + flight.durationS,
  hours: period.hours + flight.durationS / 3600,
  distanceM: period.distanceM + flight.distanceM,
})

/** UTC calendar buckets. Empty months are included in the last twelve months. */
export function shapeDashboard(
  rows: readonly Flight[],
  now: number
): Dashboard {
  const date = new Date(now)
  const perMonth: ActivityPeriod[] = Array.from({ length: 12 }, (_, index) => ({
    period: new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 11 + index, 1)
    )
      .toISOString()
      .slice(0, 7),
    flights: 0,
    seconds: 0,
    hours: 0,
    distanceM: 0,
  }))
  const years = new Map<string, ActivityPeriod>()
  const sites = new Map<
    string,
    { name: string; flights: number; hours: number }
  >()
  for (const flight of rows) {
    const month = new Date(flight.takeoffAt).toISOString().slice(0, 7)
    const index = perMonth.findIndex((p) => p.period === month)
    if (index !== -1) perMonth[index] = add(perMonth[index]!, flight)
    const year = month.slice(0, 4)
    years.set(
      year,
      add(
        years.get(year) ?? {
          period: year,
          flights: 0,
          seconds: 0,
          hours: 0,
          distanceM: 0,
        },
        flight
      )
    )
    if (flight.takeoffName) {
      const site = sites.get(flight.takeoffName) ?? {
        name: flight.takeoffName,
        flights: 0,
        hours: 0,
      }
      sites.set(site.name, {
        ...site,
        flights: site.flights + 1,
        hours: site.hours + flight.durationS / 3600,
      })
    }
  }
  const definitions = [
    ["duration", "durationS"],
    ["distance", "distanceM"],
    ["altitude", "maxAltM"],
    ["speed", "maxSpeedMps"],
    ["climb", "maxClimbMps"],
    ["gain", "elevationGainM"],
  ] as const
  const records: DashboardRecord[] = []
  for (const [metric, key] of definitions) {
    const best = sorted(
      rows.filter((flight) => flight[key] !== null),
      (a, b) =>
        b[key]! - a[key]! ||
        b.takeoffAt - a.takeoffAt ||
        a.id.localeCompare(b.id)
    )[0]
    if (best)
      records.push({
        metric,
        value: best[key]!,
        flightId: best.id,
        date: best.takeoffAt,
        takeoffName: best.takeoffName,
      })
  }
  return {
    totals: {
      flights: rows.length,
      hours: rows.reduce((sum, f) => sum + f.durationS / 3600, 0),
      distanceM: rows.reduce((sum, f) => sum + f.distanceM, 0),
    },
    perMonth,
    perYear: sorted([...years.values()], (a, b) =>
      a.period.localeCompare(b.period)
    ),
    records,
    recentFlights: sorted(
      rows,
      (a, b) => b.takeoffAt - a.takeoffAt || b.id.localeCompare(a.id)
    )
      .slice(0, 5)
      .map((f) => ({
        id: f.id,
        date: f.takeoffAt,
        takeoffName: f.takeoffName,
        durationS: f.durationS,
        distanceM: f.distanceM,
      })),
    topSites: sorted(
      [...sites.values()],
      (a, b) => b.flights - a.flights || a.name.localeCompare(b.name)
    ).slice(0, 10),
  }
}
const makeStats = Effect.gen(function* () {
  const flights = yield* Flights
  const dashboard = Effect.fn("FlightStats.dashboard")(function* (
    userId: string
  ) {
    return shapeDashboard(
      yield* flights.list(userId),
      yield* Clock.currentTimeMillis
    )
  })
  return { dashboard }
})
export class FlightStats extends Context.Service<
  FlightStats,
  Effect.Success<typeof makeStats>
>()("server/actions/flights/FlightStats") {
  static readonly layerNoDeps = Layer.effect(FlightStats, makeStats)
  static readonly layer = FlightStats.layerNoDeps.pipe(
    Layer.provide(Flights.layer)
  )
}
