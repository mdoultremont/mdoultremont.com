import { Context, Effect, Layer } from "effect"
import {
  FlightNotFound,
  analysisKey,
  loadTrack,
} from "#backend/actions/flights/flights"
import {
  ANALYSIS_VERSION,
  measuredColumns,
  prepareFlight,
} from "#backend/actions/flights/track"
import { gzipText } from "#backend/modules/compression"
import { ObjectStorage } from "#backend/modules/object-storage"
import { FlightPreparationStore } from "./store"

const makePreparation = Effect.gen(function* () {
  const store = yield* FlightPreparationStore
  const storage = yield* ObjectStorage
  const prepare = Effect.fn("FlightPreparation.prepare")(function* (
    userId: string,
    flightId: string
  ) {
    const current = yield* store.read(userId, flightId)
    if (!current)
      return yield* new FlightNotFound({ message: "Flight not found" })
    if (current.analysis)
      return { flightId, status: "already-prepared" as const }
    const track = current.track
    if (!track || track.pointCount < 1)
      return { flightId, status: "unavailable" as const }
    const points = yield* loadTrack(track).pipe(
      Effect.provideService(ObjectStorage, storage)
    )
    const prepared = prepareFlight(points)
    const key = analysisKey(userId, flightId, crypto.randomUUID())
    const bytes = yield* gzipText(
      JSON.stringify({
        schemaVersion: 1,
        pointsSha256: track.sha256,
        pointCount: track.pointCount,
        analysis: prepared.analysis,
      })
    )
    const cleanup = storage.delete([key]).pipe(
      Effect.catch((error) =>
        Effect.logError("Orphaned flight analysis after preparation", {
          flightId,
          error,
        })
      )
    )
    yield* storage
      .put(key, bytes, { contentType: "application/gzip" })
      .pipe(Effect.onError(() => cleanup))
    const deleteIfOtherAttemptWon = store.read(userId, flightId).pipe(
      Effect.flatMap((row) =>
        row?.analysis && row.analysis.objectKey !== key ? cleanup : Effect.void
      ),
      Effect.catch((error) =>
        Effect.logError("Could not verify flight analysis before cleanup", {
          flightId,
          error,
        })
      )
    )
    return yield* Effect.gen(function* () {
      yield* store.publish(
        userId,
        flightId,
        track,
        {
          flightId,
          version: ANALYSIS_VERSION,
          objectKey: key,
          preview: prepared.preview,
        },
        measuredColumns(prepared.metrics!)
      )
      const published = yield* store.read(userId, flightId)
      if (published?.analysis?.objectKey === key)
        return { flightId, status: "prepared" as const }
      if (!published?.analysis) {
        yield* cleanup
        if (!published)
          return yield* new FlightNotFound({ message: "Flight not found" })
        return { flightId, status: "unavailable" as const }
      }
      yield* cleanup
      return { flightId, status: "already-prepared" as const }
    }).pipe(Effect.onError(() => deleteIfOtherAttemptWon))
  })
  return { prepare }
})
export class FlightPreparation extends Context.Service<
  FlightPreparation,
  Effect.Success<typeof makePreparation>
>()("server/actions/flights/FlightPreparation") {
  static readonly layerNoDeps = Layer.effect(FlightPreparation, makePreparation)
  static readonly layer = FlightPreparation.layerNoDeps.pipe(
    Layer.provide(FlightPreparationStore.layer)
  )
}
