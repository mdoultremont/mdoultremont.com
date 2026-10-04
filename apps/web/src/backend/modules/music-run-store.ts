import { and, asc, desc, eq, ne, sql } from "drizzle-orm"
import { createDatabase } from "@/backend/primitives/db/client"
import {
  musicDestinations,
  musicRuns,
  musicRunTracks,
  musicSettings,
  musicDiscoveryCheckpoints,
  spotifyConnections,
  musicBaselineRuns,
  musicDecisions,
  musicDeliveries,
} from "@/backend/primitives/db/schema"
import type { MusicRun, RunTrack } from "@/backend/workflows/music-runs"
import type {
  SavedClassification,
  SyncMode,
  SyncReport,
} from "@/backend/workflows/playlist-sync"

export function createMusicRunStore(
  binding: D1Database,
  options: { writesEnabled?: boolean } = {}
) {
  const db = createDatabase(binding)
  const get = (id: string) =>
    db
      .select()
      .from(musicRuns)
      .where(eq(musicRuns.id, id))
      .get()
      .then((run) => run ?? null)
  return {
    get,
    async status(ownerId: string) {
      const settings = await db
        .select()
        .from(musicSettings)
        .where(eq(musicSettings.ownerId, ownerId))
        .get()
      const runs = await db
        .select()
        .from(musicRuns)
        .where(eq(musicRuns.ownerId, ownerId))
        .orderBy(desc(musicRuns.createdAt))
        .limit(10)
      return {
        automationEnabled: settings?.automationEnabled ?? false,
        runs,
        policy: "dry-run",
        evaluation:
          "Owner-labeled evaluation and useful acceptance threshold required before any playlist additions.",
      }
    },
    async setEnabled(ownerId: string, enabled: boolean) {
      await db
        .insert(musicSettings)
        .values({ ownerId, automationEnabled: enabled, updatedAt: Date.now() })
        .onConflictDoUpdate({
          target: musicSettings.ownerId,
          set: { automationEnabled: enabled, updatedAt: Date.now() },
        })
    },
    async start(ownerId: string, mode: SyncMode, scheduled = false) {
      const connection = await db
        .select()
        .from(spotifyConnections)
        .where(eq(spotifyConnections.ownerId, ownerId))
        .get()
      const settings = await db
        .select()
        .from(musicSettings)
        .where(eq(musicSettings.ownerId, ownerId))
        .get()
      if (scheduled && !settings?.automationEnabled) return null
      if (!connection || connection.needsReconnect)
        throw new Error("Connect Spotify before starting a run")
      if (!settings?.reviewPlaylistId)
        throw new Error("Configure a review playlist before starting a run")
      const checkpoint = await db
        .select()
        .from(musicDiscoveryCheckpoints)
        .where(eq(musicDiscoveryCheckpoints.ownerId, ownerId))
        .get()
      const baseline = checkpoint
        ? await db
            .select()
            .from(musicBaselineRuns)
            .where(eq(musicBaselineRuns.id, checkpoint.baselineRunId))
            .get()
        : null
      if (!checkpoint || baseline?.status !== "completed")
        throw new Error("Wait for initial baseline completion")
      const now = Date.now()
      const id = crypto.randomUUID()
      // Unique partial index is the owner-level coordination primitive, including concurrent manual/cron starts.
      await db
        .insert(musicRuns)
        .values({
          id,
          ownerId,
          accountId: connection.accountId,
          mode,
          status: "queued",
          phase: "discover",
          cutoff: new Date(Math.floor(now / 1000) * 1000).toISOString(),
          checkpoint: checkpoint.cutoff,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
      const created = await get(id)
      if (!created)
        throw new Error("A run is already active; wait for it to finish")
      // Preserve unfinished work independently of the discovery checkpoint.
      await binding
        .prepare(`INSERT OR IGNORE INTO music_run_tracks (run_id, track_id, isrc, added_at, completed)
        SELECT ?, t.track_id, t.isrc, t.added_at, 0 FROM music_run_tracks t JOIN music_runs r ON r.id = t.run_id
        WHERE r.owner_id = ? AND r.account_id = ? AND r.status = 'failed' AND t.completed = 0
          AND NOT EXISTS (
            SELECT 1 FROM music_run_tracks recovered JOIN music_runs recovery ON recovery.id = recovered.run_id
            WHERE recovery.owner_id = r.owner_id AND recovery.account_id = r.account_id
              AND recovered.track_id = t.track_id AND recovered.completed = 1
              AND recovery.created_at >= r.created_at
          )`)
        .bind(id, ownerId, connection.accountId)
        .run()
      return created
    },
    async acquire(id: string, token: string) {
      const now = Date.now()
      const result = await db
        .update(musicRuns)
        .set({
          leaseToken: token,
          leaseUntil: now + 20 * 60_000,
          status: "running",
          updatedAt: now,
        })
        .where(
          and(
            eq(musicRuns.id, id),
            sql`${musicRuns.status} IN ('queued','running')`,
            sql`${musicRuns.leaseUntil} < ${now}`
          )
        )
        .run()
      return result.meta.changes > 0
    },
    async release(id: string, token: string) {
      await db
        .update(musicRuns)
        .set({ leaseToken: null, leaseUntil: 0 })
        .where(and(eq(musicRuns.id, id), eq(musicRuns.leaseToken, token)))
    },
    async discover(
      run: MusicRun,
      tracks: readonly RunTrack[],
      next: string | null
    ) {
      const checkpoint = await db
        .select()
        .from(musicDiscoveryCheckpoints)
        .where(eq(musicDiscoveryCheckpoints.ownerId, run.ownerId))
        .get()
      const baseline = checkpoint
        ? await db
            .select()
            .from(musicBaselineRuns)
            .where(eq(musicBaselineRuns.id, checkpoint.baselineRunId))
            .get()
        : null
      const eligible = tracks.filter(
        (track) =>
          run.mode !== "catchup" ||
          (baseline && Date.parse(track.addedAt) >= Date.parse(baseline.cutoff))
      )
      const operations = eligible.map((track) =>
        db
          .insert(musicRunTracks)
          .values({
            runId: run.id,
            trackId: track.id,
            isrc: track.isrc,
            addedAt: track.addedAt,
          })
          .onConflictDoNothing()
      )
      const updateRun = db
        .update(musicRuns)
        .set({
          cursor: next,
          phase: next ? "discover" : "sync",
          scanned: sql`${musicRuns.scanned} + ${tracks.length}`,
          updatedAt: Date.now(),
        })
        .where(eq(musicRuns.id, run.id))
      await db.batch([
        updateRun,
        ...operations,
        ...(!next && options.writesEnabled === true
          ? [
              db
                .update(musicDiscoveryCheckpoints)
                .set({ cutoff: run.cutoff, updatedAt: Date.now() })
                .where(
                  and(
                    eq(musicDiscoveryCheckpoints.ownerId, run.ownerId),
                    eq(musicDiscoveryCheckpoints.accountId, run.accountId)
                  )
                ),
            ]
          : []),
      ])
    },
    async pending(run: MusicRun, limit: number) {
      const tracks = await db
        .select()
        .from(musicRunTracks)
        .where(
          and(
            eq(musicRunTracks.runId, run.id),
            eq(musicRunTracks.completed, false),
            eq(musicRunTracks.attempted, false)
          )
        )
        .orderBy(asc(musicRunTracks.retryAttempts), asc(musicRunTracks.trackId))
        .limit(limit)
      return tracks.map((track) => ({
        id: track.trackId,
        isrc: track.isrc,
        addedAt: track.addedAt,
      }))
    },
    async defer(run: MusicRun, track: RunTrack) {
      const rows = await db
        .update(musicRunTracks)
        .set({ retryAttempts: sql`${musicRunTracks.retryAttempts} + 1` })
        .where(
          and(
            eq(musicRunTracks.runId, run.id),
            eq(musicRunTracks.trackId, track.id)
          )
        )
        .returning({ attempts: musicRunTracks.retryAttempts })
      if (!rows[0]) throw new Error("Retry track is missing")
      return rows[0].attempts
    },
    async progress(run: MusicRun, track: RunTrack, report: SyncReport) {
      await db.batch([
        db
          .update(musicRunTracks)
          .set({ completed: report.failed === 0, attempted: true })
          .where(
            and(
              eq(musicRunTracks.runId, run.id),
              eq(musicRunTracks.trackId, track.id)
            )
          ),
        db
          .update(musicRuns)
          .set({
            processed: sql`${musicRuns.processed} + 1`,
            delivered: sql`${musicRuns.delivered} + ${report.delivered}`,
            updatedAt: Date.now(),
          })
          .where(eq(musicRuns.id, run.id)),
        ...(report.failed === 0
          ? [
              db
                .update(musicRunTracks)
                .set({ completed: true, attempted: true })
                .where(
                  and(
                    eq(musicRunTracks.trackId, track.id),
                    eq(musicRunTracks.completed, false),
                    sql`${musicRunTracks.runId} IN (SELECT id FROM music_runs WHERE owner_id = ${run.ownerId} AND account_id = ${run.accountId} AND status = 'failed')`
                  )
                ),
            ]
          : []),
      ])
    },
    async complete(run: MusicRun) {
      const unfinished = await db
        .select()
        .from(musicRunTracks)
        .where(
          and(
            eq(musicRunTracks.runId, run.id),
            eq(musicRunTracks.completed, false)
          )
        )
        .limit(1)
      await db
        .update(musicRuns)
        .set({
          status: unfinished.length ? "failed" : "completed",
          error: unfinished.length
            ? "Some tracks failed. Start another run to retry unfinished work; completed tracks are retained."
            : null,
          updatedAt: Date.now(),
        })
        .where(eq(musicRuns.id, run.id))
    },
    async fail(id: string, error: string) {
      await db
        .update(musicRuns)
        .set({
          status: "failed",
          error,
          leaseToken: null,
          leaseUntil: 0,
          updatedAt: Date.now(),
        })
        .where(and(eq(musicRuns.id, id), ne(musicRuns.status, "completed")))
    },
    async recover(ownerId: string) {
      return db
        .select()
        .from(musicRuns)
        .where(
          and(
            eq(musicRuns.ownerId, ownerId),
            sql`${musicRuns.status} IN ('queued','running')`,
            sql`${musicRuns.leaseUntil} < ${Date.now()}`
          )
        )
    },
    async decision(
      ownerId: string,
      trackId: string
    ): Promise<SavedClassification | null> {
      const row = await db
        .select()
        .from(musicDecisions)
        .where(
          and(
            eq(musicDecisions.ownerId, ownerId),
            eq(musicDecisions.trackId, trackId)
          )
        )
        .get()
      return row ? JSON.parse(row.decision) : null
    },
    async saveDecision(
      ownerId: string,
      trackId: string,
      decision: SavedClassification
    ) {
      await db
        .insert(musicDecisions)
        .values({ ownerId, trackId, decision: JSON.stringify(decision) })
        .onConflictDoUpdate({
          target: [musicDecisions.ownerId, musicDecisions.trackId],
          set: { decision: JSON.stringify(decision) },
        })
    },
    async delivered(ownerId: string, trackId: string, playlistId: string) {
      return Boolean(
        await db
          .select()
          .from(musicDeliveries)
          .where(
            and(
              eq(musicDeliveries.ownerId, ownerId),
              eq(musicDeliveries.trackId, trackId),
              eq(musicDeliveries.playlistId, playlistId)
            )
          )
          .get()
      )
    },
    async markDelivered(ownerId: string, trackId: string, playlistId: string) {
      await db
        .insert(musicDeliveries)
        .values({ ownerId, trackId, playlistId })
        .onConflictDoNothing()
    },
    async configuration(ownerId: string) {
      const settings = await db
        .select()
        .from(musicSettings)
        .where(eq(musicSettings.ownerId, ownerId))
        .get()
      const destinations = await db
        .select()
        .from(musicDestinations)
        .where(eq(musicDestinations.ownerId, ownerId))
      return {
        reviewPlaylistId: settings?.reviewPlaylistId ?? "",
        destinations,
      }
    },
  }
}
