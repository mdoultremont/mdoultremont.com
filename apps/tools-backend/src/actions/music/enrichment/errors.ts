import { Data, Schema } from "effect"
import type { TagSource } from "#backend/modules/database"

/** How many found recordings one tag source has been asked about, and with what result. */
export interface TagSourceCoverage {
  readonly source: TagSource
  /** Whether its credentials are set; an unconfigured source is never asked. */
  readonly configured: boolean
  /** Found recordings with tags from this source. */
  readonly found: number
  readonly notFound: number
  readonly failed: number
  /** Found recordings not asked yet. */
  readonly pending: number
}

/** Enrichment progress across the owner's collected tracks. */
export interface EnrichmentStatus {
  /** Collected tracks with recording data from MusicBrainz. */
  readonly enriched: number
  /** Of those, how many also have an AcousticBrainz analysis. */
  readonly withAnalysis: number
  /** Of those, how many were matched by title and artist because the ISRC was unknown. */
  readonly matchedBySearch: number
  /** Of those, how many have tags from at least one tag source. */
  readonly withTags: number
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
  readonly sources: readonly TagSourceCoverage[]
}

/** Queue message asking enrichment to look up the next batch of ISRCs. */
export const EnrichmentMessage = Schema.Struct({
  kind: Schema.Literal("music.enrichment"),
  /** Whose pipeline continues afterwards. Recording data itself is shared. */
  ownerId: Schema.NonEmptyString,
})

export class EnrichmentPersistenceError extends Data.TaggedError(
  "EnrichmentPersistenceError"
)<{ readonly cause: unknown }> {
  override get message() {
    return "Could not save recording data"
  }
}
