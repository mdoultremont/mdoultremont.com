import { assert, describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { vi } from "vitest"
import {
  AcousticBrainz,
  AcousticBrainzError,
} from "@/backend/modules/acousticbrainz"
import {
  MusicBrainz,
  MusicBrainzError,
  type MusicBrainzRecording,
} from "@/backend/modules/musicbrainz"
import { Database } from "@/backend/primitives/database"
import { makeTestD1 } from "@/backend/primitives/database/testing"
import { JobQueue } from "@/backend/primitives/job-queue"
import { EnrichmentStore, MusicEnrichment } from "."

const recording = (id: string): MusicBrainzRecording => ({
  id,
  title: `Title ${id}`,
  artistCredit: "Artist",
  durationMs: 1000,
})

const analysis = {
  bpm: 120,
  danceability: 0.8,
  mood: { happy: 0.7 },
  genre: { "genre_rosamerica:pop": 0.6 },
}

function setup() {
  const d1 = makeTestD1()
  d1.seedOwner()
  const recordingsByIsrc = vi.fn<MusicBrainz["Service"]["recordingsByIsrc"]>(
    () => Effect.succeed([])
  )
  const analysisFor = vi.fn<AcousticBrainz["Service"]["analysis"]>(() =>
    Effect.succeed(Option.none())
  )
  const sent: unknown[] = []
  const layer = MusicEnrichment.layerNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(
        EnrichmentStore.layer,
        Layer.succeed(MusicBrainz, MusicBrainz.of({ recordingsByIsrc })),
        Layer.succeed(
          AcousticBrainz,
          AcousticBrainz.of({ analysis: analysisFor })
        ),
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
  const like = (isrc: string | null, liked = true) =>
    d1.sqlite
      .prepare(
        "INSERT INTO music_liked_tracks (owner_id, track_id, name, artist_names, isrc, liked_at, liked, first_seen_at, last_seen_at) VALUES ('owner', ?, 'Song', '[]', ?, '2026-01-01T00:00:00Z', ?, 1, 1)"
      )
      .run(`track${next++}`, isrc, liked ? 1 : 0)

  const recordingRow = (isrc: string) =>
    d1.sqlite.prepare("SELECT * FROM music_recordings WHERE isrc = ?").get(isrc)

  return {
    d1,
    sent,
    like,
    recordingRow,
    recordingsByIsrc,
    analysisFor,
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
})
