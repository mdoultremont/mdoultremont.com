import { vi } from "vitest"
import type { Caller } from "@/server/entrypoints/actions"
import { makeTestD1 } from "@/server/modules/database/testing"
import { makeFakeR2 } from "@/server/modules/object-storage/testing"
import { createActionsClient } from "@/shared/actions/client"
import type { App } from "@/shared/apps"
import { platformLayer } from "../../platform"
import { refusal } from "../oauth"
import { type ApiOptions, createApi } from "."

export const origin = "https://tools.example"

/**
 * The real API on an in-memory D1, a fake R2 bucket, and recording queue and
 * email bindings, with the caller chosen by the test. Test files must mock
 * `cloudflare:workers` before importing this.
 */
export function makeHarness(options: Omit<ApiOptions, "platform"> = {}) {
  const d1 = makeTestD1()
  const jobs = vi.fn<(message: unknown) => Promise<void>>(async () => {})
  const emails = vi.fn<
    (message: { to: string; text: string }) => Promise<void>
  >(async () => {})
  const bindings = {
    DB: d1.binding,
    FILES: makeFakeR2(),
    JOBS: { send: jobs },
    EMAIL: { send: emails },
    EMAIL_FROM: "tools@example.com",
    SPOTIFY_CLIENT_ID: "client",
    SPOTIFY_CLIENT_SECRET: "secret",
    SPOTIFY_REDIRECT_URI: `${origin}/api/music/spotify/callback`,
    SPOTIFY_TOKEN_ENCRYPTION_KEY: btoa(
      String.fromCharCode(...new Uint8Array(32).fill(7))
    ),
  } as unknown as Cloudflare.Env
  const state: { caller: Caller | null } = { caller: null }
  const fallback = vi.fn<(request: Request) => Response>(
    () => new Response("tanstack", { status: 218 })
  )
  const app = createApi(fallback, {
    authenticate: async () =>
      state.caller ?? refusal("UNAUTHORIZED", "Sign-in required"),
    ...options,
    platform: () => platformLayer(bindings),
  })
  const fetch = async (request: Request) => app.fetch(request)

  return {
    app,
    d1,
    jobs,
    emails,
    fallback,
    /** Calls as `userId` with access to `apps`, signed in with the session cookie. */
    signIn: (apps: ReadonlyArray<App>, userId = "owner") => {
      state.caller = { userId, apps, origin }
    },
    signOut: () => {
      state.caller = null
    },
    /** The browser's client, sending this site's Origin. */
    client: createActionsClient({
      url: `${origin}/api/rpc`,
      headers: { Origin: origin },
      fetch,
    }),
    request: (path: string, init: RequestInit = {}) =>
      app.fetch(new Request(`${origin}${path}`, init)),
    close: () => d1.close(),
  }
}

/** The code of an `ORPCError` a call fails with, or `ok`. */
export const code = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (error: unknown) =>
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "other"
  )

/** Inserts a user with app access, as sign-in would have left them. */
export const seedUser = (
  d1: ReturnType<typeof makeTestD1>,
  id: string,
  apps: ReadonlyArray<App>
) => {
  d1.sqlite
    .prepare(
      "INSERT INTO auth_users (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, 1, 1)"
    )
    .run(id, id, `${id}@example.com`)
  for (const app of apps)
    d1.sqlite
      .prepare(
        "INSERT INTO app_access (user_id, app, granted_at) VALUES (?, ?, 1)"
      )
      .run(id, app)
}
