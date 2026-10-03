import { describe, expect, test, vi } from "vitest"
import { createCc0Sources } from "./cc0-sources"

const mbid = "f5d53f70-3f26-4b45-b0d7-c31fe51dfc22"
const isrc = "USABC2400001"

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status })
}

describe("CC0 recording sources", () => {
  test("resolves one ISRC match into MusicBrainz core fields only", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        recordings: [
          {
            id: mbid,
            title: "Night Walk",
            length: 184000,
            "artist-credit": [{ name: "Example Artist" }],
            tags: [{ name: "restricted community tag" }],
            genres: [{ name: "restricted genre association" }],
          },
        ],
      })
    )
    const source = createCc0Sources({ fetcher })

    expect(await source.resolveByIsrc(isrc)).toEqual({
      source: "musicbrainz-core-cc0",
      id: mbid,
      title: "Night Walk",
      artistCredit: "Example Artist",
      durationMs: 184000,
    })
    expect(String(fetcher.mock.calls[0]![0])).toContain(
      `/isrc/${isrc}?fmt=json`
    )
    expect(fetcher.mock.calls[0]![1]?.headers).toHaveProperty("User-Agent")
  })

  test("abstains when an ISRC maps to multiple recordings", async () => {
    const source = createCc0Sources({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        json({
          recordings: [
            { id: mbid },
            { id: "edd27dd7-1ab5-4475-8ddb-b75716fa800f" },
          ],
        })
      ),
    })

    expect(await source.resolveByIsrc(isrc)).toBeNull()
  })

  test("extracts only selected AcousticBrainz fields", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({
          rhythm: { bpm: 112, danceability: 0.72 },
          metadata: { secret: "ignore" },
        })
      )
      .mockResolvedValueOnce(
        json({
          highlevel: {
            mood_relaxed: { all: { relaxed: 0.82 } },
            genre_electronic: { value: "ambient", probability: 0.64 },
            unrelated: { value: "ignore" },
          },
        })
      )
    const source = createCc0Sources({ fetcher })

    expect(await source.acousticByRecordingId(mbid)).toEqual({
      source: "acousticbrainz-cc0",
      recordingId: mbid,
      bpm: 112,
      danceability: 0.72,
      mood: { relaxed: 0.82 },
      genre: { "genre_electronic:ambient": 0.64 },
    })
  })
})
