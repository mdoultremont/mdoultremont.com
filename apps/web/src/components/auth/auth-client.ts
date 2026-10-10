import { createAuthClient } from "better-auth/client"

/** Browser side of Better Auth: starts sign-in, linking and sign-out against /api/auth. */
export const authClient = createAuthClient()

export type SignInProvider = "github" | "spotify"

export const providerNames: Record<SignInProvider, string> = {
  github: "GitHub",
  spotify: "Spotify",
}

/** What to tell the owner after Better Auth redirects back with `?error=`. */
export function signInErrorMessage(code: string): string {
  switch (code) {
    case "not_allowed":
      return "This account is not allowed to use the private area."
    case "link_required":
      return "Sign in with the account you used before, then link this one from the signed-in page."
    default:
      return "Sign-in could not be completed. Please try again."
  }
}
