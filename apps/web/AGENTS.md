# Portfolio web guide

- Keep this app limited to the portfolio UI, routes, content loading, and
  owner-operated music control area and its private backend.
- Keep backend domain code under `src/backend/` in primitives, modules,
  workflows, and entrypoints. Workflows must not depend on TanStack routes,
  Cloudflare binding types, browser state, or provider transport payloads.
- Keep provider integrations independent from app sign-in. Private server
  actions must verify the configured GitHub owner on every request.
- Edit content records under `content/`. Update the repository-root
  `.pages.yml` when their schema or media paths change.
- Generate `src/routeTree.gen.ts` with TanStack Router tooling.
- Run `pnpm check` and `pnpm build` from the repository root.
