import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { describe, expect, test } from "vitest"
import { createMusicRunStore } from "./music-run-store"

function setup(writesEnabled = true) {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec("PRAGMA foreign_keys = ON")
  const migrations = new URL("../../../migrations/", import.meta.url)
  for (const file of readdirSync(migrations)
    .filter((name) => name.endsWith(".sql"))
    // oxlint-disable-next-line unicorn/no-array-sort -- this freshly read migration list has no other consumers
    .sort())
    sqlite.exec(readFileSync(new URL(file, migrations), "utf8"))
  sqlite.exec(`INSERT INTO app_owners (github_id, login, updated_at) VALUES ('owner', 'owner', 1);
    INSERT INTO spotify_connections (owner_id, account_id, spotify_user_id, encrypted_refresh_token, scopes, connected_at) VALUES ('owner', 'account', 'spotify', 'encrypted', 'scopes', 1);
    INSERT INTO music_settings (owner_id, review_playlist_id, updated_at) VALUES ('owner', 'review', 1);
    INSERT INTO music_baseline_runs (id, owner_id, account_id, cutoff, status, created_at, updated_at) VALUES ('baseline', 'owner', 'account', '2026-10-01T00:00:00Z', 'completed', 1, 1);
    INSERT INTO music_discovery_checkpoints VALUES ('owner', 'account', '2026-10-02T00:00:00Z', 'baseline', 1);`)
  function prepare(query: string, values: unknown[] = []) {
    const statement = () => sqlite.prepare(query)
    const all = async () => {
      const stmt = statement()
      const results = stmt.all(...(values as Parameters<typeof stmt.all>))
      const changes = sqlite.prepare("SELECT changes() AS count").get()!.count
      return { success: true, results, meta: { changes: Number(changes) } }
    }
    return {
      bind: (...params: unknown[]) => prepare(query, params),
      all,
      run: all,
      async first() {
        const stmt = statement()
        return stmt.get(...(values as Parameters<typeof stmt.get>)) ?? null
      },
      async raw() {
        const stmt = statement()
        stmt.setReturnArrays(true)
        return stmt.all(...(values as Parameters<typeof stmt.all>))
      },
    }
  }
  const binding = {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      sqlite.exec("BEGIN")
      try {
        const result = []
        for (const statement of statements) result.push(await statement.all())
        sqlite.exec("COMMIT")
        return result
      } catch (error) {
        sqlite.exec("ROLLBACK")
        throw error
      }
    },
  } as unknown as D1Database
  return {
    sqlite,
    store: createMusicRunStore(binding, { writesEnabled }),
    close: () => sqlite.close(),
  }
}

describe("durable music run persistence", () => {
  test("paused scheduling does not start work, manual runs still work, and overlapping starts are rejected", async () => {
    const state = setup()
    try {
      expect(await state.store.start("owner", "catchup", true)).toBeNull()
      const run = await state.store.start("owner", "catchup")
      expect(run?.status).toBe("queued")
      await expect(state.store.start("owner", "full")).rejects.toThrow(
        "already active"
      )
      await state.store.setEnabled("owner", true)
      expect((await state.store.status("owner")).automationEnabled).toBe(true)
      expect(await state.store.acquire(run!.id, "one")).toBe(true)
      expect(await state.store.acquire(run!.id, "two")).toBe(false)
      await state.store.release(run!.id, "two")
      expect(await state.store.acquire(run!.id, "three")).toBe(false)
      await state.store.release(run!.id, "one")
      await state.store.fail(run!.id, "provider down")
      expect((await state.store.start("owner", "catchup", true))?.status).toBe(
        "queued"
      )
    } finally {
      state.close()
    }
  })
  test("discovery advances checkpoint only after final durable page and excludes baseline history", async () => {
    const state = setup()
    try {
      const run = (await state.store.start("owner", "catchup"))!
      await state.store.discover(
        run,
        [
          { id: "historical", isrc: null, addedAt: "2026-09-30T23:59:59Z" },
          { id: "new", isrc: null, addedAt: run.checkpoint },
        ],
        "next"
      )
      expect(
        state.sqlite
          .prepare("SELECT cutoff FROM music_discovery_checkpoints")
          .get()!.cutoff
      ).toBe(run.checkpoint)
      expect(
        (await state.store.pending(run, 5)).map((track) => track.id)
      ).toEqual(["new"])
      await state.store.discover((await state.store.get(run.id))!, [], null)
      expect(
        state.sqlite
          .prepare("SELECT cutoff FROM music_discovery_checkpoints")
          .get()!.cutoff
      ).toBe(run.cutoff)
      expect((await state.store.get(run.id))!.phase).toBe("sync")
    } finally {
      state.close()
    }
  })
  test("failed tracks survive a later checkpoint and run while completed tracks do not retry", async () => {
    const state = setup()
    try {
      const run = (await state.store.start("owner", "catchup"))!
      const good = { id: "good", isrc: null, addedAt: run.checkpoint }
      const bad = { id: "bad", isrc: "USABC2400001", addedAt: run.checkpoint }
      await state.store.discover(run, [good, bad], null)
      await state.store.progress(run, good, {
        scanned: 1,
        delivered: 1,
        skippedUnliked: 0,
        failed: 0,
      })
      await state.store.progress(run, bad, {
        scanned: 1,
        delivered: 0,
        skippedUnliked: 0,
        failed: 1,
      })
      expect(await state.store.pending(run, 5)).toEqual([])
      await state.store.complete(run)
      expect((await state.store.get(run.id))!.status).toBe("failed")
      const retry = (await state.store.start("owner", "catchup"))!
      expect(await state.store.pending(retry, 5)).toEqual([bad])
    } finally {
      state.close()
    }
  })
  test("dry-run discovery preserves the live checkpoint and disconnect removes credentials and music progress", async () => {
    const state = setup(false)
    try {
      const run = (await state.store.start("owner", "full"))!
      await state.store.discover(
        run,
        [{ id: "track", isrc: null, addedAt: run.cutoff }],
        null
      )
      expect(
        state.sqlite
          .prepare("SELECT cutoff FROM music_discovery_checkpoints")
          .get()!.cutoff
      ).toBe(run.checkpoint)
      state.sqlite.exec(
        "DELETE FROM spotify_connections WHERE owner_id = 'owner'"
      )
      expect(await state.store.get(run.id)).toBeNull()
      expect(
        state.sqlite
          .prepare("SELECT count(*) AS count FROM music_run_tracks")
          .get()!.count
      ).toBe(0)
    } finally {
      state.close()
    }
  })
})

test("successful recovery retires failed historical work and later catch-up does not resurrect it", async () => {
  const state = setup()
  try {
    const track = { id: "T", isrc: null, addedAt: "2026-10-02T00:00:00Z" }
    const failed = (await state.store.start("owner", "catchup"))!
    await state.store.discover(failed, [track], null)
    await state.store.progress(failed, track, {
      scanned: 1,
      delivered: 0,
      skippedUnliked: 0,
      failed: 1,
    })
    await state.store.complete(failed)
    const recovery = (await state.store.start("owner", "catchup"))!
    expect(await state.store.pending(recovery, 5)).toEqual([track])
    await state.store.progress(recovery, track, {
      scanned: 1,
      delivered: 1,
      skippedUnliked: 0,
      failed: 0,
    })
    await state.store.complete(recovery)
    expect(
      state.sqlite
        .prepare("SELECT completed FROM music_run_tracks WHERE run_id = ?")
        .get(failed.id)!.completed
    ).toBe(1)
    // Also handle pre-fix historical rows that have not been retired in place.
    state.sqlite
      .prepare(
        "UPDATE music_run_tracks SET completed = 0, attempted = 0 WHERE run_id = ?"
      )
      .run(failed.id)
    const next = (await state.store.start("owner", "catchup"))!
    expect(await state.store.pending(next, 5)).toEqual([])
    // Explicit full discovery may still restore T; historical recovery must not suppress fresh source scans.
    await state.store.discover(next, [track], null)
    expect(await state.store.pending(next, 5)).toEqual([track])
  } finally {
    state.close()
  }
})

test("durable retry deferral leaves failed tracks pending behind untried tracks", async () => {
  const state = setup()
  try {
    const run = (await state.store.start("owner", "full"))!
    const first = { id: "A", isrc: null, addedAt: run.cutoff }
    const next = { id: "B", isrc: null, addedAt: run.cutoff }
    await state.store.discover(run, [first, next], null)
    expect(await state.store.defer(run, first)).toBe(1)
    expect(await state.store.pending(run, 5)).toEqual([next, first])
    expect((await state.store.get(run.id))!.processed).toBe(0)
    expect(await state.store.defer(run, first)).toBe(2)
  } finally {
    state.close()
  }
})
