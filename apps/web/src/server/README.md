# Backend

The private music backend, written with [Effect](https://effect.website) v4.
This guide covers the structure and the Effect patterns used here. The
best worked example is `modules/spotify` together with
`actions/music/destinations` and `entrypoints/http/music/destinations.server.ts`.

## Layers

```
entrypoints  →  actions  →  modules
```

| Layer           | Holds                                                                                                          | Example                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **modules**     | Capabilities with no business rules: infrastructure and provider clients.                                      | `database`, `object-storage`, `spotify`             |
| **actions**     | Business logic: use cases grouped by domain. Combines modules.                                                 | `music/destinations`                                |
| **entrypoints** | Adapters that wire actions to the outside: HTTP (Hono + oRPC, TanStack routes), queue consumers, cron, (MCP…). | `http/music/destinations.server.ts`, `http/flights` |

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
  `@/server/modules/spotify`, never `@/server/modules/spotify/spotify`.
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
- Entrypoints turn every error into a response with `Effect.catchTags`. Only
  then can `respond()` accept the program, because it requires every
  action error to be handled.

### Parsing untrusted data

Use `Schema` for every boundary: request bodies (`decodeBody`), provider
responses (`modules/spotify/schemas.ts`). Don't write `typeof x === "object"`
checks.

### Configuration and time

- Read Worker variables and secrets with `Config` inside a layer
  (`Config.NonEmptyString("SPOTIFY_CLIENT_ID")`). The entrypoint provides
  them from the Worker `env` through `platformLayer`. Missing configuration
  surfaces as `ConfigError` and becomes a 503.
- Get the current time from `Clock.currentTimeMillis`, not `Date.now()`, so
  tests can control it with `TestClock`.

### Running effects

Only entrypoints leave Effect (`Effect.runPromise`), through `respond()` for
HTTP. Everything below returns an `Effect`.

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
exception is `@/server/modules/database/testing`, a test-only in-memory D1, and `@/server/modules/object-storage/testing`, a fake R2 bucket.

## HTTP: Hono and oRPC

`src/server.ts` sends every `/api/*` request to the Hono app in
`entrypoints/http/hono`; anything Hono does not match (auth, music, back
office, invitations) falls through to the TanStack server routes, which still
use `respond()`. Flights is the first app migrated:

- The contract lives in `src/shared/<app>/contract` (`@orpc/contract`, input and
  output as Effect Schema through `Schema.toStandardSchemaV1`), so the browser
  and the backend share one set of types. The frontend calls it through a typed
  `createORPCClient` + `RPCLink` client.
- `entrypoints/http/<app>/router.ts` implements the contract with `implement()`.
  The oRPC context carries the signed-in user id and the request's
  `platformLayer(env)`, built in the Hono middleware.
- Hono middleware (in `hono/index.ts`) owns what is common: body cap, session +
  `requireApp`, the Origin check for non-GET requests. Binary or non-RPC
  endpoints are plain Hono routes in the same unit.

Each app's router is mounted at `/api/rpc/<app>/*` by one `mountAppRpc(app,
"<app>", router)` line in `hono/index.ts`; only that prefix requires the app.

To add a procedure: declare it with its schemas in the contract, add a handler in
the router that calls `runProcedure(program, Action.layer, context.platform)`,
and add the new action errors to `toOrpcError` in `flights/errors.ts`, which maps
tagged errors to `ORPCError` codes. `runProcedure` is where the program leaves
Effect; defects are logged and become a generic 500.
