import { assert, describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { vi } from "vitest"
import {
  InvalidLikesPage,
  MusicIngestion,
} from "@/backend/features/music/ingestion"
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

function withIngestion(processNext: MusicIngestion["Service"]["processNext"]) {
  const fail = vi.fn<MusicIngestion["Service"]["fail"]>(() => Effect.void)
  const layer = Layer.succeed(MusicIngestion, {
    processNext,
    fail,
  } as unknown as MusicIngestion["Service"])
  return {
    fail,
    run: <A, E>(effect: Effect.Effect<A, E, MusicIngestion>) =>
      Effect.provide(effect, layer),
  }
}

const ingestionMessage = { kind: "music.ingestion", ingestionId: "ing-1" }

describe("queue consumer", () => {
  it.effect("acks a processed page", () => {
    const { run } = withIngestion(() => Effect.void)
    const received = message(ingestionMessage)
    return run(
      Effect.gen(function* () {
        yield* handleMessage(received)
        expect(received.ack).toHaveBeenCalledOnce()
      })
    )
  })

  it.effect("drops unknown messages", () => {
    const { run } = withIngestion(() => Effect.die("not called"))
    const received = message({ kind: "likes-baseline", runId: "old" })
    return run(
      Effect.gen(function* () {
        yield* handleMessage(received)
        expect(received.ack).toHaveBeenCalledOnce()
      })
    )
  })

  it.effect("retries a rate limit after Spotify's delay", () => {
    const { run, fail } = withIngestion(() =>
      Effect.fail(spotifyError(new RateLimited({ retryAfterSeconds: 42 })))
    )
    const received = message(ingestionMessage)
    return run(
      Effect.gen(function* () {
        yield* handleMessage(received)
        expect(received.retry).toHaveBeenCalledWith({ delaySeconds: 42 })
        expect(fail).not.toHaveBeenCalled()
      })
    )
  })

  it.effect("fails the ingestion when retrying cannot help", () => {
    const { run, fail } = withIngestion(() =>
      Effect.fail(spotifyError(new ReconnectNeeded()))
    )
    const received = message(ingestionMessage)
    return run(
      Effect.gen(function* () {
        yield* handleMessage(received)
        expect(fail).toHaveBeenCalledWith(
          "ing-1",
          "Spotify needs to be reconnected"
        )
        expect(received.ack).toHaveBeenCalledOnce()
      })
    )
  })

  it.effect("fails the ingestion when Spotify returns an unusable page", () => {
    const { run, fail } = withIngestion(() =>
      Effect.fail(
        new InvalidLikesPage({ message: "Spotify returned a bad page" })
      )
    )
    const invalid = message(ingestionMessage)
    return run(
      Effect.gen(function* () {
        yield* handleMessage(invalid)
        assert.strictEqual(fail.mock.calls.length, 1)
        expect(invalid.retry).not.toHaveBeenCalled()
      })
    )
  })
})
