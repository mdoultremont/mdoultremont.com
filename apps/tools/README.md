# Tools

The private apps, served at `tools.mdoultremont.com`. It is a TanStack Start
app on Cloudflare Workers, with D1, R2, a queue, and an hourly cron. The public
portfolio is a separate app in `apps/web`.

## Run locally

```bash
pnpm dev:tools
```

Install dependencies once from the repository root. Run the command above from
the root, or `pnpm dev` directly from this `apps/tools` directory.

## Sign-in and the music connection

The private apps live on `tools.mdoultremont.com`: the music app at `/music`,
the flight logbook at `/flights`, and the back office at `/back-office`. The
home page lists the apps a user can open. A pathless layout signs users in with
[Better Auth](https://www.better-auth.com), through GitHub or Spotify, and each
user may use only the apps they have access to. The music app adds a separate
Spotify connection for music access. Apply the local D1 migrations before signing in:

```bash
pnpm --filter @mdoultremont/tools db:migrate:local
```

Open the local app at `http://127.0.0.1:3000/music`, not `localhost`: Spotify
rejects `localhost` callbacks, and every callback must use the same cookie
host.

Register a GitHub OAuth app with the callback
`http://127.0.0.1:3000/api/auth/callback/github` for local use, or
`https://tools.mdoultremont.com/api/auth/callback/github` in production.
`OWNER_ACCOUNTS` lists the owner's accounts as `provider:accountId` pairs: the
numeric GitHub account ID and the Spotify user ID. While nobody has access to
the back office (on a fresh database), these accounts can sign in and receive
every app. Everyone else signs up through an invitation from the back office.

```text
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=http://127.0.0.1:3000
OWNER_ACCOUNTS=github:<numeric GitHub account ID>,spotify:<Spotify user ID>
GITHUB_CLIENT_ID=<GitHub OAuth app client ID>
GITHUB_CLIENT_SECRET=<GitHub OAuth app client secret>
```

In production, `BETTER_AUTH_URL` is `https://tools.mdoultremont.com`. Changing
`BETTER_AUTH_SECRET` signs everyone out.

To add another provider to a user, sign in and use "Also sign in with …".
Accounts are never linked because their emails match.

Invitations are emailed through
[Cloudflare Email Service](https://developers.cloudflare.com/email-service/) via
the `EMAIL` binding, from `EMAIL_FROM` (an address on a domain onboarded with
`pnpm exec wrangler email sending enable mdoultremont.com`). Local development
uses Wrangler's email simulator, which does not deliver mail; the invitation
link is in the logged message.

```text
EMAIL_FROM=apps@mdoultremont.com
```

A Spotify app in development mode only signs in accounts on its allowlist
(see below), so add Spotify users there before they accept an invitation, or
have them use GitHub.

Create a Spotify app with Web API access, and register two exact callback
URLs, one for the music connection and one for sign-in:
`http://127.0.0.1:3000/api/music/spotify/callback` and
`http://127.0.0.1:3000/api/auth/callback/spotify` for local use, or the same
paths on `https://tools.mdoultremont.com` in production. Spotify
[allows HTTP loopback IP addresses](https://developer.spotify.com/blog/2025-02-12-increasing-the-security-requirements-for-integrating-with-spotify)
for local OAuth callbacks. In development mode, the Spotify app owner needs
Premium and each authorized account must be on the app's
[allowlist](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).

Set these values in an untracked `apps/tools/.dev.vars` for local development and
as Worker secrets for deployment, alongside the sign-in values above:

```text
SPOTIFY_CLIENT_ID=<Spotify app client ID>
SPOTIFY_CLIENT_SECRET=<Spotify app client secret>
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/music/spotify/callback
SPOTIFY_TOKEN_ENCRYPTION_KEY=<base64 encoding of 32 random bytes>
```

Generate the encryption key with `openssl rand -base64 32`. Keep that key
stable while the Spotify connection exists; changing it makes the stored
refresh token unreadable and requires reconnecting. The server stores only an
encrypted refresh token, account identifiers, display name, scopes, and
connection status. Disconnect deletes this connection record and its dependent
music data while leaving sign-in intact. Connecting starts a full
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

## Checks

```bash
pnpm check
pnpm build
PLAYWRIGHT_CHANNEL=chrome pnpm --filter @mdoultremont/tools exec playwright test
```
