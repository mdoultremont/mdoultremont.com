import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import { Database } from "@/server/modules/database"
import { makeTestD1 } from "@/server/modules/database/testing"
import { Email, EmailError, type EmailMessage } from "@/server/modules/email"
import { sha256Hex } from "@/server/modules/hashing"
import { invitationLifetimeMs, UserDirectoryStore, Users } from "."

function setup(options: { readonly emailFails?: boolean } = {}) {
  const d1 = makeTestD1()
  const sent: Array<EmailMessage> = []
  const email = Layer.succeed(
    Email,
    Email.of({
      send: (message) =>
        options.emailFails
          ? Effect.fail(
              new EmailError({ code: "E_DELIVERY_FAILED", cause: "down" })
            )
          : Effect.sync(() => {
              sent.push(message)
            }),
    })
  )
  const layer = Users.layerNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(
        email,
        UserDirectoryStore.layer.pipe(Layer.provide(Database.layer(d1.binding)))
      )
    )
  )

  const addUser = (id: string, apps: ReadonlyArray<string>, sessions = 0) => {
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
    for (let index = 0; index < sessions; index++)
      d1.sqlite
        .prepare(
          "INSERT INTO auth_sessions (id, expires_at, token, created_at, updated_at, user_id) VALUES (?, 9999999999999, ?, 1, 1, ?)"
        )
        .run(`${id}-${index}`, `${id}-${index}`, id)
  }

  const appsOf = (userId: string) =>
    d1.sqlite
      .prepare("SELECT app FROM app_access WHERE user_id = ? ORDER BY app")
      .all(userId)
      .map((row) => row.app)

  const invitationRows = () =>
    d1.sqlite
      .prepare(
        "SELECT id, email, token_hash, apps, expires_at, invited_by FROM invitations ORDER BY created_at"
      )
      .all()

  return {
    d1,
    sent,
    addUser,
    appsOf,
    invitationRows,
    run: <A, E>(body: Effect.Effect<A, E, Users>) =>
      body.pipe(Effect.provide(layer), Effect.ensuring(Effect.sync(d1.close))),
  }
}

const tokenFrom = (message: EmailMessage | undefined) =>
  /token=([\w-]+)/u.exec(message?.text ?? "")?.[1] ?? ""

const failureTag = <A, E extends { readonly _tag: string }, R>(
  effect: Effect.Effect<A, E, R>
) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => error._tag)
  )

describe("inviting", () => {
  it.effect("saves the invitation and emails a link carrying its token", () => {
    const t = setup()
    t.addUser("owner", ["music", "backOffice"])
    return t.run(
      Effect.gen(function* () {
        yield* TestClock.setTime(1_000)
        const users = yield* Users
        yield* users.invite({
          email: "  Guest@Example.com ",
          apps: ["music"],
          invitedBy: "owner",
          origin: "https://mdoultremont.com",
        })

        assert.strictEqual(t.sent.length, 1)
        assert.strictEqual(t.sent[0]?.to, "guest@example.com")
        assert.include(
          t.sent[0]?.text ?? "",
          "https://mdoultremont.com/api/invitations/accept?token="
        )
        const [row] = t.invitationRows()
        assert.strictEqual(row?.email, "guest@example.com")
        assert.strictEqual(row?.apps, '["music"]')
        assert.strictEqual(row?.invited_by, "owner")
        assert.strictEqual(row?.expires_at, 1_000 + invitationLifetimeMs)
        // Only the hash is stored.
        assert.strictEqual(
          row?.token_hash,
          yield* sha256Hex(tokenFrom(t.sent[0]))
        )

        const { invitations } = yield* users.list()
        assert.deepStrictEqual(
          invitations.map(({ email, apps }) => ({ email, apps })),
          [{ email: "guest@example.com", apps: ["music"] }]
        )
      })
    )
  })

  it.effect("replaces an earlier invitation to the same email", () => {
    const t = setup()
    t.addUser("owner", ["backOffice"])
    return t.run(
      Effect.gen(function* () {
        const users = yield* Users
        const invite = (apps: ReadonlyArray<"music" | "backOffice">) =>
          users.invite({
            email: "guest@example.com",
            apps,
            invitedBy: "owner",
            origin: "https://mdoultremont.com",
          })
        yield* invite(["music"])
        yield* invite(["music", "backOffice"])
        assert.deepStrictEqual(
          t.invitationRows().map((row) => row.apps),
          ['["music","backOffice"]']
        )
      })
    )
  })

  it.effect("refuses bad input and existing users", () => {
    const t = setup()
    t.addUser("friend", ["music"])
    return t.run(
      Effect.gen(function* () {
        const users = yield* Users
        const invite = (email: string, apps: ReadonlyArray<"music">) =>
          failureTag(
            users.invite({
              email,
              apps,
              invitedBy: "owner",
              origin: "https://mdoultremont.com",
            })
          )
        assert.strictEqual(
          yield* invite("not an email", ["music"]),
          "UserInputError"
        )
        assert.strictEqual(
          yield* invite("guest@example.com", []),
          "UserInputError"
        )
        assert.strictEqual(
          yield* invite("friend@example.com", ["music"]),
          "AlreadyAUser"
        )
        assert.strictEqual(t.sent.length, 0)
      })
    )
  })

  it.effect("keeps no invitation whose email could not be sent", () => {
    const t = setup({ emailFails: true })
    t.addUser("owner", ["backOffice"])
    return t.run(
      Effect.gen(function* () {
        const users = yield* Users
        assert.strictEqual(
          yield* failureTag(
            users.invite({
              email: "guest@example.com",
              apps: ["music"],
              invitedBy: "owner",
              origin: "https://mdoultremont.com",
            })
          ),
          "EmailError"
        )
        assert.strictEqual(t.invitationRows().length, 0)
      })
    )
  })

  it.effect("sends a new link that replaces the old one, and revokes", () => {
    const t = setup()
    t.addUser("owner", ["backOffice"])
    return t.run(
      Effect.gen(function* () {
        const users = yield* Users
        yield* users.invite({
          email: "guest@example.com",
          apps: ["music"],
          invitedBy: "owner",
          origin: "https://mdoultremont.com",
        })
        const [before] = t.invitationRows()
        const id = String(before?.id)
        yield* TestClock.setTime(5_000)
        yield* users.resendInvitation({
          invitationId: id,
          origin: "https://mdoultremont.com",
        })
        const [after] = t.invitationRows()
        assert.strictEqual(t.sent.length, 2)
        assert.notStrictEqual(after?.token_hash, before?.token_hash)
        assert.strictEqual(
          after?.token_hash,
          yield* sha256Hex(tokenFrom(t.sent[1]))
        )
        assert.strictEqual(after?.expires_at, 5_000 + invitationLifetimeMs)

        yield* users.revokeInvitation(id)
        assert.strictEqual(t.invitationRows().length, 0)
        assert.strictEqual(
          yield* failureTag(users.revokeInvitation(id)),
          "InvitationNotFound"
        )
        assert.strictEqual(
          yield* failureTag(
            users.resendInvitation({
              invitationId: id,
              origin: "https://mdoultremont.com",
            })
          ),
          "InvitationNotFound"
        )
      })
    )
  })
})

describe("app access", () => {
  it.effect("replaces a user's apps", () => {
    const t = setup()
    t.addUser("owner", ["music", "backOffice"])
    t.addUser("friend", ["music"])
    return t.run(
      Effect.gen(function* () {
        const users = yield* Users
        yield* users.setAccess({
          actorId: "owner",
          userId: "friend",
          apps: ["backOffice"],
        })
        assert.deepStrictEqual(t.appsOf("friend"), ["backOffice"])
        yield* users.setAccess({ actorId: "owner", userId: "friend", apps: [] })
        assert.deepStrictEqual(t.appsOf("friend"), [])
        assert.strictEqual(
          yield* failureTag(
            users.setAccess({ actorId: "owner", userId: "ghost", apps: [] })
          ),
          "UserNotFound"
        )
      })
    )
  })

  it.effect("never removes your own back office access", () => {
    const t = setup()
    t.addUser("owner", ["music", "backOffice"])
    t.addUser("friend", ["backOffice"])
    return t.run(
      Effect.gen(function* () {
        const users = yield* Users
        assert.strictEqual(
          yield* failureTag(
            users.setAccess({
              actorId: "owner",
              userId: "owner",
              apps: ["music"],
            })
          ),
          "OwnAccessProtected"
        )
        assert.deepStrictEqual(t.appsOf("owner"), ["backOffice", "music"])
        // Your other apps are yours to change.
        yield* users.setAccess({
          actorId: "owner",
          userId: "owner",
          apps: ["backOffice"],
        })
        assert.deepStrictEqual(t.appsOf("owner"), ["backOffice"])
      })
    )
  })

  it.effect("always leaves someone with the back office", () => {
    const t = setup()
    t.addUser("last", ["backOffice"])
    t.addUser("friend", ["music"])
    return t.run(
      Effect.gen(function* () {
        const users = yield* Users
        // Only reachable without the self-check, e.g. through a stale page.
        assert.strictEqual(
          yield* failureTag(
            users.setAccess({ actorId: "friend", userId: "last", apps: [] })
          ),
          "LastBackOfficeUser"
        )
        assert.deepStrictEqual(t.appsOf("last"), ["backOffice"])
        assert.strictEqual(
          yield* failureTag(
            users.remove({ actorId: "friend", userId: "last" })
          ),
          "LastBackOfficeUser"
        )
      })
    )
  })
})

describe("removing users", () => {
  it.effect("signs them out and drops their access, but keeps the user", () => {
    const t = setup()
    t.addUser("owner", ["music", "backOffice"])
    t.addUser("friend", ["music", "backOffice"], 2)
    return t.run(
      Effect.gen(function* () {
        yield* TestClock.setTime(42)
        const users = yield* Users
        yield* users.remove({ actorId: "owner", userId: "friend" })
        assert.deepStrictEqual(t.appsOf("friend"), [])
        assert.strictEqual(
          t.d1.sqlite
            .prepare("SELECT deleted_at FROM auth_users WHERE id = 'friend'")
            .get()?.deleted_at,
          42
        )
        assert.strictEqual(
          t.d1.sqlite
            .prepare(
              "SELECT count(*) AS sessions FROM auth_sessions WHERE user_id = 'friend'"
            )
            .get()?.sessions,
          0
        )
        const { users: listed } = yield* users.list()
        assert.deepStrictEqual(
          listed.map((user) => user.id),
          ["owner"]
        )
        assert.strictEqual(
          yield* failureTag(
            users.remove({ actorId: "owner", userId: "friend" })
          ),
          "UserNotFound"
        )
      })
    )
  })

  it.effect("never removes yourself", () => {
    const t = setup()
    t.addUser("owner", ["backOffice"])
    t.addUser("friend", ["backOffice"])
    return t.run(
      Effect.gen(function* () {
        const users = yield* Users
        assert.strictEqual(
          yield* failureTag(
            users.remove({ actorId: "owner", userId: "owner" })
          ),
          "OwnAccessProtected"
        )
      })
    )
  })
})
