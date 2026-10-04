import { Effect, Layer } from "effect"
import {
  BaselineError,
  BaselineStore,
  type BaselineRun,
} from "@/backend/workflows/likes-baseline"

type RunRow = Omit<BaselineRun, "status"> & { status: BaselineRun["status"] }

function storage<A>(
  operation: () => Promise<A>
): Effect.Effect<A, BaselineError> {
  return Effect.tryPromise({
    try: operation,
    catch: (cause) =>
      new BaselineError("storage", "Baseline state could not be saved", {
        cause,
      }),
  })
}

export function likesBaselineStoreLayer(binding: D1Database) {
  const get = (id: string) =>
    storage(async () => {
      const row = await binding
        .prepare("SELECT * FROM music_baseline_runs WHERE id = ?")
        .bind(id)
        .first<Record<string, unknown>>()
      return row ? readRun(row) : null
    })

  return Layer.succeed(BaselineStore, {
    createOrGet: (input) =>
      storage(async () => {
        await binding
          .prepare(`INSERT INTO music_baseline_runs
        (id, owner_id, account_id, cutoff, status, cursor, pages, scanned, recorded, recent, total, error, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'queued', NULL, 0, 0, 0, 0, NULL, NULL, ?, ?)
        ON CONFLICT(owner_id, account_id) DO NOTHING`)
          .bind(
            input.id,
            input.ownerId,
            input.accountId,
            input.cutoff,
            input.now,
            input.now
          )
          .run()
        const row = await binding
          .prepare(
            "SELECT * FROM music_baseline_runs WHERE owner_id = ? AND account_id = ?"
          )
          .bind(input.ownerId, input.accountId)
          .first<Record<string, unknown>>()
        if (!row) throw new Error("Baseline run was not created")
        return readRun(row)
      }),
    latest: (ownerId, accountId) =>
      storage(async () => {
        const row = await binding
          .prepare(
            "SELECT * FROM music_baseline_runs WHERE owner_id = ? AND account_id = ?"
          )
          .bind(ownerId, accountId)
          .first<Record<string, unknown>>()
        return row ? readRun(row) : null
      }),
    get,
    commitPage: (input) =>
      storage(async () => {
        const { run, historicalIds, scanned, recent, total, next, now } = input
        const expected = [run.id, run.pages, run.cursor]
        const statements = historicalIds.map((id) =>
          binding
            .prepare(`INSERT OR IGNORE INTO music_baseline_tracks (run_id, spotify_track_id)
        SELECT ?, ? WHERE EXISTS (
          SELECT 1 FROM music_baseline_runs
          WHERE id = ? AND pages = ? AND cursor IS ? AND status IN ('queued', 'running')
        )`)
            .bind(run.id, id, ...expected)
        )
        statements.push(
          binding
            .prepare(`UPDATE music_baseline_runs SET
        status = ?, cursor = ?, pages = pages + 1, scanned = scanned + ?,
        recorded = (SELECT COUNT(*) FROM music_baseline_tracks WHERE run_id = ?),
        recent = recent + ?, total = ?, error = NULL, updated_at = ?
        WHERE id = ? AND pages = ? AND cursor IS ? AND status IN ('queued', 'running')`)
            .bind(
              next === null ? "completed" : "running",
              next,
              scanned,
              run.id,
              recent,
              total,
              now,
              ...expected
            )
        )
        if (next === null)
          statements.push(
            binding
              .prepare(`INSERT INTO music_discovery_checkpoints
        (owner_id, account_id, cutoff, baseline_run_id, updated_at)
        SELECT owner_id, account_id, cutoff, id, ? FROM music_baseline_runs
        WHERE id = ? AND pages = ? AND status = 'completed'
        ON CONFLICT(owner_id) DO UPDATE SET
          account_id = excluded.account_id, cutoff = excluded.cutoff,
          baseline_run_id = excluded.baseline_run_id, updated_at = excluded.updated_at`)
              .bind(now, run.id, run.pages + 1)
          )
        const results = await binding.batch(statements)
        const update = results[historicalIds.length]
        if (!update?.meta.changes) return null
        const row = await binding
          .prepare("SELECT * FROM music_baseline_runs WHERE id = ?")
          .bind(run.id)
          .first<Record<string, unknown>>()
        if (!row) throw new Error("Baseline run disappeared after page commit")
        return readRun(row)
      }),
    fail: (runId, message, now) =>
      storage(async () => {
        await binding
          .prepare(`UPDATE music_baseline_runs SET status = 'failed', error = ?, updated_at = ?
        WHERE id = ? AND status != 'completed'`)
          .bind(message, now, runId)
          .run()
      }),
    resume: (runId, now) =>
      storage(async () => {
        await binding
          .prepare(`UPDATE music_baseline_runs SET status = 'queued', error = NULL, updated_at = ?
        WHERE id = ? AND status = 'failed'`)
          .bind(now, runId)
          .run()
        const row = await binding
          .prepare("SELECT * FROM music_baseline_runs WHERE id = ?")
          .bind(runId)
          .first<Record<string, unknown>>()
        return row ? readRun(row) : null
      }),
  })
}

function readRun(row: Record<string, unknown>): RunRow {
  if (
    row.status !== "queued" &&
    row.status !== "running" &&
    row.status !== "completed" &&
    row.status !== "failed"
  )
    throw new Error("Invalid baseline status")
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    accountId: String(row.account_id),
    cutoff: String(row.cutoff),
    status: row.status,
    cursor: typeof row.cursor === "string" ? row.cursor : null,
    pages: Number(row.pages),
    scanned: Number(row.scanned),
    recorded: Number(row.recorded),
    recent: Number(row.recent),
    total: row.total === null ? null : Number(row.total),
    error: typeof row.error === "string" ? row.error : null,
    updatedAt: Number(row.updated_at),
  }
}
