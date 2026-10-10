import { Config, Schema } from "effect"

/** A sign-in account that belongs to the owner, such as `github:18487606`. */
export interface OwnerAccount {
  readonly provider: string
  readonly accountId: string
}

const entry = String.raw`[a-z]+:[^,:\s]+`

/**
 * OWNER_ACCOUNTS: the owner's sign-in accounts, as comma-separated
 * `provider:accountId` pairs (`github:18487606,spotify:abc`). Only these
 * accounts can sign in, and a user owns the private area while one of them is
 * linked.
 */
export const ownerAccounts = Config.schema(
  Schema.String.check(Schema.isPattern(new RegExp(`^${entry}(,${entry})*$`))),
  "OWNER_ACCOUNTS"
).pipe(
  Config.map((value): ReadonlyArray<OwnerAccount> =>
    value.split(",").map((pair) => {
      const [provider = "", accountId = ""] = pair.split(":")
      return { provider, accountId }
    })
  )
)

export const isOwnerAccount = (
  accounts: ReadonlyArray<OwnerAccount>,
  candidate: OwnerAccount
) =>
  accounts.some(
    (account) =>
      account.provider === candidate.provider &&
      account.accountId === candidate.accountId
  )
