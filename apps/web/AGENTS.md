# Portfolio web guide

- Keep this app limited to the portfolio UI, routes, content loading, and
  the private apps and their backend.
- Put each private app under `/apps/<name>`: pages in `src/routes/apps/`,
  APIs in `src/routes/api/apps/<name>/`, UI in `src/components/apps/<name>/`.
  Add the app to `apps` in `src/backend/features/auth/apps.ts` and to
  `src/components/apps/catalog.ts`, wrap its page in `RequireApp`, and grant
  it to existing users in the migration that ships it. The `/apps` layout
  signs users in for every app; each API handler still checks access itself.
- Keep backend code under `src/backend/` in three layers: entrypoints →
  features → modules. Imports only point down; each unit is a
  directory whose `index.ts` is its public API. Features must not depend on
  TanStack routes, Cloudflare binding types, browser state, or provider
  transport payloads; lint enforces these boundaries. Read
  `src/backend/README.md` before changing backend code; it defines the Effect
  patterns to follow.
- Keep provider integrations independent from app sign-in (Better Auth, in
  `features/auth` and `modules/better-auth`). Private server actions must
  verify app access on every request through `requireApp`.
- Edit content records under `content/`. Update the repository-root
  `.pages.yml` when their schema or media paths change.
- Generate D1 migrations with `pnpm db:generate`. Production applies them
  automatically before each deploy, while the previous Worker still runs, so
  every migration must stay compatible with the code deployed before it (see
  `docs/deploy-to-cloudflare.md`).
- Generate `src/routeTree.gen.ts` with TanStack Router tooling.
- Run `pnpm check` and `pnpm build` from the repository root.
