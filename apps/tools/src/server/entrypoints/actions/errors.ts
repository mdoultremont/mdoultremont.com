import { Data, Effect } from "effect"
import type { Config } from "effect"
import type { FlightsError } from "@/server/actions/flights/flights"
import type { ClassificationPersistenceError } from "@/server/actions/music/classification"
import type { DeliveryPersistenceError } from "@/server/actions/music/delivery"
import type { DestinationsError } from "@/server/actions/music/destinations"
import type { EnrichmentPersistenceError } from "@/server/actions/music/enrichment"
import type { IngestionPersistenceError } from "@/server/actions/music/ingestion"
import type {
  AlreadyAUser,
  InvitationNotFound,
  LastBackOfficeUser,
  OwnAccessProtected,
  UserDirectoryPersistenceError,
  UserInputError,
  UserNotFound,
} from "@/server/actions/back-office/users"
import type { EmailError } from "@/server/modules/email"
import type { JobQueueError } from "@/server/modules/job-queue"
import type { SpotifyError } from "@/server/modules/spotify"
import type { ActionErrorCode, ActionErrorData } from "@/shared/actions"

/** A failed action as every transport reports it. */
export class ActionError extends Data.TaggedError("ActionError")<{
  readonly code: ActionErrorCode
  readonly message: string
  readonly data?: ActionErrorData
}> {}

/** Every business error an action handler may fail with. */
export type BusinessError =
  | FlightsError
  | DestinationsError
  | IngestionPersistenceError
  | EnrichmentPersistenceError
  | ClassificationPersistenceError
  | DeliveryPersistenceError
  | JobQueueError
  | AlreadyAUser
  | InvitationNotFound
  | LastBackOfficeUser
  | OwnAccessProtected
  | UserDirectoryPersistenceError
  | UserInputError
  | UserNotFound
  | EmailError
  | Config.ConfigError

const fail = (code: ActionErrorCode, message: string, data?: ActionErrorData) =>
  Effect.succeed(new ActionError({ code, message, ...(data ? { data } : {}) }))

const spotifyCodes = {
  NotConnected: "CONFLICT",
  ReconnectNeeded: "CONFLICT",
  RateLimited: "TOO_MANY_REQUESTS",
  Unavailable: "SERVICE_UNAVAILABLE",
  InvalidInput: "BAD_REQUEST",
  AccessDenied: "FORBIDDEN",
  InvalidResponse: "BAD_GATEWAY",
  Rejected: "BAD_GATEWAY",
} as const satisfies Record<SpotifyError["reason"]["_tag"], ActionErrorCode>

/**
 * The one table from business errors to public failures. Failures nobody can
 * act on are logged here with their cause.
 */
export const toActionError = (
  error: BusinessError
): Effect.Effect<ActionError> => {
  switch (error._tag) {
    case "FlightInputError":
    case "DestinationInputError":
    case "PlaylistNotUsable":
    case "UserInputError":
      return fail("BAD_REQUEST", error.message)
    case "FlightNotFound":
    case "UserNotFound":
    case "InvitationNotFound":
      return fail("NOT_FOUND", error.message)
    case "SetupIncomplete":
    case "DestinationConflict":
    case "AlreadyAUser":
    case "LastBackOfficeUser":
    case "OwnAccessProtected":
      return fail("CONFLICT", error.message)
    case "SpotifyError":
      return fail(spotifyCodes[error.reason._tag], error.message, {
        reason: error.reason._tag,
        ...(error.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: error.retryAfterSeconds }),
      })
    case "CreatedPlaylistConfigurationError":
      return fail("INTERNAL_SERVER_ERROR", error.message, {
        createdPlaylist: error.playlist,
      })
    case "DestinationPersistenceError":
    case "IngestionPersistenceError":
    case "EnrichmentPersistenceError":
    case "ClassificationPersistenceError":
    case "DeliveryPersistenceError":
    case "UserDirectoryPersistenceError":
      return Effect.logError(error.message, error.cause).pipe(
        Effect.andThen(fail("INTERNAL_SERVER_ERROR", error.message))
      )
    case "DatabaseError":
      return Effect.logError("Flight database failure", error).pipe(
        Effect.andThen(
          fail(
            "INTERNAL_SERVER_ERROR",
            "Flight data could not be saved or loaded"
          )
        )
      )
    case "ObjectStorageError":
    case "CompressionError":
      return Effect.logError("Flight file failure", error).pipe(
        Effect.andThen(
          fail(
            "INTERNAL_SERVER_ERROR",
            "Flight file could not be read or stored"
          )
        )
      )
    case "JobQueueError":
      return Effect.logError(error.message, error.cause).pipe(
        Effect.andThen(fail("SERVICE_UNAVAILABLE", error.message))
      )
    case "EmailError":
      return Effect.logError(
        "Invitation email failed",
        error.code,
        error.cause
      ).pipe(Effect.andThen(fail("BAD_GATEWAY", error.message)))
    case "ConfigError":
      return fail("SERVICE_UNAVAILABLE", "This feature is not configured")
  }
}
