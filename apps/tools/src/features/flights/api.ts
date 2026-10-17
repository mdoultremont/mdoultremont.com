import { createORPCClient } from "@orpc/client"
import { RPCLink } from "@orpc/client/fetch"
import type { ContractRouterClient } from "@orpc/contract"
import { flightsContract, type EquipmentInput } from "@/shared/flights/contract"

export type {
  Dashboard,
  EquipmentInput,
  EquipmentItem,
  Flight,
  FlightDetail,
  FlightUpdate,
  ImportResult,
} from "@/shared/flights/contract"

/** The original file as `downloadFlightFile` reads it. */
export interface FlightDownload {
  readonly filename: string
  readonly format: "gpx" | "igc"
  readonly text: string
}

/**
 * Typed client for the flights contract in `@/shared/flights/contract`; the
 * wire shapes and units are documented there. Calls go to /api/rpc/flights with the
 * session cookie, and failures throw an Error whose message is readable.
 * Only called from the browser, never during server rendering.
 */
const client: ContractRouterClient<typeof flightsContract> = createORPCClient(
  new RPCLink({
    url: () => new URL("/api/rpc/flights", window.location.origin).href,
  })
)

export const listFlights = (year?: number) => client.list({ year })
export const getFlight = (flightId: string) => client.get({ flightId })
export const updateFlight = (
  flightId: string,
  input: Omit<Parameters<typeof client.update>[0], "flightId">
) => client.update({ flightId, ...input })
export const deleteFlight = (flightId: string) => client.delete({ flightId })
export const importFlight = (input: {
  readonly filename: string
  readonly text: string
}) => client.import(input)
export const getFlightStats = () => client.stats.get()
export const listEquipment = () => client.equipment.list()
export const createEquipment = (input: EquipmentInput) =>
  client.equipment.create(input)
export const updateEquipment = (equipmentId: string, input: EquipmentInput) =>
  client.equipment.update({ equipmentId, ...input })
export const deleteEquipment = (equipmentId: string) =>
  client.equipment.delete({ equipmentId })

/**
 * GET /api/flights/files/:fileId returns an attachment containing the exact
 * original text (binary-safe, so it is a plain route rather than a procedure).
 * Reads it as { filename, format: 'gpx'|'igc', text }; throws Error with the
 * route's { error } message.
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
    throw new Error(
      payload &&
        typeof payload === "object" &&
        "error" in payload &&
        typeof payload.error === "string"
        ? payload.error
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
