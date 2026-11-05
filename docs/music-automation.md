# Music automation operation

The private music area (`/music` on `tools.mdoultremont.com`) sorts tracks from the owner's enabled Spotify sources into destination playlists.
Vocabulary is defined in `CONTEXT.md` (Music control area); code structure and
Effect patterns are in `apps/tools-backend/README.md`.

## Pipeline

Four steps, each re-runnable on its own:

| Step           | Reads                                    | Writes                                  | Runs when                                                          |
| -------------- | ---------------------------------------- | --------------------------------------- | ------------------------------------------------------------------ |
| Ingestion      | enabled Spotify sources                  | collected tracks and source memberships | Spotify connects; source added or enabled; hourly; "Check for new" |
| Enrichment     | MusicBrainz, AcousticBrainz, tag sources | recording data                          | an ingestion page adds source entries; hourly while pending        |
| Classification | recording data + destination description | decisions                               | the owner sets **Ready**; after enrichment; "Reclassify"           |
| Delivery       | decisions                                | Spotify playlists                       | **Write now**; after classification if automatic delivery          |

- **Ingestion.** Reads one source per ingestion. Liked Songs is built in and
  can be disabled. Owners can add their own playlists, such as My Shazam Tracks,
  then disable or remove them. Sources are never changed and cannot also be
  destinations or the review playlist. A full ingestion reads every page.
  Liked Songs incremental reads stop at the first known like. Playlist
  incremental reads first compare Spotify's snapshot with the last completed
  read, skipping unchanged playlists and reading every page of changed ones.
  The snapshot is saved on completion. A read of every page marks missing
  memberships as removed from that source. Each enabled source runs hourly,
  with a full read daily. One ingestion runs at a time per source.
- **Enrichment.** Recording data is stored per ISRC, so re-ingesting never
  repeats a lookup. An ISRC MusicBrainz does not know is searched by title and
  artist. An ISRC naming several recordings takes the one matching the track's
  title and artist, or the first when all name the same song; otherwise it is
  stored as ambiguous rather than guessed. AcousticBrainz only knows
  recordings analysed before 2022. Last.fm, Discogs, and ListenBrainz then add
  tags; see [tag sources](spotify-classifier-input-policy.md#tag-sources).
  Last.fm and Discogs are skipped until their secret is set, and recordings
  found earlier are asked once a source is configured. "Look up unresolved
  tracks again" retries not-found, ambiguous, and failed ISRCs, and tag
  sources that found nothing or failed. A track sent to review for lack of
  recording data is classified again once a retry finds its recording. Other
  decisions are not redone when tags arrive later, such as after setting a
  tag source's secret; press "Reclassify" to use them.
- **Classification.** Clef, Cloudflare's decision model, answers one yes/no
  question per enabled destination through the Workers AI binding.
  Destinations at 0.5 or more are accepted; otherwise the track goes to
  review. Tracks without recording data go to review without a Clef call.
  Only recording data reaches Clef; see
  [the input policy](spotify-classifier-input-policy.md). Each decision
  records a fingerprint of the model name and destinations it used, so
  changing either marks decisions as outdated until the owner reclassifies.
- **Delivery.** Adds each eligible decided track to its enabled destinations,
  or to the review playlist. It never removes tracks. Right before a write,
  delivery re-checks present memberships in an enabled Liked Songs source.
  A missing like clears that membership. A track remains eligible while it is
  present in any enabled source. Playlist-only tracks use the latest ingestion
  without a playlist re-read. Removed tracks keep recording data and decisions,
  and earlier deliveries stay in Spotify. Writes are recorded as pending first.
  A pending write is checked against the destination playlist before a retry,
  so a lost response does not duplicate a track.

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

The hourly cron (`0 * * * *`) starts each enabled source's due ingestion,
re-sends stalled ingestions' messages after ten minutes, and resumes every
step with pending work.

## Configuration and deployment

Worker variables and secrets: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
`OWNER_ACCOUNTS`, `EMAIL_FROM`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SPOTIFY_CLIENT_ID`,
`SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI`,
`SPOTIFY_TOKEN_ENCRYPTION_KEY`, and optionally `LASTFM_API_KEY` and
`DISCOGS_TOKEN`. See `apps/tools/README.md` for
how to obtain each. A missing variable returns 503 from the routes that need it.

Bindings: D1 `DB` (`mdoultremont-data`), queue `JOBS`, Workers AI `AI`, and the hourly
cron. Production deploys apply migrations automatically (see
[deploying](deploy-to-cloudflare.md)); locally, run:

```sh
pnpm --filter @mdoultremont/tools db:migrate:local
```

Disconnecting Spotify deletes the connection and, through foreign keys, every
source, source membership, collected track, decision, delivery record,
destination, and setting of the owner.
Recording data is kept, since it is shared data keyed by ISRC.

## Validation

Run `pnpm check` and `pnpm build` at the repository root. Stores are tested
against in-memory SQLite with the real migrations; provider modules against
mocked `fetch` responses shaped like recorded live responses. Browser tests
(`pnpm --filter @mdoultremont/tools exec playwright test`) mount the UI
with controlled API responses; they do not perform a live OAuth round trip.
