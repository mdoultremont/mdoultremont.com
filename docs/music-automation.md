# Music automation operation

Issue #16's backend is local to `apps/web/src/backend`: primitives own D1,
modules own provider and storage capabilities, workflows own behavior, and
HTTP/queue/cron entrypoints dispatch into those workflows. Effect is pinned to
`4.0.0-rc.118`.

## Current launch state

The live policy in `modules/music-run-runtime.ts` is closed. Runs discover
current likes, resolve only CC0 recording evidence, save progress, and report
status. They make **no Jev calls and no playlist additions**, including review
playlist additions. Dry runs do not advance the live discovery checkpoint or
record playlist delivery, so likes remain eligible when the gate eventually
opens. Playlist creation requested explicitly through configuration remains
available and creates private playlists.

Absent ISRCs, ambiguous MusicBrainz matches, or absent AcousticBrainz recording
data produce an abstention. The portable sync workflow selects the review
playlist for abstentions, and reconciles exact Spotify IDs before every write
when writes are enabled. Spotify metadata stays outside the model request.
See [the input policy](spotify-classifier-input-policy.md).

An owner-labeled evaluation is still required. Do not open the live gate merely
because tests pass. Record clear, overlapping, and ambiguous CC0 examples;
record the selected exact Jev model version, input policy version, probability
threshold, destination rules, expected labels, actual decisions, abstentions,
and errors. Establish useful precision and coverage with the owner before
changing the policy. The threshold of 1 in the closed policy is a placeholder,
not an evaluated threshold. A model-version change must change the decision
fingerprint. Jev availability and the authenticated response contract must
also be verified before launch. No evaluation labels were invented here.

## Configuration and deployment

The existing Worker needs D1 and the `MUSIC_BASELINE_QUEUE` binding. The same
queue dispatches baseline and music-run messages by their `kind`; consumers
process one page or at most five tracks per invocation. Consumer concurrency
is one, and continuation messages are delayed two seconds to preserve the
MusicBrainz request spacing across deliveries. Configure the hourly cron
`0 * * * *` and apply all migrations before using the control area:

```sh
pnpm --filter @mdoultremont/portfolio db:migrate:local
# For an authorized deployment, apply the same migrations remotely first:
pnpm --filter @mdoultremont/portfolio exec wrangler d1 migrations apply mdoultremont-music --remote
```

Set the GitHub and Spotify secrets described in `apps/web/README.md`. A Jev key
will be needed only after evaluation; the closed runtime does not use it.
The owner ID must be the configured GitHub numeric account ID. Provisioning,
remote migration, OAuth connection, and deployment were not performed by this
implementation.

## Runs and recovery

The initial baseline inventories historical IDs without processing them.
Catch-up scans every current Liked Songs page, includes checkpoint ties and a
one-minute overlap, and excludes initial-baseline history. Full and full
reclassification scan current likes afresh, including historical likes.
The latter bypasses saved decisions once model calls are permitted. Saved
decisions include permitted-input, enabled-destination rule, classifier-version,
and threshold fingerprints. Catch-up respects recorded deliveries; full runs
can restore manually removed entries. No mode removes likes or playlist items.

An owner-level partial unique index prevents concurrent active starts. Queue
processing acquires a conditional lease before reading/advancing run state;
continuation is sent after releasing it. Leases last twenty minutes, exceeding
Cloudflare's queue invocation lifetime. Redelivery resumes saved progress.
Hourly cron also re-enqueues stranded active runs, even when scheduling is
paused. Disabling automation affects new scheduled starts only; manual starts
remain available.

Discovery inserts each page and advances its cursor atomically. The live
checkpoint advances only with the final durable discovery page, independently
of later track failures. Transient provider failures remain pending and rotate behind untried tracks.
Queue redelivery uses exponential backoff and honors provider Retry-After, with
at most ten durable transient attempts per track. Permanent failures and exhausted
retries finish as failed track work without preventing later tracks from progressing.
Successful recovery retires historical failed copies of the same exact track ID,
and subsequent catch-up runs exclude already recovered work. Runs with failures report `failed`; starting another run imports their
unfinished track IDs independently of the timestamp checkpoint. Repeated
queue/provider failures produce a persisted actionable error. Remote write
retries always inspect playlist membership before adding; this is reconciliation,
not cross-system exactly-once delivery.

Disconnect cascades stored configuration, baseline, checkpoints, runs, decisions,
and delivery records, while retaining app identity. The private `/music` route
and API routes are excluded from public prerendering.

## Validation

Run `pnpm check` and `pnpm build` at the repository root. Focused browser checks:

```sh
pnpm --filter @mdoultremont/portfolio exec playwright test tests/browser/music.spec.ts tests/browser/destinations.spec.ts tests/browser/music-runs.spec.ts
```

The browser configuration smoke tests mount real UI modules with controlled API
responses; they do not claim a live GitHub/Spotify OAuth round trip or provider
writes. Workflow tests and SQLite-backed module tests cover durable discovery,
cutoff ties, batching, overlap coordination, pause/manual starts, partial failure,
checkpoint preservation, dry-run delivery gating, and disconnect cleanup.
