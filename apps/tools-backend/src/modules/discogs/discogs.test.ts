import { assert, describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Effect, Layer, Option } from "effect"
import { FetchHttpClient } from "effect/http"
import { vi } from "vitest"
import { Discogs } from "."

const json = (value: unknown, status = 200) => Response.json(value, { status })

const release = (
  id: number,
  tracklist: {
    title: string
    duration?: string
    artists?: { name: string }[]
  }[],
  artists = [{ name: "Disclosure" }]
) => ({
  id,
  artists,
  genres: ["Electronic"],
  styles: ["UK Garage", "House"],
  tracklist,
})

function setup(env: Record<string, string> = { DISCOGS_TOKEN: "token" }) {
  const fetcher = vi.fn<typeof fetch>()
  return {
    fetcher,
    url: (call: number) => new URL(String(fetcher.mock.calls[call]![0])),
    run: <A, E>(body: Effect.Effect<A, E, Discogs>) =>
      body.pipe(
        Effect.provide(
          Discogs.layerWith({ minimumSpacing: "0 millis" }).pipe(
            Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)))
          )
        ),
        Effect.provideService(FetchHttpClient.Fetch, fetcher)
      ),
  }
}

const remix = {
  title: "Latch (Kaytranada remix)",
  artistCredit: "Disclosure feat. Sam Smith",
  primaryArtist: "Disclosure",
  durationMs: 250_000,
}

describe("Discogs", () => {
  it.effect(
    "returns the first release whose tracklist has the exact mix",
    () => {
      const t = setup()
      t.fetcher
        .mockResolvedValueOnce(json({ results: [{ id: 1 }, { id: 2 }] }))
        .mockResolvedValueOnce(
          json(release(1, [{ title: "Latch", duration: "4:15" }]))
        )
        .mockResolvedValueOnce(
          json(
            release(2, [
              { title: "Latch", duration: "4:15" },
              { title: "Latch (Kaytranada Remix)", duration: "4:12" },
            ])
          )
        )
      return t.run(
        Effect.gen(function* () {
          const discogs = yield* Discogs
          assert.deepStrictEqual(
            yield* discogs.release(remix),
            Option.some({
              releaseId: 2,
              genres: ["Electronic"],
              styles: ["UK Garage", "House"],
            })
          )
          expect(Object.fromEntries(t.url(0).searchParams)).toMatchObject({
            type: "release",
            artist: "Disclosure",
            track: "Latch (Kaytranada remix)",
          })
          expect(
            new Headers(t.fetcher.mock.calls[0]![1]?.headers).get(
              "authorization"
            )
          ).toBe("Discogs token=token")
        })
      )
    }
  )

  it.effect(
    "rejects the right title by another artist or of another length",
    () => {
      const t = setup()
      t.fetcher
        .mockResolvedValueOnce(json({ results: [{ id: 1 }, { id: 2 }] }))
        .mockResolvedValueOnce(
          json(
            release(
              1,
              [{ title: "Latch (Kaytranada Remix)", duration: "4:12" }],
              [{ name: "Various" }]
            )
          )
        )
        .mockResolvedValueOnce(
          json(
            release(2, [
              { title: "Latch (Kaytranada Remix)", duration: "6:40" },
            ])
          )
        )
      return t.run(
        Effect.gen(function* () {
          const discogs = yield* Discogs
          assert.isTrue(Option.isNone(yield* discogs.release(remix)))
        })
      )
    }
  )

  it.effect("matches a compilation by the track's own artists", () => {
    const t = setup()
    t.fetcher
      .mockResolvedValueOnce(json({ results: [{ id: 3 }] }))
      .mockResolvedValueOnce(
        json(
          release(
            3,
            [
              {
                title: "Latch (Kaytranada Remix)",
                artists: [{ name: "Disclosure (2)" }],
              },
            ],
            [{ name: "Various" }]
          )
        )
      )
    return t.run(
      Effect.gen(function* () {
        const discogs = yield* Discogs
        assert.isTrue(Option.isSome(yield* discogs.release(remix)))
      })
    )
  })

  it.effect("asks nothing without a token", () => {
    const t = setup({})
    return t.run(
      Effect.gen(function* () {
        const discogs = yield* Discogs
        assert.isFalse(discogs.configured)
        assert.isTrue(Option.isNone(yield* discogs.release(remix)))
        expect(t.fetcher).not.toHaveBeenCalled()
      })
    )
  })
})
