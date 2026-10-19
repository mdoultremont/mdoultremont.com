import { Cause, Data, Effect, Option } from "effect"
import type { Config } from "effect"
import type { App } from "#backend/actions/auth"
import { userFromRequest } from "./auth.server"

class SignInRequired extends Data.TaggedError("SignInRequired")<{}> {}

class AppAccessRequired extends Data.TaggedError("AppAccessRequired")<{}> {}

/** Errors every route may produce. `respond` turns them into responses. */
type RequestError = SignInRequired | AppAccessRequired | Config.ConfigError

function json(value: unknown, status = 200, headers?: Record<string, string>) {
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
        SignInRequired: () =>
          Effect.succeed(json({ error: "Sign-in required" }, 401)),
        AppAccessRequired: () =>
          Effect.succeed(
            json({ error: "You do not have access to this app" }, 403)
          ),
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

/**
 * The signed-in user, if they may use the app; otherwise `SignInRequired` or
 * `AppAccessRequired`. Checked on every private request.
 */
export const requireApp = Effect.fn("requireApp")(function* (
  request: Request,
  app: App
) {
  const user = yield* userFromRequest(request)
  if (Option.isNone(user)) return yield* new SignInRequired()
  if (!user.value.apps.includes(app)) return yield* new AppAccessRequired()
  return user.value
})
