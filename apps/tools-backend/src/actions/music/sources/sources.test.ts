import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { vi } from "vitest"
import { Database } from "#backend/modules/database"
import { makeTestD1 } from "#backend/modules/database/testing"
import {
  Spotify,
  SpotifyConnections,
  spotifyError,
  AccessDenied,
} from "#backend/modules/spotify"
import { JobQueue } from "#backend/modules/job-queue"
import { SourceStore } from "#backend/actions/music/collection"
import { DestinationStore } from "#backend/actions/music/destinations"
import {
  MusicIngestion,
  IngestionStore,
} from "#backend/actions/music/ingestion"
import { Sources } from "."

function setup() {
  const d1 = makeTestD1()
  d1.seedOwner()
  const sent: unknown[] = []
  const playlist = vi.fn<Spotify["Service"]["playlist"]>((_ownerId, id) =>
    Effect.succeed({
      id,
      name: id,
      public: false,
      collaborative: false,
      ownerId: "spotify-user",
    })
  )
  const playlistSnapshot = vi.fn<Spotify["Service"]["playlistSnapshot"]>(() =>
    Effect.succeed("version1")
  )
  const playlistTracksPage = vi.fn<Spotify["Service"]["playlistTracksPage"]>(
    () => Effect.succeed({ items: [], next: null, total: 0 })
  )
  const dependencies = Layer.mergeAll(
    SourceStore.layer,
    IngestionStore.layer,
    DestinationStore.layer,
    SpotifyConnections.layer,
    Layer.succeed(Spotify, {
      playlist,
      playlistSnapshot,
      playlistTracksPage,
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
  const ingestion = MusicIngestion.layerNoDeps.pipe(Layer.provide(dependencies))
  const layer = Layer.mergeAll(
    Sources.layerNoDeps.pipe(
      Layer.provide(Layer.mergeAll(dependencies, ingestion))
    ),
    SourceStore.layer,
    DestinationStore.layer,
    ingestion
  ).pipe(Layer.provide(Database.layer(d1.binding)))
  return {
    d1,
    sent,
    playlist,
    playlistTracksPage,
    playlistSnapshot,
    run: <A, E>(
      body: Effect.Effect<
        A,
        E,
        Sources | SourceStore | DestinationStore | MusicIngestion
      >
    ) =>
      body.pipe(Effect.provide(layer), Effect.ensuring(Effect.sync(d1.close))),
  }
}

const destination = (enabled: boolean) => ({
  playlistId: "shazam",
  description: "All",
  enabled,
  createdAt: 1,
  updatedAt: 1,
})

describe("music sources", () => {
  it.effect(
    "keeps Liked Songs built in and seeds it without resetting its enabled state",
    () => {
      const t = setup()
      return t.run(
        Effect.gen(function* () {
          const sources = yield* Sources
          const store = yield* SourceStore
          yield* sources.setEnabled("owner", { kind: "liked" }, false)
          yield* store.seedLiked("owner", 10)
          expect(yield* sources.read("owner")).toMatchObject([
            { sourceId: { kind: "liked" }, enabled: false },
          ])
          expect(
            (yield* Effect.flip(sources.remove("owner", "liked")))._tag
          ).toBe("SourceInputError")
          expect(t.sent).toHaveLength(0)
          yield* sources.setEnabled("owner", { kind: "liked" }, true)
          expect(t.sent).toHaveLength(1)
        })
      )
    }
  )

  it.effect(
    "adds and enables owned playlists with a full read, and cancels work on disable or removal",
    () => {
      const t = setup()
      return t.run(
        Effect.gen(function* () {
          const sources = yield* Sources
          const ingestion = yield* MusicIngestion
          yield* sources.add("owner", "shazam")
          expect(t.playlist).toHaveBeenCalledWith("owner", "shazam")
          expect((yield* sources.read("owner"))[1]).toMatchObject({
            enabled: true,
            latest: {
              kind: "full",
              status: "queued",
              source: { kind: "playlist", playlistId: "shazam" },
            },
          })
          expect(t.sent).toHaveLength(1)
          yield* sources.add("owner", "shazam")
          expect(t.sent).toHaveLength(1)
          yield* sources.setEnabled(
            "owner",
            { kind: "playlist", playlistId: "shazam" },
            false
          )
          const disabled = (yield* sources.read("owner"))[1]!
          expect(disabled).toMatchObject({
            enabled: false,
            latest: { status: "failed" },
          })
          expect(yield* ingestion.processNext(disabled.latest!.id)).toEqual({
            ownerId: null,
            added: 0,
          })
          yield* sources.setEnabled(
            "owner",
            { kind: "playlist", playlistId: "shazam" },
            true
          )
          expect((yield* sources.read("owner"))[1]?.latest).toMatchObject({
            kind: "full",
            status: "queued",
          })
          expect(t.sent).toHaveLength(2)
          yield* sources.remove("owner", "shazam")
          expect(
            (yield* sources.read("owner")).map((source) => source.sourceId)
          ).toEqual([{ kind: "liked" }])
          expect(t.playlist).toHaveBeenCalledTimes(3)
        })
      )
    }
  )

  it.effect("refuses a playlist the connected account does not own", () => {
    const t = setup()
    t.playlist.mockReturnValue(
      Effect.fail(spotifyError(new AccessDenied({ message: "Not owned" })))
    )
    return t.run(
      Effect.gen(function* () {
        const sources = yield* Sources
        expect((yield* Effect.flip(sources.add("owner", "shazam")))._tag).toBe(
          "SpotifyError"
        )
        expect(yield* sources.read("owner")).toHaveLength(1)
        expect(t.sent).toHaveLength(0)
      })
    )
  })

  it.effect(
    "rejects conflicting roles in either write order, including disabled roles",
    () => {
      const t = setup()
      return t.run(
        Effect.gen(function* () {
          const sources = yield* Sources
          const destinations = yield* DestinationStore
          for (const enabled of [false, true]) {
            yield* destinations.save("owner", destination(enabled))
            expect(
              (yield* Effect.flip(sources.add("owner", "shazam")))._tag
            ).toBe("SourceConflict")
            yield* destinations.remove("owner", "shazam")
          }
          yield* destinations.setReview("owner", "shazam", 1)
          expect(
            (yield* Effect.flip(sources.add("owner", "shazam")))._tag
          ).toBe("SourceConflict")
          yield* destinations.setReview("owner", null, 1)
          yield* sources.add("owner", "shazam")
          yield* sources.setEnabled(
            "owner",
            { kind: "playlist", playlistId: "shazam" },
            false
          )
          for (const enabled of [false, true])
            expect(
              (yield* Effect.flip(
                destinations.save("owner", destination(enabled))
              ))._tag
            ).toBe("DestinationConflict")
          expect(
            (yield* Effect.flip(destinations.setReview("owner", "shazam", 1)))
              ._tag
          ).toBe("DestinationConflict")
          expect((yield* destinations.read("owner")).destinations).toEqual([])
        })
      )
    }
  )
})

it.effect(
  "does not restore a disabled source's work when a Spotify page arrives late",
  () => {
    const t = setup()
    return t.run(
      Effect.gen(function* () {
        const sources = yield* Sources
        const ingestion = yield* MusicIngestion
        yield* sources.add("owner", "shazam")
        const queued = (yield* sources.read("owner"))[1]!.latest!
        t.playlistTracksPage.mockReturnValue(
          sources
            .setEnabled(
              "owner",
              { kind: "playlist", playlistId: "shazam" },
              false
            )
            .pipe(
              Effect.orDie,
              Effect.as({
                items: [
                  {
                    id: "late",
                    name: "Late",
                    artistNames: [],
                    isrc: null,
                    durationMs: null,
                    addedAt: "2026-01-01T00:00:00Z",
                  },
                ],
                next: null,
                total: 1,
              })
            )
        )
        expect(yield* ingestion.processNext(queued.id)).toEqual({
          ownerId: null,
          added: 0,
        })
        expect((yield* sources.read("owner"))[1]).toMatchObject({
          enabled: false,
          present: 0,
          snapshotId: null,
          latest: { status: "failed" },
        })
      })
    )
  }
)
