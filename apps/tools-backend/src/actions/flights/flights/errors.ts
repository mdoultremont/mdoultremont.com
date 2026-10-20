import { Data } from "effect"
import type {
  DatabaseError,
  flightEquipmentItems,
  flightFiles,
  flights,
} from "#backend/modules/database"
import type { CompressionError } from "#backend/modules/compression"
import type { ObjectStorageError } from "#backend/modules/object-storage"
import type { ProfilePoint, TrackPoint } from "#backend/actions/flights/track"

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
  readonly flight: Flight & {
    readonly title: string
    readonly needsPreparation: boolean
  }
  readonly equipment: readonly EquipmentItem[]
  readonly files: readonly FileMetadata[]
  readonly analysis: {
    readonly takeoffIndex: number
    readonly landingIndex: number
    readonly takeoffAt: number
    readonly profile: readonly ProfilePoint[]
  } | null
  readonly points: readonly TrackPoint[]
}
export interface FlightUpdate {
  readonly title?: string
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
