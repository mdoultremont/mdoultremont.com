import { assert, describe, expect, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { FetchHttpClient } from "effect/http"
import { vi } from "vitest"
import { AcousticBrainz } from "."

const mbid = "f5d53f70-3f26-4b45-b0d7-c31fe51dfc22"

const json = (value: unknown, status = 200) => Response.json(value, { status })

function setup() {
  const fetcher = vi.fn<typeof fetch>()
  return {
    fetcher,
    run: <A, E>(body: Effect.Effect<A, E, AcousticBrainz>) =>
      body.pipe(
        Effect.provide(
          AcousticBrainz.layerWith({ minimumSpacing: "0 millis" })
        ),
        Effect.provideService(FetchHttpClient.Fetch, fetcher)
      ),
  }
}

describe("AcousticBrainz", () => {
  it.effect("keeps only the selected analysis fields", () => {
    const t = setup()
    t.fetcher
      .mockResolvedValueOnce(
        json({
          rhythm: { bpm: 112, danceability: 1.2 },
          metadata: { secret: "ignored" },
        })
      )
      .mockResolvedValueOnce(
        json({
          highlevel: {
            mood_relaxed: { all: { relaxed: 0.82, not_relaxed: 0.18 } },
            genre_electronic: { value: "ambient", probability: 0.64 },
            timbre: { value: "dark", probability: 0.9 },
          },
        })
      )
    return t.run(
      Effect.gen(function* () {
        const acousticBrainz = yield* AcousticBrainz
        assert.deepStrictEqual(
          yield* acousticBrainz.analysis(mbid),
          Option.some({
            bpm: 112,
            danceability: 1.2,
            mood: { relaxed: 0.82 },
            genre: { "genre_electronic:ambient": 0.64 },
          })
        )
        expect(String(t.fetcher.mock.calls[0]![0])).toContain(
          `/api/v1/${mbid}/low-level`
        )
      })
    )
  })

  it.effect("has no analysis for recordings it never processed", () => {
    const t = setup()
    t.fetcher.mockResolvedValue(json({ message: "Not found" }, 404))
    return t.run(
      Effect.gen(function* () {
        const acousticBrainz = yield* AcousticBrainz
        assert.isTrue(Option.isNone(yield* acousticBrainz.analysis(mbid)))
        expect(t.fetcher).toHaveBeenCalledOnce()
      })
    )
  })

  it.effect("rejects malformed analyses as not retryable", () => {
    const t = setup()
    t.fetcher.mockResolvedValue(json({ rhythm: "unexpected" }))
    return t.run(
      Effect.gen(function* () {
        const acousticBrainz = yield* AcousticBrainz
        const error = yield* Effect.flip(acousticBrainz.analysis(mbid))
        assert.strictEqual(error.reason, "InvalidResponse")
        assert.isFalse(error.retryable)
      })
    )
  })
})
