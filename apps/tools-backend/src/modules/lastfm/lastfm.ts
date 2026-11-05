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

/** A Last.fm user tag with its weight relative to the top tag, 0 to 1. */
export interface LastFmTag {
  readonly scope: "recording" | "artist"
  readonly name: string
  readonly weight: number
}

export class LastFmError extends Data.TaggedError("LastFmError")<{
  readonly reason: "RateLimited" | "Unavailable" | "InvalidResponse"
  readonly cause?: unknown
}> {
  override get message() {
    return this.reason === "InvalidResponse"
      ? "Last.fm returned data that could not be read"
      : "Last.fm is temporarily unavailable"
  }
}

const Tag = Schema.Struct({ name: Schema.String, count: Schema.Finite })

/** Last.fm sends a lone tag as an object instead of a one-item array. */
const TopTags = Schema.Struct({
  toptags: Schema.Struct({
    tag: Schema.optional(Schema.Union([Schema.Array(Tag), Tag])),
  }),
})

const ApiError = Schema.Struct({ error: Schema.Finite })

/** Tags kept per scope, and the weight below which a tag is noise. */
const tagsPerScope = 10
const minimumWeight = 0.1
/** Fewer track tags than this also reads the artist's tags. */
const enoughTrackTags = 3

/**
 * Last.fm API. Data is for non-commercial use with attribution to Last.fm.
 * Requests are spaced to stay under five per second.
 */
export class LastFm extends Context.Service<
  LastFm,
  {
    /** Whether an API key is set. Without one, `tags` always finds nothing. */
    readonly configured: boolean
    /**
     * The track's top tags, plus the artist's when the track has few.
     * Empty when Last.fm knows neither.
     */
    readonly tags: (query: {
      readonly title: string
      readonly artist: string
    }) => Effect.Effect<readonly LastFmTag[], LastFmError>
  }
>()("server/modules/LastFm") {
  static readonly layerWith = (options: {
    readonly minimumSpacing: Duration.Input
  }) =>
    Layer.effect(
      LastFm,
      Effect.gen(function* () {
        const apiKey = yield* Config.option(
          Config.schema(
            Schema.Redacted(Schema.NonEmptyString),
            "LASTFM_API_KEY"
          )
        )
        const http = yield* HttpClient.HttpClient
        const spacing = Duration.toMillis(
          Duration.fromInputUnsafe(options.minimumSpacing)
        )
        const lock = yield* Semaphore.make(1)
        let nextRequestAt = 0

        /** Top tags for one method; `None` when Last.fm does not know the item. */
        const topTags = (
          key: Redacted.Redacted<string>,
          scope: LastFmTag["scope"],
          params: Record<string, string>
        ) =>
          lock.withPermit(
            Effect.gen(function* () {
              const now = yield* Clock.currentTimeMillis
              if (nextRequestAt > now)
                yield* Effect.sleep(Duration.millis(nextRequestAt - now))
              nextRequestAt = (yield* Clock.currentTimeMillis) + spacing
              const response = yield* http
                .execute(
                  HttpClientRequest.get(
                    "https://ws.audioscrobbler.com/2.0/"
                  ).pipe(
                    HttpClientRequest.setUrlParams({
                      ...params,
                      autocorrect: "1",
                      format: "json",
                      api_key: Redacted.value(key),
                    }),
                    HttpClientRequest.setHeader(
                      "User-Agent",
                      "mdoultremont-music/0.1 (https://mdoultremont.com)"
                    )
                  )
                )
                .pipe(
                  Effect.mapError(
                    (cause) => new LastFmError({ reason: "Unavailable", cause })
                  )
                )
              const body: unknown = yield* response.json.pipe(
                Effect.mapError(
                  (cause) =>
                    new LastFmError({ reason: statusReason(response), cause })
                )
              )
              if (Schema.is(ApiError)(body)) {
                // 6: no such track or artist.
                if (body.error === 6) return Option.none()
                return yield* Effect.fail(
                  new LastFmError({
                    reason: errorReason(body.error),
                    cause: `Last.fm error ${body.error}`,
                  })
                )
              }
              if (response.status < 200 || response.status >= 300)
                return yield* Effect.fail(
                  new LastFmError({
                    reason: statusReason(response),
                    cause: `Last.fm returned ${response.status}`,
                  })
                )
              const { toptags } = yield* Schema.decodeUnknownEffect(TopTags)(
                body
              ).pipe(
                Effect.mapError(
                  (cause) =>
                    new LastFmError({ reason: "InvalidResponse", cause })
                )
              )
              return Option.some(toTags(scope, toptags.tag))
            })
          )

        const tags = Effect.fn("LastFm.tags")(function* (query: {
          readonly title: string
          readonly artist: string
        }) {
          if (Option.isNone(apiKey) || !query.artist || !query.title) return []
          const track = yield* topTags(apiKey.value, "recording", {
            method: "track.gettoptags",
            artist: query.artist,
            track: query.title,
          })
          const trackTags = Option.getOrElse(track, () => [])
          if (trackTags.length >= enoughTrackTags) return trackTags
          const artist = yield* topTags(apiKey.value, "artist", {
            method: "artist.gettoptags",
            artist: query.artist,
          })
          return [...trackTags, ...Option.getOrElse(artist, () => [])]
        })

        return LastFm.of({ configured: Option.isSome(apiKey), tags })
      })
    ).pipe(Layer.provide(FetchHttpClient.layer))

  static readonly layer = LastFm.layerWith({ minimumSpacing: "250 millis" })
}

function toTags(
  scope: LastFmTag["scope"],
  tag: typeof TopTags.Type.toptags.tag
): readonly LastFmTag[] {
  const list = tag === undefined ? [] : Array.isArray(tag) ? tag : [tag]
  const top = Math.max(0, ...list.map((entry) => entry.count))
  if (top === 0) return []
  return list
    .map((entry) => ({
      scope,
      name: entry.name.trim().toLowerCase(),
      weight: Math.round((entry.count / top) * 100) / 100,
    }))
    .filter((entry) => entry.name !== "" && entry.weight >= minimumWeight)
    .slice(0, tagsPerScope)
}

/** Last.fm API error codes: 29 rate limit, 8 and 16 temporary failures. */
function errorReason(code: number): LastFmError["reason"] {
  if (code === 29) return "RateLimited"
  if (code === 8 || code === 11 || code === 16) return "Unavailable"
  return "InvalidResponse"
}

function statusReason(
  response: HttpClientResponse.HttpClientResponse
): LastFmError["reason"] {
  if (response.status === 429) return "RateLimited"
  return response.status >= 500 ? "Unavailable" : "InvalidResponse"
}
