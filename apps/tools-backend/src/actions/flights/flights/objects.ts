import { Effect, Option, Schema } from "effect"
import { CompressionError, gunzipText } from "#backend/modules/compression"
import {
  ObjectStorage,
  ObjectStorageError,
  readBytes,
} from "#backend/modules/object-storage"
import { sha256Hex } from "#backend/modules/hashing"

const Index = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const ProfilePointSchema = Schema.Struct({
  i: Index,
  tS: Schema.Finite,
  altM: Schema.NullOr(Schema.Finite),
  speedKmh: Schema.Finite,
  varioMps: Schema.Finite,
  distKm: Schema.Finite,
})
const SnapshotSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  pointsSha256: Schema.String,
  pointCount: Index,
  analysis: Schema.NullOr(
    Schema.Struct({
      takeoffIndex: Index,
      landingIndex: Index,
      takeoffAt: Schema.Finite,
      profile: Schema.Array(ProfilePointSchema),
    })
  ),
})
const TrackSchema = Schema.Array(
  Schema.mutable(
    Schema.Tuple([
      Schema.Finite,
      Schema.Finite.check(Schema.isBetween({ minimum: -90, maximum: 90 })),
      Schema.Finite.check(Schema.isBetween({ minimum: -180, maximum: 180 })),
      Schema.NullOr(Schema.Finite),
      Schema.NullOr(Schema.Finite),
    ])
  )
)
const invalid = (message: string, cause?: unknown) =>
  new CompressionError({ reason: "InvalidData", message, cause })
const readText = Effect.fn("FlightObjects.readText")(function* (key: string) {
  const storage = yield* ObjectStorage
  const object = yield* storage.get(key)
  if (Option.isNone(object))
    return yield* new ObjectStorageError({ reason: "MissingObject", key })
  return yield* gunzipText(yield* readBytes(key, object.value)).pipe(
    Effect.mapError((cause) =>
      invalid("Stored flight object is unreadable", cause)
    )
  )
})
export const loadTrack = Effect.fn("FlightObjects.loadTrack")(
  function* (track: { objectKey: string; sha256: string; pointCount: number }) {
    const text = yield* readText(track.objectKey)
    const points = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(TrackSchema)
    )(text).pipe(
      Effect.mapError((cause) => invalid("Stored track is unreadable", cause))
    )
    if (
      points.length !== track.pointCount ||
      (yield* sha256Hex(text)) !== track.sha256 ||
      points.some((point, i) => i > 0 && point[0] <= points[i - 1]![0])
    )
      return yield* invalid("Stored track does not match its metadata")
    return points
  }
)
export const loadSnapshot = Effect.fn("FlightObjects.loadSnapshot")(function* (
  key: string,
  track: { sha256: string; pointCount: number }
) {
  const text = yield* readText(key)
  const snapshot = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(SnapshotSchema)
  )(text).pipe(
    Effect.mapError((cause) =>
      invalid("Stored flight analysis is unreadable", cause)
    )
  )
  const analysis = snapshot.analysis
  const profileExpected = track.pointCount >= 2
  if (
    snapshot.pointsSha256 !== track.sha256 ||
    snapshot.pointCount !== track.pointCount ||
    profileExpected !== (analysis !== null) ||
    (analysis &&
      (analysis.takeoffIndex > analysis.landingIndex ||
        analysis.landingIndex >= track.pointCount ||
        !analysis.profile.length ||
        analysis.profile[0]!.i !== analysis.takeoffIndex ||
        analysis.profile.at(-1)!.i !== analysis.landingIndex ||
        analysis.profile.some(
          (p, i) =>
            p.i < analysis.takeoffIndex ||
            p.i > analysis.landingIndex ||
            (i > 0 &&
              (p.i <= analysis.profile[i - 1]!.i ||
                p.tS <= analysis.profile[i - 1]!.tS))
        )))
  )
    return yield* invalid("Stored flight analysis does not match its track")
  return snapshot.analysis
})
