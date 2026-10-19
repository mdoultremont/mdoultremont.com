import type { TrackPoint } from "@mdoultremont/flight-track"
import { Clock, Context, Effect, Layer, Option, Schema } from "effect"
import { CompressionError, gunzipText } from "#backend/modules/compression"
import {
  ObjectStorage,
  ObjectStorageError,
  readBytes,
} from "#backend/modules/object-storage"
import {
  type FlightDetail,
  FlightInputError,
  FlightNotFound,
  type FlightsError,
  type FlightUpdate,
  type OriginalFile,
} from "./errors"
import { flightPrefix } from "./keys"
import { FlightStore } from "./store"

const missing = () => new FlightNotFound({ message: "Flight not found" })

const makeFlights = Effect.gen(function* () {
  const store = yield* FlightStore
  const storage = yield* ObjectStorage
  const list = Effect.fn("Flights.list")(function* (
    userId: string,
    year?: number
  ) {
    if (
      year !== undefined &&
      (!Number.isInteger(year) || year < 1900 || year > 9998)
    )
      return yield* new FlightInputError({ message: "Choose a valid year" })
    return yield* store.list(userId, year)
  })
  const loadTrack = Effect.fn("Flights.loadTrack")(function* (
    objectKey: string
  ) {
    const object = yield* storage.get(objectKey)
    if (Option.isNone(object))
      return yield* new ObjectStorageError({
        reason: "MissingObject",
        key: objectKey,
      })
    const bytes = yield* readBytes(objectKey, object.value)
    return yield* gunzipText(bytes).pipe(
      Effect.flatMap(
        // Stored content is trusted (the contract validates it on the way in);
        // only check the shape so a corrupt object fails clearly.
        Schema.decodeUnknownEffect(
          Schema.fromJsonString(Schema.Array(Schema.Array(Schema.Unknown)))
        )
      ),
      Effect.mapError(
        (cause) =>
          new CompressionError({
            reason: "InvalidData",
            message: "Stored track is unreadable",
            cause,
          })
      )
    )
  })
  const detail = Effect.fn("Flights.detail")(function* (
    userId: string,
    id: string
  ): Effect.fn.Return<FlightDetail, FlightsError> {
    const [rows, equipment, files, tracks] = yield* store.detail(userId, id)
    const flight = rows[0]
    if (!flight) return yield* missing()
    const points = tracks[0] ? yield* loadTrack(tracks[0].objectKey) : []
    return {
      flight,
      equipment,
      files,
      points: points.map((point) => [...point] as unknown as TrackPoint),
    }
  })
  const update = Effect.fn("Flights.update")(function* (
    userId: string,
    id: string,
    input: FlightUpdate
  ) {
    if (
      input.takeoffName.length > 200 ||
      input.landingName.length > 200 ||
      input.notes.length > 10000 ||
      input.equipmentIds.length > 100
    )
      return yield* new FlightInputError({
        message:
          "Names allow 200 characters, notes 10000, and equipment 100 items",
      })
    const [rows, attached] = yield* store.detail(userId, id)
    if (!rows[0]) return yield* missing()
    const equipmentIds = [...new Set(input.equipmentIds)]
    const available = yield* store.equipment(userId)
    if (
      equipmentIds.some(
        (equipmentId) =>
          !available.some(
            (item) =>
              item.id === equipmentId &&
              (!item.retired ||
                attached.some((link) => link.id === equipmentId))
          )
      )
    )
      return yield* new FlightInputError({
        message: "Choose active equipment from your own kit",
      })
    const result = yield* store.update(
      userId,
      id,
      {
        takeoffName: input.takeoffName.trim(),
        landingName: input.landingName.trim(),
        notes: input.notes.trim(),
        equipmentIds,
      },
      yield* Clock.currentTimeMillis
    )
    if (!result[0][0]) return yield* missing()
    return { id }
  })
  const remove = Effect.fn("Flights.remove")(function* (
    userId: string,
    id: string
  ) {
    const rows = yield* store.remove(userId, id)
    if (!rows.length) return yield* missing()
    // D1 is the source of truth and has already committed: an object-storage
    // failure leaves orphans to clean up later, but must not fail the request.
    yield* storage.deleteByPrefix(flightPrefix(userId, id)).pipe(
      Effect.catch((error) =>
        Effect.logError("Orphaned flight objects after delete", {
          userId,
          flightId: id,
          error,
        })
      )
    )
    return { id }
  })
  const download = Effect.fn("Flights.download")(function* (
    userId: string,
    fileId: string
  ) {
    const row = yield* store.file(userId, fileId)
    if (!row)
      return yield* new FlightNotFound({ message: "Original file not found" })
    const file = row.flight_files
    const object = yield* storage.get(file.objectKey)
    if (Option.isNone(object))
      return yield* new ObjectStorageError({
        reason: "MissingObject",
        key: file.objectKey,
      })
    return {
      filename: file.filename,
      format: file.format,
      contentType: file.contentType,
      sizeBytes: object.value.size,
      body: object.value.body,
    } satisfies OriginalFile
  })
  return { list, detail, update, remove, download }
})
export class Flights extends Context.Service<
  Flights,
  Effect.Success<typeof makeFlights>
>()("server/actions/flights/Flights") {
  static readonly layerNoDeps = Layer.effect(Flights, makeFlights)
  static readonly layer = Flights.layerNoDeps.pipe(
    Layer.provide(FlightStore.layer)
  )
}
