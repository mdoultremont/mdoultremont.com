# Flight logbook

Flights brings the paragliding prototype into the private apps, at `/flights`
on `tools.mdoultremont.com`. The prototype's README, implementation plan, and import research
in `apps/flights/` in the source checkout are the historical references. Its
standalone PostgreSQL server, password authentication, Docker deployment, and
public `/flights` routes are not the web integration architecture.

## Backend track processing

`apps/tools-backend/src/actions/flights/track/index.ts` is the backend unit
for track parsing, measurements, and profiles. The importer and flight detail
action use it. GPX parsing uses `fast-xml-parser`; IGC parsing uses the
prototype's fixed-width parser.

A track point is `[UTC epoch milliseconds, latitude, longitude, GPS altitude
or null, barometric altitude or null]`. Coordinates use degrees and altitude
uses metres. Parsers normalize ordering and remove duplicate timestamps.
Metrics require at least two valid points with strictly increasing timestamps.

The flight detail action returns the full point array and nullable `analysis`.
Analysis contains the detected takeoff and landing indices, the takeoff
timestamp, and the full airborne profile. The viewer and share image use
those results. The browser owns chart sampling, cursor selection, map
projection, formatting, and image composition.

Parsing, measurement, and profile tests and fixtures live beside the backend
implementation. Chart sampling tests live with the viewer. Run them from the
repository root:

```sh
pnpm --filter @mdoultremont/tools-backend test
pnpm --filter @mdoultremont/tools test
```

## Import research carried forward

The prototype research is dated **2026-10-15**. The notes below preserve its
findings and uncertainty; they are not a fresh verification of vendor services.

- **Syride:** manual IGC or GPX import is the supported path. With the instrument
  powered on and connected by USB, use SYS PC Tool's **Download recorded
  flights**, then **File → open local directory** to find local exports. The
  research found this workflow in the [XL computer upload manual](https://manuals.syride.com/xl-english-manual/xv.-uploading-your-flights/using-a-computer.md)
  and the [Nav V3 transfer manual](https://manuals.syride.com/nav-v3-english-manual/xv.-transfer-your-flights.md).
  Prefer IGC for its separate pressure and GNSS altitude fields. KML and Syride
  SDF are not supported inputs.
- **Vendor sync:** the research found no documented Syride public API; absence
  from the reviewed pages does not prove none exists. Syride website downloads,
  mobile file sharing, and scraping terms remained unconfirmed. Do not build
  scraping or live sync on these assumptions. The [Syride support page](https://www.syride.com/en/support)
  and [manuals index](https://manuals.syride.com/llms.txt) are starting points for
  further verification.
- **GPX:** [GPX 1.1](https://www.topografix.com/GPX/1/1/) defines tracks,
  segments, coordinates, optional elevations, and optional timestamps. The
  implementation requires timestamps with explicit zones on every imported
  point, accepts namespace prefixes and singleton nodes, concatenates tracks
  and segments, and sorts by time. It also accepts timestamped route points
  when no track fixes exist, preserving the prototype behavior. Waypoints-only
  files and planned routes without timestamps cannot supply a flight.
- **IGC:** preserve both `HFDTEDDMMYY` and `HFDTEDATE:DDMMYY,NN` date headers,
  fixed-width B records, signed altitude, southern/western coordinates, and UTC
  midnight rollover. Invalid (`V`) fixes are skipped. Small time reversals are
  sorted rather than treated as midnight; rollover requires a backward jump
  greater than 12 hours. B-record extensions do not shift the base fields.
  The prototype consulted the [IGC format reference](https://xp-soaring.github.io/igc_file_format/igc_format_2008.html),
  which links the recorder specification. G-record contest signatures are not
  validated; an imported or converted file makes no contest-eligibility claim.
- **Other instruments and logbooks:** import user-exported GPX or IGC from
  XCTrack, Flyskyhy, Oudie, and similar tools. The research found no confirmed
  public XContest or Leonardo integration. [Strava's API](https://developers.strava.com/docs/reference/)
  offers activity streams rather than a raw activity GPX download endpoint;
  vendor OAuth integrations remain outside this manual-import scope.
- **Maps and profiles:** the prototype uses MapLibre with a configurable
  OpenFreeMap style and Recharts with downsampled profiles. Preserve attribution
  and a fallback when tiles or canvas capture fail. The original research linked
  [OpenFreeMap setup](https://openfreemap.org/quick_start/) and
  [terms](https://openfreemap.org/tos/); availability and commercial-use questions
  were not settled by the prototype. Its chart-library comparison was not
  benchmarked.

Pilot and glider headers are advisory, not trusted identity or equipment
assignments. The prototype detects duplicates by original-text SHA-256 or a
takeoff within two minutes for the same user, and reuses prior site names within
500 metres. The earlier research proposed a start/position/duration heuristic;
the hash/time rule describes the implemented prototype behavior.

## Metrics and thresholds

Metrics estimate the recorded flight; they are not instrument certification,
optimized cross-country distance, or contest scoring. Calendar grouping and
display dates use UTC. Compute metrics from the full normalized track before
downsampling a profile to roughly 1,000 display samples.

| Measurement            | Definition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Takeoff and landing    | Ground stops separate runs: ground speed below 1.5 m/s and vertical rate below 0.2 m/s for at least 30 seconds. Missing altitude allows the quiet-ground test. Select the run with the greatest altitude range above 5 m, breaking ties by duration; without altitude range, select the longest run. Trim that run to sustained speed above 3 m/s or altitude change above 5 m with continuous motion. Detection windows span `max(10 seconds, median fix interval)` and reject spans exceeding `max(20 seconds, 3 × median interval)`. Continuous motion means each segment has speed above 3 m/s or an absolute altitude change above 0.05 m. Fall back to the run endpoints when no activity window qualifies. |
| Duration               | Landing timestamp minus takeoff timestamp, in seconds.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Distance               | Sum of haversine segments between airborne fixes, in metres. Segments exceeding 40 m/s contribute no distance. An isolated fix is omitted when both adjacent legs exceed 40 m/s but bypassing it does not. Original point indices remain available for map/profile synchronization.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Altitude               | Select one source for the whole track: GPS when at least 90% of points have it, otherwise barometric. Never fill gaps by switching sensors. IGC GNSS zero becomes missing only when every valid GNSS altitude is zero; pressure zero is retained. Maximum and arithmetic mean use observed airborne altitudes.                                                                                                                                                                                                                                                                                                                                                                                                    |
| Maximum speed          | Maximum ground speed over trailing five-second windows, interpolating at the window boundary. Use full windows when flight duration is at least five seconds; shorter flights use the available interval.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Elevation gain         | Sum of climbs with 2 m reversal hysteresis, suppressing small fluctuations while retaining gradual climbs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Maximum climb and sink | Strongest positive and negative vertical rates over the same five-second windows. Maximum sink is a positive magnitude.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Without altitude observations, altitude, elevation gain, climb, and sink metrics
are `null`; show a dash and omit them from records. Profiles preserve missing
altitude as `null`, while an unavailable per-sample vertical rate is zero.

A ground stop of at least 30 seconds separates a top landing and relaunch; only
the selected run contributes to a flight's metrics. Without a stop or altitude
evidence, vehicle travel cannot reliably be distinguished from flight. No
terrain model is used. Segment gaps are retained as elapsed time, not rebuilt
into a continuous recording, and may affect measurements.

## Private web integration

Use the portfolio's existing Better Auth sign-in and app access. The integration
places pages under `src/routes/_apps/`, the operations as actions (declared in
`packages/tools-contracts/src/flights/actions.ts`, bound in
`apps/tools-backend/src/entrypoints/actions/flights.ts`), and UI under
`src/features/flights/`. Register `flights` in the app access catalog and
private-app launcher, and wrap the page in `RequireApp`. Every action call
checks the `flights` app independently of the page guard.

Keep backend entrypoints, actions, and modules in their existing layers.
The browser reads flight measurements and profiles through action contracts
in `@mdoultremont/tools-contracts/flights`.
Load MapLibre and its worker only in the browser. Preserve the prototype's
linked map/profile cursor, original-file download, and client-side share image
with a projected-track fallback when map capture fails.

Every flight, source file, track, equipment item, list, aggregate, update, and
download must be scoped to the signed-in user's ID. Equipment assignments and
duplicate/site lookups must use that same ownership scope. App access permits
opening the logbook; it never permits reading another user's data.

### Storage and upload limits

Searchable flight metadata and calculated metrics live in ordinary D1 columns.
Binary data lives in R2 (binding `FILES`, bucket `mdoultremont-files`) through
the reusable `modules/object-storage` module, which knows nothing about flights:

| Object key                                   | Content                                                       |
| -------------------------------------------- | ------------------------------------------------------------- |
| `flights/{userId}/{flightId}/files/{fileId}` | The original upload, raw bytes, with its content type         |
| `flights/{userId}/{flightId}/track.json.gz`  | Gzipped JSON of the full track tuples (`modules/compression`) |

D1 keeps only metadata: `flight_files` has the object key, filename, format,
content type, byte size, and SHA-256 of the original; `flight_tracks` has the
object key, the SHA-256 and byte size of the uncompressed JSON, and the point
count. Compression retains the full track; profile downsampling does not change
stored data or metric calculations.

The only size limit is the **5 MB input limit**, checked before parsing (the
prototype expressed it as 10 MiB of UTF-8 text; the web boundary defines its
byte limit for both validation and UI messages). There is no per-value D1 cap
any more, and no storage-limit error. The shared parser has no storage policy.

Consistency rules (D1 and R2 cannot share a transaction):

- Import detects duplicates in D1 (same SHA-256, or a takeoff within two
  minutes) before writing anything to R2. Then it writes the R2 objects, then
  the D1 batch, so a flight row never points at a missing object. The batch
  keeps its conditional duplicate predicates, so concurrent uploads cannot both
  win. If the batch fails, or loses a concurrent race, the written objects are
  deleted best-effort (a cleanup failure is logged).
- Deleting a flight deletes the D1 rows first, then every object under
  `flights/{userId}/{flightId}/`. If R2 fails after D1 committed, the request
  still succeeds and the orphaned objects are logged
  (`Orphaned flight objects after delete`). Orphans are unreachable and only
  cost storage; remove them by deleting the prefix.
- Deleting a user account cascades D1 rows but not R2 objects; remove
  `flights/{userId}/` as part of any account purge.
- A row whose object is missing fails the read or download with a 500
  (`ObjectStorageError`, reason `MissingObject`).

### Access migration

The additive `0002_brave_calypso.sql` migration grants `flights` to existing
users with `backOffice` app access, excluding removed users. This follows
`0001_app_access.sql`'s `INSERT ... SELECT` approach but uses the established
administrator permission instead of granting every invited user a personal
logbook. The migration cannot read Worker `OWNER_ACCOUNTS` configuration.
Back-office administrators may grant Flights to additional users; fresh owner
bootstrap automatically grants every registered app, including Flights.

Keep deployment migrations compatible with the previous Worker while it still
runs. Introducing the app and its tables does not automatically migrate the
prototype's PostgreSQL records or password accounts. Any later data migration
must explicitly map an owner to a portfolio user and retain per-user ownership.

## Data model and API

The additive migration creates five tables: `flights` (searchable metadata and
metrics), `equipment` (a user's kit), `flight_equipment` (assignments),
`flight_tracks` (metadata of a flight's stored point array), and `flight_files`
(metadata of the stored original). User references target `auth_users`; deleting a
flight cascades to its track, originals, and equipment assignments. Retiring
gear preserves assignments and allows editing flights that already use it.
Retired gear cannot be newly assigned. Deleting gear removes its assignments.

Both tables keep a SHA-256, the uncompressed byte size, and the R2 object key.
`flight_tracks` also records the point count. The file hash is unique per user;
`flights(user_id, takeoff_at)` supports list filters and duplicate checks.
Import writes use one D1 `db.batch`, with duplicate predicates inside the
conditional flight insert so concurrent uploads cannot both win. A duplicate
returns the existing flight ID and leaves its original unchanged.

The API is the `flights.*` actions in `packages/tools-contracts/src/flights/actions.ts`
(Effect Schema), with DTO types in `schemas.ts` beside it. The browser calls
them through the typed client in `apps/tools/src/features/flights/api.ts` over
oRPC at `POST /api/rpc/flights/<name>`, for example `/api/rpc/flights/list` and
`/api/rpc/flights/equipment/create`. The same actions are served at their
declared routes under `/api/v1` (`GET /api/v1/flights`, `POST
/api/v1/flights/imports`, …) and listed by `GET /api/v1`. Every call requires
Flights access, and session-cookie changes must carry this site's Origin. A
request body is capped at 6,000,000 bytes. Failures carry a code and a readable
message: `UNAUTHORIZED` 401, `FORBIDDEN` 403, `BAD_REQUEST` 400 (invalid input
or a rejected value), `NOT_FOUND` 404, `PAYLOAD_TOO_LARGE` 413,
`SERVICE_UNAVAILABLE` 503 and `INTERNAL_SERVER_ERROR` 500 (database, object
storage, or compression failures).

- `list({ year? })` returns `{ flights }`, newest takeoff first; year is
  an optional integer from 1900 to 9998.
- `get({ flightId })` returns `{ flight, equipment, files, points, analysis }`.
  File records contain `id`, `filename`, `format`, `sha256`, and `sizeBytes`.
  Analysis is null for fewer than two recorded points. Otherwise it contains
  `takeoffIndex`, `landingIndex`, `takeoffAt`, and `profile`. Each profile
  sample contains its original point index `i`, elapsed seconds `tS`,
  nullable altitude `altM`, speed `speedKmh`, vertical speed `varioMps`,
  and cumulative distance `distKm`. Elapsed time starts at `analysis.takeoffAt`.
  The stored flight row remains the source for summary statistics.
- `update({ flightId, takeoffName, landingName, notes, equipmentIds })`
  returns `{ id }`. Names allow 200 characters; notes allow 10,000;
  assignments allow up to 100 equipment IDs. Blank names and notes become null.
- `delete({ flightId })` returns `{ id }` after cascading deletion.
- `import({ filename, text })` returns
  `{ status: "imported" | "duplicate", flightId }`. The JSON request is bounded
  at 6,000,000 bytes; decoded file text is bounded at 5,000,000 UTF-8 bytes.
  Heavy JSON escaping can reach the request cap first.
- `stats.get()` returns `{ totals, perMonth, perYear, records, recentFlights,
topSites }`. Totals contain flights, hours, and distanceM. UTC activity buckets
  contain period, flights, seconds, hours, and distanceM; the last twelve months
  include empty months. Records exclude null values. The response includes five
  recent flights and up to ten named takeoff sites ranked by flight count.
- `equipment.list()` returns `{ equipment }`, including retired items.
  `equipment.create(input)` and `equipment.update({ equipmentId, ...input })`
  take the full input `{ kind, name, notes, retired }` and return `{ equipment }`.
  Name length is 1-200, notes allow 5,000 characters, and kind is wing,
  harness, reserve, instrument, or other. `equipment.delete({ equipmentId })`
  returns `{ id }`.
- `files.download({ fileId })` returns the original file as
  `{ filename, contentType, sizeBytes, contentBase64 }` after checking
  ownership in D1. `GET /api/flights/files/:fileId` serves the same action as
  an attachment with the exact bytes (content type, `Content-Length`, and
  filename) and returns `{ error: { code, message } }` on failure.

API timestamps use UTC epoch milliseconds. Metrics use metres, seconds, and
metres per second, except explicitly named hours. Missing altitude-derived
metrics remain null. Flights and equipment responses include their user ID
and created/updated timestamps. A flight read outside the user's ownership
returns 404; access to the app alone grants no access to another user's data.

## Local operation and validation

Run these commands from the worktree root:

```sh
pnpm --filter @mdoultremont/tools db:migrate:local
pnpm dev
pnpm check
pnpm build
```

`wrangler dev` and the Vite plugin emulate the `FILES` R2 bucket locally; no
bucket is needed. Flights is unmerged, so its migration was regenerated as
`0002_brave_calypso.sql`. A local database that applied an earlier `0002`
(`0002_closed_prism`, with blob columns) fails with "table already exists";
reset local D1 and re-run the migrations:

```sh
rm -rf apps/tools/.wrangler/state/v3/d1 apps/tools/.wrangler/state/v3/r2
pnpm --filter @mdoultremont/tools db:migrate:local
```

Open `http://127.0.0.1:3000/flights` and continue with GitHub or Spotify.
The existing `apps/tools/.dev.vars` provides OAuth configuration; it is not
committed. GitHub's local callback is
`http://127.0.0.1:3000/api/auth/callback/github`. Use the same loopback host for
the whole sign-in flow. On a fresh local database, an account configured in
`OWNER_ACCOUNTS` receives all apps on its first sign-in. On an existing database,
a back-office administrator can grant Flights access. There is no password or
development sign-in bypass.

The implementation was checked against local Wrangler D1 and the running
Worker API: GPX import, list, 101 decompressed points, exact original download,
stats, equipment creation/assignment, and duplicate import. The smoke check
used a temporary local database user and signed test session. Deleting that
user removed its D1 rows but not its R2 objects (a known gap: user deletion does
not clean R2), so objects under `flights/tmp-shadcn-user/` had to be removed
separately from local state. The OAuth redirect reached GitHub's login form; the browser had
no signed-in GitHub session, so an owner OAuth round trip was not completed.
Automated HTTP tests use real action layers and migrated in-memory SQLite,
with the session lookup replaced by a controlled user.
