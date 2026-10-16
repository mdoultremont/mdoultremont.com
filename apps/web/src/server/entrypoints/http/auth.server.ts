import { env } from "cloudflare:workers"
import { Effect, Layer, Option } from "effect"
import {
  type SignedInUser,
  UserAuth,
  type UserSession,
} from "@/server/actions/auth"
import { platformLayer } from "../platform"

export const authLayer = () =>
  UserAuth.layer.pipe(Layer.provide(platformLayer(env)))

/** Better Auth's routes under /api/auth: sign-in, callbacks, sign-out, linking. */
export const handleAuthRequest = (request: Request) =>
  Effect.runPromise(
    UserAuth.use((auth) => auth.handler(request)).pipe(
      Effect.provide(authLayer()),
      Effect.catchTag("ConfigError", () =>
        Effect.succeed(
          new Response("Sign-in is not configured", { status: 503 })
        )
      ),
      Effect.catchCause((cause) =>
        Effect.logError("Sign-in request failed", cause).pipe(
          Effect.as(new Response("Sign-in failed", { status: 500 }))
        )
      )
    )
  )

/** The signed-in user, if any. Never fails: any problem reads as signed out. */
export const userFromRequest = (request: Request) =>
  UserAuth.use((auth) => auth.currentUser(request.headers)).pipe(
    Effect.provide(authLayer()),
    Effect.orElseSucceed(() => Option.none<UserSession>())
  )

/** For the /apps layout loader: the signed-in user, or null. Sent to the browser. */
export const currentUser = (request: Request): Promise<SignedInUser | null> =>
  Effect.runPromise(
    userFromRequest(request).pipe(
      Effect.map(
        Option.match({
          onNone: () => null,
          onSome: ({ id, name, email, image, providers, apps }) => ({
            id,
            name,
            email,
            image,
            providers,
            apps,
          }),
        })
      )
    )
  )
