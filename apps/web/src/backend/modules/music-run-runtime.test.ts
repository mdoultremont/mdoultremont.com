import { expect, test } from "vitest"
import { toRunTrackError, liveMusicPolicy } from "./music-run-runtime"
import {
  RateLimited,
  ReconnectNeeded,
  spotifyError,
  Unavailable,
} from "./spotify"
import { Cc0SourceError } from "./cc0-sources"

test("provider errors preserve retry policy and rate-limit backoff without opening the live gate", () => {
  expect(
    toRunTrackError(spotifyError(new RateLimited({ retryAfterSeconds: 90 })))
  ).toMatchObject({ retryable: true, retryAfterSeconds: 90 })
  expect(toRunTrackError(spotifyError(new Unavailable({})))).toMatchObject({
    retryable: true,
  })
  expect(toRunTrackError(spotifyError(new ReconnectNeeded()))).toMatchObject({
    retryable: false,
  })
  expect(
    toRunTrackError(new Cc0SourceError("temporary", true, 45))
  ).toMatchObject({ retryable: true, retryAfterSeconds: 45 })
  expect(
    toRunTrackError(new Cc0SourceError("invalid recording"))
  ).toMatchObject({ retryable: false })
  expect(liveMusicPolicy.destinationAddsEnabled).toBe(false)
  expect(liveMusicPolicy.model).toBeNull()
})
