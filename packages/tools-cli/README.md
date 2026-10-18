# Tools CLI

A remote-only Node CLI for tools. Requires Node 22.12 or newer and pnpm.
From the repository root:

```sh
pnpm tools login
pnpm tools actions
pnpm tools help <action-name>
pnpm tools call <action-name> --json '{"id":"example"}'
pnpm tools call <action-name> --json @input.json
cat input.json | pnpm tools call <action-name> --json -
pnpm tools call <import-action> --file track.igc
pnpm tools call <download-action> --json '{"flightId":"example"}' --output track.igc
pnpm tools logout
```

Every action comes from the authenticated manifest. `tools <action-name>`
also calls an action. Results are JSON on stdout. Errors and login URLs go to
stderr. Failed requests exit nonzero. No business handler runs locally.

Use `--url http://127.0.0.1:3000` or `TOOLS_URL` for a local server.
`TOOLS_TOKEN` supplies an OAuth access token for headless execution. Credentials
are only sent over HTTPS or loopback HTTP, and redirects are not followed by
API requests. `login --no-browser` prints the authorization URL without launching
the system browser. `TOOLS_LOGIN_TIMEOUT_MS` overrides the three-minute callback
timeout, up to ten minutes.

`--file` reads at most 5,000,000 bytes and requires valid UTF-8. The manifest
determines which content and filename fields it fills. Those fields must be absent from
`--json`. `--output` saves the exact decoded bytes. Existing output files require
`--force`. The CLI caps API JSON responses and JSON file/stdin input at 8 MiB.

## Session storage

Sessions are stored separately per origin in `TOOLS_CONFIG_DIR`, or
`$XDG_CONFIG_HOME/mdoultremont-tools`, defaulting to
`~/.config/mdoultremont-tools`. The directory uses mode 0700 and each credential
file uses mode 0600. Writes use an atomic rename. This is a filesystem fallback,
not an operating-system keychain. Treat backups of this directory as credentials.

An exclusive per-origin directory lock serializes credential saves, refresh, and
logout across processes. Login waits for the browser without holding the lock.
Lock acquisition times out after fifteen seconds. SIGINT and SIGTERM cancel
locked requests and release the lock after local writes finish. If a process is
killed with SIGKILL, ensure no tools process is using that origin before removing
the `.lock` directory named in the error. Locks are never stolen from possibly
active processes.

Before rotating a refresh token, the CLI records that refresh is pending. A crash
or lost token response therefore requires login again, rather than retrying a
possibly consumed refresh token. Action requests are sent once and never retried
after an ambiguous network failure. Logout calls the advertised revocation
endpoint for stored refresh and access tokens, and clears local credentials even
if revocation fails. Revocation failure still exits nonzero. `TOOLS_TOKEN` is an
external credential and cannot be removed by logout.

## Server contract

`src/contracts.mjs` owns manifest normalization. Authenticated `GET /api/v1`
returns `{ actions: [...] }`, each with:

```ts
{
  name: string
  description: string
  inputSchema: { type: "object", ...JSONSchema }
  outputSchema: { type: "object", ...JSONSchema }
  http: { method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string }
  file?: { contentField: string, filenameField: string }
}
```

Paths are relative to `/api/v1` and start with `/`. `:param` segments come from
input and are URI-encoded individually. Remaining GET input uses `?input=<json>`.
Other methods send the remaining input as a JSON body. Responses are the action's
JSON value. HTTP errors use `{ error: { code, message } }`. Downloads return
`{ filename, contentType, sizeBytes, contentBase64 }` directly.

OAuth uses canonical resource `<origin>/api` and issuer `<origin>/api/auth`.
Protected resource metadata lives at
`/.well-known/oauth-protected-resource/api`; authorization server metadata uses
`/.well-known/oauth-authorization-server/api/auth`. Endpoint URLs come from
metadata. The provider must support S256 PKCE, public native dynamic registration,
authorization code and refresh grants, the `tools offline_access` scopes, and
loopback redirect URIs with dynamically assigned ports. Each login registers its
current loopback URI. `oauth4webapi@3.8.8` verifies discovery, authorization
responses, state, and token responses. The provider enforces the PKCE verifier.

`pnpm check` and `pnpm build` from the root include this package's checks.
`pnpm --filter @mdoultremont/tools-cli test` runs actual CLI subprocesses against
a local authenticated HTTP/OAuth fixture.
`apps/tools/src/server/entrypoints/http/api/api.test.ts` also runs it as a
subprocess against the real Worker routes and OAuth provider on an in-memory
D1: login, `actions`, `call`, `logout`, and refusal after revocation or loss
of app access.

Signing out of the browser ends the access token issued in that session. The
CLI only refreshes when its token is about to expire, so until then a call
fails with `HTTP 401`; `tools login` again, or wait for the refresh.
