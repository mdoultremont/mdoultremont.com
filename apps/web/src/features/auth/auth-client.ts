import { createAuthClient } from "better-auth/client"

/** Browser side of Better Auth: starts sign-in, linking and sign-out against /api/auth. */
export const authClient = createAuthClient()

export type SignInProvider = "github" | "spotify"

export const providerNames: Record<SignInProvider, string> = {
  github: "GitHub",
  spotify: "Spotify",
}

/** What to tell someone after Better Auth or an invitation link redirects back with `?error=`. */
export function signInErrorMessage(code: string): string {
  switch (code) {
    case "not_allowed":
      return "This account is not allowed to use the private area."
    case "invitation_required":
      return "Only invited people can sign up. Ask for an invitation, or sign in with the account you used before."
    case "invitation_invalid":
      return "This invitation link has expired or was already used. Ask for a new one."
    case "account_not_linked":
      return "A user with this email already exists. Sign in with the account you used before, then link this one from the signed-in page."
    case "unavailable":
      return "Sign-in is temporarily unavailable. Please try again."
    default:
      return "Sign-in could not be completed. Please try again."
  }
}
