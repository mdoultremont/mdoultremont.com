import { Effect } from "effect"
import type { GitHubIdentity } from "@/backend/workflows/app-auth"

export class GitHubOAuthError extends Error {
  readonly _tag = "GitHubOAuthError"

  constructor(message: string, cause?: unknown) {
    super(message, { cause })
    this.name = "GitHubOAuthError"
  }
}

export function exchangeCodeForIdentity(input: {
  readonly code: string
  readonly clientId: string
  readonly clientSecret: string
  readonly redirectUri: string
  readonly fetcher?: typeof fetch
}): Effect.Effect<GitHubIdentity, GitHubOAuthError> {
  return Effect.tryPromise({
    try: async () => {
      const fetcher = input.fetcher ?? fetch
      const tokenResponse = await fetcher(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: input.clientId,
            client_secret: input.clientSecret,
            code: input.code,
            redirect_uri: input.redirectUri,
          }),
        }
      )
      if (!tokenResponse.ok)
        throw new GitHubOAuthError("GitHub rejected the authorization code")
      const tokenPayload: unknown = await tokenResponse.json()
      if (
        !isRecord(tokenPayload) ||
        typeof tokenPayload.access_token !== "string"
      )
        throw new GitHubOAuthError(
          "GitHub returned an invalid access token response"
        )

      const profileResponse = await fetcher("https://api.github.com/user", {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${tokenPayload.access_token}`,
          "User-Agent": "mdoultremont.com",
        },
      })
      if (!profileResponse.ok)
        throw new GitHubOAuthError(
          "GitHub could not verify the signed-in account"
        )
      const profile: unknown = await profileResponse.json()
      if (
        !isRecord(profile) ||
        (typeof profile.id !== "number" && typeof profile.id !== "string") ||
        typeof profile.login !== "string"
      )
        throw new GitHubOAuthError("GitHub returned an invalid account profile")

      return {
        id: String(profile.id),
        login: profile.login,
        name: typeof profile.name === "string" ? profile.name : null,
        avatarUrl:
          typeof profile.avatar_url === "string" ? profile.avatar_url : null,
      }
    },
    catch: (cause) =>
      cause instanceof GitHubOAuthError
        ? cause
        : new GitHubOAuthError("GitHub sign-in could not be completed", cause),
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
