# Private apps live in their own app

The private apps (music, flights, back office) started under `/apps` inside
the portfolio app. They brought D1, R2, a queue, a cron, email, and Better Auth
into a Worker whose public pages use none of them. Both sides also shared one
stylesheet, so the apps' shadcn theme had to be scoped to pages that rendered a
`[data-app-shell]` marker to keep it off the portfolio.

## Decision

- **The private apps are their own deployable app, `apps/tools`, served at
  `tools.mdoultremont.com`.** The portfolio, `apps/web`, keeps only its
  prerendered pages, content, and the `/images/...` route.
- **Paths drop the `/apps` prefix.** The apps index is the tools home page,
  each app sits at `/<name>`, and its API at `/api/<name>/...`. A pathless
  `_apps` layout signs users in for every page.
- **Old `/apps` URLs are not redirected.** Only the owner used them.
- **The tools Worker is the existing `mdoultremont-me` Worker, renamed
  `mdoultremont-tools`.** Its secrets cannot be read back from Cloudflare, so
  moving the backend to a new Worker would mean re-entering every one, and a
  changed `BETTER_AUTH_SECRET` or `SPOTIFY_TOKEN_ENCRYPTION_KEY` would sign
  everyone out and drop the Spotify connection. The portfolio moves to a new Worker, `mdoultremont-portfolio`,
  which needs no secrets.
- **The portfolio and tools have independent UI code.** The shadcn components
  moved to tools with the apps. [ADR 0004](0004-tools-application-package-boundaries.md)
  defines the packages shared by the tools clients and backend.

## Consequences

- Each app has its own theme in its own `src/styles.css`, with no scoping
  workaround. `dark:` applies everywhere in tools.
- Sessions are bound to the new host, so everyone signs in again once.
- The GitHub and Spotify OAuth apps, `BETTER_AUTH_URL`, and
  `SPOTIFY_REDIRECT_URI` point at `tools.mdoultremont.com`.
- Two Workers Builds configurations deploy the repository, one per Worker (see
  `docs/deploy-to-cloudflare.md`).
