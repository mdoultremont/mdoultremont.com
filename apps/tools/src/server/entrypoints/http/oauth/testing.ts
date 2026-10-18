import { assert } from "@effect/vitest"
import { Effect } from "effect"
import { vi } from "vitest"
import { makeTestD1 } from "@/server/modules/database/testing"
import { makeFakeR2 } from "@/server/modules/object-storage/testing"
import { errorStatus } from "@/shared/actions"
import { handleAuthRequest } from "../auth.server"
import { authenticate, isRefusal } from "."

/**
 * The real Better Auth OAuth provider on an in-memory D1, signing in through
 * a stubbed GitHub. Test files must mock `cloudflare:workers` with an `env`
 * object and pass it to `setup`. BETTER_AUTH_URL is `TOOLS_TEST_ORIGIN` when
 * set, so a test can serve the site on a port of its own.
 */

export const origin = process.env.TOOLS_TEST_ORIGIN ?? "http://127.0.0.1:3000"
export const resource = `${origin}/api`
export const redirectUri = "http://127.0.0.1:43123/callback"
export const verifier =
  "a-pkce-verifier-that-is-long-enough-to-be-valid-0123456789"

/** Answers GitHub's sign-in calls as user `id`; every other request goes out. */
export function stubGitHub(id: number) {
  const network = globalThis.fetch
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.startsWith("https://github.com/login/oauth/access_token"))
        return Response.json({
          access_token: "github-token",
          token_type: "bearer",
          scope: "read:user,user:email",
        })
      if (url === "https://api.github.com/user")
        return Response.json({
          id,
          login: "matthieu",
          name: "Matthieu",
          email: "matthieu@example.com",
          avatar_url: null,
        })
      if (url === "https://api.github.com/user/emails")
        return Response.json([
          { email: "matthieu@example.com", primary: true, verified: true },
        ])
      if (new URL(url).hostname.endsWith("github.com"))
        return new Response("Unexpected request", { status: 500 })
      return network(input, init)
    })
  )
}

/** A promise and the function that resolves it. */
export function signal() {
  let resolve: (() => void) | undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve: () => resolve?.() }
}

/**
 * A D1 that can hold back one kind of statement until released, to replay a
 * request interleaving the way two concurrent Worker requests can.
 */
export function pausableD1(binding: D1Database) {
  let paused:
    | { pattern: RegExp; reached: () => void; release: Promise<void> }
    | undefined
  const wrapped = {
    ...binding,
    batch: binding.batch.bind(binding),
    prepare: (query: string) => {
      const statement = binding.prepare(query)
      return {
        bind: (...values: Array<unknown>) => {
          const bound = statement.bind(...values)
          const hold = paused?.pattern.test(query) ? paused : undefined
          if (hold === undefined) return bound
          paused = undefined
          const later =
            <A>(run: () => Promise<A>) =>
            async () => {
              hold.reached()
              await hold.release
              return run()
            }
          return {
            ...bound,
            all: later(() => bound.all()),
            first: later(() => bound.first()),
            raw: later(() => bound.raw()),
            run: later(() => bound.run()),
          }
        },
      }
    },
  } as unknown as D1Database
  const pause = (pattern: RegExp) => {
    const reached = signal()
    const release = signal()
    paused = {
      pattern,
      reached: () => reached.resolve(),
      release: release.promise,
    }
    return { reached: reached.promise, release: () => release.resolve() }
  }
  return { binding: wrapped, pause }
}

/** Fresh bindings in `workerEnv`: D1 (pausable), R2, queue and email, and sign-in configuration. */
export function setup(workerEnv: Record<string, unknown>) {
  const d1 = makeTestD1()
  const pausable = pausableD1(d1.binding)
  for (const key of Object.keys(workerEnv)) delete workerEnv[key]
  Object.assign(workerEnv, {
    DB: pausable.binding,
    OWNER_ACCOUNTS: "github:42",
    BETTER_AUTH_SECRET: "test-secret-with-enough-entropy-1234567890",
    BETTER_AUTH_URL: origin,
    GITHUB_CLIENT_ID: "github-client",
    GITHUB_CLIENT_SECRET: "github-secret",
    SPOTIFY_CLIENT_ID: "spotify-client",
    SPOTIFY_CLIENT_SECRET: "spotify-secret",
    SPOTIFY_REDIRECT_URI: `${origin}/api/music/spotify/callback`,
    SPOTIFY_TOKEN_ENCRYPTION_KEY: btoa(
      String.fromCharCode(...new Uint8Array(32).fill(7))
    ),
    FILES: makeFakeR2(),
    JOBS: { send: vi.fn<(message: unknown) => Promise<void>>(async () => {}) },
    EMAIL: { send: vi.fn<(message: unknown) => Promise<void>>(async () => {}) },
    EMAIL_FROM: "tools@example.com",
  })
  const count = (sql: string, ...params: Array<string>) =>
    Number(d1.sqlite.prepare(sql).get(...params)?.count)
  return { d1, pause: pausable.pause, count }
}

/** Undoes `stubGitHub` and fake timers; call it after each test. */
export const restoreGlobals = () => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
}

export const cookiesOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ")

export const auth = (path: string, init?: RequestInit) =>
  Effect.promise(() =>
    handleAuthRequest(new Request(new URL(path, origin), init))
  )

export const json = (response: Response) =>
  Effect.promise(() => response.json() as Promise<Record<string, unknown>>)

export const pkceChallenge = Effect.promise(async () =>
  btoa(
    String.fromCharCode(
      ...new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(verifier)
        )
      )
    )
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
)

/** Registers a public native client the way Claude Code and Codex do: no application_type. */
export const register = Effect.gen(function* () {
  const response = yield* auth("/api/auth/oauth2/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Codex",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  })
  const body = yield* json(response)
  assert.strictEqual(response.status, 201, JSON.stringify(body))
  return String(body.client_id)
})

export const authorizeRequest = (
  clientId: string,
  options: { cookie?: string; params?: Record<string, string> } = {}
) =>
  Effect.gen(function* () {
    const params = new URLSearchParams(
      Object.entries({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: "tools offline_access",
        state: "state-1",
        code_challenge: yield* pkceChallenge,
        code_challenge_method: "S256",
        resource,
        ...options.params,
      }).filter(([, value]) => value !== "")
    )
    const response = yield* auth(`/api/auth/oauth2/authorize?${params}`, {
      headers:
        options.cookie === undefined
          ? { Accept: "text/html" }
          : { Accept: "text/html", Cookie: options.cookie },
    })
    assert.strictEqual(response.status, 302)
    return new URL(response.headers.get("Location") ?? "", origin)
  })

/** Signs in from the OAuth login page as its browser client does, through GitHub's callback. */
export const signInFromLoginPage = (login: URL) =>
  Effect.gen(function* () {
    const started = yield* auth("/api/auth/sign-in/social", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        provider: "github",
        callbackURL: "/",
        errorCallbackURL: `${login.pathname}${login.search}`,
        oauth_query: login.search.slice(1),
      }),
    })
    const { url } = (yield* json(started)) as { url: string }
    const state = new URL(url).searchParams.get("state") ?? ""
    const callback = yield* auth(
      `/api/auth/callback/github?code=code&state=${state}`,
      {
        headers: {
          Cookie: cookiesOf(started),
          "Sec-Fetch-Mode": "navigate",
          Accept: "text/html",
        },
      }
    )
    assert.strictEqual(callback.status, 302)
    return {
      next: new URL(callback.headers.get("Location") ?? "", origin),
      cookie: cookiesOf(callback),
    }
  })

export const answerConsent = (
  consentPage: URL,
  cookie: string,
  accept: boolean
) =>
  Effect.gen(function* () {
    const response = yield* auth("/api/auth/oauth2/consent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        Cookie: cookie,
      },
      body: JSON.stringify({
        accept,
        oauth_query: consentPage.search.slice(1),
      }),
    })
    const body = yield* json(response)
    assert.strictEqual(response.status, 200, JSON.stringify(body))
    return new URL(String(body.url))
  })

export const token = (
  values: Record<string, string>,
  headers: HeadersInit = {}
) =>
  Effect.gen(function* () {
    const response = yield* auth("/api/auth/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: new URLSearchParams(values).toString(),
    })
    return { status: response.status, body: yield* json(response) }
  })

export interface Tokens {
  readonly access: string
  readonly refresh: string
}

export const tokensOf = (body: Record<string, unknown>): Tokens => ({
  access: String(body.access_token),
  refresh: String(body.refresh_token),
})

export const exchange = (clientId: string, code: string, extra = {}) =>
  token({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
    resource,
    ...extra,
  })

export const refresh = (clientId: string, refreshToken: string) =>
  token({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  })

/** A first connection: registration, sign-in, consent, code exchange. */
export const connect = Effect.gen(function* () {
  const clientId = yield* register
  const login = yield* authorizeRequest(clientId)
  const signedIn = yield* signInFromLoginPage(login)
  const redirect = yield* answerConsent(signedIn.next, signedIn.cookie, true)
  const exchanged = yield* exchange(
    clientId,
    redirect.searchParams.get("code") ?? ""
  )
  assert.strictEqual(exchanged.status, 200, JSON.stringify(exchanged.body))
  return { clientId, cookie: signedIn.cookie, tokens: tokensOf(exchanged.body) }
})

/** Another code for an already consented client, without any page in between. */
export const codeFor = (clientId: string, cookie: string, params = {}) =>
  authorizeRequest(clientId, { cookie, params }).pipe(
    Effect.map((redirect) => {
      assert.strictEqual(`${redirect.origin}${redirect.pathname}`, redirectUri)
      return redirect.searchParams.get("code") ?? ""
    })
  )

export const call = (
  credentials: { bearer?: string; cookie?: string },
  init: { method?: string; origin?: string; url?: string } = {}
) =>
  Effect.promise(() =>
    authenticate(
      new Request(init.url ?? `${origin}/api/v1/flights.list`, {
        method: init.method ?? "GET",
        headers: {
          ...(credentials.bearer === undefined
            ? {}
            : { Authorization: `Bearer ${credentials.bearer}` }),
          ...(credentials.cookie === undefined
            ? {}
            : { Cookie: credentials.cookie }),
          ...(init.origin === undefined ? {} : { Origin: init.origin }),
        },
      })
    )
  )

export const callerOf = (result: Awaited<ReturnType<typeof authenticate>>) => {
  if (isRefusal(result))
    assert.fail(
      `refused with ${result.code} ${result.headers["WWW-Authenticate"]}`
    )
  return result
}

/** The status and challenge a refusal is sent with, or 200 for a caller. */
export const refusal = (result: Awaited<ReturnType<typeof authenticate>>) =>
  isRefusal(result)
    ? {
        status: errorStatus[result.code],
        challenge: result.headers["WWW-Authenticate"] ?? null,
      }
    : { status: 200, challenge: null }
