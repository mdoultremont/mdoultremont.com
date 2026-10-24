import { and, count, desc, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import {
  Database,
  musicIngestions,
  musicSources,
  musicSourceTracks,
} from "#backend/modules/database"
import type { Source, SourceId } from "@mdoultremont/tools-contracts/music"
import { SourceConflict, SourcePersistenceError } from "./errors"
import { sourceIdFromStorage, storedSourceId } from "./source-id"

type SourceRow = Omit<Source, "present" | "removed" | "latest">

const matches = (ownerId: string, source: SourceId) =>
  and(
    eq(musicSources.ownerId, ownerId),
    eq(musicSources.sourceId, storedSourceId(source))
  )
export class SourceStore extends Context.Service<
  SourceStore,
  {
    readonly seedLiked: (
      ownerId: string,
      now: number
    ) => Effect.Effect<void, SourcePersistenceError>
    readonly get: (
      ownerId: string,
      source: SourceId
    ) => Effect.Effect<SourceRow | null, SourcePersistenceError>
    readonly read: (
      ownerId: string
    ) => Effect.Effect<readonly Source[], SourcePersistenceError>
    readonly add: (
      ownerId: string,
      playlistId: string,
      now: number
    ) => Effect.Effect<void, SourcePersistenceError | SourceConflict>
    readonly setEnabled: (
      ownerId: string,
      source: SourceId,
      enabled: boolean,
      now: number
    ) => Effect.Effect<void, SourcePersistenceError>
    readonly remove: (
      ownerId: string,
      playlistId: string,
      now: number
    ) => Effect.Effect<void, SourcePersistenceError>
  }
>()("server/actions/music/collection/SourceStore") {
  static readonly layer = Layer.effect(
    SourceStore,
    Effect.gen(function* () {
      const database = yield* Database
      const query = <A>(run: Parameters<typeof database.use<A>>[0]) =>
        database
          .use(run)
          .pipe(
            Effect.mapError((cause) => new SourcePersistenceError({ cause }))
          )
      const cancel = (ownerId: string, sourceId: string, now: number) =>
        database.drizzle
          .update(musicIngestions)
          .set({
            status: "failed",
            error: "Source disabled or removed",
            updatedAt: now,
            finishedAt: now,
          })
          .where(
            and(
              eq(musicIngestions.ownerId, ownerId),
              eq(musicIngestions.sourceId, sourceId),
              sql`${musicIngestions.status} IN ('queued', 'running')`
            )
          )

      return SourceStore.of({
        seedLiked: (ownerId, now) =>
          query((db) =>
            db
              .insert(musicSources)
              .values({
                ownerId,
                sourceId: storedSourceId({ kind: "liked" }),
                createdAt: now,
                updatedAt: now,
              })
              .onConflictDoNothing()
          ).pipe(Effect.asVoid),
        get: (ownerId, source) =>
          query((db) =>
            db.select().from(musicSources).where(matches(ownerId, source)).get()
          ).pipe(
            Effect.map((row) =>
              row
                ? { ...row, sourceId: sourceIdFromStorage(row.sourceId) }
                : null
            )
          ),
        read: (ownerId) =>
          query(async (db) => {
            const rows = await db
              .select()
              .from(musicSources)
              .where(eq(musicSources.ownerId, ownerId))
              .orderBy(
                desc(sql`${musicSources.sourceId} = 'liked'`),
                musicSources.createdAt,
                musicSources.sourceId
              )
            return await Promise.all(
              rows.map(async (row): Promise<Source> => {
                const [latest, counts] = await Promise.all([
                  db
                    .select()
                    .from(musicIngestions)
                    .where(
                      and(
                        eq(musicIngestions.ownerId, ownerId),
                        eq(musicIngestions.sourceId, row.sourceId)
                      )
                    )
                    .orderBy(desc(musicIngestions.startedAt), desc(sql`rowid`))
                    .limit(1)
                    .get(),
                  db
                    .select({
                      present: musicSourceTracks.present,
                      count: count(),
                    })
                    .from(musicSourceTracks)
                    .where(
                      and(
                        eq(musicSourceTracks.ownerId, ownerId),
                        eq(musicSourceTracks.sourceId, row.sourceId)
                      )
                    )
                    .groupBy(musicSourceTracks.present),
                ])
                return {
                  ...row,
                  sourceId: sourceIdFromStorage(row.sourceId),
                  present: counts.find((entry) => entry.present)?.count ?? 0,
                  removed: counts.find((entry) => !entry.present)?.count ?? 0,
                  latest: latest
                    ? {
                        ...latest,
                        source: sourceIdFromStorage(latest.sourceId),
                      }
                    : null,
                }
              })
            )
          }),
        add: (ownerId, playlistId, now) =>
          query((db) =>
            db.run(sql`
        INSERT INTO music_sources (owner_id, source_id, created_at, updated_at)
        SELECT ${ownerId}, ${playlistId}, ${now}, ${now}
        WHERE NOT EXISTS (SELECT 1 FROM music_destinations WHERE owner_id = ${ownerId} AND playlist_id = ${playlistId})
          AND NOT EXISTS (SELECT 1 FROM music_settings WHERE owner_id = ${ownerId} AND review_playlist_id = ${playlistId})
        ON CONFLICT(owner_id, source_id) DO UPDATE SET enabled = 1, updated_at = excluded.updated_at
      `)
          ).pipe(
            Effect.flatMap((result) =>
              result.meta.changes === 0
                ? Effect.fail(new SourceConflict())
                : Effect.void
            )
          ),
        setEnabled: (ownerId, source, enabled, now) =>
          query(async (db) => {
            const update = db
              .update(musicSources)
              .set({ enabled, updatedAt: now })
              .where(matches(ownerId, source))
            if (enabled) await update
            else
              await db.batch([
                update,
                cancel(ownerId, storedSourceId(source), now),
              ])
          }),
        remove: (ownerId, playlistId, now) =>
          query(async (db) => {
            await db.batch([
              cancel(ownerId, playlistId, now),
              db
                .delete(musicSourceTracks)
                .where(
                  and(
                    eq(musicSourceTracks.ownerId, ownerId),
                    eq(musicSourceTracks.sourceId, playlistId)
                  )
                ),
              db
                .delete(musicSources)
                .where(matches(ownerId, { kind: "playlist", playlistId })),
            ])
          }),
      })
    })
  )
}
