# Backend

The private apps backend, written with [Effect](https://effect.website) v4.
This guide covers the structure and the Effect patterns used here. The
best worked example is `modules/spotify` together with
`actions/music/destinations` and the `music.destinations.*` actions
(`packages/tools-contracts/src/music/actions.ts`, `entrypoints/actions/music.ts`).

This package exposes only `@mdoultremont/tools-backend/http` for protocol
routes and server functions, and `@mdoultremont/tools-backend/worker` for
Worker mounting, queues, and cron. It ships inside the existing `apps/tools`
Worker. Action declarations and the typed HTTP client are in
`packages/tools-contracts`; shared track algorithms are in
`packages/flight-track`. Internal `#backend/*` imports stay within this package.

The schema, Drizzle config, and SQL migrations live here. Generate migrations
with `pnpm db:generate`. Apply them through `apps/tools` to keep Wrangler
state in the host directory and preserve the production deployment sequence.

## Layers

```
entrypoints  →  actions  →  modules
```

| Layer           | Holds                                                                                                                                   | Example                                 |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **modules**     | Capabilities with no business rules: infrastructure and provider clients.                                                               | `database`, `object-storage`, `spotify` |
| **actions**     | Business logic: use cases grouped by domain. Combines modules.                                                                          | `music/destinations`                    |
| **entrypoints** | Adapters that wire actions to the outside: the action registry, HTTP (Hono + oRPC, MCP, OAuth, protocol routes), queue consumers, cron. | `entrypoints/actions`, `http/hono`      |

Actions are grouped by domain (`actions/music/…`, `actions/flights/…`);
each folder inside a domain is one unit. Modules are named after what they do
or talk to, not after a domain, so any action can reuse them: a generic
capability by the capability (`database`, `object-storage`, `job-queue`), a client for one
provider by the provider (`spotify`, `better-auth`).

Rules:

- Imports point down only. A module never imports an action; an action never
  imports an entrypoint.
- Modules may use other modules (`spotify` uses `database` and `token-cipher`)
  but never in a cycle; lint rejects cycles.
- Each unit is a directory. Its `index.ts` is the public API; import
  `#backend/modules/spotify`, never `#backend/modules/spotify/spotify`.
- Start from the action. Add a module only when an action needs one, and keep
  business rules out of it.
- A store whose tables only make sense for one action domain lives in that action
  (`actions/music/destinations/store.ts`). A store that is part of a capability
  lives in the module (`modules/spotify/connections.ts`).

## Effect patterns

### Services and layers

Every unit with dependencies or state is a service:

```ts
export class Destinations extends Context.Service<
  Destinations,
  { readonly read: (ownerId: string) => Effect.Effect<…, …> }
>()("server/actions/Destinations") {
  static readonly layerNoDeps = Layer.effect(Destinations, Effect.gen(function* () {
    const spotify = yield* Spotify            // dependencies are yielded
    return Destinations.of({ read: … })
  }))
  static readonly layer = Destinations.layerNoDeps.pipe(
    Layer.provide(Layer.mergeAll(DestinationStore.layer, Spotify.layer))
  )
}
```

- `layerNoDeps` still requires its dependencies, so tests use it with fakes.
- `layer` is the production wiring. It only requires the platform (`Database`
  and configuration).
- To use a service: `yield* Destinations` inside `Effect.gen`, or
  `Destinations.use((d) => d.read(id))` for a one-liner.

A service's definition and its implementation can live in different units.
When a module needs a decision that belongs to an action, the module defines
the service and the action provides a layer for it. `modules/better-auth`
defines `AuthGate` (who may sign in) and asks it before admitting anyone;
`actions/auth` implements it as `AccessGate`. The module stays free of
business rules, and imports still point down.

`modules/object-storage` is the reusable binary store (R2 `FILES` binding,
provided by `platformLayer`): `put`, `get`, `delete`, `deleteByPrefix`, failing
with `ObjectStorageError`. It knows nothing about callers; each action owns its
key layout. Tests use `ObjectStorage.layerMemory(map)` instead of a fake.

### Functions

Write service methods with `Effect.fn("Service.method")(function* (…) {…})`.
It reads like `async`/`await` (`yield*` instead of `await`), and the name
becomes the tracing span.

### Errors

- Define errors with `Data.TaggedError("Name")<{ fields }>`. Fail with
  `return yield* new MyError(…)`.
- Error types are part of the signature (`Effect<A, E, R>`). The compiler
  tracks which errors are still unhandled.
- A module exposes **one error with a `reason`**: `SpotifyError` carries
  `NotConnected | ReconnectNeeded | RateLimited | …`. Callers handle specific
  reasons with `Effect.catchReason` or `Effect.catchReasons` (see `usable` in
  `actions/music/destinations/destinations.ts`).
- An action adds its own business errors (`DestinationConflict`, …) and passes
  module errors through when the caller should see them.
- Entrypoints turn every error into a response. Action errors go through the
  one table in `entrypoints/actions/errors.ts` (`toActionError`); `bind`
  only accepts handlers whose errors have a row there. The remaining TanStack
  protocol routes use `respond()`, which requires every error to be handled.

### Parsing untrusted data

Use `Schema` for every boundary: action inputs and outputs (decoded and
encoded once by `bind`), provider responses (`modules/spotify/schemas.ts`). Don't write `typeof x === "object"`
checks.

### Configuration and time

- Read Worker variables and secrets with `Config` inside a layer
  (`Config.NonEmptyString("SPOTIFY_CLIENT_ID")`). The entrypoint provides
  them from the Worker `env` through `platformLayer`. Missing configuration
  surfaces as `ConfigError` and becomes a 503.
- Get the current time from `Clock.currentTimeMillis`, not `Date.now()`, so
  tests can control it with `TestClock`.

### Running effects

Only entrypoints leave Effect (`Effect.runPromise`): `invokeAction` for every
action call, `respond()` for the TanStack protocol routes. Everything below returns an `Effect`.

Layers are built **per request or per queue batch**, never shared across
requests. Cloudflare Workers forbid one request from awaiting I/O started by
another, so module state (such as Spotify's access-token cache) is scoped to
one request.

### Testing

Use `@effect/vitest`:

```ts
it.effect("does something", () =>
  Effect.gen(function* () {
    const destinations = yield* Destinations
    yield* TestClock.setTime(10)
    …
  }).pipe(Effect.provide(testLayer))
)
```

- Build `testLayer` from `layerNoDeps` plus fakes via
  `Layer.succeed(Service, Service.of({...}))`.
- Assert on failures with `Effect.flip(effect)`, which swaps the error into
  the success channel.
- HTTP modules use the real `FetchHttpClient`, with the `fetch` function
  replaced by `Effect.provideService(FetchHttpClient.Fetch, vi.fn())`.

## Enforcing the layers

`.oxlintrc.json` rejects imports that bypass a unit's `index.ts` and imports
that point up a layer, and keeps `cloudflare:workers` out of actions. The one
exception is `#backend/modules/database/testing`, a test-only in-memory D1, and `#backend/modules/object-storage/testing`, a fake R2 bucket.

## Actions: one registry, every transport

Every business operation is an **action**. Its declaration lives in
`packages/tools-contracts/src/<app>/actions.ts` (frontend-safe): a description written for
agents, `effect` (`read` or `write`), an explicit HTTP route relative to
`/api/v1`, Effect Schema input and output, and optional `file` metadata
for a text field that may come from a local file (with its byte limit). The
catalog (`packages/tools-contracts/src/actions/catalog.ts`) holds one tree per app; the path
to an action is its name (`flights.equipment.create`).

`entrypoints/actions/<app>.ts` binds each action to its business code:

```ts
create: bind(actions.equipment.create, Equipment.layer, (input, caller) =>
  Equipment.use((equipment) => equipment.create(caller.userId, input)).pipe(
    Effect.map((equipment) => ({ equipment }))
  )
),
```

`handlers` must have exactly one handler per action, at the same path
(`HandlersFor<typeof catalog>`); `createRegistry` also refuses a handler
bound to another action and two actions on one route.

Every transport calls `invokeAction(action, input, caller, platform)`: it
checks `caller.apps` against the action's app, decodes the canonical JSON
input once (`Schema.toCodecJson`), enforces `file.maxBytes`, runs the
handler with its layer on the request's platform, maps errors with
`toActionError`, and encodes the output once. Defects are logged and become
`INTERNAL_SERVER_ERROR`. `invoke(name, ...)` does the same by name.

To add an action: declare it in the app's tree, bind it in the app's handler
file, and give any new error a row in `toActionError`. oRPC, `/api/v1`, the
manifest and the typed browser client pick it up with no routing code.

## HTTP

`apps/tools/src/server.ts` hands every request to `createToolsFetch` in
`entrypoints/http/api`, which tries in order:

1. `handleOAuthRequest` (`entrypoints/http/oauth`): OAuth discovery under
   `/.well-known/`, and the provider's public endpoints
   (`/api/auth/oauth2/{register,token,revoke}`) with CORS for any origin and
   no credentials. A cookie-carrying change under `/api/auth/oauth2/` must
   come from this site's `Origin`.
2. `/api/*`: the Hono app from `createApi(fallback, options)` in
   `entrypoints/http/hono`.
3. Everything else, and whatever Hono does not match: the TanStack app, whose
   server routes only hold protocol endpoints (Better Auth, the Spotify
   connection flow, invitation links).

Hono serves:

- `/api/rpc/<action path>`: every action over oRPC, for the browser. The
  contract (`actionsContract`) is derived from the catalog; the browser uses
  `createActionsClient`, which encodes inputs and decodes outputs with the
  same JSON codecs. The server does not re-validate with oRPC.
- `GET /api/v1`: `{ actions: ActionDescriptor[] }` for the caller's apps,
  with JSON Schemas of the canonical JSON. Inputs and outputs are object
  schemas (a union of objects also gets `type: "object"`).
- `/api/v1/<route>`: each action at its declared method and path. Path
  parameters fill string input fields; a GET takes the rest of its input as
  JSON in `?input=`; other methods take a JSON body, merged with the path
  parameters (a conflicting value is a 400). Success is `200` with the
  output; failure is `{ error: { code, message, data? } }` with the status
  from `errorStatus`.
- `/api/mcp`: every action of the caller's apps as an MCP tool, through the
  SDK adapter in `entrypoints/mcp` (see its README). `hono/mcp-tools.ts`
  turns descriptors into tools and refuses, at startup, an action without
  object schemas.
- `GET /api/flights/files/:fileId`: `flights.files.download` as the file
  itself, for the browser.

Every route is capped at 6 MB and authenticated by `options.authenticate`
(default: `authenticate` from `entrypoints/http/oauth`), which receives the
credentials the route accepts: `"bearer"` for MCP, `"bearer-or-session"`
elsewhere. It returns a `Caller` or a `Refusal`; Hono renders a refusal in
the route's error body (oRPC or JSON) and keeps its headers
(`WWW-Authenticate`, `Retry-After`). `authenticate` owns every rule about
credentials: a bearer header is the only credential when present, a cookie
change needs this site's `Origin`, MCP refuses cookies and foreign `Origin`s.
This site is `BETTER_AUTH_URL`'s origin, never the request's Host.
`options.registry` and `options.platform` exist for tests. A `Caller` is
built per request with the user's current app access.

OAuth itself is Better Auth's provider (`modules/better-auth/oauth.ts`), plus
tools' grant listing: a revoked grant, a replayed refresh token or a code
redeemed twice is listed in `oauth_revoked_grants`, and its tokens are refused
even when stored after the listing. See `docs/tools-api.md`.
