import { describe, expect, test, vi } from "vitest"
import { beginGitHubSignIn, completeGitHubSignIn, signOut } from "./auth.server"

const bindings = vi.hoisted(() => ({
  GITHUB_CLIENT_ID: "test-client",
  GITHUB_CLIENT_SECRET: "test-secret",
  GITHUB_OWNER_ID: "42",
  GITHUB_REDIRECT_URI: "https://example.com/api/auth/github/callback",
}))
vi.mock("cloudflare:workers", () => ({ env: bindings }))

describe("owner sign-in HTTP boundary", () => {
  test("starts GitHub authorization with a private state cookie", async () => {
    const response = await beginGitHubSignIn(
      new Request("https://example.com/music")
    )
    const target = new URL(response.headers.get("Location")!)

    expect(response.status).toBe(302)
    expect(target.origin).toBe("https://github.com")
    expect(target.searchParams.get("client_id")).toBe("test-client")
    expect(target.searchParams.get("state")).toBeTruthy()
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly")
    expect(response.headers.get("Set-Cookie")).toContain("SameSite=Lax")
    expect(response.headers.get("Set-Cookie")).toContain("Secure")
  })

  test("rejects a callback with no matching initiating state", async () => {
    const response = await completeGitHubSignIn(
      new Request(
        "https://example.com/api/auth/github/callback?code=stolen&state=bad",
        {
          headers: { Cookie: "github_oauth_state=good" },
        }
      )
    )

    expect(response.status).toBe(303)
    expect(response.headers.get("Location")).toBe(
      "https://example.com/music?signIn=failed"
    )
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0")
  })

  test("rejects a sign-out without same-origin request protection", async () => {
    const response = await signOut(
      new Request("https://example.com/api/auth/logout", { method: "POST" })
    )

    expect(response.status).toBe(403)
  })
})
