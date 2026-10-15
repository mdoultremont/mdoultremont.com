import { assert, describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { vi } from "vitest"
import { InvalidLikesPage } from "@/backend/features/music/ingestion"
import { MusicPipeline } from "@/backend/features/music/pipeline"
import {
  RateLimited,
  ReconnectNeeded,
  spotifyError,
} from "@/backend/modules/spotify"
import { handleMessage } from "."

function message(body: unknown, attempts = 1) {
  return {
    body,
    attempts,
    ack: vi.fn<() => void>(),
    retry: vi.fn<(options?: { delaySeconds?: number }) => void>(),
  } as unknown as Message<unknown> & {
    ack: ReturnType<typeof vi.fn>
    retry: ReturnType<typeof vi.fn>
  }
}

function withPipeline(handle: MusicPipeline["Service"]["handle"]) {
  const giveUp = vi.fn<MusicPipeline["Service"]["giveUp"]>(() => Effect.void)
  const layer = Layer.succeed(MusicPipeline, {
    handle,
    giveUp,
  } as unknown as MusicPipeline["Service"])
  return {
    giveUp,
    run: <A, E>(effect: Effect.Effect<A, E, MusicPipeline>) =>
      Effect.provide(effect, layer),
  }
}

const ingestionMessage = { kind: "music.ingestion", ingestionId: "ing-1" }

describe("queue consumer", () => {
  it.effect("acks a processed page", () => {
    const { run } = withPipeline(() => Effect.void)
    const received = message(ingestionMessage)
    return run(
      Effect.gen(function* () {
        yield* handleMessage(received)
        expect(received.ack).toHaveBeenCalledOnce()
      })
    )
  })

  it.effect("drops unknown messages", () => {
    const { run } = withPipeline(() => Effect.die("not called"))
    const received = message({ kind: "likes-baseline", runId: "old" })
    return run(
      Effect.gen(function* () {
        yield* handleMessage(received)
        expect(received.ack).toHaveBeenCalledOnce()
      })
    )
  })

  it.effect("retries a rate limit after Spotify's delay", () => {
    const { run, giveUp } = withPipeline(() =>
      Effect.fail(spotifyError(new RateLimited({ retryAfterSeconds: 42 })))
    )
    const received = message(ingestionMessage)
    return run(
      Effect.gen(function* () {
        yield* handleMessage(received)
        expect(received.retry).toHaveBeenCalledWith({ delaySeconds: 42 })
        expect(giveUp).not.toHaveBeenCalled()
      })
    )
  })

  it.effect("gives up when retrying cannot help", () => {
    const { run, giveUp } = withPipeline(() =>
      Effect.fail(spotifyError(new ReconnectNeeded()))
    )
    const received = message(ingestionMessage)
    return run(
      Effect.gen(function* () {
        yield* handleMessage(received)
        expect(giveUp).toHaveBeenCalledWith(
          ingestionMessage,
          spotifyError(new ReconnectNeeded())
        )
        expect(received.ack).toHaveBeenCalledOnce()
      })
    )
  })

  it.effect("gives up on an unusable Spotify page", () => {
    const { run, giveUp } = withPipeline(() =>
      Effect.fail(
        new InvalidLikesPage({ message: "Spotify returned a bad page" })
      )
    )
    const invalid = message(ingestionMessage)
    return run(
      Effect.gen(function* () {
        yield* handleMessage(invalid)
        assert.strictEqual(giveUp.mock.calls.length, 1)
        expect(invalid.retry).not.toHaveBeenCalled()
      })
    )
  })
})
