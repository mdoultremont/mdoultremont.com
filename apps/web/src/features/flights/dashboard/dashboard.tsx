import { Link } from "@tanstack/react-router"
import type { Dashboard as DashboardData } from "../api"
import { formatDate, formatDistance, formatDuration } from "../format"
import { buttonVariants } from "@/features/ui/button"
import { Card } from "@/features/ui/card"
import { ActivityChart } from "./activity-chart"
import { formatNumber, shapeActivity, shapeRecords } from "./data"

const cardLink =
  "block min-w-0 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"

export function Dashboard({
  data,
  now,
}: {
  readonly data: DashboardData
  readonly now: number
}) {
  const activity = shapeActivity(data, now)
  const records = shapeRecords(data.records)
  return (
    <div className="dark-surface space-y-8 text-foreground dark:-mx-3 dark:rounded-2xl dark:p-3">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Flight dashboard
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your time in the air, at a glance.
          </p>
        </div>
        {data.totals.flights > 0 ? (
          <Link
            to="/apps/flights/import"
            className={buttonVariants({ variant: "outline" })}
          >
            Import flights
          </Link>
        ) : null}
      </div>
      {data.totals.flights === 0 ? (
        <section>
          <Card className="items-center border border-dashed border-border bg-transparent px-5 py-16 text-center ring-0">
            <h2 className="text-xl font-semibold">Your logbook starts here</h2>
            <p className="mx-auto max-w-md text-sm leading-6 text-muted-foreground">
              Import a GPX or IGC track to see your flight time, personal
              records, and flying history.
            </p>
            <Link
              to="/apps/flights/import"
              className={buttonVariants({
                variant: "outline",
                className: "mt-2",
              })}
            >
              Import your first flight
            </Link>
          </Card>
        </section>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              {
                label: "Total flights",
                value: formatNumber(data.totals.flights),
              },
              {
                label: "Hours flown",
                value: `${formatNumber(data.totals.hours)} h`,
              },
              {
                label: "Distance flown",
                value: formatDistance(data.totals.distanceM),
              },
              {
                label: "Hours this year",
                value: `${formatNumber(activity.currentYearHours)} h`,
              },
            ].map((item) => (
              <Card key={item.label} className="min-w-0 gap-3 px-4 sm:px-5">
                <dt className="text-sm text-muted-foreground">{item.label}</dt>
                <dd className="break-words text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
                  {item.value}
                </dd>
              </Card>
            ))}
          </dl>
          <ActivityChart monthly={activity.monthly} yearly={activity.yearly} />
          {records.length > 0 ? (
            <section aria-labelledby="records-heading">
              <h2 id="records-heading" className="text-lg font-semibold">
                Personal records
              </h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {records.map((record) => (
                  <Link
                    key={record.metric}
                    to="/apps/flights/$flightId"
                    params={{ flightId: record.flightId }}
                    className={cardLink}
                  >
                    <Card className="h-full gap-0 px-5 transition-colors hover:bg-muted">
                      <h3 className="text-sm text-muted-foreground">
                        {record.label}
                      </h3>
                      <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">
                        {record.formattedValue}
                      </p>
                      <p className="mt-3 break-words text-sm">
                        {record.takeoffName || "Unnamed takeoff"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDate(record.date)}
                      </p>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
          <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <section aria-labelledby="recent-heading" className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 id="recent-heading" className="text-lg font-semibold">
                  Recent flights
                </h2>
                <Link
                  to="/apps/flights/logbook"
                  className="rounded text-sm underline underline-offset-4 hover:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  View logbook
                </Link>
              </div>
              <Card className="mt-4 gap-0 py-0">
                <ul className="divide-y divide-border">
                  {data.recentFlights.map((flight) => (
                    <li key={flight.id}>
                      <Link
                        to="/apps/flights/$flightId"
                        params={{ flightId: flight.id }}
                        className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 px-5 py-4 outline-none hover:bg-muted focus-visible:bg-muted"
                      >
                        <div className="min-w-0 flex-1 basis-36">
                          <p className="break-words text-sm font-medium">
                            {flight.takeoffName || "Unnamed takeoff"}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatDate(flight.date)}
                          </p>
                        </div>
                        <div className="flex gap-4 text-sm tabular-nums">
                          <span>
                            <span className="sr-only">
                              Duration (hours:minutes):{" "}
                            </span>
                            {formatDuration(flight.durationS)}
                          </span>
                          <span className="text-muted-foreground">
                            <span className="sr-only">Distance: </span>
                            {formatDistance(flight.distanceM)}
                          </span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
            <section aria-labelledby="sites-heading" className="min-w-0">
              <h2 id="sites-heading" className="text-lg font-semibold">
                Top sites
              </h2>
              {data.topSites.length === 0 ? (
                <p className="mt-4 text-sm leading-6 text-muted-foreground">
                  Name a takeoff in your logbook to see your most flown sites
                  here.
                </p>
              ) : (
                <Card className="mt-4 gap-0 py-0">
                  <ol className="divide-y divide-border">
                    {data.topSites.map((site) => (
                      <li
                        key={site.name}
                        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4"
                      >
                        <p className="min-w-0 flex-1 basis-32 break-words text-sm font-medium">
                          {site.name}
                        </p>
                        <p className="text-sm tabular-nums">
                          <span>
                            {site.flights}{" "}
                            {site.flights === 1 ? "flight" : "flights"}
                          </span>
                          <span className="ml-3 text-muted-foreground">
                            {formatNumber(site.hours)} h
                          </span>
                        </p>
                      </li>
                    ))}
                  </ol>
                </Card>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
