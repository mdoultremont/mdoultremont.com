import {
  Clock,
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  Schema,
  Semaphore,
} from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/http"

/** A MusicBrainz genre tag with its vote weight relative to the top genre in the same scope, 0 to 1. */
export interface ListenBrainzGenre {
  readonly scope: "recording" | "release" | "artist"
  readonly name: string
  readonly weight: number
}

export class ListenBrainzError extends Data.TaggedError("ListenBrainzError")<{
  readonly reason: "RateLimited" | "Unavailable" | "InvalidResponse"
  readonly cause?: unknown
}> {
  override get message() {
    return this.reason === "InvalidResponse"
      ? "ListenBrainz returned data that could not be read"
      : "ListenBrainz is temporarily unavailable"
  }
}

const Tags = Schema.optional(
  Schema.Array(
    Schema.Struct({
      tag: Schema.String,
      count: Schema.Finite,
      genre_mbid: Schema.optional(Schema.String),
    })
  )
)

const Metadata = Schema.Record(
  Schema.String,
  Schema.Struct({
    tag: Schema.optional(
      Schema.Struct({
        recording: Tags,
        release_group: Tags,
        artist: Tags,
      })
    ),
  })
)

const recordingIdPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu

/**
 * ListenBrainz metadata API, which serves MusicBrainz tags by recording ID.
 * Only tags MusicBrainz lists as genres are kept: free-form tags are mostly
 * noise for classification. Requests are spaced to stay under its limit of
 * 30 requests every 10 seconds.
 */
export class ListenBrainz extends Context.Service<
  ListenBrainz,
  {
    /** Genres of the recording, its release group, and its artist. Empty when none are tagged. */
    readonly genres: (
      recordingId: string
    ) => Effect.Effect<readonly ListenBrainzGenre[], ListenBrainzError>
  }
>()("server/modules/ListenBrainz") {
  static readonly layerWith = (options: {
    readonly minimumSpacing: Duration.Input
  }) =>
    Layer.effect(
      ListenBrainz,
      Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient
        const spacing = Duration.toMillis(
          Duration.fromInputUnsafe(options.minimumSpacing)
        )
        const lock = yield* Semaphore.make(1)
        let nextRequestAt = 0

        const genres = Effect.fn("ListenBrainz.genres")(function* (
          recordingId: string
        ) {
          if (!recordingIdPattern.test(recordingId)) return []
          const body = yield* lock.withPermit(
            Effect.gen(function* () {
              const now = yield* Clock.currentTimeMillis
              if (nextRequestAt > now)
                yield* Effect.sleep(Duration.millis(nextRequestAt - now))
              nextRequestAt = (yield* Clock.currentTimeMillis) + spacing
              const response = yield* http
                .execute(
                  HttpClientRequest.get(
                    "https://api.listenbrainz.org/1/metadata/recording/"
                  ).pipe(
                    HttpClientRequest.setUrlParams({
                      recording_mbids: recordingId,
                      inc: "tag",
                    }),
                    HttpClientRequest.setHeader(
                      "User-Agent",
                      "mdoultremont-music/0.1 (https://mdoultremont.com)"
                    )
                  )
                )
                .pipe(
                  Effect.mapError(
                    (cause) =>
                      new ListenBrainzError({ reason: "Unavailable", cause })
                  )
                )
              yield* failOnStatus(response)
              return yield* response.json.pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(Metadata)),
                Effect.mapError(
                  (cause) =>
                    new ListenBrainzError({ reason: "InvalidResponse", cause })
                )
              )
            })
          )
          const tags = body[recordingId]?.tag
          return [
            ...toGenres("recording", tags?.recording),
            ...toGenres("release", tags?.release_group),
            ...toGenres("artist", tags?.artist),
          ]
        })

        return ListenBrainz.of({ genres })
      })
    ).pipe(Layer.provide(FetchHttpClient.layer))

  static readonly layer = ListenBrainz.layerWith({
    minimumSpacing: "400 millis",
  })
}

function toGenres(
  scope: ListenBrainzGenre["scope"],
  tags: (typeof Tags)["Type"]
): readonly ListenBrainzGenre[] {
  const genres = (tags ?? []).filter(
    (tag) => tag.genre_mbid !== undefined && tag.count > 0
  )
  const top = Math.max(0, ...genres.map((tag) => tag.count))
  return genres.map((tag) => ({
    scope,
    name: tag.tag.trim().toLowerCase(),
    weight: Math.round((tag.count / top) * 100) / 100,
  }))
}

function failOnStatus(response: HttpClientResponse.HttpClientResponse) {
  if (response.status >= 200 && response.status < 300) return Effect.void
  if (response.status === 429)
    return Effect.fail(new ListenBrainzError({ reason: "RateLimited" }))
  return Effect.fail(
    new ListenBrainzError({
      reason: response.status >= 500 ? "Unavailable" : "InvalidResponse",
      cause: `ListenBrainz returned ${response.status}`,
    })
  )
}
