import { assert, describe, it } from "@effect/vitest"
import { ConfigProvider, Effect, Layer, Option } from "effect"
import {
  AuthGate,
  type AuthSession,
  BetterAuth,
  type SignInAttempt,
} from "@/backend/modules/better-auth"
import { Database } from "@/backend/primitives/database"
import { makeTestD1 } from "@/backend/primitives/database/testing"
import { AuthStore, OwnerAuth, OwnerGate } from "."

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
    OwnerAuth.layerNoDeps.pipe(Layer.provide(betterAuth)),
    OwnerGate
  ).pipe(Layer.provide(store), Layer.provide(config))

  const addUser = (id: string, ...accounts: string[]) => {
    d1.sqlite
      .prepare(
        "INSERT INTO auth_users (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, 1, 1)"
      )
      .run(id, id, `${id}@example.com`)
    for (const account of accounts) {
      const [provider, accountId] = account.split(":")
      d1.sqlite
        .prepare(
          "INSERT INTO auth_accounts (id, account_id, provider_id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)"
        )
        .run(`${id}-${account}`, accountId ?? "", provider ?? "", id)
    }
  }

  return {
    addUser,
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
    run: <A, E>(body: Effect.Effect<A, E, OwnerAuth | AuthGate>) =>
      body.pipe(Effect.provide(layer), Effect.ensuring(Effect.sync(d1.close))),
  }
}

const attempt = (
  account: string,
  action: SignInAttempt["action"] = "sign-in"
): SignInAttempt => {
  const [provider = "", accountId = ""] = account.split(":")
  return { provider, accountId, action }
}

const rejection = (attempted: SignInAttempt) =>
  AuthGate.use((gate) => gate.admit(attempted)).pipe(
    Effect.flip,
    Effect.map((error) => error.code),
    Effect.orElseSucceed(() => "admitted")
  )

describe("owner sign-in gate", () => {
  it.effect("admits only the owner's accounts", () => {
    const t = setup()
    return t.run(
      Effect.gen(function* () {
        assert.strictEqual(yield* rejection(attempt("github:42")), "admitted")
        assert.strictEqual(
          yield* rejection(attempt("spotify:matthieu", "link-account")),
          "admitted"
        )
        assert.strictEqual(yield* rejection(attempt("github:7")), "not_allowed")
        // Same ID on another provider is another person.
        assert.strictEqual(
          yield* rejection(attempt("spotify:42")),
          "not_allowed"
        )
      })
    )
  })

  it.effect(
    "creates the owner once; another method must be linked, not a second user",
    () => {
      const t = setup()
      return t.run(
        Effect.gen(function* () {
          assert.strictEqual(
            yield* rejection(attempt("github:42", "create-user")),
            "admitted"
          )
          t.addUser("owner", "github:42")
          assert.strictEqual(
            yield* rejection(attempt("spotify:matthieu", "create-user")),
            "link_required"
          )
          assert.strictEqual(
            yield* rejection(attempt("spotify:matthieu", "link-account")),
            "admitted"
          )
        })
      )
    }
  )
})

describe("current owner", () => {
  it.effect(
    "is the signed-in user while one of their accounts is the owner's",
    () => {
      const t = setup()
      t.addUser("owner", "github:42", "spotify:matthieu")
      t.addUser("former", "github:7")
      return t.run(
        Effect.gen(function* () {
          const auth = yield* OwnerAuth
          const headers = new Headers()
          assert.isTrue(Option.isNone(yield* auth.currentOwner(headers)))

          t.signInAs("owner")
          const owner = yield* auth.currentOwner(headers)
          assert.isTrue(Option.isSome(owner))
          assert.deepStrictEqual(
            Option.map(owner, ({ id, providers, sessionId }) => ({
              id,
              providers: new Set(providers),
              sessionId,
            })),
            Option.some({
              id: "owner",
              providers: new Set(["github", "spotify"]),
              sessionId: "session",
            })
          )

          // A session whose accounts were removed from OWNER_ACCOUNTS grants nothing.
          t.signInAs("former")
          assert.isTrue(Option.isNone(yield* auth.currentOwner(headers)))

          assert.deepStrictEqual(yield* auth.ownerIds(), ["owner"])
        })
      )
    }
  )
})
