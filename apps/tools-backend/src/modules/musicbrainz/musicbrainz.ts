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

/** MusicBrainz core recording fields, which are CC0. */
export interface MusicBrainzRecording {
  readonly id: string
  readonly title: string
  /** Credited artists joined the way MusicBrainz displays them, e.g. "Simon & Garfunkel". */
  readonly artistCredit: string
  /** The first credited artist, e.g. "Simon & Garfunkel" or "Disclosure" in "Disclosure feat. Sam Smith". */
  readonly primaryArtist: string
  readonly durationMs: number | null
  /** What tells this recording apart from others of the same song, e.g. "live, 1981-09-19"; empty when nothing does. */
  readonly disambiguation: string
}

/** A search result with MusicBrainz's relevance score, 0 to 100. */
export interface MusicBrainzSearchResult extends MusicBrainzRecording {
  readonly score: number
}

export class MusicBrainzError extends Data.TaggedError("MusicBrainzError")<{
  readonly reason: "RateLimited" | "Unavailable" | "InvalidResponse"
  readonly retryAfterSeconds?: number
  readonly cause?: unknown
}> {
  override get message() {
    return this.reason === "InvalidResponse"
      ? "MusicBrainz returned data that could not be read"
      : "MusicBrainz is temporarily unavailable"
  }

  get retryable() {
    return this.reason !== "InvalidResponse"
  }
}

const Recording = Schema.Struct({
  id: Schema.String.check(
    Schema.isPattern(
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu
    )
  ),
  title: Schema.String,
  disambiguation: Schema.optional(Schema.String),
  length: Schema.optional(Schema.NullOr(Schema.Finite)),
  "artist-credit": Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        joinphrase: Schema.optional(Schema.String),
      })
    )
  ),
})

const IsrcLookup = Schema.Struct({ recordings: Schema.Array(Recording) })

const RecordingSearch = Schema.Struct({
  recordings: Schema.Array(
    Schema.Struct({ ...Recording.fields, score: Schema.Finite })
  ),
})

const toRecording = (
  recording: typeof Recording.Type
): MusicBrainzRecording => {
  const credits = recording["artist-credit"] ?? []
  return {
    id: recording.id,
    title: recording.title,
    artistCredit: credits
      .map((credit) => credit.name + (credit.joinphrase ?? ""))
      .join(""),
    primaryArtist: credits[0]?.name ?? "",
    durationMs: recording.length ?? null,
    disambiguation: recording.disambiguation ?? "",
  }
}

/** Quotes a value for a Lucene phrase query. */
const phrase = (value: string) =>
  `"${value.replaceAll(/["\\]/gu, (character) => `\\${character}`)}"`

const isrcPattern = /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/u

/**
 * MusicBrainz web service. Requests are spaced to respect its limit of about
 * one request per second for each client.
 */
export class MusicBrainz extends Context.Service<
  MusicBrainz,
  {
    /** Every recording MusicBrainz lists for the ISRC; empty when unknown or invalid. */
    readonly recordingsByIsrc: (
      isrc: string
    ) => Effect.Effect<readonly MusicBrainzRecording[], MusicBrainzError>
    /** Recordings whose title and artist match the phrases, best first. */
    readonly searchRecordings: (query: {
      readonly title: string
      readonly artist: string
    }) => Effect.Effect<readonly MusicBrainzSearchResult[], MusicBrainzError>
  }
>()("server/modules/MusicBrainz") {
  static readonly layerWith = (options: {
    readonly minimumSpacing: Duration.Input
  }) =>
    Layer.effect(
      MusicBrainz,
      Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient
        const spacing = Duration.toMillis(
          Duration.fromInputUnsafe(options.minimumSpacing)
        )
        const lock = yield* Semaphore.make(1)
        let nextRequestAt = 0

        /** Waits until the previous request is far enough in the past. */
        const spaced = <A, E>(request: Effect.Effect<A, E>) =>
          lock.withPermit(
            Effect.gen(function* () {
              const now = yield* Clock.currentTimeMillis
              if (nextRequestAt > now)
                yield* Effect.sleep(Duration.millis(nextRequestAt - now))
              nextRequestAt = (yield* Clock.currentTimeMillis) + spacing
              return yield* request
            })
          )

        const get = (path: string, params: Record<string, string>) =>
          spaced(
            HttpClientRequest.get(`https://musicbrainz.org/${path}`).pipe(
              HttpClientRequest.setUrlParams({ fmt: "json", ...params }),
              HttpClientRequest.setHeader(
                "User-Agent",
                "mdoultremont-music/0.1 (https://mdoultremont.com)"
              ),
              http.execute,
              Effect.mapError(
                (cause) =>
                  new MusicBrainzError({ reason: "Unavailable", cause })
              )
            )
          )

        const decode = <S extends Schema.Top>(
          response: HttpClientResponse.HttpClientResponse,
          schema: S
        ) =>
          failOnStatus(response).pipe(
            Effect.andThen(response.json),
            Effect.flatMap(Schema.decodeUnknownEffect(schema)),
            Effect.mapError((cause) =>
              cause instanceof MusicBrainzError
                ? cause
                : new MusicBrainzError({ reason: "InvalidResponse", cause })
            )
          ) as Effect.Effect<S["Type"], MusicBrainzError>

        const recordingsByIsrc = Effect.fn("MusicBrainz.recordingsByIsrc")(
          function* (isrc: string) {
            isrc = isrc.toUpperCase().replaceAll("-", "")
            if (!isrcPattern.test(isrc)) return []
            const response = yield* get(`ws/2/isrc/${isrc}`, {
              inc: "artist-credits",
            })
            // 404: unknown ISRC. 400: MusicBrainz rejected it as invalid.
            if (response.status === 404 || response.status === 400) return []
            const body = yield* decode(response, IsrcLookup)
            return body.recordings.map(toRecording)
          }
        )

        const searchRecordings = Effect.fn("MusicBrainz.searchRecordings")(
          function* (query: {
            readonly title: string
            readonly artist: string
          }) {
            if (!query.title.trim() || !query.artist.trim()) return []
            const response = yield* get("ws/2/recording", {
              query: `recording:${phrase(query.title)} AND artist:${phrase(query.artist)}`,
              limit: "25",
            })
            const body = yield* decode(response, RecordingSearch)
            return body.recordings.map(
              (recording): MusicBrainzSearchResult => ({
                ...toRecording(recording),
                score: recording.score,
              })
            )
          }
        )

        return MusicBrainz.of({ recordingsByIsrc, searchRecordings })
      })
    ).pipe(Layer.provide(FetchHttpClient.layer))

  static readonly layer = MusicBrainz.layerWith({
    minimumSpacing: "1100 millis",
  })
}

/** MusicBrainz answers 503 when a client exceeds its rate limit. */
function failOnStatus(response: HttpClientResponse.HttpClientResponse) {
  if (response.status >= 200 && response.status < 300) return Effect.void
  const header = Number(response.headers["retry-after"])
  const retryAfterSeconds =
    Number.isFinite(header) && header >= 0 ? header : undefined
  if (response.status === 429 || response.status === 503)
    return Effect.fail(
      new MusicBrainzError({ reason: "RateLimited", retryAfterSeconds })
    )
  return Effect.fail(
    new MusicBrainzError({
      reason: response.status >= 500 ? "Unavailable" : "InvalidResponse",
      cause: `MusicBrainz returned ${response.status}`,
    })
  )
}
