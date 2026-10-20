import { and, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import {
  Database,
  flights,
  flightTracks,
  flightAnalyses,
} from "#backend/modules/database"
import type { measuredColumns } from "#backend/actions/flights/track"

const makeStore = Effect.gen(function* () {
  const database = yield* Database
  const read = Effect.fn("FlightPreparationStore.read")(function* (
    userId: string,
    flightId: string
  ) {
    return yield* database.use((db) =>
      db
        .select({
          id: flights.id,
          track: flightTracks,
          analysis: flightAnalyses,
        })
        .from(flights)
        .leftJoin(flightTracks, eq(flightTracks.flightId, flights.id))
        .leftJoin(flightAnalyses, eq(flightAnalyses.flightId, flights.id))
        .where(and(eq(flights.id, flightId), eq(flights.userId, userId)))
        .get()
    )
  })
  const publish = Effect.fn("FlightPreparationStore.publish")(function* (
    userId: string,
    flightId: string,
    track: typeof flightTracks.$inferSelect,
    analysis: typeof flightAnalyses.$inferInsert,
    measured: ReturnType<typeof measuredColumns>
  ) {
    yield* database.use((db) =>
      db.batch([
        db
          .insert(flightAnalyses)
          .select(sql`SELECT ${flightId}, ${analysis.version}, ${analysis.objectKey}, ${JSON.stringify(analysis.preview)}
        WHERE EXISTS (SELECT 1 FROM flights f JOIN flight_tracks t ON t.flight_id = f.id
          WHERE f.id = ${flightId} AND f.user_id = ${userId} AND t.object_key = ${track.objectKey} AND t.sha256 = ${track.sha256})
        AND NOT EXISTS (SELECT 1 FROM flight_analyses WHERE flight_id = ${flightId})`)
          .onConflictDoNothing(),
        db
          .update(flights)
          .set(measured)
          .where(
            and(
              eq(flights.id, flightId),
              eq(flights.userId, userId),
              sql`EXISTS (SELECT 1 FROM flight_analyses WHERE flight_id = ${flightId} AND object_key = ${analysis.objectKey})`
            )
          ),
      ])
    )
  })
  return { read, publish }
})
export class FlightPreparationStore extends Context.Service<
  FlightPreparationStore,
  Effect.Success<typeof makeStore>
>()("server/actions/flights/FlightPreparationStore") {
  static readonly layer = Layer.effect(FlightPreparationStore, makeStore)
}
