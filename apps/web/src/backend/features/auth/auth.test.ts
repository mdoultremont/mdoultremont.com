import { assert, describe, it } from "@effect/vitest"
import { ConfigProvider, Effect, Layer, Option } from "effect"
import {
  AuthGate,
  type AuthSession,
  BetterAuth,
  type SignInAttempt,
} from "@/backend/modules/better-auth"
import { Database } from "@/backend/modules/database"
import { makeTestD1 } from "@/backend/modules/database/testing"
import { sha256Hex } from "@/backend/modules/hashing"
import { AccessGate, AuthStore, UserAuth } from "."

const config = ConfigProvider.layer(
  ConfigProvider.fromUnknown({ OWNER_ACCOUNTS: "github:42,spotify:matthieu" })
)

function setup() {
  const d1 = makeTestD1()
  let session = Option.none<AuthSession>()
  const betterAuth = Layer.succeed(
    BetterAuth,
    BetterAuth.of({
      handler: () => Effect.succeed(new Response()),
      session: () => Effect.succeed(session),
    })
  )
  const store = AuthStore.layer.pipe(Layer.provide(Database.layer(d1.binding)))
  const layer = Layer.mergeAll(
    UserAuth.layerNoDeps.pipe(Layer.provide(betterAuth)),
    AccessGate
  ).pipe(Layer.provide(store), Layer.provide(config))

  const addUser = (
    id: string,
    options: {
      readonly accounts?: ReadonlyArray<string>
      readonly apps?: ReadonlyArray<string>
      readonly removed?: boolean
    } = {}
  ) => {
    d1.sqlite
      .prepare(
        "INSERT INTO auth_users (id, name, email, email_verified, created_at, updated_at, deleted_at) VALUES (?, ?, ?, 1, 1, 1, ?)"
      )
      .run(id, id, `${id}@example.com`, options.removed ? 1 : null)
    for (const account of options.accounts ?? []) {
      const [provider, accountId] = account.split(":")
      d1.sqlite
        .prepare(
          "INSERT INTO auth_accounts (id, account_id, provider_id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)"
        )
        .run(`${id}-${account}`, accountId ?? "", provider ?? "", id)
    }
    for (const app of options.apps ?? [])
      d1.sqlite
        .prepare(
          "INSERT INTO app_access (user_id, app, granted_at) VALUES (?, ?, 1)"
        )
        .run(id, app)
  }

  const addInvitation = (
    token: string,
    options: {
      readonly apps?: ReadonlyArray<string>
      readonly expiresAt?: number
    } = {}
  ) =>
    sha256Hex(token).pipe(
      Effect.map((hash) =>
        d1.sqlite
          .prepare(
            "INSERT INTO invitations (id, email, token_hash, apps, created_at, expires_at) VALUES (?, ?, ?, ?, 0, ?)"
          )
          .run(
            `invitation-${token}`,
            "guest@example.com",
            hash,
            JSON.stringify(options.apps ?? ["music"]),
            options.expiresAt ?? 1_000
          )
      )
    )

  const appsOf = (userId: string) =>
    d1.sqlite
      .prepare("SELECT app FROM app_access WHERE user_id = ? ORDER BY app")
      .all(userId)
      .map((row) => row.app)

  return {
    d1,
    addUser,
    addInvitation,
    appsOf,
    signInAs: (userId: string) => {
      session = Option.some({
        sessionId: "session",
        user: {
          id: userId,
          name: userId,
          email: `${userId}@example.com`,
          image: null,
        },
      })
    },
    run: <A, E>(body: Effect.Effect<A, E, UserAuth | AuthGate>) =>
      body.pipe(Effect.provide(layer), Effect.ensuring(Effect.sync(d1.close))),
  }
}

const attempt = (
  account: string,
  action: SignInAttempt["action"] = "sign-in",
  invitation?: string
): SignInAttempt => {
  const [provider = "", accountId = ""] = account.split(":")
  return {
    provider,
    accountId,
    action,
    headers: new Headers(
      invitation === undefined ? {} : { Cookie: `invitation=${invitation}` }
    ),
  }
}

const rejection = (attempted: SignInAttempt) =>
  AuthGate.use((gate) => gate.admit(attempted)).pipe(
    Effect.flip,
    Effect.map((error) => error.code),
    Effect.orElseSucceed(() => "admitted")
  )

const startSession = (userId: string, invitation?: string) =>
  AuthGate.use((gate) =>
    gate.sessionStarting(
      userId,
      new Headers(
        invitation === undefined ? {} : { Cookie: `invitation=${invitation}` }
      )
    )
  )

describe("sign-in gate", () => {
  it.effect(
    "lets users sign in again, but not removed users or strangers",
    () => {
      const t = setup()
      t.addUser("owner", { accounts: ["github:42"], apps: ["backOffice"] })
      t.addUser("friend", { accounts: ["spotify:friend"], apps: ["music"] })
      t.addUser("former", { accounts: ["github:7"], removed: true })
      return t.run(
        Effect.gen(function* () {
          assert.strictEqual(yield* rejection(attempt("github:42")), "admitted")
          assert.strictEqual(
            yield* rejection(attempt("spotify:friend")),
            "admitted"
          )
          assert.strictEqual(
            yield* rejection(attempt("github:7")),
            "not_allowed"
          )
          assert.strictEqual(
            yield* rejection(attempt("github:99")),
            "not_allowed"
          )
          // Same ID on another provider is another person.
          assert.strictEqual(
            yield* rejection(attempt("spotify:42")),
            "not_allowed"
          )
          // Linking happens from a signed-in session.
          assert.strictEqual(
            yield* rejection(attempt("spotify:new", "link-account")),
            "admitted"
          )
        })
      )
    }
  )

  it.effect("creates users only with a pending invitation", () => {
    const t = setup()
    t.addUser("owner", { accounts: ["github:42"], apps: ["backOffice"] })
    return t.run(
      Effect.gen(function* () {
        yield* t.addInvitation("valid")
        yield* t.addInvitation("old", { expiresAt: 0 })
        assert.strictEqual(
          yield* rejection(attempt("github:99", "create-user")),
          "invitation_required"
        )
        assert.strictEqual(
          yield* rejection(attempt("github:99", "create-user", "wrong")),
          "invitation_required"
        )
        assert.strictEqual(
          yield* rejection(attempt("github:99", "create-user", "old")),
          "invitation_required"
        )
        assert.strictEqual(
          yield* rejection(attempt("github:99", "create-user", "valid")),
          "admitted"
        )
        // Even the owner's other accounts need an invitation once someone has the back office.
        assert.strictEqual(
          yield* rejection(attempt("spotify:matthieu", "create-user")),
          "invitation_required"
        )
      })
    )
  })

  it.effect("accepts the invitation when the session starts, once", () => {
    const t = setup()
    t.addUser("owner", { accounts: ["github:42"], apps: ["backOffice"] })
    t.addUser("guest", { accounts: ["github:99"] })
    t.addUser("late", { accounts: ["github:98"] })
    return t.run(
      Effect.gen(function* () {
        yield* t.addInvitation("valid", { apps: ["music", "backOffice"] })
        yield* startSession("guest", "valid")
        assert.deepStrictEqual(t.appsOf("guest"), ["backOffice", "music"])
        assert.strictEqual(
          t.d1.sqlite.prepare("SELECT accepted_by FROM invitations").get()
            ?.accepted_by,
          "guest"
        )

        // The same link no longer admits or grants anything.
        assert.strictEqual(
          yield* rejection(attempt("github:97", "create-user", "valid")),
          "invitation_required"
        )
        yield* startSession("late", "valid")
        assert.deepStrictEqual(t.appsOf("late"), [])
      })
    )
  })

  it.effect("lets an invitation restore a removed user", () => {
    const t = setup()
    t.addUser("owner", { accounts: ["github:42"], apps: ["backOffice"] })
    t.addUser("former", { accounts: ["github:7"], removed: true })
    return t.run(
      Effect.gen(function* () {
        yield* t.addInvitation("again")
        assert.strictEqual(
          yield* rejection(attempt("github:7", "sign-in", "again")),
          "admitted"
        )
        yield* startSession("former", "again")
        assert.deepStrictEqual(t.appsOf("former"), ["music"])
        assert.strictEqual(yield* rejection(attempt("github:7")), "admitted")
      })
    )
  })

  it.effect(
    "gives the owner every app while nobody has the back office",
    () => {
      const t = setup()
      return t.run(
        Effect.gen(function* () {
          assert.strictEqual(
            yield* rejection(attempt("github:42", "create-user")),
            "admitted"
          )
          assert.strictEqual(
            yield* rejection(attempt("github:99", "create-user")),
            "invitation_required"
          )
          t.addUser("owner", { accounts: ["github:42"] })
          t.addUser("stranger", { accounts: ["github:99"] })
          yield* startSession("stranger")
          assert.deepStrictEqual(t.appsOf("stranger"), [])
          yield* startSession("owner")
          assert.deepStrictEqual(t.appsOf("owner"), ["backOffice", "music"])
        })
      )
    }
  )
})

describe("current user", () => {
  it.effect("is the signed-in user with their apps, unless removed", () => {
    const t = setup()
    t.addUser("owner", {
      accounts: ["github:42", "spotify:matthieu"],
      apps: ["music", "backOffice"],
    })
    t.addUser("friend", { accounts: ["github:8"], apps: ["music"] })
    t.addUser("former", {
      accounts: ["github:7"],
      apps: ["music"],
      removed: true,
    })
    return t.run(
      Effect.gen(function* () {
        const auth = yield* UserAuth
        const headers = new Headers()
        assert.isTrue(Option.isNone(yield* auth.currentUser(headers)))

        t.signInAs("owner")
        assert.deepStrictEqual(
          Option.map(
            yield* auth.currentUser(headers),
            ({ id, providers, apps, sessionId }) => ({
              id,
              providers: new Set(providers),
              apps: [...apps],
              sessionId,
            })
          ),
          Option.some({
            id: "owner",
            providers: new Set(["github", "spotify"]),
            apps: ["music", "backOffice"],
            sessionId: "session",
          })
        )

        // A removed user's older sessions grant nothing.
        t.signInAs("former")
        assert.isTrue(Option.isNone(yield* auth.currentUser(headers)))

        assert.deepStrictEqual(
          new Set(yield* auth.userIds("music")),
          new Set(["friend", "owner"])
        )
        assert.deepStrictEqual(yield* auth.userIds("backOffice"), ["owner"])
      })
    )
  })

  it.effect("accepts an invitation for a user who is already signed in", () => {
    const t = setup()
    t.addUser("owner", { accounts: ["github:42"], apps: ["backOffice"] })
    return t.run(
      Effect.gen(function* () {
        const auth = yield* UserAuth
        yield* t.addInvitation("valid")
        assert.isTrue(yield* auth.hasPendingInvitation("valid"))
        assert.isFalse(yield* auth.hasPendingInvitation("wrong"))
        assert.isTrue(
          yield* auth.acceptInvitation({ token: "valid", userId: "owner" })
        )
        assert.deepStrictEqual(t.appsOf("owner"), ["backOffice", "music"])
        assert.isFalse(yield* auth.hasPendingInvitation("valid"))
        assert.isFalse(
          yield* auth.acceptInvitation({ token: "valid", userId: "owner" })
        )
      })
    )
  })
})
