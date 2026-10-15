import {
  Clock,
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  Option,
  Schema,
  Semaphore,
} from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/http"

/** Selected AcousticBrainz analysis fields, which are CC0. */
export interface AcousticBrainzAnalysis {
  readonly bpm: number | null
  readonly danceability: number | null
  /** Probability per mood, e.g. `{ relaxed: 0.82 }`. */
  readonly mood: Readonly<Record<string, number>>
  /** Probability of each model's top genre, keyed `model:genre`. */
  readonly genre: Readonly<Record<string, number>>
}

export class AcousticBrainzError extends Data.TaggedError(
  "AcousticBrainzError"
)<{
  readonly reason: "RateLimited" | "Unavailable" | "InvalidResponse"
  readonly retryAfterSeconds?: number
  readonly cause?: unknown
}> {
  override get message() {
    return this.reason === "InvalidResponse"
      ? "AcousticBrainz returned data that could not be read"
      : "AcousticBrainz is temporarily unavailable"
  }

  get retryable() {
    return this.reason !== "InvalidResponse"
  }
}

const moods = ["happy", "party", "relaxed", "sad"] as const
const genreModels = [
  "genre_dortmund",
  "genre_electronic",
  "genre_rosamerica",
  "genre_tzanetakis",
] as const

const Probability = Schema.Finite.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(1)
)

const LowLevel = Schema.Struct({
  rhythm: Schema.Struct({
    bpm: Schema.optional(Schema.Finite),
    danceability: Schema.optional(Schema.Finite),
  }),
})

const HighLevel = Schema.Struct({
  highlevel: Schema.Record(
    Schema.String,
    Schema.Struct({
      value: Schema.optional(Schema.String),
      probability: Schema.optional(Schema.Finite),
      all: Schema.optional(Schema.Record(Schema.String, Schema.Finite)),
    })
  ),
})

const recordingIdPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu

/**
 * AcousticBrainz API. Read-only since 2022: it only knows recordings analysed
 * before then. Requests are spaced to stay under its limit of ten requests
 * every ten seconds.
 */
export class AcousticBrainz extends Context.Service<
  AcousticBrainz,
  {
    /** The analysis for a MusicBrainz recording ID, if AcousticBrainz has one. */
    readonly analysis: (
      recordingId: string
    ) => Effect.Effect<
      Option.Option<AcousticBrainzAnalysis>,
      AcousticBrainzError
    >
  }
>()("backend/modules/AcousticBrainz") {
  static readonly layerWith = (options: {
    readonly minimumSpacing: Duration.Input
  }) =>
    Layer.effect(
      AcousticBrainz,
      Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient
        const spacing = Duration.toMillis(
          Duration.fromInputUnsafe(options.minimumSpacing)
        )
        const lock = yield* Semaphore.make(1)
        let nextRequestAt = 0

        /** Fetches one document; `None` when AcousticBrainz has no analysis. */
        const fetchDocument = <S extends Schema.Top>(url: string, schema: S) =>
          lock.withPermit(
            Effect.gen(function* () {
              const now = yield* Clock.currentTimeMillis
              if (nextRequestAt > now)
                yield* Effect.sleep(Duration.millis(nextRequestAt - now))
              nextRequestAt = (yield* Clock.currentTimeMillis) + spacing
              const response = yield* http
                .execute(HttpClientRequest.get(url))
                .pipe(
                  Effect.mapError(
                    (cause) =>
                      new AcousticBrainzError({ reason: "Unavailable", cause })
                  )
                )
              if (response.status === 404) return Option.none()
              yield* failOnStatus(response)
              const body = yield* response.json.pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(schema)),
                Effect.mapError(
                  (cause) =>
                    new AcousticBrainzError({
                      reason: "InvalidResponse",
                      cause,
                    })
                )
              )
              return Option.some(body as S["Type"])
            })
          )

        const analysis = Effect.fn("AcousticBrainz.analysis")(function* (
          recordingId: string
        ) {
          if (!recordingIdPattern.test(recordingId)) return Option.none()
          const base = `https://acousticbrainz.org/api/v1/${recordingId}`
          const low = yield* fetchDocument(`${base}/low-level`, LowLevel)
          if (Option.isNone(low)) return Option.none()
          const high = yield* fetchDocument(`${base}/high-level`, HighLevel)
          if (Option.isNone(high)) return Option.none()
          return Option.some(toAnalysis(low.value, high.value))
        })

        return AcousticBrainz.of({ analysis })
      })
    ).pipe(Layer.provide(FetchHttpClient.layer))

  static readonly layer = AcousticBrainz.layerWith({
    minimumSpacing: "1 second",
  })
}

const nonNegative = (value: number | undefined) =>
  value !== undefined && value >= 0 ? value : null

function toAnalysis(
  low: typeof LowLevel.Type,
  high: typeof HighLevel.Type
): AcousticBrainzAnalysis {
  const isProbability = Schema.is(Probability)
  const mood: Record<string, number> = {}
  for (const name of moods) {
    const value = high.highlevel[`mood_${name}`]?.all?.[name]
    if (isProbability(value)) mood[name] = value
  }
  const genre: Record<string, number> = {}
  for (const model of genreModels) {
    const entry = high.highlevel[model]
    if (entry?.value !== undefined && isProbability(entry.probability))
      genre[`${model}:${entry.value}`] = entry.probability
  }
  return {
    bpm: nonNegative(low.rhythm.bpm),
    danceability: nonNegative(low.rhythm.danceability),
    mood,
    genre,
  }
}

function failOnStatus(response: HttpClientResponse.HttpClientResponse) {
  if (response.status >= 200 && response.status < 300) return Effect.void
  const header = Number(response.headers["retry-after"])
  const retryAfterSeconds =
    Number.isFinite(header) && header >= 0 ? header : undefined
  if (response.status === 429)
    return Effect.fail(
      new AcousticBrainzError({ reason: "RateLimited", retryAfterSeconds })
    )
  return Effect.fail(
    new AcousticBrainzError({
      reason: response.status >= 500 ? "Unavailable" : "InvalidResponse",
      cause: `AcousticBrainz returned ${response.status}`,
    })
  )
}
