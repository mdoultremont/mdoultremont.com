import { and, eq, getTableColumns, gte, lte, or, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import {
  Database,
  flights,
  flightFiles,
  flightTracks,
  flightTitles,
  flightAnalyses,
} from "#backend/modules/database"

interface ImportWrite {
  readonly title: string
  readonly analysis: Omit<typeof flightAnalyses.$inferInsert, "flightId">
  readonly flight: typeof flights.$inferInsert
  readonly trackKey: string
  readonly pointsSha256: string
  readonly pointsSizeBytes: number
  readonly pointCount: number
  readonly file: typeof flightFiles.$inferInsert
}
export const DUPLICATE_WINDOW_MS = 120_000
const makeStore = Effect.gen(function* () {
  const database = yield* Database
  const write = Effect.fn("FlightImportStore.write")(function* (
    input: ImportWrite
  ) {
    const { flight, file } = input
    const columns = Object.entries(getTableColumns(flights))
    const values = columns.map(
      ([key]) => flight[key as keyof typeof flight] ?? null
    )
    // D1 serializes the entire batch. The INSERT's duplicate predicates are
    // evaluated at write time, unlike a separate preflight SELECT.
    const result = yield* database.use((db) =>
      db.batch([
        db.insert(flights).select(sql`SELECT ${sql.join(
          values.map((value) => sql`${value}`),
          sql`, `
        )}
        WHERE NOT EXISTS (SELECT 1 FROM flight_files WHERE user_id = ${flight.userId} AND sha256 = ${file.sha256})
        AND NOT EXISTS (SELECT 1 FROM flights WHERE user_id = ${flight.userId} AND takeoff_at BETWEEN ${flight.takeoffAt - DUPLICATE_WINDOW_MS} AND ${flight.takeoffAt + DUPLICATE_WINDOW_MS})`),
        db
          .insert(flightTracks)
          .select(
            sql`SELECT ${flight.id},${input.trackKey},${input.pointsSha256},${input.pointsSizeBytes},${input.pointCount} WHERE EXISTS (SELECT 1 FROM flights WHERE id = ${flight.id} AND user_id = ${flight.userId})`
          ),
        db.insert(flightFiles)
          .select(sql`SELECT ${file.id},${flight.id},${flight.userId},${file.filename},${file.format},${file.contentType},${file.sizeBytes},${file.sha256},${file.objectKey}
        WHERE EXISTS (SELECT 1 FROM flights WHERE id = ${flight.id} AND user_id = ${flight.userId})`),
        db
          .insert(flightTitles)
          .select(
            sql`SELECT ${flight.id}, ${input.title} WHERE EXISTS (SELECT 1 FROM flights WHERE id = ${flight.id} AND user_id = ${flight.userId})`
          ),
        db
          .insert(flightAnalyses)
          .select(
            sql`SELECT ${flight.id}, ${input.analysis.version}, ${input.analysis.objectKey}, ${JSON.stringify(input.analysis.preview)} WHERE EXISTS (SELECT 1 FROM flights WHERE id = ${flight.id} AND user_id = ${flight.userId})`
          ),
        db
          .select({ flightId: flightFiles.flightId })
          .from(flightFiles)
          .where(
            and(
              eq(flightFiles.userId, flight.userId),
              eq(flightFiles.sha256, file.sha256)
            )
          ),
        db
          .select({ flightId: flights.id })
          .from(flights)
          .where(
            and(
              eq(flights.userId, flight.userId),
              or(
                eq(flights.id, flight.id),
                and(
                  gte(
                    flights.takeoffAt,
                    flight.takeoffAt - DUPLICATE_WINDOW_MS
                  ),
                  lte(flights.takeoffAt, flight.takeoffAt + DUPLICATE_WINDOW_MS)
                )
              )
            )
          ),
      ])
    )
    const found = result[5][0] ?? result[6][0]
    if (!found)
      return yield* Effect.die(
        new Error("Import batch did not create or identify a flight")
      )
    return {
      status:
        found.flightId === flight.id
          ? ("imported" as const)
          : ("duplicate" as const),
      flightId: found.flightId,
    }
  })
  /** Cheap pre-check so duplicates never reach object storage; `write` still decides atomically. */
  const findDuplicate = Effect.fn("FlightImportStore.findDuplicate")(function* (
    userId: string,
    sha256: string,
    takeoffAt: number
  ) {
    const rows = yield* database.use((db) =>
      db.batch([
        db
          .select({ flightId: flightFiles.flightId })
          .from(flightFiles)
          .where(
            and(eq(flightFiles.userId, userId), eq(flightFiles.sha256, sha256))
          ),
        db
          .select({ flightId: flights.id })
          .from(flights)
          .where(
            and(
              eq(flights.userId, userId),
              gte(flights.takeoffAt, takeoffAt - DUPLICATE_WINDOW_MS),
              lte(flights.takeoffAt, takeoffAt + DUPLICATE_WINDOW_MS)
            )
          ),
      ])
    )
    return (rows[0][0] ?? rows[1][0])?.flightId
  })
  /** Whether the flight row exists, e.g. to tell if a batch that errored actually committed. */
  const exists = Effect.fn("FlightImportStore.exists")(function* (id: string) {
    const rows = yield* database.use((db) =>
      db.select({ id: flights.id }).from(flights).where(eq(flights.id, id))
    )
    return rows.length > 0
  })
  return { write, findDuplicate, exists }
})
export class FlightImportStore extends Context.Service<
  FlightImportStore,
  Effect.Success<typeof makeStore>
>()("server/actions/flights/FlightImportStore") {
  static readonly layer = Layer.effect(FlightImportStore, makeStore)
}
