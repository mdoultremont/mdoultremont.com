import { env } from "cloudflare:workers"
import { Effect, Layer, Option } from "effect"
import { OwnerAuth, sessionLifetimeSeconds } from "@/backend/features/auth"
import type { GitHubIdentity } from "@/backend/modules/github"
import { randomToken } from "@/backend/primitives/hashing"
import { platformLayer } from "../platform"
import { readCookie } from "./cookies"

export const sessionCookie = "music_session"
export const csrfCookie = "music_csrf"
const stateCookie = "github_oauth_state"

const authLayer = () => OwnerAuth.layer.pipe(Layer.provide(platformLayer(env)))

/** Redirects to GitHub with a random state, kept in a short-lived cookie. */
export const beginGitHubSignIn = (request: Request) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* OwnerAuth
      const state = yield* randomToken
      return new Response(null, {
        status: 302,
        headers: {
          Location: auth.authorizationUrl(state),
          "Cache-Control": "no-store",
          "Set-Cookie": cookie(stateCookie, state, 600, request, true),
        },
      })
    }).pipe(
      Effect.provide(authLayer()),
      Effect.catchTag("ConfigError", () =>
        Effect.succeed(
          new Response("GitHub sign-in is not configured", { status: 503 })
        )
      )
    )
  )

/** GitHub's callback. Always redirects to /music with a session or a reason. */
export const completeGitHubSignIn = (request: Request) => {
  const url = new URL(request.url)
  const clearState = cookie(stateCookie, "", 0, request, true)
  const redirect = (reason: string) =>
    new Response(null, {
      status: 303,
      headers: [
        [
          "Location",
          new URL(`/music?signIn=${reason}`, request.url).toString(),
        ],
        ["Cache-Control", "no-store"],
        ["Set-Cookie", clearState],
      ],
    })

  return Effect.runPromise(
    Effect.gen(function* () {
      const state = url.searchParams.get("state")
      const code = url.searchParams.get("code")
      if (!state || !code || state !== readCookie(request, stateCookie))
        return redirect("failed")
      const auth = yield* OwnerAuth
      const session = yield* auth.signIn(code)
      return new Response(null, {
        status: 303,
        headers: [
          ["Location", new URL("/music", request.url).toString()],
          ["Cache-Control", "no-store"],
          ["Set-Cookie", clearState],
          [
            "Set-Cookie",
            cookie(
              sessionCookie,
              session.sessionToken,
              sessionLifetimeSeconds,
              request,
              true
            ),
          ],
          [
            "Set-Cookie",
            cookie(
              csrfCookie,
              session.csrfToken,
              sessionLifetimeSeconds,
              request,
              false
            ),
          ],
        ],
      })
    }).pipe(
      Effect.provide(authLayer()),
      Effect.catchTag("OwnerAccessDenied", () =>
        Effect.succeed(redirect("denied"))
      ),
      Effect.catch(() => Effect.succeed(redirect("failed")))
    )
  )
}

/** Ends the session. Same-origin only, proven by the CSRF cookie and header. */
export const signOut = (request: Request) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const csrf = readCookie(request, csrfCookie)
      if (
        request.headers.get("Origin") !== new URL(request.url).origin ||
        !csrf ||
        csrf !== request.headers.get("X-CSRF-Token")
      )
        return new Response("Request verification failed", { status: 403 })
      const sessionToken = readCookie(request, sessionCookie)
      if (sessionToken)
        yield* OwnerAuth.use((auth) => auth.signOut(sessionToken)).pipe(
          Effect.provide(authLayer()),
          // Clearing the cookies signs the browser out even if the row stays.
          Effect.ignore
        )
      return new Response(null, {
        status: 303,
        headers: [
          ["Location", new URL("/music", request.url).toString()],
          ["Cache-Control", "no-store"],
          ["Set-Cookie", cookie(sessionCookie, "", 0, request, true)],
          ["Set-Cookie", cookie(csrfCookie, "", 0, request, false)],
        ],
      })
    })
  )

/** The signed-in owner, if any. Never fails: any problem reads as signed out. */
export const ownerFromRequest = (request: Request) => {
  const sessionToken = readCookie(request, sessionCookie)
  if (!sessionToken) return Effect.succeed(Option.none<GitHubIdentity>())
  return OwnerAuth.use((auth) => auth.currentOwner(sessionToken)).pipe(
    Effect.provide(authLayer()),
    Effect.orElseSucceed(() => Option.none<GitHubIdentity>())
  )
}

/** For the /music page loader: the owner and the CSRF token its forms send. */
export const currentOwner = (request: Request) =>
  Effect.runPromise(
    ownerFromRequest(request).pipe(
      Effect.map((owner) =>
        Option.isSome(owner)
          ? {
              identity: owner.value,
              csrfToken: readCookie(request, csrfCookie) ?? "",
            }
          : null
      )
    )
  )

function cookie(
  name: string,
  value: string,
  maxAge: number,
  request: Request,
  httpOnly: boolean
) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "SameSite=Lax",
    ...(httpOnly ? ["HttpOnly"] : []),
    ...(new URL(request.url).protocol === "https:" ? ["Secure"] : []),
  ].join("; ")
}
