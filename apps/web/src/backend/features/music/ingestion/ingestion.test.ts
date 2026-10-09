import { assert, describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { vi } from "vitest"
import {
  Spotify,
  SpotifyConnections,
  type SpotifyPage,
  type SpotifySavedTrack,
} from "@/backend/modules/spotify"
import { Database } from "@/backend/primitives/database"
import { makeTestD1 } from "@/backend/primitives/database/testing"
import { JobQueue } from "@/backend/primitives/job-queue"
import { IngestionStore, MusicIngestion } from "."

const hour = 60 * 60 * 1000

const track = (id: string, addedAt = "2026-01-01T00:00:00Z") =>
  ({
    id,
    name: `Song ${id}`,
    artistNames: ["Artist"],
    isrc: `ISRC${id}`,
    durationMs: 1000,
    addedAt,
  }) satisfies SpotifySavedTrack

/** Splits likes into Spotify-style pages addressed by `cursor-<index>`. */
function pages(likes: readonly SpotifySavedTrack[], size: number) {
  const result = new Map<string | undefined, SpotifyPage<SpotifySavedTrack>>()
  for (let start = 0; start < Math.max(likes.length, 1); start += size) {
    const next = start + size < likes.length ? `cursor-${start + size}` : null
    result.set(start === 0 ? undefined : `cursor-${start}`, {
      items: likes.slice(start, start + size),
      next,
      total: likes.length,
    })
  }
  return result
}

function setup() {
  const d1 = makeTestD1()
  d1.seedOwner()
  let library = pages([], 50)
  const savedTracksPage = vi.fn<Spotify["Service"]["savedTracksPage"]>(
    (_ownerId, cursor) => {
      const page = library.get(cursor)
      return page ? Effect.succeed(page) : Effect.die(`no page ${cursor}`)
    }
  )
  const sent: unknown[] = []
  const layer = MusicIngestion.layerNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(
        IngestionStore.layer,
        SpotifyConnections.layer,
        Layer.succeed(Spotify, {
          savedTracksPage,
        } as unknown as Spotify["Service"]),
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

  /** Processes queued messages until the queue is empty, like the consumer would. */
  const drain = Effect.gen(function* () {
    const ingestion = yield* MusicIngestion
    while (sent.length > 0) {
      const message = sent.shift() as { ingestionId: string }
      yield* ingestion.processNext(message.ingestionId)
    }
  })

  const liked = (trackId: string) =>
    d1.sqlite
      .prepare(
        "SELECT liked FROM music_liked_tracks WHERE owner_id = 'owner' AND track_id = ?"
      )
      .get(trackId)?.liked

  return {
    d1,
    sent,
    savedTracksPage,
    drain,
    liked,
    setLibrary: (likes: readonly SpotifySavedTrack[], size = 50) => {
      library = pages(likes, size)
    },
    run: <A, E>(body: Effect.Effect<A, E, MusicIngestion>) =>
      body.pipe(Effect.provide(layer), Effect.ensuring(Effect.sync(d1.close))),
  }
}

describe("music ingestion", () => {
  it.effect("a full ingestion reads every page and records every like", () => {
    const t = setup()
    return t.run(
      Effect.gen(function* () {
        const ingestion = yield* MusicIngestion
        // 25 likes in pages of 10: three pages, and more than one insert chunk per page.
        t.setLibrary(
          Array.from({ length: 25 }, (_, index) => track(`t${index}`)),
          10
        )
        yield* ingestion.start("owner", "full")
        yield* t.drain
        const status = yield* ingestion.status("owner")
        expect(status.latest).toMatchObject({
          kind: "full",
          status: "completed",
          pages: 3,
          seen: 25,
          added: 25,
          total: 25,
        })
        assert.strictEqual(status.liked, 25)
        expect(t.savedTracksPage).toHaveBeenCalledTimes(3)
      })
    )
  })

  it.effect(
    "an incremental ingestion stops at the first like it already has",
    () => {
      const t = setup()
      return t.run(
        Effect.gen(function* () {
          const ingestion = yield* MusicIngestion
          const older = Array.from({ length: 20 }, (_, index) =>
            track(`old${index}`)
          )
          t.setLibrary(older, 5)
          yield* ingestion.start("owner", "full")
          yield* t.drain
          t.savedTracksPage.mockClear()

          t.setLibrary(
            [
              track("new1", "2026-02-01T00:00:00Z"),
              track("new2", "2026-02-01T00:00:00Z"),
              ...older,
            ],
            5
          )
          yield* ingestion.start("owner", "incremental")
          yield* t.drain
          const status = yield* ingestion.status("owner")
          expect(status.latest).toMatchObject({
            kind: "incremental",
            status: "completed",
            added: 2,
          })
          assert.strictEqual(status.liked, 22)
          expect(t.savedTracksPage).toHaveBeenCalledTimes(1)
        })
      )
    }
  )

  it.effect(
    "a full ingestion marks missing likes as un-liked, and re-liking restores them",
    () => {
      const t = setup()
      return t.run(
        Effect.gen(function* () {
          const ingestion = yield* MusicIngestion
          t.setLibrary([track("a"), track("b"), track("c")])
          yield* ingestion.start("owner", "full")
          yield* t.drain

          yield* TestClock.adjust(hour)
          t.setLibrary([track("a"), track("c")])
          yield* ingestion.start("owner", "full")
          yield* t.drain
          expect((yield* ingestion.status("owner")).latest).toMatchObject({
            unliked: 1,
          })
          assert.strictEqual(t.liked("b"), 0)

          t.setLibrary([
            track("b", "2026-03-01T00:00:00Z"),
            track("a"),
            track("c"),
          ])
          yield* ingestion.start("owner", "incremental")
          yield* t.drain
          assert.strictEqual(t.liked("b"), 1)
          expect(yield* ingestion.status("owner")).toMatchObject({
            liked: 3,
            unliked: 0,
          })
        })
      )
    }
  )

  it.effect(
    "starting while an ingestion is in progress returns it without queuing again",
    () => {
      const t = setup()
      return t.run(
        Effect.gen(function* () {
          const ingestion = yield* MusicIngestion
          const first = yield* ingestion.start("owner", "full")
          const second = yield* ingestion.start("owner", "incremental")
          assert.strictEqual(second.id, first.id)
          assert.strictEqual(t.sent.length, 1)
        })
      )
    }
  )

  it.effect(
    "a page whose cursor does not advance fails instead of looping",
    () => {
      const t = setup()
      return t.run(
        Effect.gen(function* () {
          const ingestion = yield* MusicIngestion
          t.savedTracksPage.mockImplementation((_ownerId, cursor) =>
            Effect.succeed({
              items: [track("a")],
              next: cursor ?? "same",
              total: 2,
            })
          )
          const started = yield* ingestion.start("owner", "full")
          yield* ingestion.processNext(started.id)
          const error = yield* Effect.flip(ingestion.processNext(started.id))
          assert.strictEqual(error._tag, "InvalidLikesPage")
        })
      )
    }
  )
})

describe("scheduled ingestion", () => {
  it.effect(
    "runs a full ingestion daily and incremental ones in between",
    () => {
      const t = setup()
      return t.run(
        Effect.gen(function* () {
          const ingestion = yield* MusicIngestion
          t.setLibrary([track("a")])
          yield* ingestion.scheduled("owner")
          yield* t.drain
          expect((yield* ingestion.status("owner")).latest).toMatchObject({
            kind: "full",
          })

          yield* TestClock.adjust(hour)
          yield* ingestion.scheduled("owner")
          yield* t.drain
          expect((yield* ingestion.status("owner")).latest).toMatchObject({
            kind: "incremental",
          })

          yield* TestClock.adjust(24 * hour)
          yield* ingestion.scheduled("owner")
          expect((yield* ingestion.status("owner")).latest).toMatchObject({
            kind: "full",
          })
        })
      )
    }
  )

  it.effect(
    "re-sends the message of a stalled ingestion instead of starting another",
    () => {
      const t = setup()
      return t.run(
        Effect.gen(function* () {
          const ingestion = yield* MusicIngestion
          const started = yield* ingestion.start("owner", "full")
          t.sent.length = 0 // the message was lost

          yield* TestClock.adjust(5 * 60 * 1000)
          yield* ingestion.scheduled("owner")
          assert.strictEqual(t.sent.length, 0)

          yield* TestClock.adjust(10 * 60 * 1000)
          yield* ingestion.scheduled("owner")
          assert.deepStrictEqual(t.sent, [
            { kind: "music.ingestion", ingestionId: started.id },
          ])
        })
      )
    }
  )

  it.effect("does nothing while Spotify is disconnected", () => {
    const t = setup()
    return t.run(
      Effect.gen(function* () {
        const ingestion = yield* MusicIngestion
        t.d1.sqlite.exec("DELETE FROM spotify_connections")
        yield* ingestion.scheduled("owner")
        assert.strictEqual(t.sent.length, 0)
        assert.isNull((yield* ingestion.status("owner")).latest)
      })
    )
  })
})
