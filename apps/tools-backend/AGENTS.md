# Tools backend

- Read `README.md` before changing backend code. Keep imports pointing from
  entrypoints to actions to modules. Import a unit through its `index.ts`;
  `#backend/*` resolves only inside this package.
- Bind operations declared in `@mdoultremont/tools-contracts` to business actions
  in `src/entrypoints/actions`. Every transport invokes the same registry and
  checks current app access. See `docs/tools-api.md` for the action workflow.
- Keep actions independent of Worker bindings and transport payloads. Provide
  their Effect services through entrypoint layers. The web host imports only
  the `http` and `worker` package exports. Backend code uses no web code or
  React or TanStack runtime.
- Keep the database schema in `src/modules/database/schema.ts` and migrations
  in `migrations`. Generate SQL with `pnpm db:generate`. Run migrations through
  `apps/tools` so Wrangler keeps its existing local state and production
  deployment ordering. Migrations must support the previous Worker version.
- Preserve the pinned OAuth provider patch and its concurrency and security
  tests when changing dependencies. Run root `pnpm check` and `pnpm build` so
  package boundary checks and every workspace test participate.
