# Music automation operation

The private `/music` area sorts the owner's Spotify Liked Songs into playlists.
Vocabulary is defined in `CONTEXT.md` (Music control area); code structure and
Effect patterns are in `apps/web/src/backend/README.md`.

## Pipeline

Four steps, each re-runnable on its own:

| Step           | Reads                                    | Writes            | Runs when                                                 |
| -------------- | ---------------------------------------- | ----------------- | --------------------------------------------------------- |
| Ingestion      | Spotify Liked Songs                      | liked tracks      | Spotify connects; hourly; "Check for new likes"           |
| Enrichment     | MusicBrainz, AcousticBrainz (by ISRC)    | recording data    | an ingestion page adds likes; hourly while pending        |
| Classification | recording data + destination description | decisions         | the owner sets **Ready**; after enrichment; "Reclassify"  |
| Delivery       | decisions                                | Spotify playlists | **Write now**; after classification if automatic delivery |

- **Ingestion.** A full ingestion reads every page and marks likes it no longer
  finds as un-liked; it runs on connect and then once a day. An incremental
  ingestion stops at the first like already stored; it runs every other hour.
  One ingestion runs at a time per owner.
- **Enrichment.** Recording data is stored per ISRC, so re-ingesting never
  repeats a lookup. An ISRC with several MusicBrainz recordings is stored as
  ambiguous rather than guessed. AcousticBrainz only knows recordings analysed
  before 2022; newer ones get MusicBrainz data only. "Look up unresolved tracks
  again" retries not-found, ambiguous, and failed ISRCs.
- **Classification.** Jev (`jev-1.13.0`, pinned) answers one yes/no question
  per enabled destination. Destinations at 0.5 or more are accepted; otherwise
  the track goes to review. Tracks without recording data go to review without
  a Jev call. Only recording data reaches Jev; see
  [the input policy](spotify-classifier-input-policy.md). Each decision
  records a fingerprint of the destinations it used, so changing destinations
  marks decisions as outdated until the owner reclassifies.
- **Delivery.** Adds each decided track to its enabled destinations, or to the
  review playlist. It only adds, never removes; it re-checks that each track is
  still liked right before writing. Writes are recorded as pending first; a
  pending write is checked against the playlist before being retried, so a lost
  response does not duplicate a track.

## Queue and cron

All steps share the site's job queue (binding `JOBS`, queue
`mdoultremont-jobs`), with consumer concurrency one. Each message
names its step (`music.ingestion`, `music.enrichment`, `music.classification`,
`music.delivery`) and processes one batch, queuing the next while work remains.
After a batch, the pipeline queues the next step when it has work.

Retryable failures (rate limits, provider outages, storage errors) retry with
exponential backoff, honouring `Retry-After`, for up to ten attempts. Other
failures stop: an ingestion is marked failed with its reason, and other steps
leave their work pending.

The hourly cron (`0 * * * *`) runs the upkeep: it starts the due ingestion,
re-sends a stalled ingestion's message after ten minutes, and resumes every
step with pending work.

## Configuration and deployment

Worker variables and secrets: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
`GITHUB_OWNER_ID`, `GITHUB_REDIRECT_URI`, `SPOTIFY_CLIENT_ID`,
`SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI`,
`SPOTIFY_TOKEN_ENCRYPTION_KEY`, `JEV_API_KEY`. See `apps/web/README.md` for
how to obtain each. A missing variable returns 503 from the routes that need it.

Bindings: D1 `DB` (`mdoultremont-data`), queue `JOBS`, and the hourly
cron. Production deploys apply migrations automatically (see
[deploying](deploy-to-cloudflare.md)); locally, run:

```sh
pnpm --filter @mdoultremont/portfolio db:migrate:local
```

Disconnecting Spotify deletes the connection and, through foreign keys, every
liked track, decision, delivery record, destination, and setting of the owner.
Recording data is kept, since it is shared CC0 data keyed by ISRC.

## Validation

Run `pnpm check` and `pnpm build` at the repository root. Stores are tested
against in-memory SQLite with the real migrations; provider modules against
mocked `fetch` responses shaped like recorded live responses. Browser tests
(`pnpm --filter @mdoultremont/portfolio exec playwright test`) mount the UI
with controlled API responses; they do not perform a live OAuth round trip.
