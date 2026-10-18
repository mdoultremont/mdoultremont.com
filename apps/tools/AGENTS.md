# Tools guide

- Keep this app limited to the private apps on `tools.mdoultremont.com` and
  their backend. The public portfolio lives in `apps/web`.
- Put each private app at `/<name>`: pages in `src/routes/_apps/` (the
  pathless layout that signs users in), UI in `src/features/<name>/`, and
  its operations as actions: declare them in `src/shared/<name>/actions.ts`
  (one tree per app in `src/shared/actions/catalog.ts`) and bind each to its
  handler in `src/server/entrypoints/actions/<name>.ts`. oRPC for the
  browser, the public HTTP API under `/api/v1` and its manifest, MCP at
  `/api/mcp` and the CLI (`packages/tools-cli`) are derived from the catalog
  (see `src/server/README.md` and `docs/tools-api.md`); browser code calls
  `api` from `src/features/api`. Action inputs and outputs must be object
  schemas. Only protocol endpoints (Better Auth, the
  Spotify connection flow, invitation links) stay TanStack routes in
  `src/routes/api/`. Add the app to `apps` in `src/shared/apps.ts` and to
  `src/features/apps/catalog.ts` (its `pages` are the sidebar links of the
  apps shell in `src/features/apps/shell`), wrap its page in `RequireApp`,
  start it with `PageHeader`, and grant it to existing users in the
  migration that ships it. The `_apps` layout signs users in for every app;
  every action call still checks the caller's access to its app.
- Keep backend code under `src/server/` in three layers: entrypoints →
  actions → modules. Imports only point down; each unit is a
  directory whose `index.ts` is its public API. Actions must not depend on
  TanStack routes, Cloudflare binding types, browser state, or provider
  transport payloads; lint enforces these boundaries. Read
  `src/server/README.md` before changing backend code; it defines the Effect
  patterns to follow.
- Keep frontend code under `src/features/<name>/` (UI, client logic, one
  directory per feature) and code imported by both sides in `src/shared/`.
  Frontend code and `src/shared/` must not import runtime values from
  `src/server/`; type-only imports are allowed in `src/features/**` and
  `src/routes/**`. `src/server/` must not import `src/features/`. Lint
  enforces these boundaries.
- Keep provider integrations independent from app sign-in (Better Auth, in
  `actions/auth` and `modules/better-auth`). App access is verified on every
  request: by `invokeAction` for actions, by `requireApp` for protocol
  routes. Which credentials a request may use (OAuth bearer token, session
  cookie and its `Origin`) is decided only by `authenticate` in
  `src/server/entrypoints/http/oauth`.
- Generate D1 migrations with `pnpm db:generate`. Production applies them
  automatically before each deploy, while the previous Worker still runs, so
  every migration must stay compatible with the code deployed before it (see
  `docs/deploy-to-cloudflare.md`).
- UI primitives are shadcn components (Base UI style `base-nova`, see
  `components.json`) in `src/features/ui`. Add them from `apps/tools` with
  `pnpm dlx shadcn@latest add <name>`. Afterwards check that `cn` is imported
  from `@/features/ui/lib/utils` (the CLI sometimes writes `from "cn"` and adds
  a bogus `cn` dependency). The theme is the shadcn preset `b6RdcmXsFG` in
  `src/styles.css`; `dark:` follows the OS preference.
- Generate `src/routeTree.gen.ts` with TanStack Router tooling.
- Run `pnpm check` and `pnpm build` from the repository root.
