import { Effect } from "effect"
import { Base64 } from "effect/encoding"
import { Equipment } from "#backend/actions/flights/equipment"
import { Flights } from "#backend/actions/flights/flights"
import { FlightPreparation } from "#backend/actions/flights/prepare"
import { FlightImport } from "#backend/actions/flights/import"
import { FlightStats } from "#backend/actions/flights/stats"
import { catalog } from "@mdoultremont/tools-contracts"
import { bind } from "./bind"

const actions = catalog.flights

const readAll = (body: ReadableStream<Uint8Array>) =>
  Effect.promise(() => new Response(body).arrayBuffer()).pipe(
    Effect.map((buffer) => new Uint8Array(buffer))
  )

export const flightsHandlers = {
  list: bind(actions.list, Flights.layer, (input, caller) =>
    Flights.use((flights) => flights.list(caller.userId, input.year)).pipe(
      Effect.map((flights) => ({ flights }))
    )
  ),
  get: bind(actions.get, Flights.layer, (input, caller) =>
    Flights.use((flights) => flights.detail(caller.userId, input.flightId))
  ),
  prepare: bind(actions.prepare, FlightPreparation.layer, (input, caller) =>
    FlightPreparation.use((preparation) =>
      preparation.prepare(caller.userId, input.flightId)
    )
  ),
  update: bind(
    actions.update,
    Flights.layer,
    ({ flightId, ...update }, caller) =>
      Flights.use((flights) => flights.update(caller.userId, flightId, update))
  ),
  delete: bind(actions.delete, Flights.layer, (input, caller) =>
    Flights.use((flights) => flights.remove(caller.userId, input.flightId))
  ),
  import: bind(actions.import, FlightImport.layer, (input, caller) =>
    FlightImport.use((importer) => importer.importFile(caller.userId, input))
  ),
  stats: {
    get: bind(actions.stats.get, FlightStats.layer, (_, caller) =>
      FlightStats.use((stats) => stats.dashboard(caller.userId))
    ),
  },
  equipment: {
    list: bind(actions.equipment.list, Equipment.layer, (_, caller) =>
      Equipment.use((equipment) => equipment.list(caller.userId)).pipe(
        Effect.map((equipment) => ({ equipment }))
      )
    ),
    create: bind(actions.equipment.create, Equipment.layer, (input, caller) =>
      Equipment.use((equipment) => equipment.create(caller.userId, input)).pipe(
        Effect.map((equipment) => ({ equipment }))
      )
    ),
    update: bind(
      actions.equipment.update,
      Equipment.layer,
      ({ equipmentId, ...item }, caller) =>
        Equipment.use((equipment) =>
          equipment.update(caller.userId, equipmentId, item)
        ).pipe(Effect.map((equipment) => ({ equipment })))
    ),
    delete: bind(actions.equipment.delete, Equipment.layer, (input, caller) =>
      Equipment.use((equipment) =>
        equipment.remove(caller.userId, input.equipmentId)
      )
    ),
  },
  files: {
    download: bind(actions.files.download, Flights.layer, (input, caller) =>
      Effect.gen(function* () {
        const file = yield* Flights.use((flights) =>
          flights.download(caller.userId, input.fileId)
        )
        const bytes = yield* readAll(file.body)
        return {
          filename: file.filename,
          contentType: file.contentType,
          sizeBytes: bytes.byteLength,
          contentBase64: Base64.encode(bytes),
        }
      })
    ),
  },
}
