import { Cause, Data, Effect, Option, Schema } from "effect"
import type { Config } from "effect"
import type { SpotifyError } from "@/backend/modules/spotify"
import { ownerFromRequest } from "./auth.server"

export class OwnerRequired extends Data.TaggedError("OwnerRequired")<{}> {}

export class MutationRejected extends Data.TaggedError(
  "MutationRejected"
)<{}> {}

export class InvalidBody extends Data.TaggedError("InvalidBody")<{
  readonly message: string
}> {}

/** Errors every route may produce. `respond` turns them into responses. */
export type RequestError =
  | OwnerRequired
  | MutationRejected
  | InvalidBody
  | Config.ConfigError

export function json(
  value: unknown,
  status = 200,
  headers?: Record<string, string>
) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  })
}

/**
 * The single place where an HTTP program leaves Effect. The type only accepts
 * programs whose own errors are already turned into responses; anything left
 * is a `RequestError`. Unexpected defects are logged and become a 500.
 */
export function respond(
  program: Effect.Effect<Response, RequestError>
): Promise<Response> {
  return Effect.runPromise(
    program.pipe(
      Effect.catchTags({
        OwnerRequired: () =>
          Effect.succeed(json({ error: "Owner sign-in required" }, 401)),
        MutationRejected: () =>
          Effect.succeed(json({ error: "Request verification failed" }, 403)),
        InvalidBody: (error) =>
          Effect.succeed(json({ error: error.message }, 400)),
        ConfigError: () =>
          Effect.succeed(
            json({ error: "This feature is not configured" }, 503)
          ),
      }),
      Effect.catchCause((cause) =>
        Effect.logError("Unhandled request failure", Cause.pretty(cause)).pipe(
          Effect.as(json({ error: "Request failed" }, 500))
        )
      )
    )
  )
}

/** The signed-in owner, or `OwnerRequired`. Checked on every private request. */
export const requireOwner = (request: Request) =>
  ownerFromRequest(request).pipe(
    Effect.flatMap((owner) =>
      Option.isSome(owner)
        ? Effect.succeed(owner.value)
        : Effect.fail(new OwnerRequired())
    )
  )

/**
 * Changes must come from this site's own pages. Browsers always send `Origin`
 * on a POST, PUT or DELETE, and the session cookie is `SameSite=Lax`, so a
 * request from another site is refused twice over.
 */
export const requireMutation = (request: Request) =>
  request.headers.get("Origin") === new URL(request.url).origin
    ? Effect.void
    : Effect.fail(new MutationRejected())

/** Parses the JSON body with a schema; any failure becomes `InvalidBody` with the given message. */
export const decodeBody = <S extends Schema.Top>(
  request: Request,
  schema: S,
  message: string
): Effect.Effect<S["Type"], InvalidBody, S["DecodingServices"]> =>
  Effect.tryPromise(() => request.json()).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.mapError(() => new InvalidBody({ message }))
  )

const spotifyStatus = {
  NotConnected: 409,
  ReconnectNeeded: 401,
  RateLimited: 429,
  Unavailable: 503,
  InvalidInput: 400,
  AccessDenied: 403,
  InvalidResponse: 502,
  Rejected: 502,
} satisfies Record<SpotifyError["reason"]["_tag"], number>

export function spotifyErrorResponse(error: SpotifyError): Response {
  const retryAfter = error.retryAfterSeconds
  return json(
    { error: error.message, code: error.reason._tag },
    spotifyStatus[error.reason._tag],
    retryAfter === undefined ? undefined : { "Retry-After": String(retryAfter) }
  )
}
