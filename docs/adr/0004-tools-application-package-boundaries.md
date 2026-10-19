# Tools application package boundaries

The action registry serves the browser, CLI, HTTP clients, and MCP from one
implementation. Keeping that implementation inside the web application makes
its ownership and dependencies difficult to distinguish from the browser code.

## Decision

- `apps/tools` owns the web client and the existing Worker deployment. Its
  Worker entrypoint mounts the backend and delegates queue and cron events.
  TanStack protocol routes and server functions call backend public entrypoints.
- `apps/tools-backend` owns Hono, oRPC handlers, MCP, OAuth, business actions,
  infrastructure modules, the database schema, and migrations. Its only public
  exports are `http` and `worker`. Internal imports use package-local
  `#backend/*` paths. It imports no web code or browser framework runtime.
- `packages/tools-contracts` owns action declarations, Effect schemas, the
  catalog, wire contracts, and the typed HTTP client. Both applications import
  explicit public subpaths. It depends only on Effect and oRPC client and
  contract libraries. It contains no business handlers.
- `packages/flight-track` owns the existing pure track parsing and measurement
  algorithms used by the backend importer and browser viewer.
- `apps/tools-cli` is a separate HTTP client. It discovers the authenticated
  manifest remotely and imports no server implementation.

## Consequences

There is still one tools Worker, with the same endpoints, authentication,
bindings, queue, and cron. The backend exposes source TypeScript to the Worker
build, so there is no separate backend deployment or compiled distribution.
The web package keeps Better Auth's client libraries for sign-in and consent.

Drizzle runs from the backend package. Wrangler migration and deployment
commands run from `apps/tools`; its `migrations_dir` points to the backend SQL.
This preserves the existing local D1 directory and applies production
migrations before replacing the previous Worker.

Root lint checks resolved cross-package imports, explicit exports, and backend
layer direction. Regression tests exercise forbidden imports, including relative
paths, type imports, and dynamic imports. The web production build checks its
emitted client graph after TanStack strips server functions and refuses backend
implementation or secret binding names. Workspace test scripts discover tests
in their owning package after moves.
