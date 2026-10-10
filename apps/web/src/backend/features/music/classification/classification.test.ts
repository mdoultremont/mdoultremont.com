import { assert, describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { vi } from "vitest"
import {
  type DestinationConfiguration,
  Destinations,
} from "@/backend/features/music/destinations"
import { Jev, JevError } from "@/backend/modules/jev"
import { Database } from "@/backend/primitives/database"
import { makeTestD1 } from "@/backend/primitives/database/testing"
import { JobQueue } from "@/backend/primitives/job-queue"
import { ClassificationStore, MusicClassification } from "."

const destination = (playlistId: string, description: string) => ({
  playlistId,
  description,
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
})

function setup() {
  const d1 = makeTestD1()
  d1.seedOwner()
  let configuration: DestinationConfiguration = {
    destinations: [
      destination("jazz", "Late-night jazz"),
      destination("party", "Upbeat party songs"),
    ],
    reviewPlaylistId: "review",
    ready: true,
  }
  /** Jev answers from a table of yes-probabilities per recording title. */
  const scores = new Map<string, Record<string, number>>()
  const noul = vi.fn<Jev["Service"]["noul"]>((input) => {
    const title = (input.state as { recording: { title: string } }).recording
      .title
    const byDescription = scores.get(title) ?? {}
    return Effect.succeed({
      model: "jev-1.13.0",
      probabilities: Object.fromEntries(
        Object.entries(input.questions).map(([key, question]) => [
          key,
          Object.entries(byDescription).find(([description]) =>
            question.includes(description)
          )?.[1] ?? 0,
        ])
      ),
    })
  })
  const sent: unknown[] = []
  const layer = MusicClassification.layerNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(
        ClassificationStore.layer,
        Layer.succeed(Destinations, {
          read: () => Effect.sync(() => configuration),
        } as unknown as Destinations["Service"]),
        Layer.succeed(Jev, Jev.of({ noul })),
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
  /** A liked track; Spotify's name and artist deliberately differ from MusicBrainz's. */
  const like = (isrc: string | null) => {
    const trackId = `track${next++}`
    d1.sqlite
      .prepare(
        "INSERT INTO music_liked_tracks (owner_id, track_id, name, artist_names, isrc, liked_at, liked, first_seen_at, last_seen_at) VALUES ('owner', ?, 'SPOTIFY NAME', '[\"SPOTIFY ARTIST\"]', ?, ?, 1, 1, 1)"
      )
      .run(trackId, isrc, `2026-01-01T00:00:${String(next).padStart(2, "0")}Z`)
    return trackId
  }
  const recording = (
    isrc: string,
    status: "found" | "not_found",
    title = "Blue in Green"
  ) =>
    d1.sqlite
      .prepare(
        "INSERT INTO music_recordings (isrc, status, recording_id, title, artist_credit, duration_ms, acoustic, fetched_at) VALUES (?, ?, 'mb-id', ?, 'Miles Davis', 337000, ?, 1)"
      )
      .run(
        isrc,
        status,
        status === "found" ? title : null,
        JSON.stringify({ bpm: 60, danceability: 0.2, mood: {}, genre: {} })
      )
  const decision = (trackId: string) =>
    d1.sqlite
      .prepare(
        "SELECT destination_ids, review, reason, model FROM music_decisions WHERE track_id = ?"
      )
      .get(trackId)

  return {
    sent,
    noul,
    scores,
    like,
    recording,
    decision,
    setConfiguration: (value: DestinationConfiguration) => {
      configuration = value
    },
    configuration: () => configuration,
    run: <A, E>(body: Effect.Effect<A, E, MusicClassification>) =>
      body.pipe(Effect.provide(layer), Effect.ensuring(Effect.sync(d1.close))),
  }
}

describe("music classification", () => {
  it.effect(
    "sends only recording data to Jev and keeps destinations at 0.5 or more",
    () => {
      const t = setup()
      const track = t.like("USAAA2600001")
      t.recording("USAAA2600001", "found")
      t.scores.set("Blue in Green", {
        "Late-night jazz": 0.91,
        "Upbeat party songs": 0.04,
      })
      return t.run(
        Effect.gen(function* () {
          const classification = yield* MusicClassification
          assert.deepStrictEqual(yield* classification.processNext("owner"), {
            decided: 1,
          })
          expect(t.decision(track)).toEqual({
            destination_ids: '["jazz"]',
            review: 0,
            reason: "classified",
            model: "jev-1.13.0",
          })
          const sentToJev = JSON.stringify(t.noul.mock.calls[0]![0].state)
          expect(sentToJev).toContain("Blue in Green")
          expect(sentToJev).not.toContain("SPOTIFY")
          expect(sentToJev).not.toContain(track)
          expect(sentToJev).not.toContain("USAAA2600001")
        })
      )
    }
  )

  it.effect("sends a track to review when no destination reaches 0.5", () => {
    const t = setup()
    const track = t.like("USAAA2600001")
    t.recording("USAAA2600001", "found")
    t.scores.set("Blue in Green", { "Late-night jazz": 0.49 })
    return t.run(
      Effect.gen(function* () {
        const classification = yield* MusicClassification
        yield* classification.processNext("owner")
        expect(t.decision(track)).toMatchObject({
          destination_ids: "[]",
          review: 1,
          reason: "classified",
        })
      })
    )
  })

  it.effect(
    "sends tracks without recording data to review without asking Jev",
    () => {
      const t = setup()
      const noIsrc = t.like(null)
      const unknown = t.like("USAAA2600002")
      t.recording("USAAA2600002", "not_found")
      const waiting = t.like("USAAA2600003")
      return t.run(
        Effect.gen(function* () {
          const classification = yield* MusicClassification
          yield* classification.processNext("owner")
          for (const track of [noIsrc, unknown])
            expect(t.decision(track)).toMatchObject({
              review: 1,
              reason: "no_recording_data",
              model: null,
            })
          // Still being enriched: not classified yet.
          assert.isUndefined(t.decision(waiting))
          expect(t.noul).not.toHaveBeenCalled()
          expect(yield* classification.status("owner")).toMatchObject({
            decided: 2,
            toReview: 2,
            withoutRecordingData: 2,
            waitingForEnrichment: 1,
            pending: 0,
          })
        })
      )
    }
  )

  it.effect("does nothing until the setup is Ready", () => {
    const t = setup()
    t.setConfiguration({ ...t.configuration(), ready: false })
    t.like(null)
    return t.run(
      Effect.gen(function* () {
        const classification = yield* MusicClassification
        yield* classification.request("owner")
        assert.deepStrictEqual(yield* classification.processNext("owner"), {
          decided: 0,
        })
        assert.strictEqual(t.sent.length, 0)
      })
    )
  })

  it.effect("ignores disabled destinations", () => {
    const t = setup()
    t.setConfiguration({
      ...t.configuration(),
      destinations: [
        destination("jazz", "Late-night jazz"),
        { ...destination("party", "Upbeat party songs"), enabled: false },
      ],
    })
    t.like("USAAA2600001")
    t.recording("USAAA2600001", "found")
    return t.run(
      Effect.gen(function* () {
        const classification = yield* MusicClassification
        yield* classification.processNext("owner")
        expect(Object.values(t.noul.mock.calls[0]![0].questions)).toEqual([
          "Does this recording belong in a playlist described as: Late-night jazz?",
        ])
      })
    )
  })

  it.effect(
    "changing destinations marks decisions outdated until reclassified",
    () => {
      const t = setup()
      const track = t.like("USAAA2600001")
      t.recording("USAAA2600001", "found")
      return t.run(
        Effect.gen(function* () {
          const classification = yield* MusicClassification
          yield* classification.processNext("owner")
          expect(yield* classification.status("owner")).toMatchObject({
            outdated: 0,
          })

          t.setConfiguration({
            ...t.configuration(),
            destinations: [
              ...t.configuration().destinations,
              destination("focus", "Calm instrumental focus music"),
            ],
          })
          t.scores.set("Blue in Green", {
            "Calm instrumental focus music": 0.8,
          })
          expect(yield* classification.status("owner")).toMatchObject({
            outdated: 1,
          })

          yield* classification.reclassify("owner")
          assert.strictEqual(t.sent.length, 1)
          yield* classification.processNext("owner")
          expect(t.decision(track)).toMatchObject({
            destination_ids: '["focus"]',
          })
          expect(yield* classification.status("owner")).toMatchObject({
            outdated: 0,
            decided: 1,
          })
        })
      )
    }
  )

  it.effect("decides 20 tracks per batch and queues the next", () => {
    const t = setup()
    for (let index = 0; index < 25; index++) t.like(null)
    return t.run(
      Effect.gen(function* () {
        const classification = yield* MusicClassification
        assert.deepStrictEqual(yield* classification.processNext("owner"), {
          decided: 20,
        })
        assert.deepStrictEqual(t.sent, [
          { kind: "music.classification", ownerId: "owner" },
        ])
        assert.deepStrictEqual(yield* classification.processNext("owner"), {
          decided: 5,
        })
        assert.strictEqual(t.sent.length, 1)
      })
    )
  })

  it.effect(
    "sends a track Jev cannot answer for to review and keeps going",
    () => {
      const t = setup()
      const rejected = t.like("USAAA2600001")
      t.recording("USAAA2600001", "found", "Rejected title")
      const next = t.like("USAAA2600002")
      t.recording("USAAA2600002", "found", "Blue in Green")
      t.scores.set("Blue in Green", { "Late-night jazz": 0.9 })
      const answer = t.noul.getMockImplementation()!
      t.noul.mockImplementation((input) =>
        JSON.stringify(input.state).includes("Rejected title")
          ? Effect.fail(new JevError({ reason: "InvalidResponse" }))
          : answer(input)
      )
      return t.run(
        Effect.gen(function* () {
          const classification = yield* MusicClassification
          assert.deepStrictEqual(yield* classification.processNext("owner"), {
            decided: 2,
          })
          expect(t.decision(rejected)).toMatchObject({
            review: 1,
            reason: "classifier_failed",
          })
          expect(t.decision(next)).toMatchObject({
            destination_ids: '["jazz"]',
          })
        })
      )
    }
  )

  it.effect(
    "stops without deciding anything when Jev is not configured",
    () => {
      const t = setup()
      const track = t.like("USAAA2600001")
      t.recording("USAAA2600001", "found")
      t.noul.mockReturnValue(
        Effect.fail(new JevError({ reason: "NotConfigured" }))
      )
      return t.run(
        Effect.gen(function* () {
          const classification = yield* MusicClassification
          const error = yield* Effect.flip(classification.processNext("owner"))
          assert.strictEqual(error._tag, "JevError")
          assert.isUndefined(t.decision(track))
        })
      )
    }
  )
})
