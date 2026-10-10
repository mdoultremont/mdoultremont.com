import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

/**
 * Test-only D1 stand-in: an in-memory SQLite database with every migration
 * applied, exposing the parts of the D1 binding that Drizzle uses.
 * Not exported from the primitive's index because it depends on `node:sqlite`.
 */
export function makeTestD1() {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec("PRAGMA foreign_keys = ON")
  const migrations = new URL("../../../../migrations/", import.meta.url)
  for (const file of readdirSync(migrations)
    .filter((name) => name.endsWith(".sql"))
    // oxlint-disable-next-line unicorn/no-array-sort -- this freshly read migration list has no other consumers
    .sort())
    sqlite.exec(readFileSync(new URL(file, migrations), "utf8"))

  type Params = Parameters<ReturnType<typeof sqlite.prepare>["all"]>

  const bound = (query: string, values: unknown[]) => {
    // D1 rejects statements with more than 100 bound parameters; SQLite does not.
    if (values.length > 100)
      throw new Error(
        `D1 allows at most 100 bound parameters, got ${values.length}`
      )
    const statement = sqlite.prepare(query)
    const params = values as Params
    const run = () => ({
      success: true,
      results: [],
      meta: { changes: Number(statement.run(...params).changes) },
    })
    const all = () => ({
      success: true,
      results: statement.all(...params),
      meta: { changes: 0 },
    })
    return {
      all: async () => all(),
      first: async () => statement.get(...params) ?? null,
      raw: async () => {
        statement.setReturnArrays(true)
        return statement.all(...params)
      },
      run: async () => run(),
      /** Used by `batch`: row-returning statements report rows, others report changes. */
      execute: () => (statement.columns().length > 0 ? all() : run()),
    }
  }

  const binding = {
    prepare: (query: string) => ({
      bind: (...values: unknown[]) => bound(query, values),
    }),
    batch: async (statements: ReturnType<typeof bound>[]) => {
      sqlite.exec("BEGIN")
      try {
        const results = statements.map((statement) => statement.execute())
        sqlite.exec("COMMIT")
        return results
      } catch (error) {
        sqlite.exec("ROLLBACK")
        throw error
      }
    },
  } as unknown as D1Database

  /** Inserts the owner and Spotify connection rows that music tables reference. */
  const seedOwner = (ownerId = "owner") => {
    sqlite
      .prepare(
        "INSERT INTO auth_users (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, 1, 1)"
      )
      .run(ownerId, ownerId, `${ownerId}@example.com`)
    sqlite
      .prepare(
        "INSERT INTO spotify_connections (owner_id, account_id, display_name, encrypted_refresh_token, scopes, connected_at, needs_reconnect, spotify_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        ownerId,
        "account",
        null,
        "encrypted",
        "scopes",
        1,
        0,
        "spotify-user"
      )
  }

  return { sqlite, binding, seedOwner, close: () => sqlite.close() }
}
