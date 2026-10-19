import { createFileRoute } from "@tanstack/react-router"
import { SignIn } from "@/features/apps/shell"

/**
 * Where an OAuth authorization request sends a signed-out user. Signing in
 * resumes the request (the page's query is signed by the server); a failed
 * sign-in comes back here with the query intact.
 */
export const Route = createFileRoute("/oauth/sign-in")({
  component: OAuthSignIn,
})

/**
 * The query exactly as the server signed it. The router's `searchStr`
 * re-serializes repeated keys such as `ba_param` as JSON, which breaks the
 * signature. Read when the user signs in, in the browser.
 */
const returnTo = {
  success: "/",
  get failure() {
    return `${window.location.pathname}${window.location.search}`
  },
}

function OAuthSignIn() {
  return (
    <SignIn
      returnTo={returnTo}
      title="Sign in to continue"
      description="An app asked to use tools as you. Sign in, then choose whether to allow it."
    />
  )
}
