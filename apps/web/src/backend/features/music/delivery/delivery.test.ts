import { assert, describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { vi } from "vitest"
import {
  type DestinationConfiguration,
  Destinations,
} from "@/backend/features/music/destinations"
import {
  AccessDenied,
  Spotify,
  spotifyError,
  Unavailable,
} from "@/backend/modules/spotify"
import { Database } from "@/backend/primitives/database"
import { makeTestD1 } from "@/backend/primitives/database/testing"
import { JobQueue } from "@/backend/primitives/job-queue"
import { DeliveryStore, MusicDelivery } from "."

const destination = (playlistId: string, enabled = true) => ({
  playlistId,
  description: playlistId,
  enabled,
  createdAt: 1,
  updatedAt: 1,
})

/** Spotify refusing writes to the "jazz" playlist. */
const refuse = (playlistId: string) =>
  playlistId === "jazz"
    ? Effect.fail(spotifyError(new AccessDenied({ message: "Not allowed" })))
    : undefined

function setup() {
  const d1 = makeTestD1()
  d1.seedOwner()
  let configuration: DestinationConfiguration = {
    destinations: [destination("jazz"), destination("focus")],
    reviewPlaylistId: "review",
    ready: true,
  }
  /** What Spotify currently holds. */
  const liked = new Set<string>()
  const playlists = new Map<string, string[]>()
  const spotify = {
    likedTracks: vi.fn<Spotify["Service"]["likedTracks"]>((_ownerId, ids) =>
      Effect.succeed(new Set(ids.filter((id) => liked.has(id))))
    ),
    playlistTrackIds: vi.fn<Spotify["Service"]["playlistTrackIds"]>(
      (_ownerId, playlistId) =>
        Effect.succeed(new Set(playlists.get(playlistId) ?? []))
    ),
    addTracksToPlaylist: vi.fn<Spotify["Service"]["addTracksToPlaylist"]>(
      (_ownerId, playlistId, ids) =>
        Effect.sync(() => {
          playlists.set(playlistId, [
            ...(playlists.get(playlistId) ?? []),
            ...ids,
          ])
        })
    ),
  }
  const sent: unknown[] = []
  const layer = MusicDelivery.layerNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(
        DeliveryStore.layer,
        Layer.succeed(Destinations, {
          read: () => Effect.sync(() => configuration),
        } as unknown as Destinations["Service"]),
        Layer.succeed(Spotify, spotify as unknown as Spotify["Service"]),
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

  /** A liked track with a decision. */
  const decided = (
    trackId: string,
    decision: { destinationIds?: string[]; review?: boolean }
  ) => {
    liked.add(trackId)
    d1.sqlite
      .prepare(
        "INSERT OR IGNORE INTO music_liked_tracks (owner_id, track_id, name, artist_names, isrc, liked_at, liked, first_seen_at, last_seen_at) VALUES ('owner', ?, 'Song', '[]', NULL, '2026-01-01T00:00:00Z', 1, 1, 1)"
      )
      .run(trackId)
    d1.sqlite
      .prepare(
        "INSERT OR REPLACE INTO music_decisions (owner_id, track_id, destination_ids, review, reason, probabilities, model, fingerprint, classified_at) VALUES ('owner', ?, ?, ?, 'classified', '{}', 'jev-1.13.0', 'f', 1)"
      )
      .run(
        trackId,
        JSON.stringify(decision.destinationIds ?? []),
        decision.review ? 1 : 0
      )
  }

  return {
    d1,
    sent,
    spotify,
    liked,
    playlists,
    decided,
    setConfiguration: (value: DestinationConfiguration) => {
      configuration = value
    },
    configuration: () => configuration,
    likedInDb: (trackId: string) =>
      d1.sqlite
        .prepare("SELECT liked FROM music_liked_tracks WHERE track_id = ?")
        .get(trackId)?.liked,
    run: <A, E>(body: Effect.Effect<A, E, MusicDelivery>) =>
      body.pipe(Effect.provide(layer), Effect.ensuring(Effect.sync(d1.close))),
  }
}

describe("music delivery", () => {
  it.effect(
    "writes each decision once, grouped by playlist, with review tracks to the review playlist",
    () => {
      const t = setup()
      t.decided("a", { destinationIds: ["jazz", "focus"] })
      t.decided("b", { destinationIds: ["jazz"] })
      t.decided("c", { review: true })
      return t.run(
        Effect.gen(function* () {
          const delivery = yield* MusicDelivery
          expect(yield* delivery.status("owner")).toMatchObject({
            toWrite: 4,
            delivered: 0,
          })
          assert.deepStrictEqual(yield* delivery.processNext("owner"), {
            delivered: 4,
            unliked: 0,
          })
          expect(new Set(t.playlists.get("jazz"))).toEqual(new Set(["a", "b"]))
          assert.deepStrictEqual(t.playlists.get("focus"), ["a"])
          assert.deepStrictEqual(t.playlists.get("review"), ["c"])
          expect(t.spotify.addTracksToPlaylist).toHaveBeenCalledTimes(3)

          assert.deepStrictEqual(yield* delivery.processNext("owner"), {
            delivered: 0,
            unliked: 0,
          })
          expect(t.spotify.addTracksToPlaylist).toHaveBeenCalledTimes(3)
          expect(yield* delivery.status("owner")).toMatchObject({
            toWrite: 0,
            delivered: 4,
          })
        })
      )
    }
  )

  it.effect("skips disabled destinations until they are enabled again", () => {
    const t = setup()
    t.setConfiguration({
      ...t.configuration(),
      destinations: [destination("jazz", false)],
    })
    t.decided("a", { destinationIds: ["jazz"] })
    return t.run(
      Effect.gen(function* () {
        const delivery = yield* MusicDelivery
        yield* delivery.processNext("owner")
        assert.isUndefined(t.playlists.get("jazz"))
        t.setConfiguration({
          ...t.configuration(),
          destinations: [destination("jazz")],
        })
        yield* delivery.processNext("owner")
        assert.deepStrictEqual(t.playlists.get("jazz"), ["a"])
      })
    )
  })

  it.effect(
    "never writes a track that is no longer liked, and records the un-like",
    () => {
      const t = setup()
      t.decided("a", { destinationIds: ["jazz"] })
      t.liked.delete("a")
      return t.run(
        Effect.gen(function* () {
          const delivery = yield* MusicDelivery
          assert.deepStrictEqual(yield* delivery.processNext("owner"), {
            delivered: 0,
            unliked: 1,
          })
          assert.isUndefined(t.playlists.get("jazz"))
          assert.strictEqual(t.likedInDb("a"), 0)
          expect(yield* delivery.status("owner")).toMatchObject({ toWrite: 0 })
        })
      )
    }
  )

  it.effect(
    "checks the playlist before retrying a write with an unknown outcome",
    () => {
      const t = setup()
      t.decided("a", { destinationIds: ["jazz"] })
      t.decided("b", { destinationIds: ["jazz"] })
      // The write reaches Spotify, but the response is lost.
      t.spotify.addTracksToPlaylist.mockImplementationOnce(
        (_ownerId, playlistId, ids) =>
          Effect.sync(() => {
            t.playlists.set(playlistId, [...ids])
          }).pipe(
            Effect.andThen(Effect.fail(spotifyError(new Unavailable({}))))
          )
      )
      return t.run(
        Effect.gen(function* () {
          const delivery = yield* MusicDelivery
          const error = yield* Effect.flip(delivery.processNext("owner"))
          assert.strictEqual(error._tag, "SpotifyError")

          yield* delivery.processNext("owner")
          expect(t.spotify.playlistTrackIds).toHaveBeenCalledWith(
            "owner",
            "jazz"
          )
          // No duplicates: both tracks appear exactly once.
          expect(t.playlists.get("jazz")).toHaveLength(2)
          expect(new Set(t.playlists.get("jazz"))).toEqual(new Set(["a", "b"]))
          expect(yield* delivery.status("owner")).toMatchObject({
            delivered: 2,
            toWrite: 0,
          })
        })
      )
    }
  )

  it.effect(
    "after reclassification, adds the new playlist and leaves the old one",
    () => {
      const t = setup()
      t.decided("a", { destinationIds: ["jazz"] })
      return t.run(
        Effect.gen(function* () {
          const delivery = yield* MusicDelivery
          yield* delivery.processNext("owner")
          t.decided("a", { destinationIds: ["focus"] })
          yield* delivery.processNext("owner")
          assert.deepStrictEqual(t.playlists.get("jazz"), ["a"])
          assert.deepStrictEqual(t.playlists.get("focus"), ["a"])
        })
      )
    }
  )

  it.effect("automatic delivery queues work only while it is on", () => {
    const t = setup()
    return t.run(
      Effect.gen(function* () {
        const delivery = yield* MusicDelivery
        yield* delivery.requestIfAutomatic("owner")
        assert.strictEqual(t.sent.length, 0)
        yield* delivery.setAutomatic("owner", true)
        assert.strictEqual(t.sent.length, 1)
        yield* delivery.requestIfAutomatic("owner")
        assert.strictEqual(t.sent.length, 2)
        expect(yield* delivery.status("owner")).toMatchObject({
          automatic: true,
        })
      })
    )
  })

  it.effect("writes 100 pairs per batch and queues the rest", () => {
    const t = setup()
    for (let index = 0; index < 120; index++)
      t.decided(`t${index}`, { destinationIds: ["jazz"] })
    return t.run(
      Effect.gen(function* () {
        const delivery = yield* MusicDelivery
        expect(yield* delivery.processNext("owner")).toMatchObject({
          delivered: 100,
        })
        assert.deepStrictEqual(t.sent, [
          { kind: "music.delivery", ownerId: "owner" },
        ])
        expect(yield* delivery.processNext("owner")).toMatchObject({
          delivered: 20,
        })
        assert.strictEqual(t.sent.length, 1)
      })
    )
  })

  it.effect("does not add a track that is already in the playlist", () => {
    const t = setup()
    t.playlists.set("jazz", ["a"])
    t.decided("a", { destinationIds: ["jazz"] })
    t.decided("b", { destinationIds: ["jazz"] })
    return t.run(
      Effect.gen(function* () {
        const delivery = yield* MusicDelivery
        yield* delivery.processNext("owner")
        assert.deepStrictEqual(t.playlists.get("jazz"), ["a", "b"])
        expect(yield* delivery.status("owner")).toMatchObject({
          delivered: 2,
          toWrite: 0,
        })
      })
    )
  })

  it.effect(
    "sets aside a playlist Spotify refuses, keeps writing the others, and retries it on Write now",
    () => {
      const t = setup()
      t.decided("a", { destinationIds: ["jazz", "focus"] })
      t.spotify.playlistTrackIds.mockImplementation(
        (_ownerId, playlistId) =>
          refuse(playlistId) ??
          Effect.succeed(new Set(t.playlists.get(playlistId)))
      )
      return t.run(
        Effect.gen(function* () {
          const delivery = yield* MusicDelivery
          expect(yield* delivery.processNext("owner")).toMatchObject({
            delivered: 1,
          })
          assert.deepStrictEqual(t.playlists.get("focus"), ["a"])
          expect(yield* delivery.status("owner")).toMatchObject({
            toWrite: 0,
            refused: 1,
          })
          // Nothing left to do: no continuation loop on the refused playlist.
          assert.strictEqual(t.sent.length, 0)

          t.spotify.playlistTrackIds.mockImplementation(
            (_ownerId, playlistId) =>
              Effect.succeed(new Set(t.playlists.get(playlistId)))
          )
          yield* delivery.request("owner")
          expect(yield* delivery.status("owner")).toMatchObject({
            toWrite: 1,
            refused: 0,
          })
          yield* delivery.processNext("owner")
          assert.deepStrictEqual(t.playlists.get("jazz"), ["a"])
        })
      )
    }
  )
})
