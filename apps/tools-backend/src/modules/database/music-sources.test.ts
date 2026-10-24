import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { expect, test } from "vitest"

test("the source migration seeds Liked Songs, drops the liked-only table, and scopes ingestions to a source", () => {
  const sqlite = new DatabaseSync(":memory:")
  try {
    sqlite.exec("PRAGMA foreign_keys = ON")
    const directory = new URL("../../../migrations/", import.meta.url)
    const files = readdirSync(directory)
      .filter((name) => name.endsWith(".sql"))
      // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 lacks toSorted; the filtered array is not shared
      .sort()
    const migration = files.find((name) => name.startsWith("0005_"))!
    for (const file of files.filter((name) => name < migration))
      sqlite.exec(readFileSync(new URL(file, directory), "utf8"))
    sqlite.exec(`
      INSERT INTO auth_users (id, name, email, email_verified, created_at, updated_at)
      VALUES ('owner', 'Owner', 'owner@example.com', 1, 1, 1), ('empty', 'Empty', 'empty@example.com', 1, 1, 1);
      INSERT INTO spotify_connections (owner_id, account_id, encrypted_refresh_token, scopes, connected_at, needs_reconnect, spotify_user_id)
      VALUES ('owner', 'account', 'encrypted', 'scopes', 42, 0, 'spotify'), ('empty', 'empty', 'encrypted', 'scopes', 43, 0, 'empty');
      INSERT INTO music_ingestions (id, owner_id, kind, status, unliked, started_at, updated_at)
      VALUES ('active', 'owner', 'full', 'running', 3, 10, 20);
    `)
    sqlite.exec(readFileSync(new URL(migration, directory), "utf8"))
    expect(
      sqlite
        .prepare(
          "SELECT owner_id, source_id, enabled FROM music_sources ORDER BY owner_id"
        )
        .all()
    ).toEqual([
      { owner_id: "empty", source_id: "liked", enabled: 1 },
      { owner_id: "owner", source_id: "liked", enabled: 1 },
    ])
    expect(
      sqlite
        .prepare("SELECT source_id, snapshot_id, removed FROM music_ingestions")
        .get()
    ).toEqual({ source_id: "liked", snapshot_id: null, removed: 3 })
    expect(
      sqlite
        .prepare(
          "SELECT count(*) AS count FROM sqlite_master WHERE name = 'music_liked_tracks'"
        )
        .get()?.count
    ).toBe(0)
    sqlite.exec(`INSERT INTO music_ingestions (id, owner_id, source_id, kind, status, started_at, updated_at)
      VALUES ('playlist', 'owner', 'shazam', 'full', 'queued', 10, 20)`)
    expect(() =>
      sqlite.exec(`INSERT INTO music_ingestions (id, owner_id, kind, status, started_at, updated_at)
      VALUES ('duplicate', 'owner', 'full', 'queued', 10, 20)`)
    ).toThrow("UNIQUE constraint failed")
    sqlite.exec("DELETE FROM spotify_connections WHERE owner_id = 'owner'")
    for (const table of [
      "music_tracks",
      "music_source_tracks",
      "music_ingestions",
    ])
      expect(
        sqlite.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count
      ).toBe(0)
    expect(
      sqlite.prepare("SELECT count(*) AS count FROM music_sources").get()?.count
    ).toBe(1)
  } finally {
    sqlite.close()
  }
})
