import { ORPCError } from "@orpc/server"
import { Cause, Data, Effect, Exit, Layer, Option } from "effect"
import type { Config } from "effect"
import type { FlightsError } from "@/server/actions/flights/flights"

/** The import text exceeds the 5 MB file limit (checked before the action runs). */
export class FlightRequestTooLarge extends Data.TaggedError(
  "FlightRequestTooLarge"
)<{
  readonly message: string
}> {}

export type FlightProcedureError =
  | FlightsError
  | FlightRequestTooLarge
  | Config.ConfigError

/** The ORPCError a failed flights program becomes. One place for the whole API. */
export const toOrpcError = (
  error: FlightProcedureError
): ORPCError<string, unknown> => {
  switch (error._tag) {
    case "FlightInputError":
      return new ORPCError("BAD_REQUEST", { message: error.message })
    case "FlightNotFound":
      return new ORPCError("NOT_FOUND", { message: error.message })
    case "FlightRequestTooLarge":
      return new ORPCError("PAYLOAD_TOO_LARGE", { message: error.message })
    case "DatabaseError":
      return new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Flight data could not be saved or loaded",
      })
    case "ObjectStorageError":
    case "CompressionError":
      return new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Flight file could not be read or stored",
      })
    case "ConfigError":
      return new ORPCError("SERVICE_UNAVAILABLE", {
        message: "This feature is not configured",
      })
  }
}

/**
 * The single place where a flights procedure leaves Effect: runs the program
 * with its action layer on top of the request's platform layer, throws typed
 * failures as `ORPCError`, and logs defects before throwing a generic 500.
 */
export const runProcedure = async <
  A,
  R,
  E extends FlightProcedureError,
  PlatformOut,
>(
  program: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, never, PlatformOut>,
  platform: Layer.Layer<PlatformOut, Config.ConfigError>
): Promise<A> => {
  const exit = await Effect.runPromiseExit(
    program.pipe(Effect.provide(layer.pipe(Layer.provide(platform))))
  )
  if (Exit.isSuccess(exit)) return exit.value
  const failure = Cause.findErrorOption(exit.cause)
  if (Option.isSome(failure)) {
    if (failure.value._tag === "ObjectStorageError")
      console.error("Flight object storage failure", failure.value)
    throw toOrpcError(failure.value)
  }
  console.error("Unhandled flights request failure", Cause.pretty(exit.cause))
  throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Request failed" })
}
