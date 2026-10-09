import { Effect, Layer } from "effect"
import { describe, expect, test } from "vitest"
import { Database } from "@/backend/primitives/database"
import { makeTestD1 } from "@/backend/primitives/database/testing"
import { DestinationStore } from "./store"

function setup() {
  const { sqlite, binding, seedOwner, close } = makeTestD1()
  seedOwner()
  const store = Effect.runSync(
    Effect.provide(
      DestinationStore,
      DestinationStore.layer.pipe(Layer.provide(Database.layer(binding)))
    )
  )
  return { sqlite, store, close }
}

describe("destination persistence", () => {
  test("keeps rules in app storage and rejects either concurrent conflict direction", async () => {
    const { store, close } = setup()
    try {
      await Effect.runPromise(
        store.save("owner", {
          playlistId: "jazz",
          description: "Improvised acoustic music",
          enabled: true,
          createdAt: 10,
          updatedAt: 10,
        })
      )
      await expect(
        Effect.runPromise(store.setReview("owner", "jazz", 1))
      ).rejects.toMatchObject({ _tag: "DestinationConflict" })
      await Effect.runPromise(store.setReview("owner", "review", 1))
      await expect(
        Effect.runPromise(
          store.save("owner", {
            playlistId: "review",
            description: "Any music",
            enabled: true,
            createdAt: 11,
            updatedAt: 11,
          })
        )
      ).rejects.toMatchObject({ _tag: "DestinationConflict" })
      await Effect.runPromise(
        store.save("owner", {
          playlistId: "jazz",
          description: "New rule",
          enabled: false,
          createdAt: 20,
          updatedAt: 20,
        })
      )
      expect(await Effect.runPromise(store.read("owner"))).toEqual({
        destinations: [
          {
            playlistId: "jazz",
            description: "New rule",
            enabled: false,
            createdAt: 10,
            updatedAt: 20,
          },
        ],
        reviewPlaylistId: "review",
        ready: false,
      })
    } finally {
      close()
    }
  })

  test("disconnect cascades only app configuration", async () => {
    const { sqlite, store, close } = setup()
    try {
      await Effect.runPromise(
        store.save("owner", {
          playlistId: "jazz",
          description: "Rule",
          enabled: true,
          createdAt: 10,
          updatedAt: 10,
        })
      )
      await Effect.runPromise(store.setReview("owner", "review", 1))
      sqlite
        .prepare("DELETE FROM spotify_connections WHERE owner_id = ?")
        .run("owner")
      expect(await Effect.runPromise(store.read("owner"))).toEqual({
        destinations: [],
        reviewPlaylistId: null,
        ready: false,
      })
    } finally {
      close()
    }
  })
})
