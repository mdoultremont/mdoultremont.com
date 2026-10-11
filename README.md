# mdoultremont.com

Matthieu's personal monorepo. The portfolio web app lives in `apps/web/`.
Pages CMS uses the repository-root `.pages.yml` to manage its content and media.

## Develop

Install dependencies and run the app from the repository root:

```bash
pnpm dev
pnpm check
pnpm build
```

Run `pnpm deploy` to build and deploy the portfolio to Cloudflare.

In a new git worktree, run `scripts/setup-worktree.sh`. It copies the
git-ignored local files listed in `.worktreeinclude` (such as
`apps/web/.dev.vars`) from the main checkout, then installs dependencies. Keep
the real copies of those files in the main checkout.

See [Deploy to Cloudflare](docs/deploy-to-cloudflare.md) for the GitHub Actions
setup and the first deployment checklist.

Image delivery lives in `apps/web/src/features/images/`. Its build-time
metadata generator and responsive image component share the width policy there;
the TanStack Start route at `apps/web/src/routes/images.$.ts` owns the
versioned `/images/...` transform endpoint.
