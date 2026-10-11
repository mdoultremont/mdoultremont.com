import { Effect, Option } from "effect"
import { invitationCookie, UserAuth } from "@/backend/features/auth"
import { authLayer, userFromRequest } from "./auth.server"

const redirect = (location: string, cookie?: string) =>
  new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Cache-Control": "no-store",
      ...(cookie === undefined ? {} : { "Set-Cookie": cookie }),
    },
  })

/**
 * The link in an invitation email. A signed-in user accepts it straight
 * away. Anyone else gets the token in a short-lived cookie and signs in from
 * /apps; the sign-in gate finds it there and accepts the invitation.
 */
export const acceptInvitationLink = (request: Request) => {
  const url = new URL(request.url)
  const token = url.searchParams.get("token") ?? ""
  return Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* UserAuth
      if (token === "" || !(yield* auth.hasPendingInvitation(token)))
        return redirect("/apps?error=invitation_invalid")
      const user = yield* userFromRequest(request)
      if (Option.isSome(user)) {
        yield* auth.acceptInvitation({ token, userId: user.value.id })
        return redirect("/apps")
      }
      const cookie = [
        `${invitationCookie.name}=${token}`,
        `Path=${invitationCookie.path}`,
        `Max-Age=${invitationCookie.maxAgeSeconds}`,
        "HttpOnly",
        "SameSite=Lax",
        ...(url.protocol === "https:" ? ["Secure"] : []),
      ].join("; ")
      return redirect("/apps?invited=1", cookie)
    }).pipe(
      Effect.provide(authLayer()),
      Effect.catchCause((cause) =>
        Effect.logError("Invitation link failed", cause).pipe(
          Effect.as(redirect("/apps?error=unavailable"))
        )
      )
    )
  )
}
