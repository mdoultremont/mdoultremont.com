# mdoultremont.com

The portfolio is a TanStack Start app. Git is its content database and Pages CMS is the editing UI.

## Run locally

```bash
pnpm dev
```

Install dependencies once from the repository root. Run the command above from
the root or directly from this `apps/web` directory.

## Content

Editable records live in `content/`:

- `profile.json` contains shared identity, contact, and professional introduction fields.
- `pages.json` contains editable headings and introductory copy.
- `experiences.json` contains ordered professional timeline entries.
- `photography.json` contains ordered photo metadata.
- `places.json` contains travel locations.
- `life-events.json` contains personal milestones shown in the personal timeline.
- `flights.json` contains flight statistics and optional trace paths.

Public media lives in `public/media/photography` and `public/media/flights`. The
repository-root `.pages.yml` exposes these records and uploads in Pages CMS.

The `/admin` route redirects to the hosted Pages CMS editor for this repository.
CMS edits become ordinary Git commits, which can trigger a new deployment.

## Checks

```bash
pnpm check
pnpm build
```

Oxlint handles linting, Oxfmt handles formatting, and TypeScript runs separately. React Compiler is enabled through the Vite integration.

## Routes

- `/` contains the professional profile and experience timeline.
- `/photography` contains the photo grid and lightbox.
- `/personal` contains travel, cooking, and paragliding content.
- `/admin` opens the content editor.

The app currently targets Cloudflare Workers through the Cloudflare Vite plugin.

## Image runtime

Responsive image URLs use the TanStack Start server route in
`src/routes/images.$.ts`, exposed at `/images/...`. The Worker
validates the source, version, and finite width candidates from the generated
image metadata, reads the original from the current deployment through the
`ASSETS` binding, and transforms it with the Cloudflare Images `IMAGES`
binding. Outputs are explicit WebP at quality 80; the browser does not need
format negotiation. Static face images use 40/80/120px candidates and face
sprites use 360/720/1080px candidates.

Successful variants use a versioned path/width cache key with a long immutable
TTL. A transform error logs the failure and returns the original with an
uncached response. Binding types are generated with `pnpm exec wrangler types`
into `worker-configuration.d.ts` after Wrangler configuration changes.

The Cloudflare Vite plugin simulates the Images binding during `pnpm dev`.
Local resizing and output format work offline; production encoder quality can
vary from the local simulation. Preview deployments use their own bundled
assets, including when Cloudflare Access protects the preview. No production
image origin or `/cdn-cgi/image` zone configuration is required.

Run the unmocked image delivery checks from the repository root:

```bash
PLAYWRIGHT_CHANNEL=chrome pnpm --filter @mdoultremont/portfolio exec playwright test
```

See [Cloudflare's Images binding documentation](https://developers.cloudflare.com/images/optimization/binding/).
