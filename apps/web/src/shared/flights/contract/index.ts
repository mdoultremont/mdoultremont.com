import { oc } from "@orpc/contract"
import { Schema } from "effect"
import {
  DashboardSchema,
  EquipmentInputSchema,
  EquipmentItemSchema,
  FlightDetailSchema,
  FlightSchema,
  FlightUpdateSchema,
  ImportResultSchema,
} from "./schemas"

export type {
  Dashboard,
  EquipmentInput,
  EquipmentItem,
  FileMetadata,
  Flight,
  FlightDetail,
  FlightUpdate,
  ImportResult,
} from "./schemas"

/**
 * The flights API. Procedures are served over oRPC at /api/rpc/flights/<name>
 * (for example /api/rpc/flights/list or /api/rpc/flights/equipment/create).
 * Failures arrive as `ORPCError`: UNAUTHORIZED, FORBIDDEN, BAD_REQUEST,
 * NOT_FOUND, PAYLOAD_TOO_LARGE or INTERNAL_SERVER_ERROR, with a readable message.
 * The original-file download is a plain GET route, not part of this contract.
 */

/** Wraps a schema for oRPC: input is what clients send, output what handlers return. */
const std = Schema.toStandardSchemaV1

const idInput = <K extends string>(key: K) =>
  std(
    Schema.Struct({ [key]: Schema.String } as Record<K, typeof Schema.String>)
  )

const Year = Schema.Int.check(
  Schema.isBetween({ minimum: 1900, maximum: 9998 })
)
const IdResult = Schema.Struct({ id: Schema.String })

export const flightsContract = {
  /** Flights, newest first; `year` filters on the UTC takeoff year (1900-9998). */
  list: oc
    .input(std(Schema.Struct({ year: Schema.optional(Year) })))
    .output(std(Schema.Struct({ flights: Schema.Array(FlightSchema) }))),
  /** One flight with its equipment, file metadata and track points. */
  get: oc.input(idInput("flightId")).output(std(FlightDetailSchema)),
  update: oc
    .input(
      std(
        Schema.Struct({
          flightId: Schema.String,
          ...FlightUpdateSchema.fields,
        })
      )
    )
    .output(std(IdResult)),
  /** Also removes the flight's files and track. */
  delete: oc.input(idInput("flightId")).output(std(IdResult)),
  /**
   * Imports GPX/IGC text. Text is limited to 5,000,000 UTF-8 bytes and the
   * whole JSON request to 6,000,000 bytes, so heavily escaped JSON may hit
   * the request cap first.
   */
  import: oc
    .input(std(Schema.Struct({ filename: Schema.String, text: Schema.String })))
    .output(std(ImportResultSchema)),
  stats: {
    get: oc.output(std(DashboardSchema)),
  },
  equipment: {
    /** Includes retired items. */
    list: oc.output(
      std(Schema.Struct({ equipment: Schema.Array(EquipmentItemSchema) }))
    ),
    create: oc
      .input(std(EquipmentInputSchema))
      .output(std(Schema.Struct({ equipment: EquipmentItemSchema }))),
    /** Replaces the whole item. */
    update: oc
      .input(
        std(
          Schema.Struct({
            equipmentId: Schema.String,
            ...EquipmentInputSchema.fields,
          })
        )
      )
      .output(std(Schema.Struct({ equipment: EquipmentItemSchema }))),
    /** Also removes the item from every flight. */
    delete: oc.input(idInput("equipmentId")).output(std(IdResult)),
  },
}

export type FlightsContract = typeof flightsContract
