import { assert, describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { vi } from "vitest"
import {
  Spotify,
  SpotifyConnections,
  type SpotifyPage,
  type SpotifySavedTrack,
} from "#backend/modules/spotify"
import { Database } from "#backend/modules/database"
import { makeTestD1 } from "#backend/modules/database/testing"
import { JobQueue } from "#backend/modules/job-queue"
import { SourceStore } from "#backend/actions/music/collection"
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
  let playlist = pages([], 50)
  let snapshot = "snapshot1"
  const playlistTracksPage = vi.fn<Spotify["Service"]["playlistTracksPage"]>(
    (_ownerId, _playlistId, cursor) => {
      const page = playlist.get(cursor)
      return page ? Effect.succeed(page) : Effect.die(`no page ${cursor}`)
    }
  )
  const playlistSnapshot = vi.fn<Spotify["Service"]["playlistSnapshot"]>(() =>
    Effect.succeed(snapshot)
  )
  const sent: unknown[] = []
  const layer = MusicIngestion.layerNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(
        IngestionStore.layer,
        SourceStore.layer,
        SpotifyConnections.layer,
        Layer.succeed(Spotify, {
          savedTracksPage,
          playlistTracksPage,
          playlistSnapshot,
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
        "SELECT present FROM music_source_tracks WHERE owner_id = 'owner' AND source_id = 'liked' AND track_id = ?"
      )
      .get(trackId)?.present

  return {
    d1,
    sent,
    savedTracksPage,
    playlistTracksPage,
    playlistSnapshot,
    addPlaylist: (id = "shazam") =>
      d1.sqlite
        .prepare(
          "INSERT INTO music_sources (owner_id, source_id, created_at, updated_at) VALUES ('owner', ?, 1, 1)"
        )
        .run(id),
    setPlaylist: (
      tracks: readonly SpotifySavedTrack[],
      version = "snapshot1",
      size = 50
    ) => {
      playlist = pages(tracks, size)
      snapshot = version
    },
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
        expect(status.sources[0]?.latest).toMatchObject({
          kind: "full",
          status: "completed",
          pages: 3,
          seen: 25,
          added: 25,
          total: 25,
        })
        assert.strictEqual(status.present, 25)
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
          expect(status.sources[0]?.latest).toMatchObject({
            kind: "incremental",
            status: "completed",
            added: 2,
          })
          assert.strictEqual(status.present, 22)
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
          expect(
            (yield* ingestion.status("owner")).sources[0]?.latest
          ).toMatchObject({
            removed: 1,
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
            present: 3,
            removed: 0,
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
          const [first] = yield* ingestion.start("owner", "full")
          const [second] = yield* ingestion.start("owner", "incremental")
          assert.strictEqual(second!.id, first!.id)
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
          const [started] = yield* ingestion.start("owner", "full")
          yield* ingestion.processNext(started!.id)
          const error = yield* Effect.flip(ingestion.processNext(started!.id))
          assert.strictEqual(error._tag, "InvalidSourcePage")
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
          expect(
            (yield* ingestion.status("owner")).sources[0]?.latest
          ).toMatchObject({
            kind: "full",
          })

          yield* TestClock.adjust(hour)
          yield* ingestion.scheduled("owner")
          yield* t.drain
          expect(
            (yield* ingestion.status("owner")).sources[0]?.latest
          ).toMatchObject({
            kind: "incremental",
          })

          yield* TestClock.adjust(24 * hour)
          yield* ingestion.scheduled("owner")
          expect(
            (yield* ingestion.status("owner")).sources[0]?.latest
          ).toMatchObject({
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
          const [started] = yield* ingestion.start("owner", "full")
          t.sent.length = 0 // the message was lost

          yield* TestClock.adjust(5 * 60 * 1000)
          yield* ingestion.scheduled("owner")
          assert.strictEqual(t.sent.length, 0)

          yield* TestClock.adjust(10 * 60 * 1000)
          yield* ingestion.scheduled("owner")
          assert.deepStrictEqual(t.sent, [
            { kind: "music.ingestion", ingestionId: started!.id },
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
        assert.deepStrictEqual((yield* ingestion.status("owner")).sources, [])
      })
    )
  })
})

describe("playlist ingestion", () => {
  it.effect(
    "skips an unchanged snapshot, but a full read always visits every page",
    () => {
      const t = setup()
      t.addPlaylist()
      return t.run(
        Effect.gen(function* () {
          const ingestion = yield* MusicIngestion
          t.setPlaylist([track("a"), track("b"), track("c")], "version1", 1)
          yield* ingestion.start("owner", "full")
          yield* t.drain
          expect(t.playlistTracksPage).toHaveBeenCalledTimes(3)
          const source = () =>
            t.d1.sqlite
              .prepare(
                "SELECT snapshot_id FROM music_sources WHERE source_id = 'shazam'"
              )
              .get()?.snapshot_id
          expect(source()).toBe("version1")
          t.playlistTracksPage.mockClear()
          yield* ingestion.start("owner", "incremental")
          yield* t.drain
          expect(t.playlistTracksPage).not.toHaveBeenCalled()
          expect(
            (yield* ingestion.status("owner")).sources[1]?.latest
          ).toMatchObject({
            status: "completed",
            pages: 0,
            seen: 0,
            snapshotId: "version1",
          })
          yield* ingestion.start("owner", "full")
          yield* t.drain
          expect(t.playlistTracksPage).toHaveBeenCalledTimes(3)
        })
      )
    }
  )

  it.effect(
    "reads a changed playlist past known entries and removes memberships only from that source",
    () => {
      const t = setup()
      t.addPlaylist()
      return t.run(
        Effect.gen(function* () {
          const ingestion = yield* MusicIngestion
          t.setLibrary([track("shared", "2026-05-01T00:00:00Z")])
          t.setPlaylist([track("shared"), track("gone")], "version1", 1)
          yield* ingestion.start("owner", "full")
          yield* t.drain
          yield* TestClock.adjust(hour)
          t.setPlaylist([track("shared"), track("new")], "version2", 1)
          t.playlistTracksPage.mockClear()
          const started = yield* ingestion.startSource(
            "owner",
            { kind: "playlist", playlistId: "shazam" },
            "incremental"
          )
          yield* ingestion.processNext(started!.id)
          expect(
            t.d1.sqlite
              .prepare(
                "SELECT snapshot_id FROM music_sources WHERE source_id = 'shazam'"
              )
              .get()?.snapshot_id
          ).toBe("version1")
          yield* t.drain
          expect(t.playlistTracksPage).toHaveBeenCalledTimes(2)
          const status = yield* ingestion.status("owner")
          expect(status.sources[1]).toMatchObject({
            present: 2,
            removed: 1,
            snapshotId: "version2",
            latest: { removed: 1 },
          })
          expect(status.sources[0]).toMatchObject({ present: 1, removed: 0 })
          expect(
            t.d1.sqlite
              .prepare(
                "SELECT added_at FROM music_tracks WHERE track_id = 'shared'"
              )
              .get()?.added_at
          ).toBe("2026-05-01T00:00:00Z")
          expect(
            t.d1.sqlite
              .prepare(
                "SELECT track_id, present FROM music_source_tracks WHERE source_id = 'shazam' ORDER BY track_id"
              )
              .all()
          ).toEqual([
            { track_id: "gone", present: 0 },
            { track_id: "new", present: 1 },
            { track_id: "shared", present: 1 },
          ])
        })
      )
    }
  )

  it.effect(
    "a full playlist read removes absent entries without removing the same track from Liked Songs",
    () => {
      const t = setup()
      t.addPlaylist()
      return t.run(
        Effect.gen(function* () {
          const ingestion = yield* MusicIngestion
          t.setLibrary([track("shared")])
          t.setPlaylist([track("shared")])
          yield* ingestion.start("owner", "full")
          yield* t.drain
          yield* TestClock.adjust(hour)
          t.setPlaylist([], "version2")
          yield* ingestion.startSource(
            "owner",
            { kind: "playlist", playlistId: "shazam" },
            "full"
          )
          yield* t.drain
          expect(yield* ingestion.status("owner")).toMatchObject({
            present: 1,
            removed: 0,
            sources: [
              { present: 1, removed: 0 },
              { present: 0, removed: 1, latest: { removed: 1 } },
            ],
          })
        })
      )
    }
  )

  it.effect(
    "runs and resumes each enabled source independently, with a daily full read",
    () => {
      const t = setup()
      t.addPlaylist()
      t.addPlaylist("disabled")
      t.d1.sqlite.exec(
        "UPDATE music_sources SET enabled = 0 WHERE source_id = 'disabled'"
      )
      return t.run(
        Effect.gen(function* () {
          const ingestion = yield* MusicIngestion
          yield* ingestion.scheduled("owner")
          expect(t.sent).toHaveLength(2)
          t.sent.length = 0
          yield* TestClock.adjust(hour)
          yield* ingestion.scheduled("owner")
          expect(t.sent).toHaveLength(2)
          yield* t.drain
          yield* TestClock.adjust(hour)
          yield* ingestion.scheduled("owner")
          yield* t.drain
          expect(
            (yield* ingestion.status("owner")).sources
              .filter((source) => source.enabled)
              .map((source) => source.latest?.kind)
          ).toEqual(["incremental", "incremental"])
          yield* TestClock.adjust(24 * hour)
          yield* ingestion.scheduled("owner")
          expect(
            (yield* ingestion.status("owner")).sources
              .filter((source) => source.enabled)
              .map((source) => source.latest?.kind)
          ).toEqual(["full", "full"])
        })
      )
    }
  )
})
