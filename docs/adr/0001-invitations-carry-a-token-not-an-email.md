# Invitations carry a token, not an email

The private apps went from a single owner (`OWNER_ACCOUNTS`) to several users,
each with app access chosen by the back office. People join through an emailed
invitation and then sign in with GitHub or Spotify.

## Decision

- **An invitation is matched by its link's token, never by email.** GitHub may
  return a different or private primary email, and Spotify never verifies
  emails, so the provider's email says nothing about who was invited. Opening
  the link stores the token in a one-hour, HTTP-only cookie scoped to
  `/api/auth`. Better Auth's sign-in gate (`AccessGate`) reads it on the
  provider callback to admit a new user, and the session hook accepts the
  invitation. Only the token's SHA-256 hash is stored.
- **Accounts are never linked implicitly.** Better Auth's
  `disableImplicitLinking` is on: an account with the same email as an existing
  user gets `account_not_linked` instead of being added to that user. With
  unverified Spotify emails, implicit linking would let anyone take over a user.
  Users add sign-in methods from a signed-in session.
- **An invitation used by an existing user goes to that user.** Opening the
  link while signed in, or signing in through it with an account that already
  belongs to a user, grants the invitation's apps to that user and restores
  them if they were removed.
- **`OWNER_ACCOUNTS` remains as a recovery path.** While nobody has back office
  access, these accounts may sign in without an invitation and receive every
  app. The migration that introduced app access gave every existing user (only
  the owner, at the time) every app.
- **"At least one back office user" is enforced in SQL.** D1 has no interactive
  transactions, so removing back office access, or removing a user, is a single
  conditional statement that only applies if another user who was not removed
  keeps the back office.

## Consequences

- An invitee whose provider email matches an existing user cannot sign up with
  that account. They see `account_not_linked`.
- Spotify sign-in only works for accounts on the Spotify app's allowlist while
  it is in development mode.
- Removing a user ends their sessions and drops their app access but keeps
  their data. Deleting data is left to a future scheduled job.
