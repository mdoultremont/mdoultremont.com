import { env } from "cloudflare:workers"
import { Effect, Layer, Option } from "effect"
import {
  type Owner,
  OwnerAuth,
  type OwnerSession,
} from "@/backend/features/auth"
import { platformLayer } from "../platform"

const authLayer = () => OwnerAuth.layer.pipe(Layer.provide(platformLayer(env)))

/** Better Auth's routes under /api/auth: sign-in, callbacks, sign-out, linking. */
export const handleAuthRequest = (request: Request) =>
  Effect.runPromise(
    OwnerAuth.use((auth) => auth.handler(request)).pipe(
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

/** The signed-in owner, if any. Never fails: any problem reads as signed out. */
export const ownerFromRequest = (request: Request) =>
  OwnerAuth.use((auth) => auth.currentOwner(request.headers)).pipe(
    Effect.provide(authLayer()),
    Effect.orElseSucceed(() => Option.none<OwnerSession>())
  )

/** For the /music page loader: the signed-in owner, or null. Sent to the browser. */
export const currentOwner = (request: Request): Promise<Owner | null> =>
  Effect.runPromise(
    ownerFromRequest(request).pipe(
      Effect.map(
        Option.match({
          onNone: () => null,
          onSome: ({ id, name, email, image, providers }) => ({
            id,
            name,
            email,
            image,
            providers,
          }),
        })
      )
    )
  )
