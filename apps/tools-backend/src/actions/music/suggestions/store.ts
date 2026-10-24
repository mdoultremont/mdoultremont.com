import { and, count, eq, sql } from "drizzle-orm"
import { Array, Context, Data, Effect, Layer, Schema } from "effect"
import { eligibleTrack } from "#backend/actions/music/collection"
import {
  Database,
  musicRecordings,
  musicTracks,
} from "#backend/modules/database"
import { recordingGroups, type RecordingGroupCounts } from "./aggregation"

export class SuggestionPersistenceError extends Data.TaggedError(
  "SuggestionPersistenceError"
)<{
  readonly cause: unknown
}> {
  override get message() {
    return "Recording data for suggestions could not be loaded"
  }
}

const decodeCounts = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Array(Schema.Array(Schema.Number)))
)

export class SuggestionStore extends Context.Service<
  SuggestionStore,
  {
    readonly aggregate: (
      ownerId: string
    ) => Effect.Effect<RecordingGroupCounts, SuggestionPersistenceError>
  }
>()("server/actions/music/SuggestionStore") {
  static readonly layer = Layer.effect(
    SuggestionStore,
    Effect.gen(function* () {
      const database = yield* Database
      return SuggestionStore.of({
        aggregate: (ownerId) =>
          database
            .use(async (db) => {
              const [summary] = await db
                .select({
                  eligibleTracks: count(),
                  analyzedTracks: sql<number>`coalesce(sum(${musicRecordings.acoustic} IS NOT NULL), 0)`,
                  counts: sql<string>`json_array(${sql.join(
                    Array.chunksOf(recordingGroups, 30).map(
                      (groups) =>
                        sql`json_array(${sql.join(
                          groups.map(
                            (group) =>
                              sql`coalesce(sum(CASE WHEN ${group.matches} THEN 1 ELSE 0 END), 0)`
                          ),
                          sql`, `
                        )})`
                    ),
                    sql`, `
                  )})`.mapWith((value) => decodeCounts(value).flat()),
                })
                .from(musicTracks)
                .leftJoin(
                  musicRecordings,
                  and(
                    eq(musicRecordings.isrc, musicTracks.isrc),
                    eq(musicRecordings.status, "found")
                  )
                )
                .where(
                  and(
                    eq(musicTracks.ownerId, ownerId),
                    eligibleTrack(musicTracks.ownerId, musicTracks.trackId)
                  )
                )
              return summary!
            })
            .pipe(
              Effect.mapError(
                (cause) => new SuggestionPersistenceError({ cause })
              )
            ),
      })
    })
  )
}
