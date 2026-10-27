import { eligibleTrack } from "#backend/actions/music/collection"
import { and, eq, inArray, isNotNull, or, type SQL, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import {
  Database,
  musicTracks,
  musicRecordings,
  type RecordingTag,
  type TagSource,
  tagSources,
} from "#backend/modules/database"
import {
  EnrichmentPersistenceError,
  type EnrichmentStatus,
  type TagSourceCoverage,
} from "./errors"
import type { TrackHint } from "./matching"

export type RecordingRow = typeof musicRecordings.$inferInsert
export type LookupStatus = "found" | "not_found" | "failed"
export type TagLookups = Readonly<Record<TagSource, LookupStatus | null>>

/** An ISRC that still needs a MusicBrainz lookup or a tag-source lookup. */
export interface PendingIsrc {
  readonly isrc: string
  readonly track: TrackHint
  /** The MusicBrainz recording found earlier; `null` when not looked up yet. */
  readonly recording: {
    readonly recordingId: string
    readonly title: string
    readonly artistCredit: string
    readonly primaryArtist: string | null
    readonly durationMs: number | null
    readonly tags: readonly RecordingTag[]
    readonly lookups: TagLookups
  } | null
}

const lookupColumns = {
  lastfm: musicRecordings.lastfmStatus,
  discogs: musicRecordings.discogsStatus,
  listenbrainz: musicRecordings.listenbrainzStatus,
} satisfies Record<TagSource, unknown>

/** Clears a not-found or failed tag-source lookup so it runs again. */
const reopen = (column: (typeof lookupColumns)[TagSource]) =>
  sql`CASE WHEN ${column} IN ('not_found', 'failed') THEN NULL ELSE ${column} END`

/** Recording data per ISRC and the queries that find work for enrichment. */
export class EnrichmentStore extends Context.Service<
  EnrichmentStore,
  {
    /**
     * ISRCs of collected tracks with no recording data yet, or whose found
     * recording has not been looked up on one of the given tag sources.
     */
    readonly pending: (
      limit: number,
      sources: readonly TagSource[]
    ) => Effect.Effect<readonly PendingIsrc[], EnrichmentPersistenceError>
    readonly save: (
      row: RecordingRow
    ) => Effect.Effect<void, EnrichmentPersistenceError>
    /** Replaces the tags and lookup results of a found recording. */
    readonly saveTags: (
      isrc: string,
      tags: readonly RecordingTag[],
      lookups: TagLookups
    ) => Effect.Effect<void, EnrichmentPersistenceError>
    readonly status: (
      ownerId: string,
      configured: readonly TagSource[]
    ) => Effect.Effect<EnrichmentStatus, EnrichmentPersistenceError>
    /**
     * Forgets not-found, ambiguous, and failed MusicBrainz lookups, and
     * not-found and failed tag-source lookups, so they are tried again.
     */
    readonly clearUnresolved: () => Effect.Effect<
      number,
      EnrichmentPersistenceError
    >
  }
>()("server/actions/music/enrichment/EnrichmentStore") {
  static readonly layer = Layer.effect(
    EnrichmentStore,
    Effect.gen(function* () {
      const database = yield* Database
      const query = <A>(run: Parameters<typeof database.use<A>>[0]) =>
        database
          .use(run)
          .pipe(
            Effect.mapError(
              (error) => new EnrichmentPersistenceError({ cause: error })
            )
          )

      return EnrichmentStore.of({
        pending: (limit, sources) => {
          const missingTags = sources.map(
            (source) => sql`${lookupColumns[source]} IS NULL`
          )
          const needsWork: SQL[] = [sql`${musicRecordings.isrc} IS NULL`]
          if (missingTags.length > 0)
            needsWork.push(
              and(eq(musicRecordings.status, "found"), or(...missingTags))!
            )
          return query((db) =>
            db
              .select({
                isrc: musicTracks.isrc,
                name: musicTracks.name,
                artistNames: musicTracks.artistNames,
                status: musicRecordings.status,
                recordingId: musicRecordings.recordingId,
                title: musicRecordings.title,
                artistCredit: musicRecordings.artistCredit,
                primaryArtist: musicRecordings.primaryArtist,
                durationMs: musicRecordings.durationMs,
                tags: musicRecordings.tags,
                lastfm: musicRecordings.lastfmStatus,
                discogs: musicRecordings.discogsStatus,
                listenbrainz: musicRecordings.listenbrainzStatus,
              })
              .from(musicTracks)
              .leftJoin(
                musicRecordings,
                eq(musicRecordings.isrc, musicTracks.isrc)
              )
              .where(
                and(
                  eligibleTrack(musicTracks.ownerId, musicTracks.trackId),
                  isNotNull(musicTracks.isrc),
                  or(...needsWork)
                )
              )
              // One row per ISRC; its tracks name the same recording.
              .groupBy(musicTracks.isrc)
              .limit(limit)
          ).pipe(
            Effect.map((rows) =>
              rows.flatMap((row): PendingIsrc[] => {
                if (!row.isrc) return []
                const track = { title: row.name, artists: row.artistNames }
                const found =
                  row.status === "found" &&
                  row.recordingId !== null &&
                  row.title !== null &&
                  row.artistCredit !== null
                return [
                  {
                    isrc: row.isrc,
                    track,
                    recording: found
                      ? {
                          recordingId: row.recordingId!,
                          title: row.title!,
                          artistCredit: row.artistCredit!,
                          primaryArtist: row.primaryArtist,
                          durationMs: row.durationMs,
                          tags: row.tags ?? [],
                          lookups: {
                            lastfm: row.lastfm,
                            discogs: row.discogs,
                            listenbrainz: row.listenbrainz,
                          },
                        }
                      : null,
                  },
                ]
              })
            )
          )
        },

        save: (row) =>
          query((db) =>
            db
              .insert(musicRecordings)
              .values(row)
              .onConflictDoUpdate({ target: musicRecordings.isrc, set: row })
          ).pipe(Effect.asVoid),

        saveTags: (isrc, tags, lookups) =>
          query((db) =>
            db
              .update(musicRecordings)
              .set({
                tags,
                lastfmStatus: lookups.lastfm,
                discogsStatus: lookups.discogs,
                listenbrainzStatus: lookups.listenbrainz,
              })
              .where(eq(musicRecordings.isrc, isrc))
          ).pipe(Effect.asVoid),

        status: (ownerId, configured) =>
          query(async (db) => {
            const scope = and(
              eq(musicTracks.ownerId, ownerId),
              eligibleTrack(musicTracks.ownerId, musicTracks.trackId)
            )
            const rows = await db
              .select({
                status: musicRecordings.status,
                hasIsrc: sql<number>`${musicTracks.isrc} IS NOT NULL`,
                hasAnalysis: sql<number>`${musicRecordings.acoustic} IS NOT NULL`,
                count: sql<number>`count(*)`,
              })
              .from(musicTracks)
              .leftJoin(
                musicRecordings,
                eq(musicRecordings.isrc, musicTracks.isrc)
              )
              .where(scope)
              .groupBy(
                musicRecordings.status,
                sql`${musicTracks.isrc} IS NOT NULL`,
                sql`${musicRecordings.acoustic} IS NOT NULL`
              )
            const recordings = await db
              .select({
                match: musicRecordings.match,
                hasTags: sql<number>`coalesce(json_array_length(${musicRecordings.tags}), 0) > 0`,
                lastfm: musicRecordings.lastfmStatus,
                discogs: musicRecordings.discogsStatus,
                listenbrainz: musicRecordings.listenbrainzStatus,
                count: sql<number>`count(*)`,
              })
              .from(musicTracks)
              .innerJoin(
                musicRecordings,
                eq(musicRecordings.isrc, musicTracks.isrc)
              )
              .where(and(scope, eq(musicRecordings.status, "found")))
              .groupBy(
                musicRecordings.match,
                sql`coalesce(json_array_length(${musicRecordings.tags}), 0) > 0`,
                musicRecordings.lastfmStatus,
                musicRecordings.discogsStatus,
                musicRecordings.listenbrainzStatus
              )
            const sumFound = (
              match: (row: (typeof recordings)[number]) => boolean
            ) =>
              recordings
                .filter(match)
                .reduce((total, row) => total + row.count, 0)
            const sum = (match: (row: (typeof rows)[number]) => boolean) =>
              rows.filter(match).reduce((total, row) => total + row.count, 0)
            return {
              enriched: sum((row) => row.status === "found"),
              withAnalysis: sum(
                (row) => row.status === "found" && Boolean(row.hasAnalysis)
              ),
              matchedBySearch: sumFound((row) => row.match === "search"),
              withTags: sumFound((row) => Boolean(row.hasTags)),
              notFound: sum((row) => row.status === "not_found"),
              ambiguous: sum((row) => row.status === "ambiguous"),
              failed: sum((row) => row.status === "failed"),
              pending: sum(
                (row) => row.status === null && Boolean(row.hasIsrc)
              ),
              withoutIsrc: sum((row) => !row.hasIsrc),
              sources: tagSources.map((source): TagSourceCoverage => ({
                source,
                configured: configured.includes(source),
                found: sumFound((row) => row[source] === "found"),
                notFound: sumFound((row) => row[source] === "not_found"),
                failed: sumFound((row) => row[source] === "failed"),
                pending: configured.includes(source)
                  ? sumFound((row) => row[source] === null)
                  : 0,
              })),
            } satisfies EnrichmentStatus
          }),

        clearUnresolved: () =>
          query(async (db) => {
            const deleted = await db
              .delete(musicRecordings)
              .where(
                inArray(musicRecordings.status, [
                  "not_found",
                  "ambiguous",
                  "failed",
                ])
              )
              .returning({ isrc: musicRecordings.isrc })
            const unresolved = ["not_found", "failed"] as const
            const reset = await db
              .update(musicRecordings)
              .set({
                lastfmStatus: reopen(musicRecordings.lastfmStatus),
                discogsStatus: reopen(musicRecordings.discogsStatus),
                listenbrainzStatus: reopen(musicRecordings.listenbrainzStatus),
              })
              .where(
                or(
                  ...tagSources.map((source) =>
                    inArray(lookupColumns[source], unresolved)
                  )
                )
              )
              .returning({ isrc: musicRecordings.isrc })
            return deleted.length + reset.length
          }),
      })
    })
  )
}
