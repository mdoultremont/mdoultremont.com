import type { App } from "./apps"

/** The user information sent to the web client, without session credentials. */
export interface SignedInUser {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly image: string | null
  readonly providers: ReadonlyArray<string>
  readonly apps: ReadonlyArray<App>
}

/** An authorization request shown on the consent page. */
export interface ConsentRequest {
  readonly client: {
    readonly clientId: string
    readonly name: string | null
  }
  readonly redirectOrigin: string
  readonly user: { readonly name: string; readonly email: string }
  readonly apps: ReadonlyArray<App>
}

export type { App } from "./apps"
