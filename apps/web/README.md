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

- `profile.json` contains shared identity and contact fields.
- `professional.json`, `photography-page.json`, and `personal.json` contain page-specific sections and copy.
- `experiences.json` contains ordered professional timeline entries.
- `photography.json` contains ordered photo metadata.
- `places.json` contains travel locations.
- `life-events.json` contains personal milestones shown in the personal timeline.
- `flights.json` contains flight statistics and optional trace paths.

Public media lives in `public/media/photography` and `public/media/flights`. The
repository-root `.pages.yml` exposes these records and uploads in Pages CMS.

The `/admin` route redirects to the hosted Pages CMS editor for this repository.
CMS edits become ordinary Git commits, which can trigger a new deployment.

Each page loads and validates its own records through the matching Zod-backed
module in `src/content/`. JSON array position is the display order.

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

## Private music connection

The `/music` route uses GitHub for app sign-in and Spotify for music access. Apply
the local D1 migrations before signing in:

```bash
pnpm --filter @mdoultremont/portfolio db:migrate:local
```

Register a GitHub OAuth app callback at
`http://127.0.0.1:3000/api/auth/github/callback` for local use or
`https://mdoultremont.com/api/auth/github/callback` in production. Open the
local app at `http://127.0.0.1:3000/music` so both OAuth callbacks use the same
browser cookie host. Configure the numeric GitHub account ID of the only
permitted owner:

```text
GITHUB_CLIENT_ID=<GitHub OAuth app client ID>
GITHUB_CLIENT_SECRET=<GitHub OAuth app client secret>
GITHUB_OWNER_ID=<numeric GitHub account ID>
GITHUB_REDIRECT_URI=http://127.0.0.1:3000/api/auth/github/callback
```

Create a Spotify app with Web API access, and register the exact callback URL
`http://127.0.0.1:3000/api/spotify/callback` for local use or
`https://mdoultremont.com/api/spotify/callback` in production. Spotify
[allows HTTP loopback IP addresses](https://developer.spotify.com/blog/2025-02-12-increasing-the-security-requirements-for-integrating-with-spotify)
for local OAuth callbacks. In development mode, the Spotify app owner needs
Premium and each authorized account must be on the app's
[allowlist](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).

Set these values in an untracked `apps/web/.dev.vars` for local development and
as Worker secrets for deployment, alongside the GitHub values above:

```text
SPOTIFY_CLIENT_ID=<Spotify app client ID>
SPOTIFY_CLIENT_SECRET=<Spotify app client secret>
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/spotify/callback
SPOTIFY_TOKEN_ENCRYPTION_KEY=<base64 encoding of 32 random bytes>
```

Generate the encryption key with `openssl rand -base64 32`. Keep that key
stable while the Spotify connection exists; changing it makes the stored
refresh token unreadable and requires reconnecting. The server stores only an
encrypted refresh token, account identifiers, display name, scopes, and
connection status. Disconnect deletes this connection record and its dependent
music data while leaving GitHub sign-in intact. Connecting starts a full
ingestion of existing Liked Songs.

Classification uses [Jev](https://typesafe.ai). Set its API key with the
others:

```text
JEV_API_KEY=<TypeSafe API key>
```

## Music pipeline

The private `/music` area runs four steps: ingestion of Liked Songs,
enrichment from MusicBrainz and AcousticBrainz, classification with Jev once
you mark your playlists **Ready**, and delivery to Spotify on **Write now** or
automatically. See [music automation operation](../../docs/music-automation.md).

## Image runtime

The shared image feature in `src/features/images/` contains the responsive
image component, build-time metadata generator, and width policy. Responsive
image URLs use the TanStack Start server route in `src/routes/images.$.ts`,
exposed at `/images/...`. The Worker validates the source, version, and finite
width candidates from the generated image metadata, reads the original from
the current deployment through the `ASSETS` binding, and transforms it with
the Cloudflare Images `IMAGES` binding. Outputs are explicit WebP at quality
80; the browser does not need format negotiation. Static face images use
40/80/120px candidates and face sprites use 360/720/1080px candidates.

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
