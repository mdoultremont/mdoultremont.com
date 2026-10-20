# Backend ownership of flight calculations

The backend importer and browser viewer both used `packages/flight-track`.
The viewer recalculated flight bounds, measurements, and profiles, and the
share-image renderer calculated bounds again. The backend now owns these
flight rules.

## Decision

- Move parsing, normalization, measurements, and profile generation into
  `apps/tools-backend/src/actions/flights/track`. The importer and flight
  detail action use that unit.
- Add nullable `analysis` to the `flights.get` output. It contains the
  takeoff and landing indices, the takeoff timestamp, and the full airborne
  profile. Indices refer to the original point array.
- Keep `packages/tools-contracts` limited to action declarations, input and
  output schemas, and the typed client. Public flight analysis types describe
  the action output. Internal parsing and measurement types stay in the backend.
- Keep chart sampling, cursor selection, map projection, formatting, and
  image composition in the browser. The viewer and share image use the
  backend's detected flight bounds.
- Delete `packages/flight-track` and migrate every caller.

This supersedes the shared flight-track clause in
[Tools application package boundaries](0004-tools-application-package-boundaries.md).

## Consequences

The stored flight row remains the source for summary statistics. Reading a
flight computes its profile and detected bounds from the stored track.
No stored data changes, migrations, or backfills are needed. A flight with
fewer than two recorded points has null analysis.

The detail response grows by one full profile, and profile calculation moves
from the browser to the Worker. Returning the full profile preserves cursor
selection at the original resolution. The browser samples each chart without
adding duplicate chart series to the response or tying the action to a chart
size.
