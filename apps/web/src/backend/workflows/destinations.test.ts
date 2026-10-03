import { Effect, Layer } from "effect"
import { describe, expect, test, vi } from "vitest"
import {
  createDestination,
  DestinationConflict,
  DestinationPersistenceError,
  DestinationStore,
  OwnedPlaylists,
  PlaylistAccessError,
  readDestinations,
  removeDestination,
  saveDestination,
  setReviewPlaylist,
  type Destination,
  type DestinationConfiguration,
  type OwnedPlaylist,
} from "./destinations"

function setup() {
  const destinations = new Map<string, Destination>()
  let reviewPlaylistId: string | null = null
  let failNextSave = false
  const get = vi.fn<
    (
      _: string,
      playlistId: string
    ) => Effect.Effect<OwnedPlaylist, PlaylistAccessError>
  >((_, playlistId) =>
    playlistId === "missing"
      ? Effect.fail(
          new PlaylistAccessError("invalid", "Playlist is inaccessible")
        )
      : Effect.succeed({ id: playlistId, name: playlistId })
  )
  const createPrivate = vi.fn<
    (
      _: string,
      name: string
    ) => Effect.Effect<OwnedPlaylist, PlaylistAccessError>
  >((_, name) => Effect.succeed({ id: "created", name }))
  const store = {
    read: vi.fn<
      (
        _: string
      ) => Effect.Effect<DestinationConfiguration, DestinationPersistenceError>
    >(() =>
      Effect.succeed({
        destinations: [...destinations.values()],
        reviewPlaylistId,
      })
    ),
    save: vi.fn<
      (
        _: string,
        destination: Destination
      ) => Effect.Effect<
        void,
        DestinationPersistenceError | DestinationConflict
      >
    >((_, destination) => {
      if (failNextSave) {
        failNextSave = false
        return Effect.fail(
          new DestinationPersistenceError("database unavailable")
        )
      }
      if (destination.enabled && reviewPlaylistId === destination.playlistId)
        return Effect.fail(new DestinationConflict())
      destinations.set(destination.playlistId, destination)
      return Effect.void
    }),
    remove: vi.fn<
      (
        _: string,
        playlistId: string
      ) => Effect.Effect<void, DestinationPersistenceError>
    >((_, playlistId) => {
      destinations.delete(playlistId)
      return Effect.void
    }),
    setReview: vi.fn<
      (
        _: string,
        playlistId: string | null
      ) => Effect.Effect<
        void,
        DestinationPersistenceError | DestinationConflict
      >
    >((_, playlistId) => {
      if (
        [...destinations.values()].some(
          (destination) =>
            destination.enabled && destination.playlistId === playlistId
        )
      )
        return Effect.fail(new DestinationConflict())
      reviewPlaylistId = playlistId
      return Effect.void
    }),
  }
  const layer = Layer.merge(
    Layer.succeed(DestinationStore, store),
    Layer.succeed(OwnedPlaylists, { get, createPrivate })
  )
  const run = <A, E>(
    effect: Effect.Effect<A, E, DestinationStore | OwnedPlaylists>
  ) => Effect.runPromise(Effect.provide(effect, layer))
  return {
    run,
    get,
    createPrivate,
    store,
    destinations,
    failNextSave: () => {
      failNextSave = true
    },
  }
}

describe("destination configuration", () => {
  test("saves app-owned rules and preserves creation time when editing", async () => {
    const { run, get } = setup()
    const first = await run(
      saveDestination({
        ownerId: "owner",
        playlistId: "jazz",
        description: "  Acoustic jazz  ",
        enabled: true,
        now: 10,
      })
    )
    const edited = await run(
      saveDestination({
        ownerId: "owner",
        playlistId: "jazz",
        description: "  Modern jazz  ",
        enabled: true,
        now: 20,
      })
    )
    expect(first).toMatchObject({ description: "Acoustic jazz", createdAt: 10 })
    expect(edited).toMatchObject({
      description: "Modern jazz",
      createdAt: 10,
      updatedAt: 20,
    })
    expect(get).toHaveBeenCalledWith("owner", "jazz")
    expect((await run(readDestinations("owner"))).destinations).toEqual([
      edited,
    ])
  })

  test("rejects inaccessible playlists and ambiguous review routing", async () => {
    const { run, store } = setup()
    await expect(
      run(
        saveDestination({
          ownerId: "owner",
          playlistId: "missing",
          description: "Rule",
          enabled: true,
          now: 10,
        })
      )
    ).rejects.toMatchObject({ _tag: "PlaylistAccessError" })
    expect(store.save).not.toHaveBeenCalled()
    await run(setReviewPlaylist({ ownerId: "owner", playlistId: "review" }))
    await expect(
      run(
        saveDestination({
          ownerId: "owner",
          playlistId: "review",
          description: "Rule",
          enabled: true,
          now: 10,
        })
      )
    ).rejects.toMatchObject({ _tag: "DestinationConflict" })
    await run(
      saveDestination({
        ownerId: "owner",
        playlistId: "review",
        description: "Rule",
        enabled: false,
        now: 10,
      })
    )
    await expect(
      run(
        saveDestination({
          ownerId: "owner",
          playlistId: "review",
          description: "Rule",
          enabled: true,
          now: 11,
        })
      )
    ).rejects.toMatchObject({ _tag: "DestinationConflict" })
    await run(
      saveDestination({
        ownerId: "owner",
        playlistId: "other",
        description: "Other",
        enabled: true,
        now: 12,
      })
    )
    await expect(
      run(setReviewPlaylist({ ownerId: "owner", playlistId: "other" }))
    ).rejects.toMatchObject({ _tag: "DestinationConflict" })
  })

  test("removing a destination only changes app configuration", async () => {
    const { run, store, get, createPrivate } = setup()
    await run(
      saveDestination({
        ownerId: "owner",
        playlistId: "jazz",
        description: "Rule",
        enabled: true,
        now: 10,
      })
    )
    await run(removeDestination({ ownerId: "owner", playlistId: "jazz" }))
    expect((await run(readDestinations("owner"))).destinations).toEqual([])
    expect(store.remove).toHaveBeenCalledWith("owner", "jazz")
    expect(get).toHaveBeenCalledTimes(1)
    expect(createPrivate).not.toHaveBeenCalled()
  })

  test("creates a private playlist before saving and reports a partial save precisely", async () => {
    const { run, createPrivate, failNextSave } = setup()
    failNextSave()
    await expect(
      run(
        createDestination({
          ownerId: "owner",
          name: "  Focus  ",
          description: "  Concentration  ",
          now: 10,
        })
      )
    ).rejects.toMatchObject({
      _tag: "CreatedPlaylistConfigurationError",
      playlist: { id: "created", name: "Focus" },
    })
    expect(createPrivate).toHaveBeenCalledWith("owner", "Focus")
    expect((await run(readDestinations("owner"))).destinations).toEqual([])
  })
})
