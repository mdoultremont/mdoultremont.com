# Backend ownership of flight calculations

The backend importer and browser viewer both used `packages/flight-track`.
The viewer recalculated flight bounds, measurements, and profiles, and the
share-image renderer calculated bounds again. The backend now owns these
flight rules.

## Decision

- Move parsing, normalization, measurements, profile generation, and static
  track previews into `apps/tools-backend/src/actions/flights/track`.
  Compute these results at import and store them. List and detail reads never
  run the flight algorithms.
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
- Return a small summary from `flights.list`, including the title, date,
  measurements, and static track preview. Load the full points and profile
  only when opening a flight.
- Provide an explicit, idempotent preparation action for existing flights
  without stored analysis. It uses the import calculations and preserves
  titles, site names, notes, equipment, and original recordings.

This supersedes the shared flight-track clause in
[Tools application package boundaries](0004-tools-application-package-boundaries.md).

## Consequences

The stored flight row remains the source for summary statistics. The importer
computes the summary and profile from the same measurements. D1 holds titles,
summary measurements, bounded preview geometry, and analysis metadata. R2
holds the original file, full point array, and compressed analysis snapshot.
Reading a flight loads the stored results.

The migration stores titles and analysis metadata in separate tables, leaving
the existing flight and raw-track schema unchanged. Existing flights remain
readable with null analysis until explicitly prepared. Missing analysis never
triggers work during a read.

Preparation writes an analysis object under a unique key before conditionally
publishing its metadata and summary in D1. Concurrent attempts cannot replace
the winning result. Cleanup never removes an object whose commit status is
uncertain. User edits remain separate from calculated fields.
Uncertain failures can leave orphan snapshots. There is no automatic cleanup
for those objects; removing them requires a separate maintenance operation.

The logbook preview shows the track shape with takeoff and landing markers.
It has no geographic basemap and requires no map service. The detail viewer
retains its interactive map.

The detail response includes one full profile. Returning the full profile
preserves cursor selection at the original resolution. The browser samples each chart without
adding duplicate chart series to the response or tying the action to a chart
size. The full raw track remains available for future detail experiences.
