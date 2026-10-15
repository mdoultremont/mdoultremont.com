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
  readonly durationMs: number | null
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

const IsrcLookup = Schema.Struct({
  recordings: Schema.Array(
    Schema.Struct({
      id: Schema.String.check(
        Schema.isPattern(
          /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu
        )
      ),
      title: Schema.String,
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
  ),
})

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
  }
>()("backend/modules/MusicBrainz") {
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

        const recordingsByIsrc = Effect.fn("MusicBrainz.recordingsByIsrc")(
          function* (isrc: string) {
            isrc = isrc.toUpperCase().replaceAll("-", "")
            if (!isrcPattern.test(isrc)) return []
            const response = yield* spaced(
              HttpClientRequest.get(
                `https://musicbrainz.org/ws/2/isrc/${isrc}`
              ).pipe(
                HttpClientRequest.setUrlParams({
                  fmt: "json",
                  inc: "artist-credits",
                }),
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
            // 404: unknown ISRC. 400: MusicBrainz rejected it as invalid.
            if (response.status === 404 || response.status === 400) return []
            yield* failOnStatus(response)
            const body = yield* response.json.pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(IsrcLookup)),
              Effect.mapError(
                (cause) =>
                  new MusicBrainzError({ reason: "InvalidResponse", cause })
              )
            )
            return body.recordings.map((recording): MusicBrainzRecording => ({
              id: recording.id,
              title: recording.title,
              artistCredit: (recording["artist-credit"] ?? [])
                .map((credit) => credit.name + (credit.joinphrase ?? ""))
                .join(""),
              durationMs: recording.length ?? null,
            }))
          }
        )

        return MusicBrainz.of({ recordingsByIsrc })
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
