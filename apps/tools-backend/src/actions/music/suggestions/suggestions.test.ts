import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber, Layer } from "effect"
import { TestClock } from "effect/testing"
import { vi } from "vitest"
import {
  Destinations,
  DestinationStore,
} from "#backend/actions/music/destinations"
import { Clef, ClefError } from "#backend/modules/clef"
import { Database } from "#backend/modules/database"
import { makeTestD1 } from "#backend/modules/database/testing"
import { Spotify, spotifyError, Unavailable } from "#backend/modules/spotify"
import type { AcousticBrainzAnalysis } from "#backend/modules/acousticbrainz"
import { SuggestionStore } from "./store"
import { DestinationSuggestions } from "."

const jazz: AcousticBrainzAnalysis = {
  bpm: 80,
  danceability: 0.3,
  mood: { relaxed: 0.9 },
  genre: { "genre_dortmund:jazz": 0.9 },
}

function setup() {
  const d1 = makeTestD1()
  d1.seedOwner()
  d1.seedOwner("other")
  d1.sqlite.exec(
    "INSERT INTO music_sources (owner_id, source_id, enabled, created_at, updated_at) VALUES ('owner', 'disabled', 0, 1, 1), ('owner', 'enabled', 1, 1, 1)"
  )
  function track(
    id: string,
    acoustic: AcousticBrainzAnalysis | null,
    source = "liked",
    owner = "owner",
    present = 1
  ) {
    const isrc = owner + id
    d1.sqlite
      .prepare(
        "INSERT INTO music_tracks (owner_id, track_id, name, artist_names, isrc, added_at, first_seen_at, last_seen_at) VALUES (?, ?, 'SPOTIFY_SECRET_TITLE', '[\"SPOTIFY_SECRET_ARTIST\"]', ?, '2026-01-01', 1, 1)"
      )
      .run(owner, id, isrc)
    d1.sqlite
      .prepare(
        "INSERT INTO music_source_tracks (owner_id, source_id, track_id, added_at, present, last_seen_at) VALUES (?, ?, ?, '2026-01-01', ?, 1)"
      )
      .run(owner, source, id, present)
    if (acoustic)
      d1.sqlite
        .prepare(
          "INSERT INTO music_recordings (isrc, status, title, artist_credit, acoustic, fetched_at) VALUES (?, 'found', 'MusicBrainz title', 'MusicBrainz artist', ?, 1)"
        )
        .run(isrc, JSON.stringify(acoustic))
  }
  const noul = vi.fn<Clef["Service"]["noul"]>((input) =>
    Effect.succeed({
      model: "clef",
      probabilities: Object.fromEntries(
        Object.keys(input.questions).map((key) => [key, 0.9])
      ),
    })
  )
  const createPrivatePlaylist = vi.fn<
    Spotify["Service"]["createPrivatePlaylist"]
  >((_, name) =>
    Effect.succeed({
      id: "created",
      name,
      ownerId: "spotify-user",
      public: false,
      collaborative: false,
    })
  )
  const playlists = vi.fn<Spotify["Service"]["playlists"]>(() =>
    Effect.succeed([
      {
        id: "existing",
        name: "Existing playlist",
        ownerId: "spotify-user",
        public: false,
        collaborative: false,
      },
    ])
  )
  const spotify = Layer.succeed(Spotify, {
    playlists,
    createPrivatePlaylist,
  } as unknown as Spotify["Service"])
  const destinations = Destinations.layerNoDeps.pipe(
    Layer.provide(DestinationStore.layer)
  )
  const suggestions = DestinationSuggestions.layerNoDeps.pipe(
    Layer.provide(Layer.mergeAll(SuggestionStore.layer, destinations))
  )
  const layer = Layer.mergeAll(suggestions, destinations).pipe(
    Layer.provide(
      Layer.mergeAll(
        Database.layer(d1.binding),
        spotify,
        Layer.succeed(Clef, Clef.of({ noul }))
      )
    )
  )
  return {
    d1,
    track,
    noul,
    playlists,
    createPrivatePlaylist,
    run: <A, E>(
      body: Effect.Effect<A, E, Destinations | DestinationSuggestions>
    ) => Effect.provide(body, layer),
  }
}

describe("recording data aggregation", () => {
  it.effect(
    "counts strong recording features and ignores uncertain or unrelated models",
    () => {
      const test = setup()
      test.track("a", jazz)
      test.track("b", {
        ...jazz,
        genre: {
          "genre_dortmund:jazz": 0.9,
          "genre_rosamerica:jaz": 0.9,
          "genre_electronic:house": 0.99,
        },
      })
      test.track("c", {
        ...jazz,
        bpm: null,
        mood: { happy: 0.2 },
        genre: { "genre_dortmund:rock": 0.4 },
      })
      test.track("unknown", null)
      return test.run(
        Effect.gen(function* () {
          const result = yield* DestinationSuggestions.use((suggestions) =>
            suggestions.suggest("owner")
          )
          expect(result).toEqual({
            status: "ready",
            eligibleTracks: 4,
            analyzedTracks: 3,
            suggestions: [
              {
                name: "Jazz",
                description: "Tracks with a jazz sound.",
                estimatedTrackCount: 2,
              },
              {
                name: "Relaxed listening",
                description: "Relaxed tracks with a calm mood.",
                estimatedTrackCount: 2,
              },
              {
                name: "Slow tempo",
                description: "Slow-paced tracks with a tempo below 90 BPM.",
                estimatedTrackCount: 2,
              },
            ],
          })
        })
      )
    }
  )

  it.effect(
    "aggregates a large pool without putting individual recordings in the model input",
    () => {
      const test = setup()
      test.track("base", jazz)
      test.d1.sqlite.exec(`
      WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n < 10000)
      INSERT INTO music_tracks (owner_id, track_id, name, artist_names, isrc, added_at, first_seen_at, last_seen_at)
      SELECT 'owner', 'large' || n, 'SPOTIFY_SECRET_TITLE', '["SPOTIFY_SECRET_ARTIST"]', 'ownerbase', '2026-01-01', 1, 1 FROM numbers;
      INSERT INTO music_source_tracks (owner_id, source_id, track_id, added_at, present, last_seen_at)
      SELECT 'owner', 'liked', track_id, '2026-01-01', 1, 1 FROM music_tracks WHERE track_id != 'base';
    `)
      return test.run(
        Effect.gen(function* () {
          const result = yield* DestinationSuggestions.use((suggestions) =>
            suggestions.suggest("owner")
          )
          expect(result.eligibleTracks).toBe(10001)
          expect(
            result.suggestions.find((suggestion) => suggestion.name === "Jazz")
              ?.estimatedTrackCount
          ).toBe(10001)
          expect(
            JSON.stringify(test.noul.mock.calls[0]?.[0].state).length
          ).toBeLessThan(2500)
        })
      )
    }
  )
})

describe("destination suggestions", () => {
  it.effect(
    "still excludes destination descriptions when Spotify cannot supply playlist names",
    () => {
      const test = setup()
      test.track("a", jazz)
      test.track("b", jazz)
      test.d1.sqlite.exec(
        "INSERT INTO music_destinations (owner_id, playlist_id, description, enabled, created_at, updated_at) VALUES ('owner', 'existing', 'Jazz is already covered', 0, 1, 1)"
      )
      test.playlists.mockReturnValueOnce(
        Effect.fail(spotifyError(new Unavailable({})))
      )
      return test.run(
        Effect.gen(function* () {
          const result = yield* DestinationSuggestions.use((suggestions) =>
            suggestions.suggest("owner")
          )
          expect(result.status).toBe("ready")
          expect(test.noul.mock.calls[0]?.[0].state).toMatchObject({
            excludedDestinations: [
              { name: "", description: "Jazz is already covered" },
            ],
          })
        })
      )
    }
  )
  it.effect(
    "uses only the owner's tracks present in enabled sources, without duplicate memberships or Spotify track metadata",
    () => {
      const test = setup()
      test.track("a", jazz)
      test.track("b", jazz, "enabled")
      test.track("disabled", jazz, "disabled")
      test.track("removed", jazz, "liked", "owner", 0)
      test.track("anotherOwner", jazz, "liked", "other")
      test.track("unknown", null)
      test.d1.sqlite.exec(
        "INSERT INTO music_source_tracks (owner_id, source_id, track_id, added_at, present, last_seen_at) VALUES ('owner', 'enabled', 'a', '2026-01-01', 1, 1)"
      )
      test.d1.sqlite.exec(
        "INSERT INTO music_destinations (owner_id, playlist_id, description, enabled, created_at, updated_at) VALUES ('owner', 'existing', 'Jazz is already covered', 0, 1, 1)"
      )
      test.noul.mockImplementationOnce((input) => {
        const state = input.state as {
          recordingData: { groups: { name: string }[] }
        }
        return Effect.succeed({
          model: "clef",
          probabilities: Object.fromEntries(
            state.recordingData.groups.map((group, index) => [
              `suggestion${index}`,
              group.name === "Jazz" ? 0.1 : 0.8,
            ])
          ),
        })
      })
      return test.run(
        Effect.gen(function* () {
          const suggestions = yield* DestinationSuggestions
          const result = yield* suggestions.suggest("owner")
          expect(result).toMatchObject({
            status: "ready",
            eligibleTracks: 3,
            analyzedTracks: 2,
          })
          expect(
            result.suggestions.map((suggestion) => suggestion.name)
          ).toEqual(["Relaxed listening", "Slow tempo"])
          const input = test.noul.mock.calls[0]?.[0]
          expect(input?.state).toMatchObject({
            excludedDestinations: [
              {
                name: "Existing playlist",
                description: "Jazz is already covered",
              },
            ],
          })
          expect(JSON.stringify(input)).not.toContain("SPOTIFY_SECRET")
          expect(JSON.stringify(input)).not.toContain("anotherOwner")
          expect(test.createPrivatePlaylist).not.toHaveBeenCalled()
        })
      )
    }
  )

  it.effect("includes the full pool beyond a single page of tracks", () => {
    const test = setup()
    for (let index = 0; index < 503; index++)
      test.track(String(index).padStart(4, "0"), jazz)
    return test.run(
      Effect.gen(function* () {
        const result = yield* DestinationSuggestions.use((suggestions) =>
          suggestions.suggest("owner")
        )
        expect(result.eligibleTracks).toBe(503)
        expect(
          result.suggestions.find((suggestion) => suggestion.name === "Jazz")
            ?.estimatedTrackCount
        ).toBe(503)
      })
    )
  })

  it.effect(
    "explains an empty pool and missing recording analysis without a model call",
    () => {
      const test = setup()
      return test.run(
        Effect.gen(function* () {
          const suggestions = yield* DestinationSuggestions
          expect((yield* suggestions.suggest("owner")).status).toBe(
            "empty_pool"
          )
          test.track("unknown", null)
          expect(yield* suggestions.suggest("owner")).toEqual({
            status: "no_recording_data",
            eligibleTracks: 1,
            analyzedTracks: 0,
            suggestions: [],
          })
          expect(test.noul).not.toHaveBeenCalled()
        })
      )
    }
  )

  it.effect(
    "reports model failures instead of silently offering unvetted candidates",
    () => {
      const test = setup()
      test.track("a", jazz)
      test.track("b", jazz)
      test.noul.mockReturnValueOnce(
        Effect.fail(new ClefError({ reason: "Unavailable" }))
      )
      return test.run(
        Effect.gen(function* () {
          expect(
            yield* Effect.flip(
              DestinationSuggestions.use((suggestions) =>
                suggestions.suggest("owner")
              )
            )
          ).toMatchObject({ _tag: "ClefError", reason: "Unavailable" })
        })
      )
    }
  )

  it.effect("ends a stalled model request so the owner can retry", () => {
    const test = setup()
    test.track("a", jazz)
    test.track("b", jazz)
    test.noul.mockReturnValueOnce(Effect.never)
    return test.run(
      Effect.gen(function* () {
        const request = yield* DestinationSuggestions.use((suggestions) =>
          suggestions.suggest("owner")
        ).pipe(Effect.flip, Effect.forkChild)
        yield* TestClock.adjust("30 seconds")
        expect(yield* Fiber.join(request)).toMatchObject({
          _tag: "ClefError",
          reason: "Unavailable",
        })
      })
    )
  })

  it.effect(
    "accepts a suggestion as a private Spotify playlist and a persisted disabled destination",
    () => {
      const test = setup()
      test.track("a", jazz)
      test.track("b", jazz)
      return test.run(
        Effect.gen(function* () {
          const suggestions = yield* DestinationSuggestions
          const destinations = yield* Destinations
          const suggestion = (yield* suggestions.suggest("owner"))
            .suggestions[0]!
          const result = yield* destinations.create({
            ownerId: "owner",
            name: suggestion.name,
            description: suggestion.description,
            enabled: false,
          })
          expect(result.playlist).toMatchObject({
            id: "created",
            name: suggestion.name,
          })
          expect((yield* destinations.read("owner")).destinations).toEqual([
            expect.objectContaining({
              playlistId: "created",
              description: suggestion.description,
              enabled: false,
            }),
          ])
          expect(test.createPrivatePlaylist).toHaveBeenCalledWith(
            "owner",
            suggestion.name
          )
          expect(
            test.d1.sqlite
              .prepare("SELECT count(*) AS count FROM music_decisions")
              .get()
          ).toMatchObject({ count: 0 })
        })
      )
    }
  )
})
