import { env } from "cloudflare:workers"
import { Effect } from "effect"
import { appAuthStoreLayer } from "@/backend/modules/app-auth-store"
import { exchangeCodeForIdentity } from "@/backend/modules/github-oauth"
import {
  completeOwnerSignIn,
  endOwnerSession,
  findOwnerSession,
  OwnerAccessDenied,
  requireOwnerSession,
  type GitHubIdentity,
} from "@/backend/workflows/app-auth"

const sessionCookie = "music_session"
const stateCookie = "github_oauth_state"
const csrfCookie = "music_csrf"
const sessionLifetimeSeconds = 60 * 60 * 24 * 30

export async function beginGitHubSignIn(request: Request): Promise<Response> {
  if (!hasOAuthConfiguration())
    return new Response("GitHub sign-in is not configured", { status: 503 })

  const state = randomToken()
  const authorizationUrl = new URL("https://github.com/login/oauth/authorize")
  authorizationUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID)
  authorizationUrl.searchParams.set("redirect_uri", env.GITHUB_REDIRECT_URI)
  authorizationUrl.searchParams.set("scope", "read:user")
  authorizationUrl.searchParams.set("state", state)

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizationUrl.toString(),
      "Cache-Control": "no-store",
      "Set-Cookie": cookie(stateCookie, state, 600, request, true),
    },
  })
}

export async function completeGitHubSignIn(
  request: Request
): Promise<Response> {
  const url = new URL(request.url)
  const queryState = url.searchParams.get("state")
  const code = url.searchParams.get("code")
  const storedState = readCookie(request, stateCookie)
  const clearStateCookie = cookie(stateCookie, "", 0, request, true)
  if (
    !hasOAuthConfiguration() ||
    !queryState ||
    !storedState ||
    queryState !== storedState ||
    !code
  )
    return signInRedirect(request, "failed", clearStateCookie)

  const identity = await Effect.runPromise(
    exchangeCodeForIdentity({
      code,
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      redirectUri: env.GITHUB_REDIRECT_URI,
    })
  ).catch(() => null)
  if (!identity) return signInRedirect(request, "failed", clearStateCookie)

  const sessionToken = randomToken()
  const csrfToken = randomToken()
  const sessionHash = await sha256(sessionToken)
  const expiresAt = Math.floor(Date.now() / 1000) + sessionLifetimeSeconds
  try {
    await Effect.runPromise(
      Effect.provide(
        completeOwnerSignIn({
          identity,
          configuredOwnerId: env.GITHUB_OWNER_ID,
          sessionHash,
          expiresAt,
        }),
        appAuthStoreLayer(env.DB)
      )
    )
  } catch (error) {
    return signInRedirect(
      request,
      error instanceof OwnerAccessDenied ? "denied" : "failed",
      clearStateCookie
    )
  }

  return new Response(null, {
    status: 303,
    headers: [
      ["Location", new URL("/music", request.url).toString()],
      ["Cache-Control", "no-store"],
      ["Set-Cookie", clearStateCookie],
      [
        "Set-Cookie",
        cookie(
          sessionCookie,
          sessionToken,
          sessionLifetimeSeconds,
          request,
          true
        ),
      ],
      [
        "Set-Cookie",
        cookie(csrfCookie, csrfToken, sessionLifetimeSeconds, request, false),
      ],
    ],
  })
}

export async function currentOwner(request: Request): Promise<{
  readonly identity: GitHubIdentity
  readonly csrfToken: string
} | null> {
  const sessionToken = readCookie(request, sessionCookie)
  if (!sessionToken || !env.GITHUB_OWNER_ID) return null
  const sessionHash = await sha256(sessionToken)
  const identity = await Effect.runPromise(
    Effect.provide(
      findOwnerSession({ sessionHash, now: Math.floor(Date.now() / 1000) }),
      appAuthStoreLayer(env.DB)
    )
  ).catch(() => null)
  if (!identity || identity.id !== env.GITHUB_OWNER_ID) return null
  return { identity, csrfToken: readCookie(request, csrfCookie) ?? "" }
}

export async function requireCurrentOwner(
  request: Request
): Promise<GitHubIdentity> {
  const sessionToken = readCookie(request, sessionCookie)
  if (!sessionToken || !env.GITHUB_OWNER_ID) throw new OwnerAccessDenied()
  const sessionHash = await sha256(sessionToken)
  const identity = await Effect.runPromise(
    Effect.provide(
      requireOwnerSession({ sessionHash, now: Math.floor(Date.now() / 1000) }),
      appAuthStoreLayer(env.DB)
    )
  )
  if (identity.id !== env.GITHUB_OWNER_ID) throw new OwnerAccessDenied()
  return identity
}

export async function signOut(request: Request): Promise<Response> {
  const origin = request.headers.get("Origin")
  const cookieToken = readCookie(request, csrfCookie)
  const headerToken = request.headers.get("X-CSRF-Token")
  if (
    origin !== new URL(request.url).origin ||
    !cookieToken ||
    !headerToken ||
    cookieToken !== headerToken
  )
    return new Response("Request verification failed", { status: 403 })

  const sessionToken = readCookie(request, sessionCookie)
  if (sessionToken) {
    await Effect.runPromise(
      Effect.provide(
        endOwnerSession(await sha256(sessionToken)),
        appAuthStoreLayer(env.DB)
      )
    ).catch(() => undefined)
  }

  return new Response(null, {
    status: 303,
    headers: [
      ["Location", new URL("/music", request.url).toString()],
      ["Cache-Control", "no-store"],
      ["Set-Cookie", cookie(sessionCookie, "", 0, request, true)],
      ["Set-Cookie", cookie(csrfCookie, "", 0, request, false)],
    ],
  })
}

function hasOAuthConfiguration() {
  return Boolean(
    env.GITHUB_CLIENT_ID &&
    env.GITHUB_CLIENT_SECRET &&
    env.GITHUB_OWNER_ID &&
    env.GITHUB_REDIRECT_URI
  )
}

function signInRedirect(
  request: Request,
  reason: string,
  clearedStateCookie: string
) {
  return new Response(null, {
    status: 303,
    headers: [
      ["Location", new URL(`/music?signIn=${reason}`, request.url).toString()],
      ["Cache-Control", "no-store"],
      ["Set-Cookie", clearedStateCookie],
    ],
  })
}

function readCookie(request: Request, name: string): string | null {
  for (const part of request.headers.get("Cookie")?.split(";") ?? []) {
    const separator = part.indexOf("=")
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue
    return decodeURIComponent(part.slice(separator + 1).trim())
  }
  return null
}

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

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return base64Url(bytes)
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

function base64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "")
}
