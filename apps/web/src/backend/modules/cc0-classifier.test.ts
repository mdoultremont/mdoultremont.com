import { Effect, Exit } from "effect"
import { describe, expect, test, vi } from "vitest"
import {
  buildCc0Input,
  classifyWithJev,
  ClassifierInputError,
  fingerprintCc0Input,
} from "./cc0-classifier"

const recording = {
  source: "musicbrainz-core-cc0" as const,
  id: "f5d53f70-3f26-4b45-b0d7-c31fe51dfc22",
  title: "Night Walk",
  artistCredit: "Example Artist",
  durationMs: 184000,
}
const acoustic = {
  source: "acousticbrainz-cc0" as const,
  recordingId: recording.id,
  bpm: 112,
  danceability: 0.72,
  mood: { relaxed: 0.82 },
  genre: { "genre_electronic:ambient": 0.64 },
}

function makeInput() {
  return buildCc0Input(recording, acoustic)
}

describe("CC0 Jev boundary", () => {
  test("rejects unproven or mismatched recording inputs", () => {
    expect(() =>
      buildCc0Input({ ...recording, source: "spotify" } as never, acoustic)
    ).toThrow(ClassifierInputError)
    expect(() =>
      buildCc0Input(recording, { ...acoustic, recordingId: "other" })
    ).toThrow(ClassifierInputError)
  })

  test("changes the decision fingerprint when permitted data changes", async () => {
    const first = await fingerprintCc0Input(makeInput())
    const second = await fingerprintCc0Input(
      buildCc0Input(recording, {
        ...acoustic,
        mood: { relaxed: 0.46 },
      })
    )

    expect(first).toMatch(/^[a-f0-9]{64}$/u)
    expect(second).not.toBe(first)
  })

  test("sends only allowlisted CC0 fields and evaluates destinations independently", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            destination_0: { type: "noul", noul: 0.94 },
            destination_1: { type: "noul", noul: 0.88 },
          },
        }),
        { status: 200 }
      )
    )
    const input = Object.assign(makeInput(), {
      spotifyId: "secret-spotify-track",
    })

    const result = await Effect.runPromise(
      classifyWithJev({
        input,
        destinations: [
          { id: "electronic", description: "Electronic music" },
          { id: "night", description: "Relaxed nighttime music" },
        ],
        model: "jev-1.13.0",
        apiKey: "test-key",
        fetcher,
      })
    )

    expect(result).toEqual([
      { destinationId: "electronic", yesProbability: 0.94 },
      { destinationId: "night", yesProbability: 0.88 },
    ])
    const body = JSON.parse(String(fetcher.mock.calls[0]![1]!.body))
    expect(body.state).toEqual({
      recording: {
        title: "Night Walk",
        artistCredit: "Example Artist",
        durationMs: 184000,
      },
      acoustic: {
        bpm: 112,
        danceability: 0.72,
        mood: { relaxed: 0.82 },
        genre: { "genre_electronic:ambient": 0.64 },
      },
    })
    expect(JSON.stringify(body)).not.toContain("secret-spotify-track")
    expect(body.questions).toEqual({
      destination_0: {
        type: "noul",
        instructions:
          "Does this recording belong in a playlist described as: Electronic music?",
      },
      destination_1: {
        type: "noul",
        instructions:
          "Does this recording belong in a playlist described as: Relaxed nighttime music?",
      },
    })
  })

  test("fails safely when Jev returns an invalid probability", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          answers: { destination_0: { type: "noul", noul: 1.5 } },
        }),
        { status: 200 }
      )
    )

    const result = await Effect.runPromiseExit(
      classifyWithJev({
        input: makeInput(),
        destinations: [{ id: "night", description: "Relaxed nighttime music" }],
        model: "jev-1.13.0",
        apiKey: "test-key",
        fetcher,
      })
    )

    expect(Exit.isFailure(result)).toBe(true)
  })
})

test("the model boundary ignores nested mutations, supplementary fields, and genre datasets", async () => {
  const input = buildCc0Input(recording, {
    ...acoustic,
    mood: { relaxed: 0.8, spotify_label: 1 },
    genre: { "genre_electronic:ambient": 0.7, "genre_dataset:restricted": 1 },
  })
  Object.assign(input.recording, {
    spotifyTitle: "restricted metadata",
    title: "mutated Spotify title",
  })
  Object.assign(input.acoustic, {
    spotifyAudio: "restricted",
    genre: { "genre_dataset:restricted": 1 },
  })
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        answers: { destination_0: { type: "noul", noul: 0.9 } },
      })
    )
  )
  await Effect.runPromise(
    classifyWithJev({
      input,
      destinations: [{ id: "ambient", description: "Ambient" }],
      model: "jev-1.13.0",
      apiKey: "test",
      fetcher,
    })
  )
  const body = JSON.parse(String(fetcher.mock.calls[0]![1]!.body))
  expect(body.state.recording.title).toBe("Night Walk")
  expect(body.state.acoustic.genre).toEqual({ "genre_electronic:ambient": 0.7 })
  expect(JSON.stringify(body)).not.toContain("restricted")
  expect(JSON.stringify(body)).not.toContain("spotify")
  const copied = { ...input }
  await expect(
    Effect.runPromise(
      classifyWithJev({
        input: copied,
        destinations: [{ id: "ambient", description: "Ambient" }],
        model: "jev-1.13.0",
        apiKey: "test",
        fetcher,
      })
    )
  ).rejects.toThrow("verified CC0")
})

test("refuses a floating model alias before any provider request", async () => {
  const fetcher = vi.fn<typeof fetch>()
  await expect(
    Effect.runPromise(
      classifyWithJev({
        input: makeInput(),
        destinations: [{ id: "ambient", description: "Ambient" }],
        apiKey: "test",
        model: "jev-latest",
        fetcher,
      })
    )
  ).rejects.toThrow("evaluated Jev model version")
  expect(fetcher).not.toHaveBeenCalled()
})
