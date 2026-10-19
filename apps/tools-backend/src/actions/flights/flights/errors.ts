import { Data } from "effect"
import type {
  DatabaseError,
  flightEquipmentItems,
  flightFiles,
  flights,
} from "#backend/modules/database"
import type { CompressionError } from "#backend/modules/compression"
import type { ObjectStorageError } from "#backend/modules/object-storage"
import type { TrackPoint } from "@mdoultremont/flight-track"

export class FlightInputError extends Data.TaggedError("FlightInputError")<{
  readonly message: string
}> {}
export class FlightNotFound extends Data.TaggedError("FlightNotFound")<{
  readonly message: string
}> {}
export type FlightsError =
  | FlightInputError
  | FlightNotFound
  | DatabaseError
  | CompressionError
  | ObjectStorageError
export type Flight = typeof flights.$inferSelect
export type EquipmentItem = typeof flightEquipmentItems.$inferSelect
export type FileMetadata = Omit<
  typeof flightFiles.$inferSelect,
  "objectKey" | "contentType" | "userId" | "flightId"
>
export interface FlightDetail {
  readonly flight: Flight
  readonly equipment: readonly EquipmentItem[]
  readonly files: readonly FileMetadata[]
  readonly points: readonly TrackPoint[]
}
export interface FlightUpdate {
  readonly takeoffName: string
  readonly landingName: string
  readonly notes: string
  readonly equipmentIds: readonly string[]
}
export interface OriginalFile {
  readonly filename: string
  readonly format: "gpx" | "igc"
  readonly contentType: string
  readonly sizeBytes: number
  readonly body: ReadableStream<Uint8Array>
}
