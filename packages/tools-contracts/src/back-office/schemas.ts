import { Schema } from "effect"
import { AppSchema } from "../apps"

/** Wire shapes of the back office. Timestamps are UTC epoch milliseconds. */

/** A user who was not removed, as the back office shows them. */
export const DirectoryUserSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  image: Schema.NullOr(Schema.String),
  /** Sign-in providers, such as `github` or `spotify`. */
  providers: Schema.Array(Schema.String),
  apps: Schema.Array(AppSchema),
})
export type DirectoryUser = typeof DirectoryUserSchema.Type

/** An invitation nobody has accepted yet. It may have expired. */
export const PendingInvitationSchema = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  apps: Schema.Array(AppSchema),
  createdAt: Schema.Number,
  expiresAt: Schema.Number,
  /** Its link no longer works; sending a new link renews it. */
  expired: Schema.Boolean,
})
export type PendingInvitationSummary = typeof PendingInvitationSchema.Type

export const UserDirectorySchema = Schema.Struct({
  users: Schema.Array(DirectoryUserSchema),
  invitations: Schema.Array(PendingInvitationSchema),
})
export type UserDirectory = typeof UserDirectorySchema.Type
