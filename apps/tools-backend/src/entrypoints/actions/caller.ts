import type { App } from "@mdoultremont/tools-contracts/apps"

/**
 * Who calls an action. Built by the transport's authentication for one
 * request (`authenticate` in `entrypoints/http/oauth`); never read from
 * request input.
 */
export interface Caller {
  readonly userId: string
  /** The user's app access, read for this request so a change applies at once. */
  readonly apps: ReadonlyArray<App>
  /** This site's origin, from BETTER_AUTH_URL, for links an action returns or emails. */
  readonly origin: string
}
