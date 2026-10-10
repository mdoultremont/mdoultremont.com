import { Data } from "effect"

export class AuthPersistenceError extends Data.TaggedError(
  "AuthPersistenceError"
)<{ readonly cause: unknown }> {
  override get message() {
    return "Could not read the owner's sign-in accounts"
  }
}
