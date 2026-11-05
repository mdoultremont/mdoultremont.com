import { assert, describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { vi } from "vitest"
import { LastFm } from "."

const json = (value: unknown, status = 200) => Response.json(value, { status })

const tags = (...entries: [string, number][]) => ({
  toptags: { tag: entries.map(([name, count]) => ({ name, count })) },
})

function setup(env: Record<string, string> = { LASTFM_API_KEY: "key" }) {
  const fetcher = vi.fn<typeof fetch>()
  return {
    fetcher,
    url: (call: number) => new URL(String(fetcher.mock.calls[call]![0])),
    run: <A, E>(body: Effect.Effect<A, E, LastFm>) =>
      body.pipe(
        Effect.provide(
          LastFm.layerWith({ minimumSpacing: "0 millis" }).pipe(
            Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)))
          )
        ),
        Effect.provideService(FetchHttpClient.Fetch, fetcher)
      ),
  }
}

const query = { title: "Latch", artist: "Disclosure" }

describe("Last.fm", () => {
  it.effect("keeps track tags weighted against the top tag", () => {
    const t = setup()
    t.fetcher.mockResolvedValue(
      json(tags(["Deep House", 50], ["electronic", 25], ["uk", 10], ["meh", 4]))
    )
    return t.run(
      Effect.gen(function* () {
        const lastFm = yield* LastFm
        assert.deepStrictEqual(yield* lastFm.tags(query), [
          { scope: "recording", name: "deep house", weight: 1 },
          { scope: "recording", name: "electronic", weight: 0.5 },
          { scope: "recording", name: "uk", weight: 0.2 },
        ])
        expect(t.fetcher).toHaveBeenCalledOnce()
        const url = t.url(0)
        expect(Object.fromEntries(url.searchParams)).toMatchObject({
          method: "track.gettoptags",
          artist: "Disclosure",
          track: "Latch",
          autocorrect: "1",
          api_key: "key",
        })
      })
    )
  })

  it.effect("adds artist tags when the track has few", () => {
    const t = setup()
    t.fetcher
      .mockResolvedValueOnce(
        json({ toptags: { tag: { name: "house", count: 3 } } })
      )
      .mockResolvedValueOnce(json(tags(["electronic", 100])))
    return t.run(
      Effect.gen(function* () {
        const lastFm = yield* LastFm
        assert.deepStrictEqual(yield* lastFm.tags(query), [
          { scope: "recording", name: "house", weight: 1 },
          { scope: "artist", name: "electronic", weight: 1 },
        ])
        assert.strictEqual(
          t.url(1).searchParams.get("method"),
          "artist.gettoptags"
        )
      })
    )
  })

  it.effect("treats an unknown track as having no tags", () => {
    const t = setup()
    t.fetcher.mockImplementation(async () =>
      json({ error: 6, message: "Track not found" }, 404)
    )
    return t.run(
      Effect.gen(function* () {
        const lastFm = yield* LastFm
        assert.deepStrictEqual(yield* lastFm.tags(query), [])
        expect(t.fetcher).toHaveBeenCalledTimes(2)
      })
    )
  })

  it.effect("reports a rate limit as an error", () => {
    const t = setup()
    t.fetcher.mockResolvedValue(json({ error: 29, message: "Rate limit" }))
    return t.run(
      Effect.gen(function* () {
        const lastFm = yield* LastFm
        const error = yield* Effect.flip(lastFm.tags(query))
        assert.strictEqual(error.reason, "RateLimited")
      })
    )
  })

  it.effect("asks nothing without an API key", () => {
    const t = setup({})
    return t.run(
      Effect.gen(function* () {
        const lastFm = yield* LastFm
        assert.isFalse(lastFm.configured)
        assert.deepStrictEqual(yield* lastFm.tags(query), [])
        expect(t.fetcher).not.toHaveBeenCalled()
      })
    )
  })
})
