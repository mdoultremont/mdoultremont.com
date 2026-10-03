import { Context, Effect } from "effect"

export interface GitHubIdentity {
  readonly id: string
  readonly login: string
  readonly name: string | null
  readonly avatarUrl: string | null
}

export interface OwnerSession {
  readonly identity: GitHubIdentity
  readonly sessionHash: string
  readonly expiresAt: number
}

export class OwnerAccessDenied extends Error {
  readonly _tag = "OwnerAccessDenied"

  constructor() {
    super("This GitHub account is not allowed to use the private music area")
    this.name = "OwnerAccessDenied"
  }
}

export class AuthPersistenceError extends Error {
  readonly _tag = "AuthPersistenceError"

  constructor(cause: unknown) {
    super("Could not persist the owner session", { cause })
    this.name = "AuthPersistenceError"
  }
}

export class AppAuthStore extends Context.Service<
  AppAuthStore,
  {
    readonly saveOwnerSession: (
      session: OwnerSession
    ) => Effect.Effect<void, AuthPersistenceError>
    readonly findOwnerSession: (input: {
      readonly sessionHash: string
      readonly now: number
    }) => Effect.Effect<GitHubIdentity | null, AuthPersistenceError>
    readonly revokeSession: (
      sessionHash: string
    ) => Effect.Effect<void, AuthPersistenceError>
  }
>()("portfolio/AppAuthStore") {}

export function completeOwnerSignIn(input: {
  readonly identity: GitHubIdentity
  readonly configuredOwnerId: string
  readonly sessionHash: string
  readonly expiresAt: number
}): Effect.Effect<
  GitHubIdentity,
  OwnerAccessDenied | AuthPersistenceError,
  AppAuthStore
> {
  return Effect.gen(function* () {
    if (input.identity.id !== input.configuredOwnerId)
      return yield* Effect.fail(new OwnerAccessDenied())

    const store = yield* AppAuthStore
    yield* store.saveOwnerSession({
      identity: input.identity,
      sessionHash: input.sessionHash,
      expiresAt: input.expiresAt,
    })
    return input.identity
  })
}

export function findOwnerSession(input: {
  readonly sessionHash: string
  readonly now: number
}): Effect.Effect<GitHubIdentity | null, AuthPersistenceError, AppAuthStore> {
  return Effect.gen(function* () {
    const store = yield* AppAuthStore
    return yield* store.findOwnerSession(input)
  })
}

export function requireOwnerSession(input: {
  readonly sessionHash: string
  readonly now: number
}): Effect.Effect<
  GitHubIdentity,
  OwnerAccessDenied | AuthPersistenceError,
  AppAuthStore
> {
  return Effect.gen(function* () {
    const identity = yield* findOwnerSession(input)
    if (!identity) return yield* Effect.fail(new OwnerAccessDenied())
    return identity
  })
}

export function endOwnerSession(
  sessionHash: string
): Effect.Effect<void, AuthPersistenceError, AppAuthStore> {
  return Effect.gen(function* () {
    const store = yield* AppAuthStore
    yield* store.revokeSession(sessionHash)
  })
}
