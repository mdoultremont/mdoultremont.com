# Tools API

Every operation of the private apps on `tools.mdoultremont.com` is an
**action**. One registry serves each action to the browser (oRPC), to HTTP
clients (`/api/v1`), to agents (MCP at `/api/mcp`) and to the CLI
(`pnpm tools`). A user signs in once with OAuth, and the same token works on
all of them. See [ADR 0003](adr/0003-one-action-registry-for-every-client.md)
for why it is built this way.

## Add an action

1. Declare it in `apps/tools/src/shared/<app>/actions.ts`, in that app's tree.
   For a hypothetical `flights.archive`:

   ```ts
   archive: action({
     description: "Archives a flight. It stays in statistics but leaves the list.",
     effect: "write",
     http: { method: "POST", path: "/flights/:flightId/archive" },
     input: Schema.Struct({ flightId: Schema.String }),
     output: Schema.Struct({ id: Schema.String }),
   }),
   ```

   The description is what agents read; say what the action does and what its
   fields mean. A `read` action changes nothing and may use `GET`; a `write`
   never does. Input and output must be objects (or a union of objects): MCP
   and the CLI require it, and the Worker refuses to start otherwise.

2. Bind it to its business code in
   `apps/tools/src/server/entrypoints/actions/<app>.ts`, at the same path:

   ```ts
   archive: bind(actions.archive, Flights.layer, ({ flightId }, caller) =>
     Flights.use((flights) => flights.archive(caller.userId, flightId))
   ),
   ```

3. Give any new business error a row in `toActionError`
   (`entrypoints/actions/errors.ts`).

The browser client, `/api/v1`, the manifest, MCP and the CLI pick it up with
no routing code. The registry checks the caller's app access, decodes the
input, and encodes the output on every transport.

## Endpoints

| Path                                                 | For                                                       |
| ---------------------------------------------------- | --------------------------------------------------------- |
| `GET /api/v1`                                        | The manifest: the caller's actions with JSON Schemas      |
| `/api/v1/<route>`                                    | Each action at its declared method and path               |
| `POST /api/mcp`                                      | MCP (Streamable HTTP, stateless): one tool per action     |
| `/api/rpc/<action path>`                             | oRPC, used by the site's own pages                        |
| `/.well-known/oauth-protected-resource/api`          | RFC 9728 metadata of the `<origin>/api` resource          |
| `/.well-known/oauth-authorization-server/api/auth`   | RFC 8414 metadata of the issuer `<origin>/api/auth`       |
| `/api/auth/oauth2/{register,authorize,token,revoke}` | Dynamic registration, sign-in, token exchange, revocation |

`/.well-known/oauth-protected-resource/api/mcp` and `.../api/v1` return the
same document: everything under `/api` is one resource, so one token serves
REST, MCP and RPC.

## HTTP

Send the access token as a bearer token. A `GET` takes its input as JSON in
`?input=`; other methods take a JSON body. `:name` path segments fill the input
field of the same name.

```sh
TOKEN=...   # an access token, e.g. from the CLI's credential file
curl -H "Authorization: Bearer $TOKEN" https://tools.mdoultremont.com/api/v1
curl -H "Authorization: Bearer $TOKEN" \
  "https://tools.mdoultremont.com/api/v1/flights?input=%7B%22year%22%3A2026%7D"
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"kind":"wing","name":"Zeno 2","notes":"","retired":false}' \
  https://tools.mdoultremont.com/api/v1/flights/equipment
```

Success is `200` with the action's output. Failure is
`{ "error": { "code", "message", "data"? } }` with the status of its code
(`errorStatus` in `src/shared/actions/errors.ts`). A refused credential also
carries `WWW-Authenticate: Bearer resource_metadata="…", scope="tools offline_access"`,
and a temporary sign-in failure carries `Retry-After`. Bodies are capped at
6 MB, and responses are `Cache-Control: no-store`.

## CLI

From the repository root, with Node 22.12 or newer:

```sh
pnpm tools login            # opens the browser; --no-browser prints the URL
pnpm tools actions          # the manifest
pnpm tools help flights.get
pnpm tools call flights.equipment.create --json '{"kind":"wing","name":"Zeno 2","notes":"","retired":false}'
pnpm tools logout           # revokes the grant and deletes local credentials
```

`--url http://localhost:3000` (or `TOOLS_URL`) targets a local server, whose
`BETTER_AUTH_URL` must be that same origin. `TOOLS_TOKEN` supplies an access
token for headless use. `packages/tools-cli/README.md` covers storage, locking
and file arguments.

## MCP

Point a client that supports MCP over Streamable HTTP with OAuth at:

```text
https://tools.mdoultremont.com/api/mcp
```

A generic configuration is a server of type `http` with that URL and no
headers. On the first request the server answers `401` with the resource
metadata URL; the client discovers the issuer, registers itself, opens the
browser for sign-in and consent, and stores the tokens. Tools are listed per
user: only the actions of apps the user can use right now appear.

Verified: the official TypeScript SDK (`@modelcontextprotocol/client` 2.3.1)
discovers `/api`, registers, signs in, lists all tools and calls
them, on protocol revisions 2025-11-25 and 2026-07-28 (and the adapter alone
on 2025-03-26). Hosted Claude and Codex sign-in were not run: they need real
accounts reaching the deployed site, so check them after deploying.

## Who may do what

- **Scopes.** A client asks for `tools offline_access`. `tools` lets it act as
  the user with all of their current app access; nothing narrows it.
  `offline_access` gives it a refresh token. There is no machine access: every
  token acts for a user who signed in and consented.
- **Live access.** The user and their app access are read from D1 on every
  request. Removing an app, or removing the user, applies to the next call of
  every live token.
- **Tokens.** Access tokens are opaque, live 15 minutes and are stored hashed
  in D1. Refresh tokens rotate; a retried refresh within 30 seconds gets the
  same answer, and a later replay revokes the grant. Revoking a refresh token
  (what `tools logout` does) ends every token of its grant. Redeeming an
  authorization code twice ends its grant too, even while the first
  redemption is still storing tokens. Signing out of the browser ends the
  access tokens issued in that session; a client holding a refresh token gets
  new ones.
- **Credentials per transport.** `/api/v1` and `/api/rpc` accept a bearer token
  or the session cookie. With an `Authorization` header, only that header
  counts, even if a cookie is also sent. A cookie-authenticated change must
  send this site's `Origin`. MCP accepts bearer tokens only, and refuses a
  request whose `Origin` is not this site's; native clients send none.
- **Browsers.** OAuth metadata, registration, token and revocation answer any
  origin with `Access-Control-Allow-Origin: *` and never with credentials. A
  cookie-carrying change under `/api/auth/oauth2/`, such as consent, must come
  from this site's `Origin`.

## Deployment

Migration `0003_oauth_provider` adds the provider's tables (clients, tokens,
consents, resources) and two of tools' own: `oauth_revoked_grants` and
`oauth_redeemed_codes`. The provider uses the existing `BETTER_AUTH_SECRET`
and `BETTER_AUTH_URL`; there are no new secrets or bindings.

API keys for unattended scripts are deferred: every client signs in as a user.

The pnpm patch for `@better-auth/oauth-provider@1.7.10` adds `tokenLifecycle`
callbacks after provider validation. Tools uses them to claim authorization
codes and list revoked grants before token writes, without authenticating a
request twice. The patch delays code consumption until credentials, PKCE,
session, and resource checks pass. When upgrading the provider, port these
callbacks or replace them with upstream equivalents and run the OAuth tests,
including `oauth.security.test.ts`.
