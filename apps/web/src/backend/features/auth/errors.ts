import { Data } from "effect"

export class OwnerAccessDenied extends Data.TaggedError(
  "OwnerAccessDenied"
)<{}> {
  override get message() {
    return "This GitHub account is not allowed to use the private area"
  }
}

export class AuthPersistenceError extends Data.TaggedError(
  "AuthPersistenceError"
)<{ readonly cause: unknown }> {
  override get message() {
    return "Could not save the owner session"
  }
}
