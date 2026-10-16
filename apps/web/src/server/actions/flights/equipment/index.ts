import { Clock, Context, Effect, Layer } from "effect"
import {
  FlightInputError,
  FlightNotFound,
} from "@/server/actions/flights/flights"
import { EquipmentStore, type EquipmentInput } from "./store"
export type { EquipmentInput } from "./store"
export type { EquipmentItem } from "@/server/actions/flights/flights"

const validate = (input: EquipmentInput) =>
  !input.name.trim() || input.name.length > 200 || input.notes.length > 5000
    ? Effect.fail(
        new FlightInputError({
          message:
            "Enter equipment with a name of 1–200 characters and notes up to 5000 characters",
        })
      )
    : Effect.succeed({
        ...input,
        name: input.name.trim(),
        notes: input.notes.trim(),
      })
const makeEquipment = Effect.gen(function* () {
  const store = yield* EquipmentStore
  const list = Effect.fn("Equipment.list")(function* (userId: string) {
    return yield* store.list(userId)
  })
  const create = Effect.fn("Equipment.create")(function* (
    userId: string,
    input: EquipmentInput
  ) {
    const value = yield* validate(input)
    const rows = yield* store.create(
      userId,
      value,
      yield* Clock.currentTimeMillis,
      crypto.randomUUID()
    )
    return rows[0]!
  })
  const update = Effect.fn("Equipment.update")(function* (
    userId: string,
    id: string,
    input: EquipmentInput
  ) {
    const value = yield* validate(input)
    const rows = yield* store.update(
      userId,
      id,
      value,
      yield* Clock.currentTimeMillis
    )
    if (!rows[0])
      return yield* new FlightNotFound({ message: "Equipment not found" })
    return rows[0]
  })
  const remove = Effect.fn("Equipment.remove")(function* (
    userId: string,
    id: string
  ) {
    const rows = yield* store.remove(userId, id)
    if (!rows[0])
      return yield* new FlightNotFound({ message: "Equipment not found" })
    return { id }
  })
  return { list, create, update, remove }
})
export class Equipment extends Context.Service<
  Equipment,
  Effect.Success<typeof makeEquipment>
>()("server/actions/flights/Equipment") {
  static readonly layerNoDeps = Layer.effect(Equipment, makeEquipment)
  static readonly layer = Equipment.layerNoDeps.pipe(
    Layer.provide(EquipmentStore.layer)
  )
}
