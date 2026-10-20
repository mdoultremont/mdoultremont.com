import { api } from "@/features/api"
import type {
  EquipmentInput,
  FlightUpdate,
} from "@mdoultremont/tools-contracts/flights"

export type {
  Dashboard,
  EquipmentInput,
  EquipmentItem,
  Flight,
  FlightSummary,
  FlightDetail,
  FlightTrackAnalysis,
  ProfilePoint,
  TrackPoint,
  FlightUpdate,
  ImportResult,
} from "@mdoultremont/tools-contracts/flights"

/** The original file as `downloadFlightFile` reads it. */
export interface FlightDownload {
  readonly filename: string
  readonly format: "gpx" | "igc"
  readonly text: string
}

/** The flights actions in `@mdoultremont/tools-contracts/flights`; wire shapes and units are documented there. */
export const listFlights = (year?: number) => api.flights.list({ year })
export const prepareFlight = (flightId: string) =>
  api.flights.prepare({ flightId })
export const getFlight = (flightId: string) => api.flights.get({ flightId })
export const updateFlight = (flightId: string, input: FlightUpdate) =>
  api.flights.update({ flightId, ...input })
export const deleteFlight = (flightId: string) =>
  api.flights.delete({ flightId })
export const importFlight = (input: {
  readonly filename: string
  readonly text: string
}) => api.flights.import(input)
export const getFlightStats = () => api.flights.stats.get()
export const listEquipment = () => api.flights.equipment.list()
export const createEquipment = (input: EquipmentInput) =>
  api.flights.equipment.create(input)
export const updateEquipment = (equipmentId: string, input: EquipmentInput) =>
  api.flights.equipment.update({ equipmentId, ...input })
export const deleteEquipment = (equipmentId: string) =>
  api.flights.equipment.delete({ equipmentId })

/**
 * GET /api/flights/files/:fileId serves `flights.files.download` as an
 * attachment containing the exact original bytes. Reads it as
 * { filename, format: 'gpx'|'igc', text }; throws Error with the failure's
 * message.
 */
export async function downloadFlightFile(
  fileId: string
): Promise<FlightDownload> {
  const response = await fetch(
    `/api/flights/files/${encodeURIComponent(fileId)}`,
    { credentials: "same-origin" }
  )
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null)
    const error =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error
        : null
    throw new Error(
      error &&
        typeof error === "object" &&
        "message" in error &&
        typeof error.message === "string"
        ? error.message
        : "Flight request failed"
    )
  }
  const disposition = response.headers.get("Content-Disposition") ?? ""
  const encodedName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1]
  const fallback = /filename="([^"]*)"/i.exec(disposition)?.[1] ?? "flight"
  const filename = encodedName ? decodeURIComponent(encodedName) : fallback
  return {
    filename,
    format: response.headers
      .get("Content-Type")
      ?.includes("application/gpx+xml")
      ? "gpx"
      : "igc",
    text: await response.text(),
  }
}
