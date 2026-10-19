import { and, desc, eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database, flightEquipmentItems } from "#backend/modules/database"

export interface EquipmentInput {
  readonly kind: "wing" | "harness" | "reserve" | "instrument" | "other"
  readonly name: string
  readonly notes: string
  readonly retired: boolean
}
const makeStore = Effect.gen(function* () {
  const database = yield* Database
  const list = Effect.fn("EquipmentStore.list")(function* (userId: string) {
    return yield* database.use((db) =>
      db
        .select()
        .from(flightEquipmentItems)
        .where(eq(flightEquipmentItems.userId, userId))
        .orderBy(
          desc(flightEquipmentItems.createdAt),
          desc(flightEquipmentItems.id)
        )
        .all()
    )
  })
  const create = Effect.fn("EquipmentStore.create")(function* (
    userId: string,
    input: EquipmentInput,
    now: number,
    id: string
  ) {
    return yield* database.use((db) =>
      db
        .insert(flightEquipmentItems)
        .values({
          ...input,
          notes: input.notes || null,
          userId,
          id,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
    )
  })
  const update = Effect.fn("EquipmentStore.update")(function* (
    userId: string,
    id: string,
    input: EquipmentInput,
    now: number
  ) {
    return yield* database.use((db) =>
      db
        .update(flightEquipmentItems)
        .set({ ...input, notes: input.notes || null, updatedAt: now })
        .where(
          and(
            eq(flightEquipmentItems.userId, userId),
            eq(flightEquipmentItems.id, id)
          )
        )
        .returning()
    )
  })
  const remove = Effect.fn("EquipmentStore.remove")(function* (
    userId: string,
    id: string
  ) {
    return yield* database.use((db) =>
      db
        .delete(flightEquipmentItems)
        .where(
          and(
            eq(flightEquipmentItems.userId, userId),
            eq(flightEquipmentItems.id, id)
          )
        )
        .returning({ id: flightEquipmentItems.id })
    )
  })
  return { list, create, update, remove }
})
export class EquipmentStore extends Context.Service<
  EquipmentStore,
  Effect.Success<typeof makeStore>
>()("server/actions/flights/EquipmentStore") {
  static readonly layer = Layer.effect(EquipmentStore, makeStore)
}
