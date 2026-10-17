# Portfolio web guide

- Keep this app limited to the portfolio UI, routes, and content loading. The
  private apps live in `apps/tools`, on `tools.mdoultremont.com`.
- Keep the portfolio free of a database, sign-in, and other backend services;
  its pages are prerendered and the Worker only serves assets and `/images/...`.
- Keep UI code under `src/features/<name>/`, one directory per feature.
- Edit content records under `content/`. Update the repository-root
  `.pages.yml` when their schema or media paths change.
- Style with the portfolio tokens in `src/styles.css` (`paper`, `ink`,
  `brand`, `muted-foreground`, …).
- Generate `src/routeTree.gen.ts` with TanStack Router tooling.
- Run `pnpm check` and `pnpm build` from the repository root.
