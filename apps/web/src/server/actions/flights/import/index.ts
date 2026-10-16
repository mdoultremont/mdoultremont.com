import { Clock, Context, Effect, Layer } from "effect"
import {
  Flights,
  FlightInputError,
  fileKey,
  trackKey,
  type Flight,
} from "@/server/actions/flights/flights"
import { gzipText } from "@/server/modules/compression"
import { ObjectStorage } from "@/server/modules/object-storage"
import { sha256Hex } from "@/server/modules/hashing"
import {
  computeMetrics,
  haversineDistance,
  parseTrackFile,
} from "@/shared/flight-track"
import { FlightImportStore } from "./store"

export const MAX_TRACK_BYTES = 5_000_000
export interface ImportInput {
  readonly filename: string
  readonly text: string
}
export interface ImportResult {
  readonly status: "imported" | "duplicate"
  readonly flightId: string
}

/** Nearest named same-kind site within 500 m, from an earlier flight only. */
export function matchSiteName(
  lat: number,
  lon: number,
  at: number,
  earlier: readonly Flight[],
  kind: "takeoff" | "landing"
) {
  let nearest = 500
  let name: string | null = null
  let latest = -Infinity
  for (const flight of earlier) {
    const siteLat = kind === "takeoff" ? flight.takeoffLat : flight.landingLat
    const siteLon = kind === "takeoff" ? flight.takeoffLon : flight.landingLon
    const siteName =
      kind === "takeoff" ? flight.takeoffName : flight.landingName
    if (
      flight.takeoffAt >= at ||
      !siteName?.trim() ||
      siteLat === null ||
      siteLon === null
    )
      continue
    const distance = haversineDistance(lat, lon, siteLat, siteLon)
    if (
      distance < nearest ||
      (distance === nearest && flight.takeoffAt > latest)
    ) {
      nearest = distance
      latest = flight.takeoffAt
      name = siteName
    }
  }
  return name
}
const makeImport = Effect.gen(function* () {
  const store = yield* FlightImportStore
  const flights = yield* Flights
  const storage = yield* ObjectStorage
  const importFile = Effect.fn("FlightImport.importFile")(function* (
    userId: string,
    input: ImportInput
  ) {
    const sizeBytes = new TextEncoder().encode(input.text).byteLength
    if (
      !input.filename.trim() ||
      input.filename.length > 255 ||
      Array.from(input.filename).some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      )
    )
      return yield* new FlightInputError({
        message:
          "Enter a filename of 1–255 characters without control characters",
      })
    if (sizeBytes > MAX_TRACK_BYTES)
      return yield* new FlightInputError({
        message: "This file is too large. The limit is 5 MB.",
      })
    const parsed = yield* Effect.try({
      try: () => parseTrackFile(input.filename, input.text),
      catch: (cause) =>
        new FlightInputError({
          message: cause instanceof Error ? cause.message : "Invalid track",
        }),
    })
    const metrics = computeMetrics(parsed.points)
    const pointsJson = JSON.stringify(parsed.points)
    const pointsGzip = yield* gzipText(pointsJson)
    const sha256 = yield* sha256Hex(input.text)
    const pointsSha256 = yield* sha256Hex(pointsJson)
    const takeoffAt = metrics.takeoffAt.getTime()
    // Duplicates are decided in D1 before any object is written.
    const existing = yield* store.findDuplicate(userId, sha256, takeoffAt)
    if (existing) return { status: "duplicate" as const, flightId: existing }
    const earlier = yield* flights.list(userId)
    const now = yield* Clock.currentTimeMillis
    const id = crypto.randomUUID()
    const fileId = crypto.randomUUID()
    const originalKey = fileKey(userId, id, fileId)
    const pointsKey = trackKey(userId, id)
    const contentType =
      parsed.source === "gpx"
        ? "application/gpx+xml; charset=utf-8"
        : "text/plain; charset=utf-8"
    // Objects first, then the D1 batch: a flight row never points at a missing
    // object. Keys are unique per attempt, so a failed attempt only leaves
    // orphans, which are removed best-effort below.
    const cleanup = storage.delete([originalKey, pointsKey]).pipe(
      Effect.catch((error) =>
        Effect.logError("Orphaned flight objects after failed import", {
          userId,
          flightId: id,
          error,
        })
      )
    )
    // An error after the D1 batch (for example a lost response) may mean D1
    // committed. Only delete the objects when the flight row does not exist;
    // if the check itself fails, keep them rather than risk dangling rows.
    const cleanupUnlessCommitted = store.exists(id).pipe(
      Effect.flatMap((committed) => (committed ? Effect.void : cleanup)),
      Effect.catch((error) =>
        Effect.logError("Could not verify flight before import cleanup", {
          userId,
          flightId: id,
          error,
        })
      )
    )
    const stored = Effect.gen(function* () {
      yield* storage.put(originalKey, new TextEncoder().encode(input.text), {
        contentType,
      })
      yield* storage.put(pointsKey, pointsGzip, {
        contentType: "application/gzip",
      })
      return yield* store.write({
        flight: {
          id,
          userId,
          startedAt: parsed.startedAt.getTime(),
          takeoffAt: metrics.takeoffAt.getTime(),
          landingAt: metrics.landingAt.getTime(),
          durationS: Math.round(metrics.durationS),
          takeoffLat: metrics.takeoff.lat,
          takeoffLon: metrics.takeoff.lon,
          landingLat: metrics.landing.lat,
          landingLon: metrics.landing.lon,
          takeoffName: matchSiteName(
            metrics.takeoff.lat,
            metrics.takeoff.lon,
            metrics.takeoffAt.getTime(),
            earlier,
            "takeoff"
          ),
          landingName: matchSiteName(
            metrics.landing.lat,
            metrics.landing.lon,
            metrics.takeoffAt.getTime(),
            earlier,
            "landing"
          ),
          distanceM: metrics.distanceM,
          maxAltM: metrics.maxAltM,
          avgAltM: metrics.avgAltM,
          maxSpeedMps: metrics.maxSpeedMps,
          elevationGainM: metrics.elevationGainM,
          maxClimbMps: metrics.maxClimbMps,
          maxSinkMps: metrics.maxSinkMps,
          source: parsed.source,
          sourceDetail: parsed.sourceDetail ?? null,
          createdAt: now,
          updatedAt: now,
        },
        trackKey: pointsKey,
        pointsSha256,
        pointsSizeBytes: new TextEncoder().encode(pointsJson).byteLength,
        pointCount: parsed.points.length,
        file: {
          id: fileId,
          flightId: id,
          userId,
          filename: input.filename,
          format: parsed.source,
          contentType,
          sizeBytes,
          sha256,
          objectKey: originalKey,
        },
      })
    })
    return yield* stored.pipe(
      Effect.onError(() => cleanupUnlessCommitted),
      // Lost a concurrent race: the other request's flight stands, ours is garbage.
      Effect.tap((result) =>
        result.status === "duplicate" ? cleanup : Effect.void
      )
    )
  })
  return { importFile }
})
export class FlightImport extends Context.Service<
  FlightImport,
  Effect.Success<typeof makeImport>
>()("server/actions/flights/FlightImport") {
  static readonly layerNoDeps = Layer.effect(FlightImport, makeImport)
  static readonly layer = FlightImport.layerNoDeps.pipe(
    Layer.provide(Layer.mergeAll(FlightImportStore.layer, Flights.layer))
  )
}
