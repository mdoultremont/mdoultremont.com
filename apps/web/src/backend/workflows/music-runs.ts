import { Effect } from "effect"
import type { SyncMode, SyncReport } from "./playlist-sync"

/** Infrastructure adapters identify transient provider errors without coupling workflows to providers. */
export class RunTrackError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterSeconds?: number,
    options?: ErrorOptions
  ) {
    super(message, options)
  }
}

export interface MusicRun {
  id: string
  ownerId: string
  accountId: string
  mode: SyncMode
  status: "queued" | "running" | "completed" | "failed"
  phase: "discover" | "sync"
  cursor: string | null
  cutoff: string
  checkpoint: string
  scanned: number
  processed: number
  delivered: number
  error: string | null
}
export interface RunTrack {
  id: string
  isrc: string | null
  addedAt: string
}
export interface MusicRunPorts {
  get(id: string): Promise<MusicRun | null>
  acquire(id: string, token: string): Promise<boolean>
  release(id: string, token: string): Promise<void>
  page(
    ownerId: string,
    cursor: string | null
  ): Promise<{ items: readonly RunTrack[]; next: string | null }>
  discover(
    run: MusicRun,
    tracks: readonly RunTrack[],
    next: string | null
  ): Promise<void>
  pending(run: MusicRun, limit: number): Promise<readonly RunTrack[]>
  sync(run: MusicRun, track: RunTrack): Promise<SyncReport>
  defer(run: MusicRun, track: RunTrack): Promise<number>
  progress(run: MusicRun, track: RunTrack, report: SyncReport): Promise<void>
  complete(run: MusicRun): Promise<void>
  enqueue(id: string): Promise<void>
}

/** One discovery page or five tracks per delivery. Queue redelivery resumes durable progress. */
export function processMusicRun(id: string, ports: MusicRunPorts) {
  return Effect.tryPromise({
    try: async () => {
      const token = crypto.randomUUID()
      if (!(await ports.acquire(id, token))) return
      let continueRun = false
      try {
        const run = await ports.get(id)
        if (!run || run.status === "completed" || run.status === "failed")
          return
        if (run.phase === "discover") {
          const page = await ports.page(run.ownerId, run.cursor)
          if (page.next !== null && page.next === run.cursor)
            throw new RunTrackError("Invalid discovery cursor", false)
          const tracks = page.items.filter((track) => {
            const time = Date.parse(track.addedAt)
            if (!Number.isFinite(time))
              throw new RunTrackError("Invalid like timestamp", false)
            return (
              run.mode !== "catchup" ||
              time >= Date.parse(run.checkpoint) - 60_000
            )
          })
          await ports.discover(
            run,
            [...new Map(tracks.map((track) => [track.id, track])).values()],
            page.next
          )
          continueRun = true
        } else {
          const pending = await ports.pending(run, 5)
          if (!pending.length) {
            await ports.complete(run)
            return
          }
          let retry: RunTrackError | null = null
          for (const track of pending) {
            let report: SyncReport
            try {
              report = await ports.sync(run, track)
            } catch (cause) {
              report = {
                scanned: 1,
                delivered: 0,
                skippedUnliked: 0,
                failed: 1,
                errors: [cause],
              }
            }
            const transient = report.errors?.find(
              (error): error is RunTrackError =>
                error instanceof RunTrackError && error.retryable
            )
            if (transient && (await ports.defer(run, track)) < 10) {
              // Rotate pending work durably; later tracks can progress before queue backoff.
              if (
                !retry ||
                (transient.retryAfterSeconds ?? 0) >
                  (retry.retryAfterSeconds ?? 0)
              )
                retry = transient
            } else await ports.progress(run, track, report)
          }
          if (retry) throw retry
          continueRun = true
        }
      } finally {
        await ports.release(id, token)
      }
      if (continueRun) await ports.enqueue(id)
    },
    catch: (cause) =>
      cause instanceof Error ? cause : new Error("Music run failed", { cause }),
  })
}
