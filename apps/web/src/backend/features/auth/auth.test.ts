import { assert, describe, it } from "@effect/vitest"
import { ConfigProvider, Effect, Layer, Option } from "effect"
import { TestClock } from "effect/testing"
import { vi } from "vitest"
import { GitHub, type GitHubIdentity } from "@/backend/modules/github"
import { Database } from "@/backend/primitives/database"
import { makeTestD1 } from "@/backend/primitives/database/testing"
import { AuthStore, OwnerAuth, sessionLifetimeSeconds } from "."

const owner: GitHubIdentity = {
  id: "42",
  login: "matthieu",
  name: "Matthieu",
  avatarUrl: null,
}

function setup(ownerId = "42", d1 = makeTestD1()) {
  const identify = vi.fn<GitHub["Service"]["identify"]>(() =>
    Effect.succeed(owner)
  )
  const layer = OwnerAuth.layerNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(
        AuthStore.layer,
        Layer.succeed(
          GitHub,
          GitHub.of({ authorizationUrl: () => "https://github.test", identify })
        )
      )
    ),
    Layer.provide(Database.layer(d1.binding)),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({ GITHUB_OWNER_ID: ownerId })
      )
    )
  )
  const storedSessions = () =>
    d1.sqlite.prepare("SELECT token_hash FROM app_sessions").all()
  return {
    identify,
    storedSessions,
    d1,
    /** Runs with this configuration, keeping the database open for another setup. */
    use: <A, E>(body: Effect.Effect<A, E, OwnerAuth>) =>
      Effect.provide(body, layer),
    run: <A, E>(body: Effect.Effect<A, E, OwnerAuth>) =>
      body.pipe(Effect.provide(layer), Effect.ensuring(Effect.sync(d1.close))),
  }
}

describe("owner sign-in", () => {
  it.effect(
    "opens a session for the configured owner and stores only its hash",
    () => {
      const t = setup()
      return t.run(
        Effect.gen(function* () {
          const auth = yield* OwnerAuth
          const session = yield* auth.signIn("code")
          assert.deepStrictEqual(session.identity, owner)
          assert.notStrictEqual(session.sessionToken, session.csrfToken)
          const [stored] = t.storedSessions()
          assert.notStrictEqual(stored?.token_hash, session.sessionToken)
          assert.deepStrictEqual(
            yield* auth.currentOwner(session.sessionToken),
            Option.some(owner)
          )
        })
      )
    }
  )

  it.effect("refuses every other GitHub account without a session", () => {
    const t = setup()
    t.identify.mockReturnValue(Effect.succeed({ ...owner, id: "7" }))
    return t.run(
      Effect.gen(function* () {
        const auth = yield* OwnerAuth
        const error = yield* Effect.flip(auth.signIn("code"))
        assert.strictEqual(error._tag, "OwnerAccessDenied")
        assert.strictEqual(t.storedSessions().length, 0)
      })
    )
  })

  it.effect(
    "sessions expire, can be ended, and are unknown when forged",
    () => {
      const t = setup()
      return t.run(
        Effect.gen(function* () {
          const auth = yield* OwnerAuth
          const first = yield* auth.signIn("code")
          assert.isTrue(Option.isNone(yield* auth.currentOwner("forged")))

          yield* auth.signOut(first.sessionToken)
          assert.isTrue(
            Option.isNone(yield* auth.currentOwner(first.sessionToken))
          )

          const second = yield* auth.signIn("code")
          yield* TestClock.adjust((sessionLifetimeSeconds + 1) * 1000)
          assert.isTrue(
            Option.isNone(yield* auth.currentOwner(second.sessionToken))
          )
        })
      )
    }
  )
})

describe("owner configuration change", () => {
  it.effect("a session of a former owner no longer grants access", () => {
    const before = setup("42")
    const after = setup("43", before.d1)
    return Effect.gen(function* () {
      const session = yield* before.use(
        OwnerAuth.use((auth) => auth.signIn("code"))
      )
      const ownerUnder = (configuration: typeof before) =>
        configuration.use(
          OwnerAuth.use((auth) => auth.currentOwner(session.sessionToken))
        )
      assert.isTrue(Option.isSome(yield* ownerUnder(before)))
      assert.isTrue(Option.isNone(yield* ownerUnder(after)))
    }).pipe(Effect.ensuring(Effect.sync(before.d1.close)))
  })
})
