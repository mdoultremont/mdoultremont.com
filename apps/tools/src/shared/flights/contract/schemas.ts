import { Schema } from "effect"

/**
 * Wire shapes of the flights API. Timestamps are UTC epoch milliseconds,
 * durations seconds, distances and altitudes metres, speeds metres per second,
 * coordinates degrees. Fields named `hours` use hours. Nullable observations
 * stay null. Every schema decodes to the same value it encodes, so the
 * contract is validated on both sides without any conversion.
 */
const Nullable = <S extends Schema.Top>(schema: S) => Schema.NullOr(schema)

export const FlightSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  startedAt: Schema.Number,
  takeoffAt: Schema.Number,
  landingAt: Schema.Number,
  durationS: Schema.Number,
  takeoffLat: Nullable(Schema.Number),
  takeoffLon: Nullable(Schema.Number),
  takeoffName: Nullable(Schema.String),
  landingLat: Nullable(Schema.Number),
  landingLon: Nullable(Schema.Number),
  landingName: Nullable(Schema.String),
  distanceM: Schema.Number,
  maxAltM: Nullable(Schema.Number),
  avgAltM: Nullable(Schema.Number),
  maxSpeedMps: Schema.Number,
  elevationGainM: Nullable(Schema.Number),
  maxClimbMps: Nullable(Schema.Number),
  maxSinkMps: Nullable(Schema.Number),
  notes: Nullable(Schema.String),
  source: Schema.Literals(["gpx", "igc", "manual"]),
  sourceDetail: Nullable(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type Flight = typeof FlightSchema.Type

export const EquipmentKind = Schema.Literals([
  "wing",
  "harness",
  "reserve",
  "instrument",
  "other",
])

export const EquipmentItemSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  kind: EquipmentKind,
  name: Schema.String,
  notes: Nullable(Schema.String),
  retired: Schema.Boolean,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type EquipmentItem = typeof EquipmentItemSchema.Type

export const EquipmentInputSchema = Schema.Struct({
  kind: EquipmentKind,
  name: Schema.String,
  notes: Schema.String,
  retired: Schema.Boolean,
})
export type EquipmentInput = typeof EquipmentInputSchema.Type

/** Metadata only; the original text comes from the file download route. */
export const FileMetadataSchema = Schema.Struct({
  id: Schema.String,
  filename: Schema.String,
  format: Schema.Literals(["gpx", "igc"]),
  sizeBytes: Schema.Number,
  sha256: Schema.String,
})
export type FileMetadata = typeof FileMetadataSchema.Type

/**
 * [epochMs, latitudeDeg, longitudeDeg, gpsAltitudeM | null, barometricAltitudeM | null].
 * Declared, not decoded: only "is an array" is checked at runtime, so the
 * server does not walk thousands of points on every response. The producer
 * (the stored, already-decoded track) guarantees the tuple shape.
 */
export type TrackPoint = [
  tMs: number,
  lat: number,
  lon: number,
  gpsAlt: number | null,
  baroAlt: number | null,
]
const TrackPoints = Schema.declare((value): value is readonly TrackPoint[] =>
  Array.isArray(value)
)

export const FlightDetailSchema = Schema.Struct({
  flight: FlightSchema,
  equipment: Schema.Array(EquipmentItemSchema),
  files: Schema.Array(FileMetadataSchema),
  points: TrackPoints,
})
export type FlightDetail = typeof FlightDetailSchema.Type

export const FlightUpdateSchema = Schema.Struct({
  takeoffName: Schema.String,
  landingName: Schema.String,
  notes: Schema.String,
  equipmentIds: Schema.Array(Schema.String),
})
export type FlightUpdate = typeof FlightUpdateSchema.Type

export const ImportResultSchema = Schema.Struct({
  status: Schema.Literals(["imported", "duplicate"]),
  flightId: Schema.String,
})
export type ImportResult = typeof ImportResultSchema.Type

const ActivityPeriodSchema = Schema.Struct({
  period: Schema.String,
  flights: Schema.Number,
  seconds: Schema.Number,
  hours: Schema.Number,
  distanceM: Schema.Number,
})

export const DashboardSchema = Schema.Struct({
  totals: Schema.Struct({
    flights: Schema.Number,
    hours: Schema.Number,
    distanceM: Schema.Number,
  }),
  perMonth: Schema.Array(ActivityPeriodSchema),
  perYear: Schema.Array(ActivityPeriodSchema),
  records: Schema.Array(
    Schema.Struct({
      metric: Schema.Literals([
        "duration",
        "distance",
        "altitude",
        "speed",
        "climb",
        "gain",
      ]),
      value: Schema.Number,
      flightId: Schema.String,
      date: Schema.Number,
      takeoffName: Nullable(Schema.String),
    })
  ),
  recentFlights: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      date: Schema.Number,
      takeoffName: Nullable(Schema.String),
      durationS: Schema.Number,
      distanceM: Schema.Number,
    })
  ),
  topSites: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      flights: Schema.Number,
      hours: Schema.Number,
    })
  ),
})
export type Dashboard = typeof DashboardSchema.Type
