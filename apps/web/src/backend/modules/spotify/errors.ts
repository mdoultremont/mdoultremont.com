import { Data } from "effect"

/** No Spotify account is connected for this owner. */
export class NotConnected extends Data.TaggedError("NotConnected")<{}> {
  override get message() {
    return "Spotify is not connected"
  }
}

/** Stored authorization was revoked, expired, or unreadable. */
export class ReconnectNeeded extends Data.TaggedError("ReconnectNeeded")<{}> {
  override get message() {
    return "Spotify needs to be reconnected"
  }
}

/** Spotify or the connected account refused something the owner asked for. */
export class AccessDenied extends Data.TaggedError("AccessDenied")<{
  readonly message: string
}> {}

export class RateLimited extends Data.TaggedError("RateLimited")<{
  readonly retryAfterSeconds: number | undefined
}> {
  override get message() {
    return "Spotify rate limit reached"
  }
}

/** Network failure, 5xx, or connection storage failure. Safe to retry. */
export class Unavailable extends Data.TaggedError("Unavailable")<{
  readonly cause?: unknown
}> {
  override get message() {
    return "Spotify is temporarily unavailable"
  }
}

/** The caller passed an ID, cursor, or name that cannot be sent to Spotify. */
export class InvalidInput extends Data.TaggedError("InvalidInput")<{
  readonly message: string
}> {}

/** Spotify answered with a status or payload this module does not understand. */
export class InvalidResponse extends Data.TaggedError("InvalidResponse")<{
  readonly message: string
  readonly cause?: unknown
}> {}

/** Spotify refused the request with an unexpected 4xx status. Not retryable. */
export class Rejected extends Data.TaggedError("Rejected")<{
  readonly status: number
}> {
  override get message() {
    return `Spotify returned ${this.status}`
  }
}

export type SpotifyErrorReason =
  | NotConnected
  | ReconnectNeeded
  | AccessDenied
  | RateLimited
  | Unavailable
  | InvalidInput
  | InvalidResponse
  | Rejected

/**
 * The single error type of the Spotify module. Handle specific cases with
 * `Effect.catchReason("SpotifyError", "RateLimited", ...)` or
 * `Effect.catchReasons("SpotifyError", { ... })`.
 */
export class SpotifyError extends Data.TaggedError("SpotifyError")<{
  readonly reason: SpotifyErrorReason
}> {
  override get message() {
    return this.reason.message
  }

  /** True when trying again later may succeed without owner action. */
  get retryable() {
    return (
      this.reason._tag === "RateLimited" ||
      this.reason._tag === "Unavailable" ||
      this.reason._tag === "InvalidResponse"
    )
  }

  get retryAfterSeconds() {
    return this.reason._tag === "RateLimited"
      ? this.reason.retryAfterSeconds
      : undefined
  }
}

export const spotifyError = (reason: SpotifyErrorReason) =>
  new SpotifyError({ reason })
