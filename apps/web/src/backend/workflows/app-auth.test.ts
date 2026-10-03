import { Effect, Exit, Layer } from "effect"
import { beforeEach, describe, expect, test, vi } from "vitest"
import {
  AppAuthStore,
  type AuthPersistenceError,
  completeOwnerSignIn,
  requireOwnerSession,
  type GitHubIdentity,
  type OwnerSession,
} from "./app-auth"

const store = vi.hoisted(() => ({
  saveOwnerSession:
    vi.fn<
      (session: OwnerSession) => Effect.Effect<void, AuthPersistenceError>
    >(),
  findOwnerSession:
    vi.fn<
      (input: {
        sessionHash: string
        now: number
      }) => Effect.Effect<GitHubIdentity | null, AuthPersistenceError>
    >(),
  revokeSession:
    vi.fn<(sessionHash: string) => Effect.Effect<void, AuthPersistenceError>>(),
}))

beforeEach(() => {
  vi.resetAllMocks()
  store.saveOwnerSession.mockReturnValue(Effect.void)
  store.findOwnerSession.mockReturnValue(Effect.succeed(null))
  store.revokeSession.mockReturnValue(Effect.void)
})

const testLayer = Layer.succeed(AppAuthStore, {
  saveOwnerSession: store.saveOwnerSession,
  findOwnerSession: store.findOwnerSession,
  revokeSession: store.revokeSession,
})

describe("GitHub owner sign-in", () => {
  test("persists a session for the configured owner account", async () => {
    const identity = {
      id: "github-owner-42",
      login: "matthieu",
      name: "Matthieu",
      avatarUrl: "https://avatars.githubusercontent.com/u/42",
    }

    const owner = await Effect.runPromise(
      Effect.provide(
        completeOwnerSignIn({
          identity,
          configuredOwnerId: "github-owner-42",
          sessionHash: "opaque-session-hash",
          expiresAt: 2_000_000_000,
        }),
        testLayer
      )
    )

    expect(owner).toEqual(identity)
    expect(store.saveOwnerSession).toHaveBeenCalledWith({
      identity,
      sessionHash: "opaque-session-hash",
      expiresAt: 2_000_000_000,
    })
  })

  test("rejects other GitHub accounts without persisting a session", async () => {
    const result = await Effect.runPromiseExit(
      Effect.provide(
        completeOwnerSignIn({
          identity: {
            id: "github-other-7",
            login: "someone-else",
            name: null,
            avatarUrl: null,
          },
          configuredOwnerId: "github-owner-42",
          sessionHash: "opaque-session-hash",
          expiresAt: 2_000_000_000,
        }),
        testLayer
      )
    )

    expect(Exit.isFailure(result)).toBe(true)
    expect(store.saveOwnerSession).not.toHaveBeenCalled()
  })

  test("rejects missing or expired sessions before private actions run", async () => {
    const result = await Effect.runPromiseExit(
      Effect.provide(
        requireOwnerSession({
          sessionHash: "expired-session-hash",
          now: 2_000_000_001,
        }),
        testLayer
      )
    )

    expect(Exit.isFailure(result)).toBe(true)
    expect(store.findOwnerSession).toHaveBeenCalledWith({
      sessionHash: "expired-session-hash",
      now: 2_000_000_001,
    })
  })
})
