import { assert, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { FetchHttpClient } from "effect/http"
import { vi } from "vitest"
import { ListenBrainz } from "."

const mbid = "ccdac0ee-3771-4682-a932-c6e05c5fe04d"

function setup() {
  const fetcher = vi.fn<typeof fetch>()
  return {
    fetcher,
    run: <A, E>(body: Effect.Effect<A, E, ListenBrainz>) =>
      body.pipe(
        Effect.provide(ListenBrainz.layerWith({ minimumSpacing: "0 millis" })),
        Effect.provideService(FetchHttpClient.Fetch, fetcher)
      ),
  }
}

describe("ListenBrainz", () => {
  it.effect("keeps only genre tags, weighted within each scope", () => {
    const t = setup()
    t.fetcher.mockResolvedValue(
      Response.json({
        [mbid]: {
          tag: {
            recording: [],
            release_group: [
              { tag: "folk rock", count: 14, genre_mbid: "a" },
              { tag: "folk", count: 7, genre_mbid: "b" },
              { tag: "mellow", count: 20 },
            ],
            artist: [{ tag: "pop", count: 1, genre_mbid: "c" }],
          },
        },
      })
    )
    return t.run(
      Effect.gen(function* () {
        const listenBrainz = yield* ListenBrainz
        assert.deepStrictEqual(yield* listenBrainz.genres(mbid), [
          { scope: "release", name: "folk rock", weight: 1 },
          { scope: "release", name: "folk", weight: 0.5 },
          { scope: "artist", name: "pop", weight: 1 },
        ])
        const url = new URL(String(t.fetcher.mock.calls[0]![0]))
        assert.strictEqual(url.searchParams.get("recording_mbids"), mbid)
        assert.strictEqual(url.searchParams.get("inc"), "tag")
      })
    )
  })

  it.effect("returns nothing for an unknown recording", () => {
    const t = setup()
    t.fetcher.mockResolvedValue(Response.json({}))
    return t.run(
      Effect.gen(function* () {
        const listenBrainz = yield* ListenBrainz
        assert.deepStrictEqual(yield* listenBrainz.genres(mbid), [])
        assert.deepStrictEqual(yield* listenBrainz.genres("not-an-id"), [])
        expect(t.fetcher).toHaveBeenCalledOnce()
      })
    )
  })

  it.effect("reports 429 as a rate limit", () => {
    const t = setup()
    t.fetcher.mockResolvedValue(Response.json({}, { status: 429 }))
    return t.run(
      Effect.gen(function* () {
        const listenBrainz = yield* ListenBrainz
        const error = yield* Effect.flip(listenBrainz.genres(mbid))
        assert.strictEqual(error.reason, "RateLimited")
      })
    )
  })
})
