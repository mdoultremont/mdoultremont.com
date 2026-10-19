# Tools web and Worker host

- Keep the private web client and the single tools Worker deployment here. Put
  business actions, HTTP handlers, OAuth, MCP, queues, and cron implementation
  in `apps/tools-backend`. Read `apps/tools-backend/README.md` before changing
  backend behavior.
- Put pages in `src/routes/_apps/`, UI in `src/features/<name>/`, and call
  `api` from `src/features/api`. Declare actions and their schemas in
  `packages/tools-contracts/src/<name>/actions.ts`, then bind their handlers
  in `apps/tools-backend/src/entrypoints/actions/<name>.ts`.
- Keep `src/server.ts` as Worker composition. Protocol routes in
  `src/routes/api/` and server functions in the apps layout and OAuth consent
  route call `@mdoultremont/tools-backend/http`. All other frontend code uses
  contracts, the HTTP client, and `@mdoultremont/flight-track`.
- Add new apps to `packages/tools-contracts/src/apps.ts` and
  `src/features/apps/catalog.ts`, wrap pages in `RequireApp`, start them with
  `PageHeader`, and grant access to existing users in the shipping migration.
  The apps layout signs users in. Every backend action checks app access again.
- Keep Worker bindings, secrets, Wrangler config, and deployment commands here.
  Generate migrations with `pnpm db:generate`; their schema and SQL live in
  `apps/tools-backend`. Run local migrations here to preserve the existing
  `.wrangler` D1 directory. Production applies migrations before replacing the
  Worker, so migrations must support the previously deployed code. See
  `docs/deploy-to-cloudflare.md`.
- UI primitives are shadcn Base UI components in `src/features/ui`. Add them
  from this directory with `pnpm dlx shadcn@latest add <name>`. Check that `cn`
  comes from `@/features/ui/lib/utils`. The theme is in `src/styles.css`;
  `dark:` follows the OS preference.
- Generate `src/routeTree.gen.ts` with TanStack Router tooling. Run `pnpm check`
  and `pnpm build` from the repository root.
