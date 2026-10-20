import { Schema } from "effect"
import { actionsFor, NoInput } from "../actions/define"
import {
  DashboardSchema,
  EquipmentInputSchema,
  EquipmentItemSchema,
  FilePayloadSchema,
  FlightDetailSchema,
  FlightSchema,
  FlightUpdateSchema,
  ImportResultSchema,
} from "./schemas"

const action = actionsFor("flights")

const Year = Schema.Int.check(
  Schema.isBetween({ minimum: 1900, maximum: 9998 })
)
const IdResult = Schema.Struct({ id: Schema.String })
const FlightId = Schema.Struct({ flightId: Schema.String })
const EquipmentId = Schema.Struct({ equipmentId: Schema.String })
const EquipmentResult = Schema.Struct({ equipment: EquipmentItemSchema })

/** The flight logbook's operations. Wire shapes and units are in `./schemas`. */
export const flightsActions = {
  list: action({
    description:
      "Lists the user's flights, newest first. `year` keeps only flights whose UTC takeoff falls in that year (1900-9998).",
    effect: "read",
    http: { method: "GET", path: "/flights" },
    input: Schema.Struct({ year: Schema.optional(Year) }),
    output: Schema.Struct({ flights: Schema.Array(FlightSchema) }),
  }),
  get: action({
    description:
      "One flight with its equipment, original file metadata and track points [epochMs, lat, lon, gpsAltM | null, baroAltM | null], and nullable analysis with detected takeoff/landing indices into those points, takeoff epochMs and the full airborne profile.",
    effect: "read",
    http: { method: "GET", path: "/flights/:flightId" },
    input: FlightId,
    output: FlightDetailSchema,
  }),
  update: action({
    description:
      "Replaces a flight's takeoff and landing site names, notes and equipment.",
    effect: "write",
    http: { method: "PUT", path: "/flights/:flightId" },
    input: Schema.Struct({
      flightId: Schema.String,
      ...FlightUpdateSchema.fields,
    }),
    output: IdResult,
  }),
  delete: action({
    description: "Deletes a flight with its original files and track.",
    effect: "write",
    http: { method: "DELETE", path: "/flights/:flightId" },
    input: FlightId,
    output: IdResult,
  }),
  import: action({
    description:
      "Imports one GPX or IGC track as a flight. A file whose contents or takeoff time match an existing flight returns that flight with status `duplicate`.",
    effect: "write",
    http: { method: "POST", path: "/flights/imports" },
    input: Schema.Struct({ filename: Schema.String, text: Schema.String }),
    output: ImportResultSchema,
    file: {
      contentField: "text",
      filenameField: "filename",
      maxBytes: 5_000_000,
    },
  }),
  stats: {
    get: action({
      description:
        "Logbook totals, activity per month and year, records, recent flights and top takeoff sites.",
      effect: "read",
      http: { method: "GET", path: "/flights/stats" },
      input: NoInput,
      output: DashboardSchema,
    }),
  },
  equipment: {
    list: action({
      description: "Lists the user's equipment, retired items included.",
      effect: "read",
      http: { method: "GET", path: "/flights/equipment" },
      input: NoInput,
      output: Schema.Struct({ equipment: Schema.Array(EquipmentItemSchema) }),
    }),
    create: action({
      description: "Adds a wing, harness, reserve, instrument or other item.",
      effect: "write",
      http: { method: "POST", path: "/flights/equipment" },
      input: EquipmentInputSchema,
      output: EquipmentResult,
    }),
    update: action({
      description: "Replaces one equipment item.",
      effect: "write",
      http: { method: "PUT", path: "/flights/equipment/:equipmentId" },
      input: Schema.Struct({
        equipmentId: Schema.String,
        ...EquipmentInputSchema.fields,
      }),
      output: EquipmentResult,
    }),
    delete: action({
      description:
        "Deletes an equipment item and removes it from every flight.",
      effect: "write",
      http: { method: "DELETE", path: "/flights/equipment/:equipmentId" },
      input: EquipmentId,
      output: IdResult,
    }),
  },
  files: {
    download: action({
      description:
        "Downloads a flight's original GPX or IGC file (at most 5 MB) as base64 with its filename and content type. File ids are in `flights.get`.",
      effect: "read",
      http: { method: "GET", path: "/flights/files/:fileId" },
      input: Schema.Struct({ fileId: Schema.String }),
      output: FilePayloadSchema,
    }),
  },
}
