import {
  Clock,
  Config,
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
  Semaphore,
} from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/http"
import {
  artistKey,
  creditNames,
  sameTitle,
} from "#backend/modules/music-matching"

/** The genres and styles of the Discogs release a recording was verified on. */
export interface DiscogsRelease {
  readonly releaseId: number
  readonly genres: readonly string[]
  readonly styles: readonly string[]
}

export class DiscogsError extends Data.TaggedError("DiscogsError")<{
  readonly reason: "RateLimited" | "Unavailable" | "InvalidResponse"
  readonly cause?: unknown
}> {
  override get message() {
    return this.reason === "InvalidResponse"
      ? "Discogs returned data that could not be read"
      : "Discogs is temporarily unavailable"
  }
}

const Artist = Schema.Struct({ name: Schema.String })

const Search = Schema.Struct({
  results: Schema.Array(Schema.Struct({ id: Schema.Finite })),
})

const Release = Schema.Struct({
  id: Schema.Finite,
  artists: Schema.optional(Schema.Array(Artist)),
  genres: Schema.optional(Schema.Array(Schema.String)),
  styles: Schema.optional(Schema.Array(Schema.String)),
  tracklist: Schema.Array(
    Schema.Struct({
      title: Schema.String,
      duration: Schema.optional(Schema.String),
      artists: Schema.optional(Schema.Array(Artist)),
    })
  ),
})

/** Search results checked against their tracklist before giving up. */
const releasesChecked = 3
/** Two lengths of the same recording differ by less than this. */
const durationToleranceMs = 15_000

/**
 * Discogs API. Requires a personal access token, which allows 60 requests a
 * minute, and attribution ("Data provided by Discogs").
 */
export class Discogs extends Context.Service<
  Discogs,
  {
    /** Whether a token is set. Without one, `release` always finds nothing. */
    readonly configured: boolean
    /**
     * A release containing this exact recording: the same title, mix name
     * included, by the same artist, and about the same length when both are
     * known. `None` rather than a near match.
     */
    readonly release: (recording: {
      readonly title: string
      readonly artistCredit: string
      readonly primaryArtist: string
      readonly durationMs: number | null
    }) => Effect.Effect<Option.Option<DiscogsRelease>, DiscogsError>
  }
>()("server/modules/Discogs") {
  static readonly layerWith = (options: {
    readonly minimumSpacing: Duration.Input
  }) =>
    Layer.effect(
      Discogs,
      Effect.gen(function* () {
        const token = yield* Config.option(
          Config.schema(Schema.Redacted(Schema.NonEmptyString), "DISCOGS_TOKEN")
        )
        const http = yield* HttpClient.HttpClient
        const spacing = Duration.toMillis(
          Duration.fromInputUnsafe(options.minimumSpacing)
        )
        const lock = yield* Semaphore.make(1)
        let nextRequestAt = 0

        const get = <S extends Schema.Top>(
          key: Redacted.Redacted<string>,
          url: string,
          params: Record<string, string>,
          schema: S
        ) =>
          lock.withPermit(
            Effect.gen(function* () {
              const now = yield* Clock.currentTimeMillis
              if (nextRequestAt > now)
                yield* Effect.sleep(Duration.millis(nextRequestAt - now))
              nextRequestAt = (yield* Clock.currentTimeMillis) + spacing
              const response = yield* http
                .execute(
                  HttpClientRequest.get(url).pipe(
                    HttpClientRequest.setUrlParams(params),
                    HttpClientRequest.setHeaders({
                      Authorization: `Discogs token=${Redacted.value(key)}`,
                      "User-Agent":
                        "mdoultremont-music/0.1 (https://mdoultremont.com)",
                    })
                  )
                )
                .pipe(
                  Effect.mapError(
                    (cause) =>
                      new DiscogsError({ reason: "Unavailable", cause })
                  )
                )
              if (response.status === 404) return Option.none()
              yield* failOnStatus(response)
              const body = yield* response.json.pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(schema)),
                Effect.mapError(
                  (cause) =>
                    new DiscogsError({ reason: "InvalidResponse", cause })
                )
              )
              return Option.some(body as S["Type"])
            })
          )

        const release = Effect.fn("Discogs.release")(function* (recording: {
          readonly title: string
          readonly artistCredit: string
          readonly primaryArtist: string
          readonly durationMs: number | null
        }) {
          if (Option.isNone(token) || !recording.primaryArtist)
            return Option.none()
          const search = yield* get(
            token.value,
            "https://api.discogs.com/database/search",
            {
              type: "release",
              artist: recording.primaryArtist,
              track: recording.title,
              per_page: String(releasesChecked),
            },
            Search
          )
          const ids = Option.match(search, {
            onNone: () => [],
            onSome: (body) => body.results.map((result) => result.id),
          })
          for (const id of ids.slice(0, releasesChecked)) {
            const found = yield* get(
              token.value,
              `https://api.discogs.com/releases/${id}`,
              {},
              Release
            )
            if (Option.isSome(found) && contains(found.value, recording))
              return Option.some({
                releaseId: found.value.id,
                genres: found.value.genres ?? [],
                styles: found.value.styles ?? [],
              })
          }
          return Option.none()
        })

        return Discogs.of({ configured: Option.isSome(token), release })
      })
    ).pipe(Layer.provide(FetchHttpClient.layer))

  static readonly layer = Discogs.layerWith({ minimumSpacing: "1100 millis" })
}

function contains(
  release: typeof Release.Type,
  recording: {
    readonly title: string
    readonly artistCredit: string
    readonly primaryArtist: string
    readonly durationMs: number | null
  }
) {
  return release.tracklist.some((track) => {
    if (!sameTitle(track.title, recording.title)) return false
    const artists = track.artists ?? release.artists ?? []
    const byArtist = artists.some(
      (artist) =>
        artistKey(artist.name) === artistKey(recording.primaryArtist) ||
        creditNames(recording.artistCredit, artist.name)
    )
    if (!byArtist) return false
    const durationMs = parseDuration(track.duration)
    return (
      durationMs === null ||
      recording.durationMs === null ||
      Math.abs(durationMs - recording.durationMs) <= durationToleranceMs
    )
  })
}

/** Discogs durations read "m:ss" or "h:mm:ss", or are empty. */
function parseDuration(value: string | undefined) {
  if (!value || !/^\d+(?::\d{1,2}){1,2}$/u.test(value)) return null
  return (
    value.split(":").reduce((total, part) => total * 60 + Number(part), 0) *
    1000
  )
}

function failOnStatus(response: HttpClientResponse.HttpClientResponse) {
  if (response.status >= 200 && response.status < 300) return Effect.void
  if (response.status === 429)
    return Effect.fail(new DiscogsError({ reason: "RateLimited" }))
  return Effect.fail(
    new DiscogsError({
      reason: response.status >= 500 ? "Unavailable" : "InvalidResponse",
      cause: `Discogs returned ${response.status}`,
    })
  )
}
