import { and, desc, eq, getTableColumns, gte, lt, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import {
  Database,
  type DatabaseError,
  flights,
  flightFiles,
  flightTracks,
  flightTitles,
  flightAnalyses,
  flightEquipment,
  flightEquipmentItems,
} from "#backend/modules/database"
import type { Flight, FlightUpdate, EquipmentItem } from "./errors"

const owned = (userId: string, id: string) =>
  and(eq(flights.userId, userId), eq(flights.id, id))

/** Four fixed parameters per statement plus one per id stay under D1's 100 limit. */
const EQUIPMENT_LINKS_PER_STATEMENT = 90
const chunks = <T>(items: readonly T[], size: number) => {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size)
    result.push(items.slice(i, i + size))
  return result
}

const makeStore = Effect.gen(function* () {
  const database = yield* Database
  const listAll = Effect.fn("FlightStore.list")(function* (
    userId: string,
    year?: number
  ) {
    return yield* database.use((db) =>
      db
        .select()
        .from(flights)
        .where(
          and(
            eq(flights.userId, userId),
            year === undefined
              ? undefined
              : and(
                  gte(flights.takeoffAt, Date.UTC(year, 0, 1)),
                  lt(flights.takeoffAt, Date.UTC(year + 1, 0, 1))
                )
          )
        )
        .orderBy(desc(flights.takeoffAt), desc(flights.id))
        .all()
    )
  })
  const list = Effect.fn("FlightStore.listSummaries")(function* (
    userId: string,
    year?: number
  ) {
    return yield* database.use((db) =>
      db
        .select({
          id: flights.id,
          title: flightTitles.title,
          takeoffAt: flights.takeoffAt,
          takeoffName: flights.takeoffName,
          durationS: flights.durationS,
          distanceM: flights.distanceM,
          maxAltM: flights.maxAltM,
          maxSpeedMps: flights.maxSpeedMps,
          source: flights.source,
          preview: flightAnalyses.preview,
          analysisId: flightAnalyses.flightId,
          pointCount: flightTracks.pointCount,
        })
        .from(flights)
        .leftJoin(flightTitles, eq(flightTitles.flightId, flights.id))
        .leftJoin(flightAnalyses, eq(flightAnalyses.flightId, flights.id))
        .leftJoin(flightTracks, eq(flightTracks.flightId, flights.id))
        .where(
          and(
            eq(flights.userId, userId),
            year === undefined
              ? undefined
              : and(
                  gte(flights.takeoffAt, Date.UTC(year, 0, 1)),
                  lt(flights.takeoffAt, Date.UTC(year + 1, 0, 1))
                )
          )
        )
        .orderBy(desc(flights.takeoffAt), desc(flights.id))
        .all()
    )
  })
  const detail = Effect.fn("FlightStore.detail")(function* (
    userId: string,
    id: string
  ) {
    return yield* database.use((db) =>
      db.batch([
        db
          .select({ ...getTableColumns(flights), title: flightTitles.title })
          .from(flights)
          .leftJoin(flightTitles, eq(flightTitles.flightId, flights.id))
          .where(owned(userId, id)),
        db
          .select(getTableColumns(flightEquipmentItems))
          .from(flightEquipment)
          .innerJoin(
            flightEquipmentItems,
            eq(flightEquipmentItems.id, flightEquipment.equipmentId)
          )
          .innerJoin(flights, eq(flights.id, flightEquipment.flightId))
          .where(
            and(owned(userId, id), eq(flightEquipmentItems.userId, userId))
          ),
        db
          .select({
            id: flightFiles.id,
            filename: flightFiles.filename,
            format: flightFiles.format,
            sha256: flightFiles.sha256,
            sizeBytes: flightFiles.sizeBytes,
          })
          .from(flightFiles)
          .where(
            and(eq(flightFiles.userId, userId), eq(flightFiles.flightId, id))
          ),
        db
          .select(getTableColumns(flightTracks))
          .from(flightTracks)
          .innerJoin(flights, eq(flights.id, flightTracks.flightId))
          .where(owned(userId, id)),
        db
          .select(getTableColumns(flightAnalyses))
          .from(flightAnalyses)
          .innerJoin(flights, eq(flights.id, flightAnalyses.flightId))
          .where(owned(userId, id)),
      ])
    )
  })
  const equipment = Effect.fn("FlightStore.equipment")(function* (
    userId: string
  ) {
    return yield* database.use((db) =>
      db
        .select()
        .from(flightEquipmentItems)
        .where(eq(flightEquipmentItems.userId, userId))
        .all()
    )
  })
  const update = Effect.fn("FlightStore.update")(function* (
    userId: string,
    id: string,
    input: FlightUpdate,
    now: number
  ) {
    // Each conditional insert verifies ownership again inside the atomic D1 batch.
    // Links go in multi-row statements chunked below D1's 100-parameter limit.
    return yield* database.use((db) =>
      db.batch([
        db
          .update(flights)
          .set({
            takeoffName: input.takeoffName || null,
            landingName: input.landingName || null,
            notes: input.notes || null,
            updatedAt: now,
          })
          .where(owned(userId, id))
          .returning({ id: flights.id }),
        db
          .delete(flightEquipment)
          .where(
            and(
              eq(flightEquipment.flightId, id),
              sql`EXISTS (SELECT 1 FROM flights WHERE id = ${id} AND user_id = ${userId})`
            )
          ),
        ...(input.title === undefined
          ? []
          : [
              db
                .insert(flightTitles)
                .select(
                  sql`SELECT ${id}, ${input.title} WHERE EXISTS (SELECT 1 FROM flights WHERE id = ${id} AND user_id = ${userId})`
                )
                .onConflictDoUpdate({
                  target: flightTitles.flightId,
                  set: { title: input.title },
                }),
            ]),
        ...chunks(input.equipmentIds, EQUIPMENT_LINKS_PER_STATEMENT).map(
          (ids) =>
            db.insert(flightEquipment).select(
              sql`SELECT ${id}, id FROM equipment WHERE user_id = ${userId} AND id IN (${sql.join(
                ids.map((equipmentId) => sql`${equipmentId}`),
                sql`, `
              )}) AND EXISTS (SELECT 1 FROM flights WHERE id = ${id} AND user_id = ${userId})`
            )
        ),
      ])
    )
  })
  const remove = Effect.fn("FlightStore.remove")(function* (
    userId: string,
    id: string
  ) {
    return yield* database.use((db) =>
      db.delete(flights).where(owned(userId, id)).returning({ id: flights.id })
    )
  })
  const file = Effect.fn("FlightStore.file")(function* (
    userId: string,
    id: string
  ) {
    return yield* database.use((db) =>
      db
        .select()
        .from(flightFiles)
        .innerJoin(flights, eq(flights.id, flightFiles.flightId))
        .where(
          and(
            eq(flightFiles.id, id),
            eq(flightFiles.userId, userId),
            eq(flights.userId, userId)
          )
        )
        .get()
    )
  })
  return { list, listAll, detail, equipment, update, remove, file }
})

export class FlightStore extends Context.Service<
  FlightStore,
  Effect.Success<typeof makeStore>
>()("server/actions/flights/FlightStore") {
  static readonly layer = Layer.effect(FlightStore, makeStore)
}
export type { DatabaseError, Flight, EquipmentItem }
