import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { Effect } from "effect"
import { describe, expect, test } from "vitest"
import { destinationStoreLayer } from "./destination-store"
import { DestinationStore } from "@/backend/workflows/destinations"

function setup() {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec("PRAGMA foreign_keys = ON")
  const migrations = new URL("../../../migrations/", import.meta.url)
  for (const file of readdirSync(migrations)
    .filter((name) => name.endsWith(".sql"))
    // oxlint-disable-next-line unicorn/no-array-sort -- this freshly read migration list has no other consumers
    .sort()) {
    sqlite.exec(readFileSync(new URL(file, migrations), "utf8"))
  }
  sqlite
    .prepare("INSERT INTO app_owners VALUES (?, ?, ?, ?, ?)")
    .run("owner", "owner", null, null, 1)
  sqlite
    .prepare(
      "INSERT INTO spotify_connections (owner_id, account_id, display_name, encrypted_refresh_token, scopes, connected_at, needs_reconnect, spotify_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run("owner", "account", null, "encrypted", "scopes", 1, 0, "spotify-user")

  const binding = {
    prepare(query: string) {
      return {
        bind(...values: unknown[]) {
          const statement = sqlite.prepare(query)
          return {
            async all() {
              return {
                results: statement.all(
                  ...(values as Parameters<typeof statement.all>)
                ),
              }
            },
            async first() {
              return (
                statement.get(
                  ...(values as Parameters<typeof statement.get>)
                ) ?? null
              )
            },
            async raw() {
              statement.setReturnArrays(true)
              return statement.all(
                ...(values as Parameters<typeof statement.all>)
              )
            },
            async run() {
              const result = statement.run(
                ...(values as Parameters<typeof statement.run>)
              )
              return {
                success: true,
                meta: { changes: Number(result.changes) },
              }
            },
          }
        },
      }
    },
  } as unknown as D1Database
  const layer = destinationStoreLayer(binding)
  const store = Effect.runSync(Effect.provide(DestinationStore, layer))
  return { sqlite, store, close: () => sqlite.close() }
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
        Effect.runPromise(store.setReview("owner", "jazz"))
      ).rejects.toMatchObject({ _tag: "DestinationConflict" })
      await Effect.runPromise(store.setReview("owner", "review"))
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
      await Effect.runPromise(store.setReview("owner", "review"))
      sqlite
        .prepare("DELETE FROM spotify_connections WHERE owner_id = ?")
        .run("owner")
      expect(await Effect.runPromise(store.read("owner"))).toEqual({
        destinations: [],
        reviewPlaylistId: null,
      })
    } finally {
      close()
    }
  })
})
