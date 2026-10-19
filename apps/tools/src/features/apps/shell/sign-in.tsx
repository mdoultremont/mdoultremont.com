import { useState } from "react"
import { AuthFrame } from "@/features/auth/auth-frame"
import {
  authClient,
  providerNames,
  type SignInProvider,
  signInProviders,
} from "@/features/auth/auth-client"
import { Button } from "@/features/ui/button"
import { AuthError, useSearchParam } from "./auth-error"

/**
 * The signed-out screen. By default signing in returns to the page the user
 * asked for; `returnTo` overrides where success and failure land.
 */
export function SignIn({
  returnTo,
  title,
  description,
}: {
  readonly returnTo?: { readonly success: string; readonly failure: string }
  readonly title?: string
  readonly description?: string
}) {
  const invited = useSearchParam("invited") === "1"
  const [busy, setBusy] = useState(false)

  async function signIn(provider: SignInProvider) {
    setBusy(true)
    const here = window.location.pathname
    const result = await authClient.signIn.social({
      provider,
      callbackURL: returnTo?.success ?? here,
      errorCallbackURL: returnTo?.failure ?? here,
    })
    if (result.error) setBusy(false)
  }

  return (
    <AuthFrame
      title={title ?? (invited ? "Finish signing up" : "Sign in")}
      description={
        description ??
        (invited
          ? "Continue with GitHub or Spotify to accept your invitation. You will sign in with that account from now on."
          : "Sign in with an account you have used here before. New users need an invitation.")
      }
    >
      <AuthError />
      {signInProviders.map((provider) => (
        <Button
          key={provider}
          size="lg"
          variant="outline"
          className="w-full"
          disabled={busy}
          onClick={() => void signIn(provider)}
        >
          Continue with {providerNames[provider]}
        </Button>
      ))}
    </AuthFrame>
  )
}
