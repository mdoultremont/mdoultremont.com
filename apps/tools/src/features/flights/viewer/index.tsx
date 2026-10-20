import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "@tanstack/react-router"
import type { Map as MapLibreMap } from "maplibre-gl"
import {
  formatAltitude,
  formatDate,
  formatDateTime,
  formatDistance,
  formatDuration,
  formatSpeed,
  formatVario,
} from "@/features/flights/format"
import {
  prepareFlight,
  getFlight,
  type FlightDetail,
} from "@/features/flights/api"
import { PageHeader } from "@/features/apps/shell"
import { Button, buttonVariants } from "@/features/ui/button"
import { Card } from "@/features/ui/card"
import { ShareImage } from "../share-image"
// oxlint-disable-next-line import/no-unassigned-import
import "./viewer.css"
import { OriginalDownload } from "./original-download"
import { FlightMap } from "./flight-map"
import { FlightProfiles } from "./profiles"
import {
  buildViewerSeries,
  nearestProfilePoint,
  formatProfileTime,
} from "./logic"

export interface FlightViewerProps {
  detail: FlightDetail
  /** Forwarded to FlightMap; ready map uses preserveDrawingBuffer for share-image capture. */
  onMapReady?: (map: MapLibreMap | null) => void
}
const valueOrDash = (
  value: number | null,
  format: (value: number) => string
) => (value === null ? "—" : format(value))

export function FlightViewer({
  detail: initialDetail,
  onMapReady,
}: FlightViewerProps) {
  const [detail, setDetail] = useState(initialDetail)
  useEffect(() => setDetail(initialDetail), [initialDetail])
  const [preparing, setPreparing] = useState(false)
  const [preparationError, setPreparationError] = useState("")
  async function prepare() {
    setPreparing(true)
    setPreparationError("")
    try {
      const result = await prepareFlight(detail.flight.id)
      if (result.status === "unavailable")
        setPreparationError(
          "The recording is unavailable. Try again from the logbook."
        )
      else setDetail(await getFlight(detail.flight.id))
    } catch (cause) {
      setPreparationError(
        cause instanceof Error
          ? cause.message
          : "Could not prepare this flight. Try again."
      )
    } finally {
      setPreparing(false)
    }
  }
  const { flight, points, equipment, files, analysis } = detail
  const [map, setMap] = useState<MapLibreMap | null>(null)
  const mapReady = useCallback(
    (value: MapLibreMap | null) => {
      setMap(value)
      onMapReady?.(value)
    },
    [onMapReady]
  )
  const series = useMemo(() => buildViewerSeries(analysis), [analysis])
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const frame = useRef(0)
  const pending = useRef<number | null>(null)
  const selectIndex = useCallback((index: number) => {
    pending.current = index
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      setActiveIndex(pending.current)
    })
  }, [])
  useEffect(() => () => cancelAnimationFrame(frame.current), [])
  const selectTime = useCallback(
    (seconds: number) => {
      const sample = nearestProfilePoint(series.profile, seconds)
      if (sample) selectIndex(sample.i)
    },
    [series.profile, selectIndex]
  )
  const selectedPoint = activeIndex === null ? undefined : points[activeIndex]
  const selectedSeconds =
    selectedPoint && analysis
      ? (selectedPoint[0] - analysis.takeoffAt) / 1000
      : null
  const active =
    selectedSeconds === null
      ? series.profile[0]
      : nearestProfilePoint(series.profile, selectedSeconds)
  const stats = [
    ["Duration", valueOrDash(flight.durationS, formatDuration)],
    ["Distance", valueOrDash(flight.distanceM, formatDistance)],
    ["Maximum altitude", valueOrDash(flight.maxAltM, formatAltitude)],
    ["Average altitude", valueOrDash(flight.avgAltM, formatAltitude)],
    ["Maximum speed", valueOrDash(flight.maxSpeedMps, formatSpeed)],
    ["Elevation gain", valueOrDash(flight.elevationGainM, formatAltitude)],
    ["Maximum climb", valueOrDash(flight.maxClimbMps, formatVario)],
    [
      "Maximum sink",
      flight.maxSinkMps === null ? "—" : formatVario(-flight.maxSinkMps),
    ],
  ]
  return (
    <article className="flight-viewer @container text-foreground">
      <Link
        to="/flights/logbook"
        className="mb-3 inline-block text-sm text-muted-foreground hover:text-foreground"
      >
        ← All flights
      </Link>
      <PageHeader
        title={<span className="break-words">{flight.title}</span>}
        description={
          <>
            {formatDate(flight.takeoffAt ?? flight.startedAt)}
            {flight.landingName ? ` · To ${flight.landingName}` : ""}
          </>
        }
        actions={
          <>
            <Link
              className={buttonVariants({ variant: "outline" })}
              to="/flights/$flightId/edit"
              params={{ flightId: flight.id }}
            >
              Edit
            </Link>
            <ShareImage detail={detail} map={map} />
          </>
        }
      />
      <div className="grid items-start gap-7 @min-[900px]:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 space-y-6">
          {points.length ? (
            <FlightMap
              points={points}
              activeIndex={activeIndex}
              takeoffIndex={analysis?.takeoffIndex ?? 0}
              landingIndex={analysis?.landingIndex ?? points.length - 1}
              onActiveIndex={selectIndex}
              onMapReady={mapReady}
            />
          ) : null}
          {points.length >= 2 && analysis ? (
            <>
              <section aria-label="Selected track point">
                <Card className="px-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h2 className="text-sm font-semibold">Track explorer</h2>
                    <p className="text-xs text-muted-foreground">
                      Hover the track or a profile
                    </p>
                  </div>
                  <dl className="grid grid-cols-2 gap-4 text-sm tabular-nums @min-[520px]:grid-cols-5">
                    {[
                      [
                        "Elapsed",
                        active
                          ? formatProfileTime(
                              Math.max(0, selectedSeconds ?? active.tS)
                            )
                          : "—",
                      ],
                      [
                        "Altitude",
                        active ? valueOrDash(active.altM, formatAltitude) : "—",
                      ],
                      [
                        "Speed",
                        active ? formatSpeed(active.speedKmh / 3.6) : "—",
                      ],
                      ["Vario", active ? formatVario(active.varioMps) : "—"],
                      [
                        "Distance",
                        active ? formatDistance(active.distKm * 1000) : "—",
                      ],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-xs text-muted-foreground">
                          {label}
                        </dt>
                        <dd className="mt-1 font-medium">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <label
                    className="mt-5 block text-xs text-muted-foreground"
                    htmlFor="track-position"
                  >
                    Track position{" "}
                    <span className="sr-only">
                      Use arrow keys to explore the flight
                    </span>
                  </label>
                  <input
                    id="track-position"
                    aria-label="Track position"
                    className="mt-2 w-full accent-primary"
                    type="range"
                    min={0}
                    max={points.length - 1}
                    value={activeIndex ?? analysis.takeoffIndex}
                    onChange={(event) =>
                      selectIndex(Number(event.target.value))
                    }
                  />
                </Card>
              </section>
              <FlightProfiles
                altitude={series.altitude}
                speed={series.speed}
                vario={series.vario}
                activeSeconds={selectedSeconds}
                onTime={selectTime}
              />
            </>
          ) : (
            <Card className="p-8">
              <h2 className="font-semibold">
                {points.length === 0
                  ? "No recorded track"
                  : points.length === 1
                    ? "One recorded point"
                    : "Profile not prepared yet"}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {points.length === 0
                  ? "This flight has no GPS track. Its saved details are shown alongside."
                  : points.length === 1
                    ? "This recording contains one position. A flight profile needs at least two points."
                    : "The recording is available. Prepare this flight to save its measurements and profile."}
              </p>
              {flight.needsPreparation ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={preparing}
                  className="mt-4"
                  onClick={() => void prepare()}
                >
                  {preparing ? "Preparing…" : "Prepare flight"}
                </Button>
              ) : null}
              {preparationError ? (
                <p role="alert" className="mt-3 text-sm text-destructive">
                  {preparationError}
                </p>
              ) : null}
            </Card>
          )}
        </div>
        <aside
          className="min-w-0 space-y-6 break-words @min-[900px]:border-l @min-[900px]:border-border @min-[900px]:pl-6"
          aria-label="Flight details"
        >
          <section>
            <h2 className="mb-4 text-sm font-semibold">Flight details</h2>
            <dl className="space-y-5">
              {[
                [
                  "Takeoff",
                  flight.takeoffName || "Unnamed takeoff",
                  flight.takeoffAt,
                ],
                [
                  "Landing",
                  flight.landingName || "Unnamed landing",
                  flight.landingAt,
                ],
              ].map(([label, name, date]) => (
                <div key={String(label)}>
                  <dt className="text-xs text-muted-foreground">
                    {String(label)}
                  </dt>
                  <dd className="mt-1 text-sm font-medium">
                    {String(name)}
                    {typeof date === "number" && (
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">
                        {formatDateTime(date)}
                      </span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-5 border-t border-border pt-5 tabular-nums @min-[900px]:grid-cols-1">
            {stats.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-lg font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          <section className="border-t border-border pt-5">
            <h2 className="text-sm font-semibold">Equipment</h2>
            {equipment.length ? (
              <ul className="mt-3 space-y-3">
                {equipment.map((item) => (
                  <li key={item.id} className="text-sm">
                    <span className="block text-xs capitalize text-muted-foreground">
                      {item.kind}
                    </span>
                    {item.name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                No equipment linked.
              </p>
            )}
          </section>
          <section className="border-t border-border pt-5">
            <h2 className="text-sm font-semibold">Source</h2>
            {flight.sourceDetail ? (
              <p className="mt-2 text-sm">
                Recorded with {flight.sourceDetail}
              </p>
            ) : null}
            <ul className="mt-3 space-y-2">
              {files.map((file) => (
                <li key={file.id} className="break-words text-sm">
                  <OriginalDownload fileId={file.id} filename={file.filename} />
                  <span className="block text-xs text-muted-foreground">
                    {file.format.toUpperCase()} ·{" "}
                    {(file.sizeBytes / 1024).toLocaleString(undefined, {
                      maximumFractionDigits: 1,
                    })}{" "}
                    KB
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="border-t border-border pt-5">
            <h2 className="text-sm font-semibold">Notes</h2>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
              {flight.notes || "No notes yet."}
            </p>
          </section>
        </aside>
      </div>
    </article>
  )
}
