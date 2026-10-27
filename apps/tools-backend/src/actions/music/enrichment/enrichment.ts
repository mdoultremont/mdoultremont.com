import { Clock, Context, Effect, Layer, Option } from "effect"
import {
  AcousticBrainz,
  type AcousticBrainzError,
} from "#backend/modules/acousticbrainz"
import type { RecordingTag, TagSource } from "#backend/modules/database"
import { Discogs, type DiscogsError } from "#backend/modules/discogs"
import { LastFm, type LastFmError } from "#backend/modules/lastfm"
import {
  ListenBrainz,
  type ListenBrainzError,
} from "#backend/modules/listenbrainz"
import {
  MusicBrainz,
  type MusicBrainzError,
} from "#backend/modules/musicbrainz"
import { JobQueue, type JobQueueError } from "#backend/modules/job-queue"
import {
  EnrichmentMessage,
  type EnrichmentPersistenceError,
  type EnrichmentStatus,
} from "./errors"
import {
  matchIsrcRecordings,
  matchSearchResults,
  searchTitle,
} from "./matching"
import {
  EnrichmentStore,
  type LookupStatus,
  type PendingIsrc,
  type TagLookups,
} from "./store"

/**
 * ISRCs looked up per queue message. Each takes one or two MusicBrainz
 * requests, then the other sources side by side: under a minute per batch.
 */
const batchSize = 10
/** Keeps the request spacing across messages, which start a fresh client. */
const continuationDelaySeconds = 2

export type EnrichmentError =
  | EnrichmentPersistenceError
  | JobQueueError
  | MusicBrainzError
  | AcousticBrainzError

/** The MusicBrainz fields tag sources are asked about. */
interface FoundRecording {
  readonly recordingId: string
  readonly title: string
  readonly artistCredit: string
  readonly primaryArtist: string | null
  readonly durationMs: number | null
}

interface TagSourceLookup {
  readonly source: TagSource
  readonly configured: boolean
  readonly lookup: (
    recording: FoundRecording
  ) => Effect.Effect<
    readonly Omit<RecordingTag, "source">[],
    LastFmError | DiscogsError | ListenBrainzError
  >
}

const notAsked: TagLookups = {
  lastfm: null,
  discogs: null,
  listenbrainz: null,
}

/**
 * Enrichment: attaching recording data to collected tracks, once per ISRC.
 * MusicBrainz identifies the recording; AcousticBrainz, Last.fm, Discogs, and
 * ListenBrainz add to it when they know it, and none of them is required.
 */
export class MusicEnrichment extends Context.Service<
  MusicEnrichment,
  {
    /** Queues a lookup batch. Safe to call often: a batch with no work ends at once. */
    readonly request: (ownerId: string) => Effect.Effect<void, JobQueueError>
    /** Looks up one batch of ISRCs and queues the next while work remains. */
    readonly processNext: (
      ownerId: string
    ) => Effect.Effect<{ readonly looked: number }, EnrichmentError>
    readonly status: (
      ownerId: string
    ) => Effect.Effect<EnrichmentStatus, EnrichmentPersistenceError>
    /** Looks up unresolved ISRCs and tag-source misses again. */
    readonly retryUnresolved: (
      ownerId: string
    ) => Effect.Effect<number, EnrichmentPersistenceError | JobQueueError>
  }
>()("server/actions/music/MusicEnrichment") {
  static readonly layerNoDeps = Layer.effect(
    MusicEnrichment,
    Effect.gen(function* () {
      const store = yield* EnrichmentStore
      const musicBrainz = yield* MusicBrainz
      const acousticBrainz = yield* AcousticBrainz
      const lastFm = yield* LastFm
      const discogs = yield* Discogs
      const listenBrainz = yield* ListenBrainz
      const queue = yield* JobQueue

      const tagSources: readonly TagSourceLookup[] = [
        {
          source: "lastfm",
          configured: lastFm.configured,
          lookup: (recording) =>
            lastFm.tags({
              title: recording.title,
              artist: recording.primaryArtist ?? recording.artistCredit,
            }),
        },
        {
          source: "discogs",
          configured: discogs.configured,
          lookup: (recording) =>
            discogs
              .release({
                ...recording,
                primaryArtist:
                  recording.primaryArtist ?? recording.artistCredit,
              })
              .pipe(
                Effect.map(
                  Option.match({
                    onNone: () => [],
                    onSome: (release) =>
                      [...release.genres, ...release.styles].map((name) => ({
                        scope: "release" as const,
                        name: name.toLowerCase(),
                        weight: 1,
                      })),
                  })
                )
              ),
        },
        {
          source: "listenbrainz",
          configured: true,
          lookup: (recording) => listenBrainz.genres(recording.recordingId),
        },
      ]
      const configured = tagSources
        .filter((entry) => entry.configured)
        .map((entry) => entry.source)

      const request = (ownerId: string) =>
        queue.send(
          EnrichmentMessage.make({ kind: "music.enrichment", ownerId }),
          { delaySeconds: continuationDelaySeconds }
        )

      /**
       * Asks every configured source not asked yet. A source's tags replace
       * its earlier ones only when it finds some, so a miss or a failure on a
       * retry never erases what an earlier lookup found. Failures are
       * recorded rather than retried at once: "Look up unresolved tracks
       * again" asks again.
       */
      const lookupTags = Effect.fn("MusicEnrichment.lookupTags")(function* (
        recording: FoundRecording,
        previous: {
          readonly tags: readonly RecordingTag[]
          readonly lookups: TagLookups
        }
      ) {
        const asked = tagSources.filter(
          (entry) => entry.configured && previous.lookups[entry.source] === null
        )
        const results = yield* Effect.forEach(
          asked,
          ({ source, lookup }) =>
            lookup(recording).pipe(
              Effect.map((tags) => ({
                source,
                status: (tags.length > 0
                  ? "found"
                  : "not_found") as LookupStatus,
                tags: tags.map((tag): RecordingTag => ({ ...tag, source })),
              })),
              Effect.catch((error) =>
                Effect.logWarning(
                  `${source} lookup failed`,
                  error.message
                ).pipe(
                  Effect.as({
                    source,
                    status: "failed" as LookupStatus,
                    tags: [] as RecordingTag[],
                  })
                )
              )
            ),
          { concurrency: "unbounded" }
        )
        const replaced = new Set(
          results
            .filter((result) => result.status === "found")
            .map((result) => result.source)
        )
        const lookups = { ...previous.lookups }
        for (const result of results) lookups[result.source] = result.status
        return {
          tags: [
            ...previous.tags.filter((tag) => !replaced.has(tag.source)),
            ...results.flatMap((result) => result.tags),
          ],
          lookups,
        }
      })

      /** By ISRC first; by title and artist only when MusicBrainz does not know the ISRC. */
      const findRecording = Effect.fn("MusicEnrichment.findRecording")(
        function* ({ isrc, track }: PendingIsrc) {
          const recordings = yield* musicBrainz.recordingsByIsrc(isrc)
          if (recordings.length > 0)
            return {
              ...matchIsrcRecordings(recordings, track),
              match: "isrc" as const,
            }
          const [artist] = track.artists
          if (artist === undefined)
            return { kind: "not_found" as const, match: "isrc" as const }
          const results = yield* musicBrainz.searchRecordings({
            title: searchTitle(track.title),
            artist,
          })
          return {
            ...matchSearchResults(results, track),
            match: "search" as const,
          }
        }
      )

      /**
       * Retryable MusicBrainz failures stop the batch and propagate, so the
       * queue retries later. Anything else is recorded against the ISRC and
       * the batch moves on.
       */
      const enrich = Effect.fn("MusicEnrichment.enrich")(function* (
        pending: PendingIsrc
      ) {
        const { isrc } = pending
        if (pending.recording !== null) {
          const { tags, lookups } = yield* lookupTags(
            pending.recording,
            pending.recording
          )
          return yield* store.saveTags(isrc, tags, lookups)
        }
        const fetchedAt = yield* Clock.currentTimeMillis
        const found = yield* findRecording(pending).pipe(
          Effect.catchIf(
            (error) => !error.retryable,
            (error) =>
              store
                .save({
                  isrc,
                  status: "failed",
                  error: error.message,
                  fetchedAt,
                })
                .pipe(Effect.as(null))
          )
        )
        if (found === null) return
        if (found.kind !== "found")
          return yield* store.save({ isrc, status: found.kind, fetchedAt })
        const { recording } = found
        const recordingData: FoundRecording = {
          recordingId: recording.id,
          title: recording.title,
          artistCredit: recording.artistCredit,
          primaryArtist: recording.primaryArtist || null,
          durationMs: recording.durationMs,
        }
        const [analysis, { tags, lookups }] = yield* Effect.all(
          [
            // The analysis is optional: AcousticBrainz is read-only, lacks
            // every recording made after 2022, and an outage must not stop
            // MusicBrainz lookups for every other track.
            acousticBrainz
              .analysis(recording.id)
              .pipe(
                Effect.catch((error) =>
                  Effect.logWarning(
                    "AcousticBrainz analysis skipped",
                    error.message
                  ).pipe(Effect.as(Option.none()))
                )
              ),
            lookupTags(recordingData, { tags: [], lookups: notAsked }),
          ],
          { concurrency: "unbounded" }
        )
        yield* store.save({
          isrc,
          status: "found",
          match: found.match,
          ...recordingData,
          acoustic: Option.getOrNull(analysis),
          tags,
          lastfmStatus: lookups.lastfm,
          discogsStatus: lookups.discogs,
          listenbrainzStatus: lookups.listenbrainz,
          fetchedAt,
        })
      })

      const processNext = Effect.fn("MusicEnrichment.processNext")(function* (
        ownerId: string
      ) {
        const pending = yield* store.pending(batchSize, configured)
        for (const item of pending) yield* enrich(item)
        if (pending.length === batchSize) yield* request(ownerId)
        return { looked: pending.length }
      })

      const status = Effect.fn("MusicEnrichment.status")(function* (
        ownerId: string
      ) {
        return yield* store.status(ownerId, configured)
      })

      const retryUnresolved = Effect.fn("MusicEnrichment.retryUnresolved")(
        function* (ownerId: string) {
          const cleared = yield* store.clearUnresolved()
          if (cleared > 0) yield* request(ownerId)
          return cleared
        }
      )

      return MusicEnrichment.of({
        request,
        processNext,
        status,
        retryUnresolved,
      })
    })
  )

  /** Production layer. Needs the platform (`Database`, `JobQueue`, config). */
  static readonly layer = MusicEnrichment.layerNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(
        EnrichmentStore.layer,
        MusicBrainz.layer,
        AcousticBrainz.layer,
        LastFm.layer,
        Discogs.layer,
        ListenBrainz.layer
      )
    )
  )
}
