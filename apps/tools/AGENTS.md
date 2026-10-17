# Tools guide

- Keep this app limited to the private apps on `tools.mdoultremont.com` and
  their backend. The public portfolio lives in `apps/web`.
- Put each private app at `/<name>`: pages in `src/routes/_apps/` (the
  pathless layout that signs users in), APIs in `src/routes/api/<name>/`
  (flights instead uses the Hono + oRPC
  shell: contract in `src/shared/flights/contract`, router in
  `src/server/entrypoints/http/flights`), UI in `src/features/<name>/`.
  Add the app to `apps` in `src/server/actions/auth/apps.ts` and to
  `src/features/apps/catalog.ts` (its `pages` are the sidebar links of the
  apps shell in `src/features/apps/shell`), wrap its page in `RequireApp`,
  start it with `PageHeader`, and grant it to existing users in the
  migration that ships it. The `_apps` layout
  signs users in for every app; each API handler still checks access itself.
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
  `actions/auth` and `modules/better-auth`). Private server actions must
  verify app access on every request through `requireApp`.
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
