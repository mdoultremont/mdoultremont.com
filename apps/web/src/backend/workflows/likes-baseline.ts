import { Context, Effect } from "effect"

/** A cutoff is captured before the first Spotify read. A like at the cutoff remains new. */
export interface BaselineRun {
  readonly id: string
  readonly ownerId: string
  readonly accountId: string
  readonly cutoff: string
  readonly status: "queued" | "running" | "completed" | "failed"
  readonly cursor: string | null
  readonly pages: number
  readonly scanned: number
  readonly recorded: number
  readonly recent: number
  readonly total: number | null
  readonly error: string | null
  readonly updatedAt: number
}

export interface BaselineTrack {
  readonly id: string
  readonly addedAt: string
}

export class BaselineError extends Error {
  readonly _tag = "BaselineError"
  constructor(
    readonly code: "storage" | "queue" | "spotify" | "invalid_page",
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = "BaselineError"
  }
}

export class BaselineStore extends Context.Service<
  BaselineStore,
  {
    readonly createOrGet: (input: {
      readonly id: string
      readonly ownerId: string
      readonly accountId: string
      readonly cutoff: string
      readonly now: number
    }) => Effect.Effect<BaselineRun, BaselineError>
    readonly latest: (
      ownerId: string,
      accountId: string
    ) => Effect.Effect<BaselineRun | null, BaselineError>
    readonly get: (
      runId: string
    ) => Effect.Effect<BaselineRun | null, BaselineError>
    /** Inserts historical IDs, advances the cursor, and writes the checkpoint atomically. */
    readonly commitPage: (input: {
      readonly run: BaselineRun
      readonly historicalIds: readonly string[]
      readonly scanned: number
      readonly recent: number
      readonly total: number
      readonly next: string | null
      readonly now: number
    }) => Effect.Effect<BaselineRun | null, BaselineError>
    readonly fail: (
      runId: string,
      message: string,
      now: number
    ) => Effect.Effect<void, BaselineError>
    readonly resume: (
      runId: string,
      now: number
    ) => Effect.Effect<BaselineRun | null, BaselineError>
  }
>()("portfolio/BaselineStore") {}

export class BaselineSpotify extends Context.Service<
  BaselineSpotify,
  {
    readonly savedTracksPage: (
      ownerId: string,
      cursor: string | null
    ) => Effect.Effect<
      {
        readonly items: readonly BaselineTrack[]
        readonly next: string | null
        readonly total: number
      },
      BaselineError
    >
  }
>()("portfolio/BaselineSpotify") {}

export class BaselineQueue extends Context.Service<
  BaselineQueue,
  {
    readonly send: (runId: string) => Effect.Effect<void, BaselineError>
  }
>()("portfolio/BaselineQueue") {}

export class BaselineClock extends Context.Service<
  BaselineClock,
  {
    readonly now: () => Effect.Effect<number>
    readonly id: () => Effect.Effect<string>
  }
>()("portfolio/BaselineClock") {}

export function startLikesBaseline(ownerId: string, accountId: string) {
  return Effect.gen(function* () {
    const store = yield* BaselineStore
    const queue = yield* BaselineQueue
    const clock = yield* BaselineClock
    const now = yield* clock.now()
    const run = yield* store.createOrGet({
      id: yield* clock.id(),
      ownerId,
      accountId,
      cutoff: new Date(Math.floor(now / 1_000) * 1_000).toISOString(),
      now,
    })
    if (run.status === "queued" || run.status === "running")
      yield* Effect.tapError(queue.send(run.id), () =>
        store.fail(
          run.id,
          "Background work could not be queued. Retry initialization.",
          now
        )
      )
    return run
  })
}

export function retryLikesBaseline(runId: string) {
  return Effect.gen(function* () {
    const store = yield* BaselineStore
    const queue = yield* BaselineQueue
    const clock = yield* BaselineClock
    const now = yield* clock.now()
    const run = yield* store.resume(runId, now)
    if (run && run.status !== "completed")
      yield* Effect.tapError(queue.send(run.id), () =>
        store.fail(
          run.id,
          "Background work could not be queued. Retry initialization.",
          now
        )
      )
    return run
  })
}

/** Exactly one provider page is handled per queue invocation. Redelivery reads durable state. */
export function processLikesBaselinePage(runId: string) {
  return Effect.gen(function* () {
    const store = yield* BaselineStore
    const spotify = yield* BaselineSpotify
    const queue = yield* BaselineQueue
    const clock = yield* BaselineClock
    const run = yield* store.get(runId)
    if (!run || run.status === "completed" || run.status === "failed")
      return run

    const page = yield* spotify.savedTracksPage(run.ownerId, run.cursor)
    if (
      !Number.isSafeInteger(page.total) ||
      page.total < 0 ||
      (page.next !== null && page.next === run.cursor)
    )
      return yield* Effect.fail(
        new BaselineError(
          "invalid_page",
          "Spotify returned an invalid Liked Songs page"
        )
      )

    const historicalIds = new Set<string>()
    let recent = 0
    for (const track of page.items) {
      const addedAt = Date.parse(track.addedAt)
      if (!track.id || !Number.isFinite(addedAt))
        return yield* Effect.fail(
          new BaselineError(
            "invalid_page",
            "Spotify returned an invalid saved track"
          )
        )
      if (addedAt < Date.parse(run.cutoff)) historicalIds.add(track.id)
      else recent += 1
    }
    const updated = yield* store.commitPage({
      run,
      historicalIds: [...historicalIds],
      scanned: page.items.length,
      recent,
      total: page.total,
      next: page.next,
      now: yield* clock.now(),
    })
    if (updated && updated.status !== "completed") yield* queue.send(updated.id)
    return updated
  })
}
