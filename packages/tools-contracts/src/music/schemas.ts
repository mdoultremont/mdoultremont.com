import { Schema } from "effect"

/**
 * Wire shapes of the music control area. Timestamps are UTC epoch
 * milliseconds. Every schema decodes to the same value it encodes.
 */

export const SpotifyConnectionStatusSchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal("disconnected") }),
  Schema.Struct({
    status: Schema.Literals(["connected", "reconnect_needed"]),
    accountId: Schema.String,
    displayName: Schema.NullOr(Schema.String),
  }),
])
export type SpotifyConnectionStatus = typeof SpotifyConnectionStatusSchema.Type

export const SpotifyPlaylistSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  public: Schema.NullOr(Schema.Boolean),
  collaborative: Schema.Boolean,
  ownerId: Schema.String,
})
export type SpotifyPlaylist = typeof SpotifyPlaylistSchema.Type

export const SpotifySavedTracksPageSchema = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      artistNames: Schema.Array(Schema.String),
      isrc: Schema.NullOr(Schema.String),
      durationMs: Schema.NullOr(Schema.Number),
      artworkUrl: Schema.optional(Schema.NullOr(Schema.String)),
      /** ISO 8601, as Spotify reports it. */
      addedAt: Schema.String,
    })
  ),
  /** Pass back as `cursor` for the next page; null on the last page. */
  next: Schema.NullOr(Schema.String),
  total: Schema.Number,
})

export const DestinationSchema = Schema.Struct({
  playlistId: Schema.String,
  description: Schema.String,
  enabled: Schema.Boolean,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type Destination = typeof DestinationSchema.Type

export const DestinationConfigurationSchema = Schema.Struct({
  destinations: Schema.Array(DestinationSchema),
  reviewPlaylistId: Schema.NullOr(Schema.String),
  /** The owner's statement that setup is complete and classification may run. */
  ready: Schema.Boolean,
})
export type DestinationConfiguration =
  typeof DestinationConfigurationSchema.Type

export const OwnedPlaylistSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
})

export const IngestionKindSchema = Schema.Literals(["full", "incremental"])
export type IngestionKind = typeof IngestionKindSchema.Type

export const SourceIdSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("liked") }),
  Schema.Struct({
    kind: Schema.Literal("playlist"),
    playlistId: Schema.String,
  }),
])
export type SourceId = typeof SourceIdSchema.Type

export const IngestionSchema = Schema.Struct({
  id: Schema.String,
  ownerId: Schema.String,
  source: SourceIdSchema,
  snapshotId: Schema.NullOr(Schema.String),
  kind: IngestionKindSchema,
  status: Schema.Literals(["queued", "running", "completed", "failed"]),
  cursor: Schema.NullOr(Schema.String),
  pages: Schema.Number,
  /** Tracks read from this source so far. */
  seen: Schema.Number,
  /** Source entries that were new, restored, or changed. */
  added: Schema.Number,
  /** Entries no longer present after reading the whole source. */
  removed: Schema.Number,
  /** Spotify's source size, known after the first page. */
  total: Schema.NullOr(Schema.Number),
  error: Schema.NullOr(Schema.String),
  startedAt: Schema.Number,
  updatedAt: Schema.Number,
  finishedAt: Schema.NullOr(Schema.Number),
})
export type Ingestion = typeof IngestionSchema.Type

export const SourceSchema = Schema.Struct({
  sourceId: SourceIdSchema,
  enabled: Schema.Boolean,
  snapshotId: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  present: Schema.Number,
  removed: Schema.Number,
  latest: Schema.NullOr(IngestionSchema),
})
export type Source = typeof SourceSchema.Type

export const IngestionStatusSchema = Schema.Struct({
  sources: Schema.Array(SourceSchema),
  present: Schema.Number,
  removed: Schema.Number,
})
export type IngestionStatus = typeof IngestionStatusSchema.Type

export const EnrichmentStatusSchema = Schema.Struct({
  /** Collected tracks with recording data from MusicBrainz. */
  enriched: Schema.Number,
  /** Of those, how many also have an AcousticBrainz analysis. */
  withAnalysis: Schema.Number,
  /** MusicBrainz does not know the ISRC. */
  notFound: Schema.Number,
  /** MusicBrainz lists several recordings for the ISRC. */
  ambiguous: Schema.Number,
  /** The lookup failed in a way retrying does not fix. */
  failed: Schema.Number,
  /** Waiting for a lookup. */
  pending: Schema.Number,
  /** Spotify gave no ISRC, so there is nothing to look up. */
  withoutIsrc: Schema.Number,
})
export type EnrichmentStatus = typeof EnrichmentStatusSchema.Type

export const DecisionSummarySchema = Schema.Struct({
  trackId: Schema.String,
  name: Schema.String,
  artistNames: Schema.Array(Schema.String),
  destinationIds: Schema.Array(Schema.String),
  review: Schema.Boolean,
  reason: Schema.Literals([
    "classified",
    "no_recording_data",
    "classifier_failed",
  ]),
  /** Clef's yes-probability per destination playlist id. */
  probabilities: Schema.Record(Schema.String, Schema.Number),
  classifiedAt: Schema.Number,
})
export type DecisionSummary = typeof DecisionSummarySchema.Type

export const ClassificationStatusSchema = Schema.Struct({
  ready: Schema.Boolean,
  /** Collected tracks with a decision. */
  decided: Schema.Number,
  /** Decisions naming at least one destination. */
  toDestinations: Schema.Number,
  /** Decisions sending the track to the review playlist. */
  toReview: Schema.Number,
  /** Of those sent to review, how many had no recording data. */
  withoutRecordingData: Schema.Number,
  /** Collected tracks still waiting for enrichment. */
  waitingForEnrichment: Schema.Number,
  /** Collected tracks ready to classify. */
  pending: Schema.Number,
  /** Decisions made against destinations that have since changed. */
  outdated: Schema.Number,
  recent: Schema.Array(DecisionSummarySchema),
})
export type ClassificationStatus = typeof ClassificationStatusSchema.Type

export const DeliveryStatusSchema = Schema.Struct({
  /** Whether delivery runs by itself after each classification batch. */
  automatic: Schema.Boolean,
  /** Track-and-playlist pairs written to Spotify. */
  delivered: Schema.Number,
  /** Pairs decided but not written yet. */
  toWrite: Schema.Number,
  /** Pairs Spotify refused to write (e.g. a playlist no longer editable). */
  refused: Schema.Number,
  lastDeliveredAt: Schema.NullOr(Schema.Number),
})
export type DeliveryStatus = typeof DeliveryStatusSchema.Type
