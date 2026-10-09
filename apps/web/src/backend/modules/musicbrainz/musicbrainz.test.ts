import { assert, describe, expect, it } from "@effect/vitest"
import { type Duration, Effect, Fiber } from "effect"
import { FetchHttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { vi } from "vitest"
import { MusicBrainz } from "."

const mbid = "f5d53f70-3f26-4b45-b0d7-c31fe51dfc22"
const isrc = "USABC2400001"

const json = (value: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(value, { status, headers })

function setup(spacing: Duration.Input = "0 millis") {
  const fetcher = vi.fn<typeof fetch>()
  return {
    fetcher,
    run: <A, E>(body: Effect.Effect<A, E, MusicBrainz>) =>
      body.pipe(
        Effect.provide(MusicBrainz.layerWith({ minimumSpacing: spacing })),
        Effect.provideService(FetchHttpClient.Fetch, fetcher)
      ),
  }
}

describe("MusicBrainz", () => {
  it.effect("reads core recording fields and joins artist credits", () => {
    const t = setup()
    t.fetcher.mockResolvedValue(
      json({
        recordings: [
          {
            id: mbid,
            title: "The Boxer",
            length: 308000,
            "artist-credit": [
              { name: "Simon", joinphrase: " & " },
              { name: "Garfunkel" },
            ],
            tags: [{ name: "not CC0, ignored" }],
          },
        ],
      })
    )
    return t.run(
      Effect.gen(function* () {
        const musicBrainz = yield* MusicBrainz
        assert.deepStrictEqual(yield* musicBrainz.recordingsByIsrc(isrc), [
          {
            id: mbid,
            title: "The Boxer",
            artistCredit: "Simon & Garfunkel",
            durationMs: 308000,
          },
        ])
        const url = new URL(String(t.fetcher.mock.calls[0]![0]))
        assert.strictEqual(url.pathname, `/ws/2/isrc/${isrc}`)
        assert.strictEqual(url.searchParams.get("inc"), "artist-credits")
        expect(
          new Headers(t.fetcher.mock.calls[0]![1]?.headers).get("user-agent")
        ).toContain("mdoultremont")
      })
    )
  })

  it.effect("returns no recordings for an unknown or malformed ISRC", () => {
    const t = setup()
    t.fetcher.mockResolvedValue(json({ error: "Not Found" }, 404))
    return t.run(
      Effect.gen(function* () {
        const musicBrainz = yield* MusicBrainz
        assert.deepStrictEqual(yield* musicBrainz.recordingsByIsrc(isrc), [])
        assert.deepStrictEqual(
          yield* musicBrainz.recordingsByIsrc("not-an-isrc"),
          []
        )
        expect(t.fetcher).toHaveBeenCalledOnce()
      })
    )
  })

  it.effect("treats 503 as a retryable rate limit", () => {
    const t = setup()
    t.fetcher.mockResolvedValue(json({}, 503, { "Retry-After": "4" }))
    return t.run(
      Effect.gen(function* () {
        const musicBrainz = yield* MusicBrainz
        const error = yield* Effect.flip(musicBrainz.recordingsByIsrc(isrc))
        expect(error).toMatchObject({
          reason: "RateLimited",
          retryAfterSeconds: 4,
        })
        assert.isTrue(error.retryable)
      })
    )
  })

  it.effect("waits between requests", () => {
    const t = setup("1100 millis")
    t.fetcher.mockImplementation(async () => json({ recordings: [] }))
    return t.run(
      Effect.gen(function* () {
        const musicBrainz = yield* MusicBrainz
        yield* musicBrainz.recordingsByIsrc(isrc)
        const second = yield* Effect.forkChild(
          musicBrainz.recordingsByIsrc(isrc)
        )
        yield* TestClock.adjust(1000)
        expect(t.fetcher).toHaveBeenCalledTimes(1)
        yield* TestClock.adjust(100)
        yield* Fiber.join(second)
        expect(t.fetcher).toHaveBeenCalledTimes(2)
      })
    )
  })
})
