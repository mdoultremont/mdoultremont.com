import { expect, test } from "vitest"
import { toRunTrackError, liveMusicPolicy } from "./music-run-runtime"
import { SpotifyError } from "./spotify"
import { Cc0SourceError } from "./cc0-sources"

test("provider errors preserve retry policy and rate-limit backoff without opening the live gate", () => {
  expect(
    toRunTrackError(new SpotifyError("rate_limited", "limited", 90))
  ).toMatchObject({ retryable: true, retryAfterSeconds: 90 })
  expect(
    toRunTrackError(new SpotifyError("temporary", "network"))
  ).toMatchObject({ retryable: true })
  expect(
    toRunTrackError(new SpotifyError("reconnect_needed", "reconnect"))
  ).toMatchObject({ retryable: false })
  expect(
    toRunTrackError(new Cc0SourceError("temporary", true, 45))
  ).toMatchObject({ retryable: true, retryAfterSeconds: 45 })
  expect(
    toRunTrackError(new Cc0SourceError("invalid recording"))
  ).toMatchObject({ retryable: false })
  expect(liveMusicPolicy.destinationAddsEnabled).toBe(false)
  expect(liveMusicPolicy.model).toBeNull()
})
