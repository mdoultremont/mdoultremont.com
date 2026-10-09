# Backend

The private music backend, written with [Effect](https://effect.website) v4.
This guide covers the structure and the Effect patterns used here. The
best worked example is `modules/spotify` together with
`features/music/destinations` and `entrypoints/http/destinations.server.ts`.

## Layers

```
entrypoints  →  features  →  modules  →  primitives
```

| Layer           | Holds                                                                                   | Example                       |
| --------------- | --------------------------------------------------------------------------------------- | ----------------------------- |
| **primitives**  | Raw infrastructure, no domain knowledge.                                                | `database`, `token-cipher`    |
| **modules**     | Capabilities such as a provider API. Actions only, no business rules.                   | `spotify`                     |
| **features**    | Business logic, grouped by domain. Combines modules and primitives.                     | `music/destinations`          |
| **entrypoints** | Adapters that wire features to the outside: HTTP routes, queue consumers, cron, (MCP…). | `http/destinations.server.ts` |

Features are grouped by domain (`features/music/…`, later `features/flights/…`);
each folder inside a domain is one unit. Modules and primitives are named after
what they talk to or do, not after a domain, so any feature can reuse them.

Rules:

- Imports point down only. A module never imports a feature; a feature never
  imports an entrypoint.
- Each unit is a directory. Its `index.ts` is the public API; import
  `@/backend/modules/spotify`, never `@/backend/modules/spotify/spotify`.
- Start from the feature. Add a module or primitive only when a feature needs
  one, and keep business rules out of them.
- A store whose tables only make sense for one feature lives in that feature
  (`features/music/destinations/store.ts`). A store that is part of a capability
  lives in the module (`modules/spotify/connections.ts`).

## Effect patterns

### Services and layers

Every unit with dependencies or state is a service:

```ts
export class Destinations extends Context.Service<
  Destinations,
  { readonly read: (ownerId: string) => Effect.Effect<…, …> }
>()("backend/features/Destinations") {
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
  `features/music/destinations/destinations.ts`).
- A feature adds its own business errors (`DestinationConflict`, …) and passes
  module errors through when the caller should see them.
- Entrypoints turn every error into a response with `Effect.catchTags`. Only
  then can `respond()` accept the program, because it requires every
  feature error to be handled.

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

## Migration status

Migrated: `primitives/*`, `modules/{spotify,musicbrainz,acousticbrainz,jev}`,
`features/music/*`, and the HTTP, queue, and cron entrypoints.

Still in the previous layout: auth (`workflows/app-auth`,
`modules/{app-auth-store,github-oauth}.ts`).
