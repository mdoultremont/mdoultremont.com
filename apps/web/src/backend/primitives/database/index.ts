import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1"
import { Context, Data, Effect, Layer } from "effect"
import * as schema from "./schema"

export * from "./schema"

export type Drizzle = DrizzleD1Database<typeof schema>

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly cause: unknown
}> {
  override get message() {
    return "Database query failed"
  }
}

/** D1 access through Drizzle. Callers own the queries; this only turns promises into typed Effects. */
export class Database extends Context.Service<
  Database,
  {
    readonly use: <A>(
      query: (db: Drizzle) => Promise<A>
    ) => Effect.Effect<A, DatabaseError>
  }
>()("backend/primitives/Database") {
  static readonly layer = (binding: D1Database) =>
    Layer.sync(Database, () => {
      const db = drizzle(binding, { schema })
      return Database.of({
        use: (query) =>
          Effect.tryPromise({
            try: () => query(db),
            catch: (cause) => new DatabaseError({ cause }),
          }),
      })
    })
}

/** @deprecated Use the Database service. Kept until every store is an Effect service. */
export function createDatabase(binding: D1Database) {
  return drizzle(binding, { schema })
}
