import { Context, Data, Effect, Layer } from "effect"

export class JobQueueError extends Data.TaggedError("JobQueueError")<{
  readonly cause: unknown
}> {
  override get message() {
    return "Background work could not be queued"
  }
}

/** Sends background work to the Worker's queue. Callers own the message shape. */
export class JobQueue extends Context.Service<
  JobQueue,
  {
    readonly send: (
      message: unknown,
      options?: { readonly delaySeconds?: number }
    ) => Effect.Effect<void, JobQueueError>
  }
>()("backend/primitives/JobQueue") {
  static readonly layer = (binding: Queue) =>
    Layer.succeed(
      JobQueue,
      JobQueue.of({
        send: (message, options) =>
          Effect.tryPromise({
            try: () => binding.send(message, options),
            catch: (cause) => new JobQueueError({ cause }),
          }),
      })
    )
}
