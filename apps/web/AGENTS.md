# Portfolio web guide

- Keep this app limited to the portfolio UI, routes, content loading, and
  owner-operated music control area and its private backend.
- Keep backend code under `src/backend/` in four layers: entrypoints →
  features → modules → primitives. Imports only point down; each unit is a
  directory whose `index.ts` is its public API. Features must not depend on
  TanStack routes, Cloudflare binding types, browser state, or provider
  transport payloads; lint enforces these boundaries. Read
  `src/backend/README.md` before changing backend code; it defines the Effect
  patterns to follow.
- Keep provider integrations independent from app sign-in (Better Auth, in
  `features/auth` and `modules/better-auth`). Private server actions must
  verify the owner on every request through `requireOwner`.
- Edit content records under `content/`. Update the repository-root
  `.pages.yml` when their schema or media paths change.
- Generate D1 migrations with `pnpm db:generate`. Production applies them
  automatically before each deploy, while the previous Worker still runs, so
  every migration must stay compatible with the code deployed before it (see
  `docs/deploy-to-cloudflare.md`).
- Generate `src/routeTree.gen.ts` with TanStack Router tooling.
- Run `pnpm check` and `pnpm build` from the repository root.
