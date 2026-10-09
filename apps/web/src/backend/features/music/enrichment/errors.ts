import { Data, Schema } from "effect"

/** Enrichment progress across the owner's liked tracks. */
export interface EnrichmentStatus {
  /** Liked tracks with recording data from MusicBrainz. */
  readonly enriched: number
  /** Of those, how many also have an AcousticBrainz analysis. */
  readonly withAnalysis: number
  /** MusicBrainz does not know the ISRC. */
  readonly notFound: number
  /** MusicBrainz lists several recordings for the ISRC, so none is chosen. */
  readonly ambiguous: number
  /** The lookup failed in a way retrying does not fix. */
  readonly failed: number
  /** Waiting for a lookup. */
  readonly pending: number
  /** Spotify gave no ISRC, so there is nothing to look up. */
  readonly withoutIsrc: number
}

/** Queue message asking enrichment to look up the next batch of ISRCs. */
export const EnrichmentMessage = Schema.Struct({
  kind: Schema.Literal("music.enrichment"),
})

export class EnrichmentPersistenceError extends Data.TaggedError(
  "EnrichmentPersistenceError"
)<{ readonly cause: unknown }> {
  override get message() {
    return "Could not save recording data"
  }
}
