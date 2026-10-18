# Deploy to Cloudflare

The repository deploys two Workers, each from its own Cloudflare Workers
Builds configuration on the same GitHub repository:

| App          | Worker                   | Domain                   |
| ------------ | ------------------------ | ------------------------ |
| `apps/web`   | `mdoultremont-portfolio` | `mdoultremont.com`       |
| `apps/tools` | `mdoultremont-tools`     | `tools.mdoultremont.com` |

The tools Worker is the original `mdoultremont-me` Worker, renamed in the
dashboard (**Settings > General**), because its secrets (sign-in, Spotify)
are stored on it and cannot be read back. Renaming keeps its secrets,
bindings, domains, and build configuration.

A push to `main` starts both production builds. The tools build applies
pending D1 migrations to `mdoultremont-data` before it deploys; the portfolio
has no database. Pushes to other branches create preview builds of the
portfolio only: the tools have no staging database, so a tools preview would
run against production data.

GitHub Actions checks formatting, linting, types, and the production builds.
It does not deploy.

## Cloudflare build configuration

Both Workers use:

- Git repository: `matthieudou/mdoultremont.com`
- Production branch: `main`
- Root directory: `/`

The portfolio (`mdoultremont-portfolio`):

- Build command: none
- Deploy command: `pnpm --filter @mdoultremont/portfolio deploy:production`
- Previews Base: builds for preview branches on, build command none,
  preview command `pnpm --filter @mdoultremont/portfolio deploy:preview`

`deploy:preview` runs `wrangler preview`, which publishes the branch as a
Workers Preview. Previews do not inherit the top-level bindings: each one the
portfolio uses must also appear in the `previews` block of
`apps/web/wrangler.jsonc`, and the command fails if that block is missing.

The tools (`mdoultremont-tools`):

- Build command: none
- Deploy command: `pnpm --filter @mdoultremont/tools deploy:production`
- Previews Base: builds for preview branches off

Each app's `deploy:production` script, and the portfolio's `deploy:preview`,
build the app themselves, so the same command works in Workers Builds and on
your computer. Leave the build command empty; setting one would build twice.

To skip builds that cannot change a Worker, set its build watch paths to its
app directory (`apps/web/*` or `apps/tools/*`) plus the root `package.json`,
`pnpm-lock.yaml`, and `pnpm-workspace.yaml`.

For the tools, `deploy:production` builds the app, runs `wrangler d1
migrations apply mdoultremont-data --remote`, and then `wrangler deploy`.
Wrangler records applied migrations in the database, so a deploy without new
migrations only builds and deploys. A failed build or migration stops the
command before the deploy, leaving the previous Worker running. Wrangler answers its confirmation prompt with yes in
the build.

Do not turn tools previews back on: a preview version would share the
production database binding.

The tools build's API token needs **D1: Edit** for the migration step. If the
migration step fails with an authentication error, add that permission to the
token in **Workers & Pages > mdoultremont-tools > Settings > Build**.

## Tools secrets

Set these on `mdoultremont-tools` with `wrangler secret put` (from `apps/tools`)
or in **Settings > Variables and Secrets**. `apps/tools/README.md` explains
each one.

- `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (`https://tools.mdoultremont.com`)
- `OWNER_ACCOUNTS`
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_TOKEN_ENCRYPTION_KEY`
- `SPOTIFY_REDIRECT_URI`
  (`https://tools.mdoultremont.com/api/music/spotify/callback`)

Classification needs no secret. The Worker calls Clef through the `AI`
binding, billed with the Workers plan.

The portfolio needs no secrets.

## R2 bucket

The tools Worker binds the R2 bucket `mdoultremont-files` as `FILES` (flight
tracks and original files; see `docs/flights.md`). Create it once, before the
first deploy that includes the binding, or the deploy fails:

```sh
wrangler r2 bucket create mdoultremont-files
```

The build's API token needs **Workers R2 Storage: Edit** only for creating the
bucket by hand; deploying a Worker with an existing bucket binding needs no
extra permission. Preview versions share the production bucket, like the
database.

## Writing migrations

Migrations run a few seconds before the new Worker replaces the old one, so
each migration must keep the previously deployed code working. Adding tables,
nullable columns, or columns with defaults is safe. To rename or drop a column,
first deploy code that no longer uses it, then remove it in a later migration.

The repository-root pnpm workspace installs the app dependencies. Wrangler
reads each app's `wrangler.jsonc`, which declares the Worker name and custom
domain.

## Check a deployment

Open **Workers & Pages > _Worker_ > Deployments** in Cloudflare. A successful
production deployment shows the `main` commit and its build log.

Then check the live responses:

```bash
curl --fail --head https://mdoultremont.com
curl --fail --head https://tools.mdoultremont.com
```

## Deploy from your computer

Authenticate Wrangler once, then run the root deployment command. It runs
each app's `deploy:production`, exactly like the production builds:

```bash
pnpm --dir apps/tools exec wrangler login
pnpm deploy:production
```

To deploy one app, run `pnpm --filter @mdoultremont/tools deploy:production`
(or `@mdoultremont/portfolio`).

Run `pnpm --dir apps/tools exec wrangler whoami` to check the active Cloudflare
account before a local deployment.
