import { Link } from "@tanstack/react-router"
import { useState } from "react"
import { PageHeader } from "@/features/apps/shell"
import { listFlights, prepareFlight } from "@/features/flights/api"
import {
  formatAltitude,
  formatDate,
  formatDistance,
  formatDuration,
  formatSpeed,
} from "@/features/flights/format"
import {
  EmptyState,
  LoadState,
  message,
  useFlightResource,
} from "@/features/flights/layout/ui"
import { Badge } from "@/features/ui/badge"
import { TrackPreview } from "./track-preview"
import { Button, buttonVariants } from "@/features/ui/button"
import { Label } from "@/features/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/features/ui/select"

export function FlightLogbook() {
  const { data, error, reload } = useFlightResource(listFlights)
  const [preparing, setPreparing] = useState(false)
  const [progress, setProgress] = useState("")
  const [failures, setFailures] = useState<
    { id: string; title: string; error: string }[]
  >([])
  async function prepareExisting() {
    const pending = (data?.flights ?? []).filter(
      (flight) => flight.needsPreparation
    )
    setPreparing(true)
    setFailures([])
    const failed: typeof failures = []
    for (const [index, flight] of pending.entries()) {
      setProgress(`Preparing ${index + 1} of ${pending.length}…`)
      try {
        const result = await prepareFlight(flight.id)
        if (result.status === "unavailable")
          failed.push({
            id: flight.id,
            title: flight.title,
            error: "Track unavailable",
          })
      } catch (cause) {
        failed.push({
          id: flight.id,
          title: flight.title,
          error: message(cause),
        })
      }
    }
    setFailures(failed)
    setProgress(
      `Finished ${pending.length} ${pending.length === 1 ? "flight" : "flights"}. ${failed.length} failed.`
    )
    setPreparing(false)
    reload()
  }
  const [year, setYear] = useState("all")
  const flights = data?.flights ?? []
  const years = [
    ...new Set(
      flights.map((flight) => new Date(flight.takeoffAt).getUTCFullYear())
    ),
  ]
  const filtered = flights.filter(
    (flight) =>
      year === "all" ||
      String(new Date(flight.takeoffAt).getUTCFullYear()) === year
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
          {flights.some((flight) => flight.needsPreparation) ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={preparing}
                onClick={() => void prepareExisting()}
              >
                {preparing
                  ? "Preparing…"
                  : failures.length
                    ? "Retry preparation"
                    : "Prepare existing flights"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Save profiles and track previews for older recordings.
              </p>
            </div>
          ) : null}
          <output
            aria-live="polite"
            className="mt-3 block text-sm text-muted-foreground"
          >
            {progress}
          </output>
          {failures.length ? (
            <ul
              className="mt-2 space-y-1 break-words text-sm text-destructive"
              aria-label="Preparation failures"
            >
              {failures.map((failure) => (
                <li key={failure.id}>
                  {failure.title}: {failure.error}
                </li>
              ))}
            </ul>
          ) : null}
          <ul className="mt-4 space-y-3" aria-label="Flights, newest first">
            {filtered.map((flight) => (
              <li key={flight.id}>
                <Link
                  to="/flights/$flightId"
                  params={{ flightId: flight.id }}
                  preload={false}
                  className="flex gap-4 rounded-xl border border-border p-4 hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:items-center sm:gap-5"
                >
                  <TrackPreview
                    preview={flight.preview}
                    needsPreparation={flight.needsPreparation}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h2 className="break-words text-sm font-medium">
                          {flight.title}
                        </h2>
                        <p className="mt-1 break-words text-xs text-muted-foreground">
                          {formatDate(flight.takeoffAt)}
                          {flight.takeoffName ? ` · ${flight.takeoffName}` : ""}
                        </p>
                      </div>
                      <Badge variant="outline" className="uppercase">
                        {flight.source}
                      </Badge>
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 text-xs sm:grid-cols-4">
                      {[
                        ["Duration (h:mm)", formatDuration(flight.durationS)],
                        ["Distance", formatDistance(flight.distanceM)],
                        ["Max altitude", formatAltitude(flight.maxAltM)],
                        ["Max speed", formatSpeed(flight.maxSpeedMps)],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <dt className="text-muted-foreground">{label}</dt>
                          <dd className="mt-1 font-medium tabular-nums">
                            {value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
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
