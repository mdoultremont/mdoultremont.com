import { Option, Schema } from "effect"

/**
 * Why an action failed, on every transport: the oRPC error code, the public
 * HTTP status (`errorStatus`), and the `code` in a JSON error body.
 */
export const errorStatus = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
} as const

export type ActionErrorCode = keyof typeof errorStatus

/** Details some failures carry beside their code and message. */
export const ActionErrorDataSchema = Schema.Struct({
  /** The provider problem behind the failure, e.g. Spotify's `ReconnectNeeded`. */
  reason: Schema.optionalKey(Schema.String),
  retryAfterSeconds: Schema.optionalKey(Schema.Number),
  /** A Spotify playlist created although saving its destination failed. */
  createdPlaylist: Schema.optionalKey(
    Schema.Struct({ id: Schema.String, name: Schema.String })
  ),
})
export type ActionErrorData = typeof ActionErrorDataSchema.Type

/** The JSON body of a failed public HTTP request. */
export interface ActionErrorBody {
  readonly error: {
    readonly code: ActionErrorCode
    readonly message: string
    readonly data?: ActionErrorData
  }
}

/** The `reason` of a failure's data, from an oRPC error or any other value. */
export const errorReason = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "data" in error
    ? Schema.decodeUnknownOption(ActionErrorDataSchema)(error.data).pipe(
        Option.flatMap((data) => Option.fromNullishOr(data.reason)),
        Option.getOrUndefined
      )
    : undefined
