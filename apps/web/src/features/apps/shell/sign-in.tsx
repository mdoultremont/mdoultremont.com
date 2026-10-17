import { LockIcon } from "lucide-react"
import { useState } from "react"
import {
  authClient,
  providerNames,
  type SignInProvider,
  signInProviders,
} from "@/features/auth/auth-client"
import { Button } from "@/features/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/features/ui/card"
import { AuthError, useSearchParam } from "./auth-error"

/** The signed-out /apps screen. Signing in returns to the page the user asked for. */
export function SignIn() {
  const invited = useSearchParam("invited") === "1"
  const [busy, setBusy] = useState(false)

  async function signIn(provider: SignInProvider) {
    setBusy(true)
    const here = window.location.pathname
    const result = await authClient.signIn.social({
      provider,
      callbackURL: here,
      errorCallbackURL: here,
    })
    if (result.error) setBusy(false)
  }

  return (
    <div
      data-app-shell=""
      className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10"
    >
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center gap-2 self-center font-heading font-medium">
          <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <LockIcon className="size-3.5" />
          </div>
          Private apps
        </div>
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">
              <h1>{invited ? "Finish signing up" : "Sign in"}</h1>
            </CardTitle>
            <CardDescription>
              {invited
                ? "Continue with GitHub or Spotify to accept your invitation. You will sign in with that account from now on."
                : "Sign in with an account you have used here before. New users need an invitation."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
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
          </CardContent>
        </Card>
        <a
          href="/"
          className="self-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Return to portfolio
        </a>
      </div>
    </div>
  )
}
