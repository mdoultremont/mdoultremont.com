# Portfolio web guide

- Keep this app limited to the portfolio UI, routes, content loading, and
  owner-operated music control area and its private backend.
- Keep backend code under `src/backend/` in four layers: entrypoints →
  features → modules → primitives. Imports only point down; each unit is a
  directory whose `index.ts` is its public API. Features must not depend on
  TanStack routes, Cloudflare binding types, browser state, or provider
  transport payloads. Read `src/backend/README.md` before changing backend
  code; it defines the Effect patterns to follow.
- Keep provider integrations independent from app sign-in. Private server
  actions must verify the configured GitHub owner on every request.
- Edit content records under `content/`. Update the repository-root
  `.pages.yml` when their schema or media paths change.
- Generate `src/routeTree.gen.ts` with TanStack Router tooling.
- Run `pnpm check` and `pnpm build` from the repository root.
