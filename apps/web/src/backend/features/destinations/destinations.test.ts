import { assert, describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { vi } from "vitest"
import {
  AccessDenied,
  Spotify,
  type SpotifyPlaylist,
  spotifyError,
} from "@/backend/modules/spotify"
import {
  type Destination,
  DestinationConflict,
  DestinationPersistenceError,
  Destinations,
  DestinationStore,
} from "."

type Store = DestinationStore["Service"]

const playlist = (id: string, name = id): SpotifyPlaylist => ({
  id,
  name,
  ownerId: "spotify-user",
  public: false,
  collaborative: false,
})

const tagOf = <A, E extends { _tag: string }>(effect: Effect.Effect<A, E>) =>
  Effect.map(Effect.flip(effect), (error) => error._tag)

function setup() {
  const destinations = new Map<string, Destination>()
  let reviewPlaylistId: string | null = null
  let failNextSave = false

  const spotify = {
    playlist: vi.fn<Spotify["Service"]["playlist"]>(
      (_ownerId: string, playlistId: string) =>
        playlistId === "missing"
          ? Effect.fail(
              spotifyError(new AccessDenied({ message: "Not owned" }))
            )
          : Effect.succeed(playlist(playlistId))
    ),
    createPrivatePlaylist: vi.fn<Spotify["Service"]["createPrivatePlaylist"]>(
      (_ownerId: string, name: string) =>
        Effect.succeed(playlist("created", name))
    ),
  }

  const store = {
    read: vi.fn<Store["read"]>((_ownerId: string) =>
      Effect.sync(() => ({
        destinations: [...destinations.values()],
        reviewPlaylistId,
      }))
    ),
    save: vi.fn<Store["save"]>((_ownerId: string, destination: Destination) => {
      if (failNextSave) {
        failNextSave = false
        return Effect.fail(
          new DestinationPersistenceError({ cause: "database unavailable" })
        )
      }
      if (destination.enabled && reviewPlaylistId === destination.playlistId)
        return Effect.fail(new DestinationConflict())
      destinations.set(destination.playlistId, destination)
      return Effect.void
    }),
    remove: vi.fn<Store["remove"]>((_ownerId: string, playlistId: string) =>
      Effect.sync(() => {
        destinations.delete(playlistId)
      })
    ),
    setReview: vi.fn<Store["setReview"]>(
      (_ownerId: string, playlistId: string | null, _now: number) => {
        if (
          [...destinations.values()].some(
            (destination) =>
              destination.enabled && destination.playlistId === playlistId
          )
        )
          return Effect.fail(new DestinationConflict())
        reviewPlaylistId = playlistId
        return Effect.void
      }
    ),
  }

  const layer = Destinations.layerNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(DestinationStore, DestinationStore.of(store)),
        // Only the two operations this feature uses are implemented.
        Layer.succeed(Spotify, spotify as unknown as Spotify["Service"])
      )
    )
  )
  return {
    spotify,
    store,
    failNextSave: () => {
      failNextSave = true
    },
    run: <A, E>(body: Effect.Effect<A, E, Destinations>) =>
      Effect.provide(body, layer),
  }
}

describe("destination configuration", () => {
  it.effect(
    "saves app-owned rules and preserves creation time when editing",
    () => {
      const { run, spotify } = setup()
      return run(
        Effect.gen(function* () {
          const destinations = yield* Destinations
          yield* TestClock.setTime(10)
          const first = yield* destinations.save({
            ownerId: "owner",
            playlistId: "jazz",
            description: "  Acoustic jazz  ",
            enabled: true,
          })
          yield* TestClock.setTime(20)
          const edited = yield* destinations.save({
            ownerId: "owner",
            playlistId: "jazz",
            description: "  Modern jazz  ",
            enabled: true,
          })
          expect(first).toMatchObject({
            description: "Acoustic jazz",
            createdAt: 10,
          })
          expect(edited).toMatchObject({
            description: "Modern jazz",
            createdAt: 10,
            updatedAt: 20,
          })
          expect(spotify.playlist).toHaveBeenCalledWith("owner", "jazz")
          assert.deepStrictEqual(
            (yield* destinations.read("owner")).destinations,
            [edited]
          )
        })
      )
    }
  )

  it.effect(
    "keeps an added playlist disabled until a meaningful description is saved",
    () => {
      const { run } = setup()
      return run(
        Effect.gen(function* () {
          const destinations = yield* Destinations
          const added = yield* destinations.save({
            ownerId: "owner",
            playlistId: "jazz",
            description: "  ",
            enabled: false,
          })
          expect(added).toMatchObject({ description: "", enabled: false })
          const error = yield* Effect.flip(
            destinations.save({
              ownerId: "owner",
              playlistId: "jazz",
              description: "  ",
              enabled: true,
            })
          )
          assert.strictEqual(error._tag, "DestinationInputError")
          expect(error.message).toContain("track description")
          const configured = yield* destinations.save({
            ownerId: "owner",
            playlistId: "jazz",
            description: "  Mellow acoustic songs  ",
            enabled: true,
          })
          expect(configured).toMatchObject({
            description: "Mellow acoustic songs",
            enabled: true,
          })
        })
      )
    }
  )

  it.effect(
    "rejects inaccessible playlists and ambiguous review routing",
    () => {
      const { run, store } = setup()
      return run(
        Effect.gen(function* () {
          const destinations = yield* Destinations
          const save = (playlistId: string, enabled: boolean) =>
            destinations.save({
              ownerId: "owner",
              playlistId,
              description: "Rule",
              enabled,
            })
          assert.strictEqual(
            yield* tagOf(save("missing", true)),
            "PlaylistNotUsable"
          )
          expect(store.save).not.toHaveBeenCalled()
          yield* destinations.setReviewPlaylist({
            ownerId: "owner",
            playlistId: "review",
          })
          assert.strictEqual(
            yield* tagOf(save("review", true)),
            "DestinationConflict"
          )
          yield* save("review", false)
          assert.strictEqual(
            yield* tagOf(save("review", true)),
            "DestinationConflict"
          )
          yield* save("other", true)
          assert.strictEqual(
            yield* tagOf(
              destinations.setReviewPlaylist({
                ownerId: "owner",
                playlistId: "other",
              })
            ),
            "DestinationConflict"
          )
        })
      )
    }
  )

  it.effect("removing a destination only changes app configuration", () => {
    const { run, store, spotify } = setup()
    return run(
      Effect.gen(function* () {
        const destinations = yield* Destinations
        yield* destinations.save({
          ownerId: "owner",
          playlistId: "jazz",
          description: "Rule",
          enabled: true,
        })
        yield* destinations.remove({ ownerId: "owner", playlistId: "jazz" })
        assert.deepStrictEqual(
          (yield* destinations.read("owner")).destinations,
          []
        )
        expect(store.remove).toHaveBeenCalledWith("owner", "jazz")
        expect(spotify.playlist).toHaveBeenCalledTimes(1)
        expect(spotify.createPrivatePlaylist).not.toHaveBeenCalled()
      })
    )
  })

  it.effect(
    "creates a private playlist before saving and reports a partial save precisely",
    () => {
      const { run, spotify, failNextSave } = setup()
      return run(
        Effect.gen(function* () {
          const destinations = yield* Destinations
          failNextSave()
          const error = yield* Effect.flip(
            destinations.create({
              ownerId: "owner",
              name: "  Focus  ",
              description: "  Concentration  ",
            })
          )
          expect(error).toMatchObject({
            _tag: "CreatedPlaylistConfigurationError",
            playlist: { id: "created", name: "Focus" },
          })
          expect(spotify.createPrivatePlaylist).toHaveBeenCalledWith(
            "owner",
            "Focus"
          )
          assert.deepStrictEqual(
            (yield* destinations.read("owner")).destinations,
            []
          )
        })
      )
    }
  )

  it.effect(
    "creates a private playlist with no description as unconfigured",
    () => {
      const { run, spotify } = setup()
      return run(
        Effect.gen(function* () {
          const destinations = yield* Destinations
          const result = yield* destinations.create({
            ownerId: "owner",
            name: "  Focus  ",
            description: "",
          })
          expect(spotify.createPrivatePlaylist).toHaveBeenCalledWith(
            "owner",
            "Focus"
          )
          expect(result.destination).toMatchObject({
            playlistId: "created",
            description: "",
            enabled: false,
          })
        })
      )
    }
  )
})
