# Deploy to Cloudflare

Cloudflare Workers Builds deploys `apps/web` from the GitHub repository. A
push to `main` starts the production build: it applies pending D1 migrations
to `mdoultremont-data`, then deploys the Worker. Pushes to other branches
create preview builds, which never migrate.

GitHub Actions checks formatting, linting, types, and the production build. It
does not deploy.

## Cloudflare build configuration

Configure the Worker with these values:

- Git repository: `matthieudou/mdoultremont.com`
- Production branch: `main`
- Root directory: `/`
- Build command: `pnpm build`
- Deploy command: `pnpm --filter @mdoultremont/portfolio deploy:production`
- Version command: `pnpm --filter @mdoultremont/portfolio exec wrangler versions upload`

`deploy:production` runs `wrangler d1 migrations apply mdoultremont-data
--remote` and then `wrangler deploy`. Wrangler records applied migrations in
the database, so a deploy without new migrations only deploys. A failed
migration stops the build before the deploy, leaving the previous Worker
running. Wrangler answers its confirmation prompt with yes in the build.

Preview versions share the production database binding, so the version
command must not apply migrations.

The build's API token needs **D1: Edit** for the migration step. If the
migration step fails with an authentication error, add that permission to the
token in **Workers & Pages > mdoultremont-me > Settings > Build**.

## Writing migrations

Migrations run a few seconds before the new Worker replaces the old one, so
each migration must keep the previously deployed code working. Adding tables,
nullable columns, or columns with defaults is safe. To rename or drop a column,
first deploy code that no longer uses it, then remove it in a later migration.

The repository-root pnpm workspace installs the app dependencies. Wrangler
reads `apps/web/wrangler.jsonc`, which declares the Worker name and custom
domain.

## Check a deployment

Open **Workers & Pages > mdoultremont-me > Deployments** in Cloudflare. A
successful production deployment shows the `main` commit and its build log.

Then check the live response:

```bash
curl --fail --head https://mdoultremont.com
```

## Deploy from your computer

Authenticate Wrangler once, then run the root deployment command. It builds,
applies pending migrations, and deploys, like the production build:

```bash
pnpm --dir apps/web exec wrangler login
pnpm deploy
```

Run `pnpm --dir apps/web exec wrangler whoami` to check the active Cloudflare
account before a local deployment.
