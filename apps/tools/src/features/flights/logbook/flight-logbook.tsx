import { Link } from "@tanstack/react-router"
import { useState } from "react"
import { PageHeader } from "@/features/apps/shell"
import { listFlights } from "@/features/flights/api"
import {
  formatAltitude,
  formatDate,
  formatDistance,
  formatDuration,
} from "@/features/flights/format"
import {
  EmptyState,
  LoadState,
  useFlightResource,
} from "@/features/flights/layout/ui"
import { Badge } from "@/features/ui/badge"
import { buttonVariants } from "@/features/ui/button"
import { Label } from "@/features/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/features/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/features/ui/table"

export function FlightLogbook() {
  const { data, error, reload } = useFlightResource(listFlights)
  const [year, setYear] = useState("all")
  const flights = data?.flights ?? []
  const years = [
    ...new Set(
      flights.map((flight) =>
        new Date(flight.takeoffAt ?? flight.startedAt).getUTCFullYear()
      )
    ),
  ]
  const filtered = flights.filter(
    (flight) =>
      year === "all" ||
      String(
        new Date(flight.takeoffAt ?? flight.startedAt).getUTCFullYear()
      ) === year
  )
  return (
    <section>
      <PageHeader
        title="Logbook"
        description="Your time in the air, one flight at a time."
        actions={
          <Link to="/flights/import" className={buttonVariants()}>
            Import flights
          </Link>
        }
      />
      {!data ? (
        <LoadState error={error} reload={reload} label="flights" />
      ) : flights.length === 0 ? (
        <EmptyState
          title="Your logbook starts here"
          description="Import a GPX or IGC file to add your first flight."
        >
          <Link to="/flights/import" className={buttonVariants()}>
            Import your first flight
          </Link>
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Label htmlFor="flight-year">Year</Label>
            <Select
              value={year}
              onValueChange={(value) => setYear(String(value))}
              items={[
                { value: "all", label: "All years" },
                ...years.map((value) => ({
                  value: String(value),
                  label: String(value),
                })),
              ]}
            >
              <SelectTrigger id="flight-year" className="min-w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All years</SelectItem>
                {years.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <output className="ml-auto text-sm text-muted-foreground">
              {filtered.length} {filtered.length === 1 ? "flight" : "flights"}
            </output>
          </div>
          <div className="mt-4 hidden md:block">
            <Table className="text-xs">
              <caption className="sr-only">
                Flights, newest first. Durations in hours and minutes.
              </caption>
              <TableHeader>
                <TableRow>
                  {[
                    "Date",
                    "Takeoff site",
                    "Duration",
                    "Distance",
                    "Max alt.",
                    "Source",
                  ].map((label) => (
                    <TableHead key={label} className="px-1 py-3 h-auto">
                      {label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((flight) => (
                  <TableRow
                    key={flight.id}
                    className="relative focus-within:bg-muted/50"
                  >
                    <TableCell className="px-1 py-4">
                      <Link
                        className="font-medium underline-offset-4 after:absolute after:inset-0 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                        to="/flights/$flightId"
                        params={{ flightId: flight.id }}
                      >
                        {formatDate(flight.takeoffAt ?? flight.startedAt)}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-32 px-1 py-4 break-words whitespace-normal">
                      {flight.takeoffName || "Unnamed site"}
                    </TableCell>
                    <TableCell className="px-1 py-4 tabular-nums">
                      {formatDuration(flight.durationS)}
                    </TableCell>
                    <TableCell className="px-1 py-4 tabular-nums">
                      {formatDistance(flight.distanceM)}
                    </TableCell>
                    <TableCell className="px-1 py-4 tabular-nums">
                      {formatAltitude(flight.maxAltM)}
                    </TableCell>
                    <TableCell className="px-1 py-4">
                      <Badge variant="outline" className="uppercase">
                        {flight.source}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="mt-4 divide-y divide-border md:hidden">
            {filtered.map((flight) => (
              <li key={flight.id}>
                <Link
                  to="/flights/$flightId"
                  params={{ flightId: flight.id }}
                  className="block rounded-xl py-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium">
                      {formatDate(flight.takeoffAt ?? flight.startedAt)}
                    </span>
                    <Badge variant="outline" className="uppercase">
                      {flight.source}
                    </Badge>
                  </div>
                  <p className="mt-1 break-words text-sm text-muted-foreground">
                    {flight.takeoffName || "Unnamed site"}
                  </p>
                  <dl className="mt-4 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <dt className="text-muted-foreground">Duration</dt>
                      <dd className="mt-1 tabular-nums">
                        {formatDuration(flight.durationS)} h
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Distance</dt>
                      <dd className="mt-1 tabular-nums">
                        {formatDistance(flight.distanceM)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Max altitude</dt>
                      <dd className="mt-1 tabular-nums">
                        {formatAltitude(flight.maxAltM)}
                      </dd>
                    </div>
                  </dl>
                </Link>
              </li>
            ))}
          </ul>
          {filtered.length === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">
              No flights in this year.
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}
