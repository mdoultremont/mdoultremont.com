# mdoultremont.com

Matthieu's personal monorepo, with two deployed sites:

- `apps/web/`: the public portfolio at `mdoultremont.com`. Pages CMS uses the
  repository-root `.pages.yml` to manage its content and media.
- `apps/tools/`: the private apps (music, flights, back office) at
  `tools.mdoultremont.com`. Its backend lives in `apps/tools-backend`, mounted
  into the same Worker. `apps/tools-cli` is a separate remote HTTP client.

`packages/tools-contracts` holds action declarations, schemas, and the typed
HTTP client. The backend owns flight parsing, measurements, and profiles;
the web client renders the results returned by its actions.

## Develop

Install dependencies and run the apps from the repository root:

```bash
pnpm dev        # both apps: tools on 127.0.0.1:3000, the portfolio on :3001
pnpm dev:web    # only the portfolio
pnpm dev:tools  # only the private apps
pnpm check
pnpm build
```

Run `pnpm deploy:production` to build and deploy both apps to Cloudflare.

In a new git worktree, run `scripts/setup-worktree.sh`. It copies the
git-ignored local files listed in `.worktreeinclude` (such as
`apps/tools/.dev.vars`) from the main checkout, then installs dependencies. Keep
the real copies of those files in the main checkout.

See [Deploy to Cloudflare](docs/deploy-to-cloudflare.md) for the GitHub Actions
setup and the first deployment checklist.

Image delivery lives in `apps/web/src/features/images/`. Its build-time
metadata generator and responsive image component share the width policy there;
the TanStack Start route at `apps/web/src/routes/images.$.ts` owns the
versioned `/images/...` transform endpoint.
