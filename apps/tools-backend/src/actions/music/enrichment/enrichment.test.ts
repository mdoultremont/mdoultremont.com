import { assert, describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { vi } from "vitest"
import {
  AcousticBrainz,
  AcousticBrainzError,
} from "#backend/modules/acousticbrainz"
import {
  MusicBrainz,
  MusicBrainzError,
  type MusicBrainzRecording,
} from "#backend/modules/musicbrainz"
import { Database } from "#backend/modules/database"
import { Discogs } from "#backend/modules/discogs"
import { LastFm, LastFmError } from "#backend/modules/lastfm"
import { ListenBrainz } from "#backend/modules/listenbrainz"
import { makeTestD1 } from "#backend/modules/database/testing"
import { JobQueue } from "#backend/modules/job-queue"
import { EnrichmentStore, MusicEnrichment } from "."

const recording = (id: string): MusicBrainzRecording => ({
  id,
  title: `Title ${id}`,
  artistCredit: "Artist",
  primaryArtist: "Artist",
  durationMs: 1000,
})

const analysis = {
  bpm: 120,
  danceability: 0.8,
  mood: { happy: 0.7 },
  genre: { "genre_rosamerica:pop": 0.6 },
}

function setup(options: { readonly discogs?: boolean } = {}) {
  const d1 = makeTestD1()
  d1.seedOwner()
  const recordingsByIsrc = vi.fn<MusicBrainz["Service"]["recordingsByIsrc"]>(
    () => Effect.succeed([])
  )
  const searchRecordings = vi.fn<MusicBrainz["Service"]["searchRecordings"]>(
    () => Effect.succeed([])
  )
  const analysisFor = vi.fn<AcousticBrainz["Service"]["analysis"]>(() =>
    Effect.succeed(Option.none())
  )
  const lastFmTags = vi.fn<LastFm["Service"]["tags"]>(() => Effect.succeed([]))
  const discogsRelease = vi.fn<Discogs["Service"]["release"]>(() =>
    Effect.succeed(Option.none())
  )
  const genres = vi.fn<ListenBrainz["Service"]["genres"]>(() =>
    Effect.succeed([])
  )
  const sent: unknown[] = []
  const layer = MusicEnrichment.layerNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(
        EnrichmentStore.layer,
        Layer.succeed(
          MusicBrainz,
          MusicBrainz.of({ recordingsByIsrc, searchRecordings })
        ),
        Layer.succeed(
          AcousticBrainz,
          AcousticBrainz.of({ analysis: analysisFor })
        ),
        Layer.succeed(
          LastFm,
          LastFm.of({ configured: true, tags: lastFmTags })
        ),
        Layer.succeed(
          Discogs,
          Discogs.of({
            configured: options.discogs ?? false,
            release: discogsRelease,
          })
        ),
        Layer.succeed(ListenBrainz, ListenBrainz.of({ genres })),
        Layer.succeed(
          JobQueue,
          JobQueue.of({
            send: (message) =>
              Effect.sync(() => {
                sent.push(message)
              }),
          })
        )
      )
    ),
    Layer.provide(Database.layer(d1.binding))
  )

  let next = 0
  /** Adds a liked track; `isrc: null` mimics local files without one. */
  const like = (
    isrc: string | null,
    present = true,
    track: { name: string; artists: string[] } = { name: "Song", artists: [] }
  ) => {
    const trackId = `track${next++}`
    d1.sqlite
      .prepare(
        "INSERT INTO music_tracks (owner_id, track_id, name, artist_names, isrc, added_at, first_seen_at, last_seen_at) VALUES ('owner', ?, ?, ?, ?, '2026-01-01T00:00:00Z', 1, 1)"
      )
      .run(trackId, track.name, JSON.stringify(track.artists), isrc)
    d1.sqlite
      .prepare(
        "INSERT INTO music_source_tracks (owner_id, source_id, track_id, added_at, present, last_seen_at) VALUES ('owner', 'liked', ?, '2026-01-01T00:00:00Z', ?, 1)"
      )
      .run(trackId, present ? 1 : 0)
  }

  const recordingRow = (isrc: string) =>
    d1.sqlite
      .prepare("SELECT * FROM music_recordings WHERE isrc = ?")
      .get(isrc) as Record<string, unknown> | undefined
  const tagsOf = (isrc: string) =>
    JSON.parse(String(recordingRow(isrc)?.tags ?? "null")) as unknown

  return {
    d1,
    sent,
    like,
    recordingRow,
    tagsOf,
    recordingsByIsrc,
    searchRecordings,
    analysisFor,
    lastFmTags,
    discogsRelease,
    genres,
    run: <A, E>(body: Effect.Effect<A, E, MusicEnrichment>) =>
      body.pipe(Effect.provide(layer), Effect.ensuring(Effect.sync(d1.close))),
  }
}

describe("music enrichment", () => {
  it.effect("stores recording data and analysis for one exact match", () => {
    const t = setup()
    t.like("USAAA2600001")
    t.recordingsByIsrc.mockReturnValue(Effect.succeed([recording("mb-1")]))
    t.analysisFor.mockReturnValue(Effect.succeed(Option.some(analysis)))
    return t.run(
      Effect.gen(function* () {
        const enrichment = yield* MusicEnrichment
        yield* enrichment.processNext("owner")
        expect(t.recordingRow("USAAA2600001")).toMatchObject({
          status: "found",
          recording_id: "mb-1",
          title: "Title mb-1",
          artist_credit: "Artist",
        })
        expect(yield* enrichment.status("owner")).toMatchObject({
          enriched: 1,
          withAnalysis: 1,
          pending: 0,
        })
      })
    )
  })

  it.effect("looks up each ISRC once, even when several likes share it", () => {
    const t = setup()
    t.like("USAAA2600001")
    t.like("USAAA2600001")
    t.recordingsByIsrc.mockReturnValue(Effect.succeed([recording("mb-1")]))
    return t.run(
      Effect.gen(function* () {
        const enrichment = yield* MusicEnrichment
        yield* enrichment.processNext("owner")
        yield* enrichment.processNext("owner")
        expect(t.recordingsByIsrc).toHaveBeenCalledOnce()
        expect(yield* enrichment.status("owner")).toMatchObject({
          enriched: 2,
          withAnalysis: 0,
        })
      })
    )
  })

  it.effect(
    "classifies unknown, ambiguous, and missing ISRCs separately",
    () => {
      const t = setup()
      t.like("USAAA2600001")
      t.like("USAAA2600002")
      t.like(null)
      t.recordingsByIsrc.mockImplementation((isrc) =>
        Effect.succeed(
          isrc === "USAAA2600002" ? [recording("a"), recording("b")] : []
        )
      )
      return t.run(
        Effect.gen(function* () {
          const enrichment = yield* MusicEnrichment
          yield* enrichment.processNext("owner")
          expect(yield* enrichment.status("owner")).toMatchObject({
            enriched: 0,
            notFound: 1,
            ambiguous: 1,
            withoutIsrc: 1,
            pending: 0,
          })
          expect(t.analysisFor).not.toHaveBeenCalled()
        })
      )
    }
  )

  it.effect("skips un-liked tracks", () => {
    const t = setup()
    t.like("USAAA2600001", false)
    return t.run(
      Effect.gen(function* () {
        const enrichment = yield* MusicEnrichment
        assert.deepStrictEqual(yield* enrichment.processNext("owner"), {
          looked: 0,
        })
      })
    )
  })

  it.effect("stops on a rate limit and leaves the ISRC pending", () => {
    const t = setup()
    t.like("USAAA2600001")
    t.recordingsByIsrc.mockReturnValue(
      Effect.fail(new MusicBrainzError({ reason: "RateLimited" }))
    )
    return t.run(
      Effect.gen(function* () {
        const enrichment = yield* MusicEnrichment
        const error = yield* Effect.flip(enrichment.processNext("owner"))
        assert.strictEqual(error._tag, "MusicBrainzError")
        expect(yield* enrichment.status("owner")).toMatchObject({ pending: 1 })
      })
    )
  })

  it.effect("records unreadable data as failed and keeps going", () => {
    const t = setup()
    t.like("USAAA2600001")
    t.like("USAAA2600002")
    t.recordingsByIsrc.mockImplementation((isrc) =>
      isrc === "USAAA2600001"
        ? Effect.fail(new MusicBrainzError({ reason: "InvalidResponse" }))
        : Effect.succeed([recording("mb-2")])
    )
    t.analysisFor.mockReturnValue(
      Effect.fail(new AcousticBrainzError({ reason: "InvalidResponse" }))
    )
    return t.run(
      Effect.gen(function* () {
        const enrichment = yield* MusicEnrichment
        yield* enrichment.processNext("owner")
        expect(yield* enrichment.status("owner")).toMatchObject({
          failed: 1,
          enriched: 1,
          withAnalysis: 0,
        })
      })
    )
  })

  it.effect("queues the next batch only while a full batch was found", () => {
    const t = setup()
    for (let index = 0; index < 12; index++)
      t.like(`USAAA26000${String(index).padStart(2, "0")}`)
    return t.run(
      Effect.gen(function* () {
        const enrichment = yield* MusicEnrichment
        assert.deepStrictEqual(yield* enrichment.processNext("owner"), {
          looked: 10,
        })
        assert.deepStrictEqual(t.sent, [
          { kind: "music.enrichment", ownerId: "owner" },
        ])
        assert.deepStrictEqual(yield* enrichment.processNext("owner"), {
          looked: 2,
        })
        assert.strictEqual(t.sent.length, 1)
      })
    )
  })

  it.effect(
    "retrying unresolved lookups clears them and queues a batch",
    () => {
      const t = setup()
      t.like("USAAA2600001")
      return t.run(
        Effect.gen(function* () {
          const enrichment = yield* MusicEnrichment
          yield* enrichment.processNext("owner")
          assert.strictEqual(yield* enrichment.retryUnresolved("owner"), 1)
          expect(yield* enrichment.status("owner")).toMatchObject({
            pending: 1,
          })
          assert.strictEqual(t.sent.length, 1)
        })
      )
    }
  )

  it.effect("keeps MusicBrainz data when AcousticBrainz is down", () => {
    const t = setup()
    t.like("USAAA2600001")
    t.like("USAAA2600002")
    t.recordingsByIsrc.mockImplementation((isrc) =>
      Effect.succeed([recording(isrc)])
    )
    t.analysisFor.mockReturnValue(
      Effect.fail(new AcousticBrainzError({ reason: "Unavailable" }))
    )
    return t.run(
      Effect.gen(function* () {
        const enrichment = yield* MusicEnrichment
        assert.deepStrictEqual(yield* enrichment.processNext("owner"), {
          looked: 2,
        })
        expect(yield* enrichment.status("owner")).toMatchObject({
          enriched: 2,
          withAnalysis: 0,
          pending: 0,
        })
      })
    )
  })

  it.effect(
    "stores Last.fm and ListenBrainz tags with their source and scope",
    () => {
      const t = setup()
      t.like("USAAA2600001")
      t.recordingsByIsrc.mockReturnValue(Effect.succeed([recording("mb-1")]))
      t.lastFmTags.mockReturnValue(
        Effect.succeed([
          { scope: "recording", name: "deep house", weight: 1 },
          { scope: "artist", name: "electronic", weight: 0.4 },
        ])
      )
      t.genres.mockReturnValue(
        Effect.succeed([{ scope: "release", name: "house", weight: 1 }])
      )
      return t.run(
        Effect.gen(function* () {
          const enrichment = yield* MusicEnrichment
          yield* enrichment.processNext("owner")
          expect(t.lastFmTags).toHaveBeenCalledWith({
            title: "Title mb-1",
            artist: "Artist",
          })
          expect(t.genres).toHaveBeenCalledWith("mb-1")
          expect(t.tagsOf("USAAA2600001")).toEqual([
            {
              source: "lastfm",
              scope: "recording",
              name: "deep house",
              weight: 1,
            },
            {
              source: "lastfm",
              scope: "artist",
              name: "electronic",
              weight: 0.4,
            },
            {
              source: "listenbrainz",
              scope: "release",
              name: "house",
              weight: 1,
            },
          ])
          const status = yield* enrichment.status("owner")
          expect(status.withTags).toBe(1)
          expect(status.sources).toEqual([
            {
              source: "lastfm",
              configured: true,
              found: 1,
              notFound: 0,
              failed: 0,
              pending: 0,
            },
            {
              source: "discogs",
              configured: false,
              found: 0,
              notFound: 0,
              failed: 0,
              pending: 0,
            },
            {
              source: "listenbrainz",
              configured: true,
              found: 1,
              notFound: 0,
              failed: 0,
              pending: 0,
            },
          ])
          expect(t.discogsRelease).not.toHaveBeenCalled()
        })
      )
    }
  )

  it.effect("stores Discogs genres and styles as release tags", () => {
    const t = setup({ discogs: true })
    t.like("USAAA2600001")
    t.recordingsByIsrc.mockReturnValue(Effect.succeed([recording("mb-1")]))
    t.discogsRelease.mockReturnValue(
      Effect.succeed(
        Option.some({
          releaseId: 1,
          genres: ["Electronic"],
          styles: ["Deep House"],
        })
      )
    )
    return t.run(
      Effect.gen(function* () {
        const enrichment = yield* MusicEnrichment
        yield* enrichment.processNext("owner")
        expect(t.tagsOf("USAAA2600001")).toEqual([
          {
            source: "discogs",
            scope: "release",
            name: "electronic",
            weight: 1,
          },
          {
            source: "discogs",
            scope: "release",
            name: "deep house",
            weight: 1,
          },
        ])
        expect(t.recordingRow("USAAA2600001")).toMatchObject({
          lastfm_status: "not_found",
          discogs_status: "found",
          listenbrainz_status: "not_found",
        })
      })
    )
  })

  it.effect("classifies a track whose tag sources all miss", () => {
    const t = setup()
    t.like("USAAA2600001")
    t.recordingsByIsrc.mockReturnValue(Effect.succeed([recording("mb-1")]))
    return t.run(
      Effect.gen(function* () {
        const enrichment = yield* MusicEnrichment
        yield* enrichment.processNext("owner")
        expect(t.recordingRow("USAAA2600001")).toMatchObject({
          status: "found",
          tags: "[]",
        })
        expect(yield* enrichment.status("owner")).toMatchObject({
          enriched: 1,
          withTags: 0,
          pending: 0,
        })
      })
    )
  })

  it.effect(
    "matches by title and artist when MusicBrainz does not know the ISRC",
    () => {
      const t = setup()
      t.like("USAAA2600001", true, {
        name: "Latch - Remastered 2013",
        artists: ["Disclosure", "Sam Smith"],
      })
      t.searchRecordings.mockReturnValue(
        Effect.succeed([
          {
            ...recording("mb-latch"),
            title: "Latch",
            artistCredit: "Disclosure feat. Sam Smith",
            primaryArtist: "Disclosure",
            score: 100,
          },
          {
            ...recording("mb-remix"),
            title: "Latch (Kaytranada remix)",
            artistCredit: "Disclosure feat. Sam Smith",
            primaryArtist: "Disclosure",
            score: 95,
          },
        ])
      )
      return t.run(
        Effect.gen(function* () {
          const enrichment = yield* MusicEnrichment
          yield* enrichment.processNext("owner")
          expect(t.searchRecordings).toHaveBeenCalledWith({
            title: "Latch",
            artist: "Disclosure",
          })
          expect(t.recordingRow("USAAA2600001")).toMatchObject({
            status: "found",
            match: "search",
            recording_id: "mb-latch",
            primary_artist: "Disclosure",
          })
          expect(yield* enrichment.status("owner")).toMatchObject({
            enriched: 1,
            matchedBySearch: 1,
          })
        })
      )
    }
  )

  it.effect("leaves a search with only near matches not found", () => {
    const t = setup()
    t.like("USAAA2600001", true, {
      name: "Latch - Kaytranada Remix",
      artists: ["Disclosure"],
    })
    t.searchRecordings.mockReturnValue(
      Effect.succeed([
        {
          ...recording("mb-latch"),
          title: "Latch",
          artistCredit: "Disclosure feat. Sam Smith",
          score: 100,
        },
      ])
    )
    return t.run(
      Effect.gen(function* () {
        const enrichment = yield* MusicEnrichment
        yield* enrichment.processNext("owner")
        expect(t.recordingRow("USAAA2600001")).toMatchObject({
          status: "not_found",
        })
      })
    )
  })

  it.effect(
    "chooses the ISRC recording whose title and artist match the track",
    () => {
      const t = setup()
      t.like("USAAA2600001", true, {
        name: "Title b",
        artists: ["Artist"],
      })
      t.recordingsByIsrc.mockReturnValue(
        Effect.succeed([recording("a"), recording("b")])
      )
      return t.run(
        Effect.gen(function* () {
          const enrichment = yield* MusicEnrichment
          yield* enrichment.processNext("owner")
          expect(t.recordingRow("USAAA2600001")).toMatchObject({
            status: "found",
            match: "isrc",
            recording_id: "b",
          })
        })
      )
    }
  )

  it.effect(
    "takes the first ISRC recording when all name the same song",
    () => {
      const t = setup()
      t.like("USAAA2600001")
      t.recordingsByIsrc.mockReturnValue(
        Effect.succeed([
          recording("a"),
          { ...recording("b"), title: "Title A" },
        ])
      )
      return t.run(
        Effect.gen(function* () {
          const enrichment = yield* MusicEnrichment
          yield* enrichment.processNext("owner")
          expect(t.recordingRow("USAAA2600001")).toMatchObject({
            status: "found",
            recording_id: "a",
          })
        })
      )
    }
  )

  it.effect(
    "adds tags to recordings found before the tag sources existed",
    () => {
      const t = setup()
      t.like("USAAA2600001")
      t.d1.sqlite.exec(
        "INSERT INTO music_recordings (isrc, status, recording_id, title, artist_credit, fetched_at) VALUES ('USAAA2600001', 'found', 'mb-1', 'Old', 'Old Artist', 1)"
      )
      t.lastFmTags.mockReturnValue(
        Effect.succeed([{ scope: "recording", name: "rock", weight: 1 }])
      )
      return t.run(
        Effect.gen(function* () {
          const enrichment = yield* MusicEnrichment
          expect((yield* enrichment.status("owner")).sources[0]).toMatchObject({
            source: "lastfm",
            pending: 1,
          })
          yield* enrichment.processNext("owner")
          expect(t.recordingsByIsrc).not.toHaveBeenCalled()
          expect(t.lastFmTags).toHaveBeenCalledWith({
            title: "Old",
            artist: "Old Artist",
          })
          expect(t.recordingRow("USAAA2600001")).toMatchObject({
            title: "Old",
            lastfm_status: "found",
            listenbrainz_status: "not_found",
          })
          assert.deepStrictEqual(yield* enrichment.processNext("owner"), {
            looked: 0,
          })
        })
      )
    }
  )

  it.effect(
    "records a tag-source failure, asks again on retry, and keeps other sources' tags",
    () => {
      const t = setup()
      t.like("USAAA2600001")
      t.recordingsByIsrc.mockReturnValue(Effect.succeed([recording("mb-1")]))
      t.genres.mockReturnValue(
        Effect.succeed([{ scope: "recording", name: "jazz", weight: 1 }])
      )
      t.lastFmTags.mockReturnValue(
        Effect.fail(new LastFmError({ reason: "Unavailable" }))
      )
      return t.run(
        Effect.gen(function* () {
          const enrichment = yield* MusicEnrichment
          yield* enrichment.processNext("owner")
          expect(t.recordingRow("USAAA2600001")).toMatchObject({
            status: "found",
            lastfm_status: "failed",
            listenbrainz_status: "found",
          })

          t.lastFmTags.mockReturnValue(Effect.succeed([]))
          assert.strictEqual(yield* enrichment.retryUnresolved("owner"), 1)
          expect((yield* enrichment.status("owner")).sources[0]).toMatchObject({
            source: "lastfm",
            pending: 1,
            failed: 0,
          })
          yield* enrichment.processNext("owner")
          expect(t.genres).toHaveBeenCalledOnce()
          expect(t.recordingRow("USAAA2600001")).toMatchObject({
            lastfm_status: "not_found",
          })
          expect(t.tagsOf("USAAA2600001")).toEqual([
            {
              source: "listenbrainz",
              scope: "recording",
              name: "jazz",
              weight: 1,
            },
          ])
        })
      )
    }
  )
})
