import { Data } from "effect"
import type { App } from "@/server/actions/auth"

/** A user who was not removed, as the back office shows them. */
export interface DirectoryUser {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly image: string | null
  readonly providers: ReadonlyArray<string>
  readonly apps: ReadonlyArray<App>
}

/** An invitation nobody has accepted yet. It may have expired. */
export interface PendingInvitationSummary {
  readonly id: string
  readonly email: string
  readonly apps: ReadonlyArray<App>
  readonly createdAt: number
  readonly expiresAt: number
  /** Its link no longer works; sending a new link renews it. */
  readonly expired: boolean
}

export interface UserDirectory {
  readonly users: ReadonlyArray<DirectoryUser>
  readonly invitations: ReadonlyArray<PendingInvitationSummary>
}

export class UserInputError extends Data.TaggedError("UserInputError")<{
  readonly message: string
}> {}

export class AlreadyAUser extends Data.TaggedError("AlreadyAUser")<{}> {
  override get message() {
    return "This email already belongs to a user. Change their access instead"
  }
}

export class UserNotFound extends Data.TaggedError("UserNotFound")<{}> {
  override get message() {
    return "This user does not exist or was removed"
  }
}

export class InvitationNotFound extends Data.TaggedError(
  "InvitationNotFound"
)<{}> {
  override get message() {
    return "This invitation does not exist or was already accepted"
  }
}

/** Someone must always be able to use the back office. */
export class LastBackOfficeUser extends Data.TaggedError(
  "LastBackOfficeUser"
)<{}> {
  override get message() {
    return "At least one user must keep access to the back office"
  }
}

/** Users cannot remove themselves or their own back office access. */
export class OwnAccessProtected extends Data.TaggedError(
  "OwnAccessProtected"
)<{}> {
  override get message() {
    return "You cannot remove yourself or your own access to the back office"
  }
}

export class UserDirectoryPersistenceError extends Data.TaggedError(
  "UserDirectoryPersistenceError"
)<{ readonly cause: unknown }> {
  override get message() {
    return "Could not read or save users"
  }
}
