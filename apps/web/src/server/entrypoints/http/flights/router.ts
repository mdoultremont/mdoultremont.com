import { implement } from "@orpc/server"
import { Effect } from "effect"
import { Equipment } from "@/server/actions/flights/equipment"
import { Flights } from "@/server/actions/flights/flights"
import { FlightImport } from "@/server/actions/flights/import"
import { FlightStats } from "@/server/actions/flights/stats"
import { flightsContract } from "@/shared/flights/contract"
import type { platformLayer } from "../../platform"
import { FlightRequestTooLarge, runProcedure } from "./errors"

/** What every procedure receives: the signed-in user and the request's platform layer. */
export interface FlightsContext {
  readonly userId: string
  readonly platform: ReturnType<typeof platformLayer>
}

const maxImportTextBytes = 5_000_000

const os = implement(flightsContract).$context<FlightsContext>()

export const flightsRouter = os.router({
  list: os.list.handler(({ input, context }) =>
    runProcedure(
      Flights.use((flights) => flights.list(context.userId, input.year)).pipe(
        Effect.map((flights) => ({ flights }))
      ),
      Flights.layer,
      context.platform
    )
  ),
  get: os.get.handler(({ input, context }) =>
    runProcedure(
      Flights.use((flights) => flights.detail(context.userId, input.flightId)),
      Flights.layer,
      context.platform
    )
  ),
  update: os.update.handler(({ input: { flightId, ...update }, context }) =>
    runProcedure(
      Flights.use((flights) =>
        flights.update(context.userId, flightId, update)
      ),
      Flights.layer,
      context.platform
    )
  ),
  delete: os.delete.handler(({ input, context }) =>
    runProcedure(
      Flights.use((flights) => flights.remove(context.userId, input.flightId)),
      Flights.layer,
      context.platform
    )
  ),
  import: os.import.handler(({ input, context }) =>
    runProcedure(
      Effect.gen(function* () {
        if (
          new TextEncoder().encode(input.text).byteLength > maxImportTextBytes
        )
          return yield* new FlightRequestTooLarge({
            message: "Flight file text exceeds 5 MB",
          })
        const importer = yield* FlightImport
        return yield* importer.importFile(context.userId, input)
      }),
      FlightImport.layer,
      context.platform
    )
  ),
  stats: {
    get: os.stats.get.handler(({ context }) =>
      runProcedure(
        FlightStats.use((stats) => stats.dashboard(context.userId)),
        FlightStats.layer,
        context.platform
      )
    ),
  },
  equipment: {
    list: os.equipment.list.handler(({ context }) =>
      runProcedure(
        Equipment.use((equipment) => equipment.list(context.userId)).pipe(
          Effect.map((equipment) => ({ equipment }))
        ),
        Equipment.layer,
        context.platform
      )
    ),
    create: os.equipment.create.handler(({ input, context }) =>
      runProcedure(
        Equipment.use((equipment) =>
          equipment.create(context.userId, input)
        ).pipe(Effect.map((equipment) => ({ equipment }))),
        Equipment.layer,
        context.platform
      )
    ),
    update: os.equipment.update.handler(
      ({ input: { equipmentId, ...item }, context }) =>
        runProcedure(
          Equipment.use((equipment) =>
            equipment.update(context.userId, equipmentId, item)
          ).pipe(Effect.map((equipment) => ({ equipment }))),
          Equipment.layer,
          context.platform
        )
    ),
    delete: os.equipment.delete.handler(({ input, context }) =>
      runProcedure(
        Equipment.use((equipment) =>
          equipment.remove(context.userId, input.equipmentId)
        ),
        Equipment.layer,
        context.platform
      )
    ),
  },
})
