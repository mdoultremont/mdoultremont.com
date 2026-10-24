# One action registry for every client

The private apps were served by hand-written routes: oRPC procedures for the
flight logbook, TanStack server routes for music and the back office. Each
route checked sign-in and app access itself, and only the site's own pages
could call them. Agents (Claude, Codex) and a command line should be able to
do everything a user can, without a second implementation of any operation.

## Decision

- **Every operation is an action in one catalog.** An action declares its
  app, whether it reads or writes, an HTTP route, and Effect Schema input and
  output (`packages/tools-contracts/src/<app>/actions.ts`). The server binds each one to its
  handler (`apps/tools-backend/src/entrypoints/actions`). Transports are derived from the
  registry: oRPC for the browser, `/api/v1` and its manifest for HTTP clients
  and the CLI, `/api/mcp` for agents. All of them call `invokeAction`, which
  checks app access, decodes, runs, maps errors, and encodes once.
- **Agents sign in as the user with OAuth 2.1.** Better Auth's OAuth provider
  issues tokens for one protected resource, `<origin>/api`, from the issuer
  `<origin>/api/auth`. Clients register dynamically, use PKCE, and need the
  user's consent. Tokens are opaque and stored in D1, so revocation and user
  removal apply on the next request.
- **A token carries the user's whole access.** The `tools` scope means "act
  as this user in every app they can use now". App access stays the only
  permission model; there are no per-app or read-only scopes.
- **Authentication is decided in one place.** `authenticate`
  (`entrypoints/http/oauth`) turns a request into a caller or a refusal, with
  this site's origin taken from `BETTER_AUTH_URL`. A bearer header, when
  present, is the only credential that counts. MCP accepts nothing but bearer
  tokens; the browser routes also accept the session cookie from this site's
  pages.
- **Tools adds the guarantees the provider does not make on D1.** A revoked
  grant, a replayed refresh token, or an authorization code redeemed twice is
  listed by its authorization code, and every token of a listed grant is
  refused, including one stored after the listing. Only the authenticated
  client the token or code was issued to can cause a listing.

## Consequences

- Adding an operation means declaring and binding one action; every client
  sees it. Its input and output must be objects, because MCP and the CLI need
  object schemas.
- The MCP endpoint is stateless and holds no sessions, so it scales like any
  other Worker request.
- Signing out of the browser ends the access tokens issued in that session;
  clients continue with their refresh token.
- Unattended scripts have no credential of their own. API keys are deferred
  until a use needs them.

## Browser playback credentials

The Web Playback SDK needs the owner's Spotify access token in the browser.
`music.player.token` stays in the action catalog but requires a browser
session. Bearer-authenticated clients cannot call it, even with a session cookie.
The token also carries playlist and library permissions, so handing it to a
delegated client would bypass tools' app access and grant revocation checks.
The HTTP response uses `Cache-Control: no-store` and contains no refresh token.
Play, pause, resume, and status remain available to every authorized client.
