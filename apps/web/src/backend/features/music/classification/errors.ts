import { Data, Schema } from "effect"

/** One decision as shown to the owner. Track name and artists are for display only. */
export interface DecisionSummary {
  readonly trackId: string
  readonly name: string
  readonly artistNames: readonly string[]
  readonly destinationIds: readonly string[]
  readonly review: boolean
  readonly reason: "classified" | "no_recording_data"
  readonly probabilities: Readonly<Record<string, number>>
  readonly classifiedAt: number
}

export interface ClassificationStatus {
  readonly ready: boolean
  /** Liked tracks with a decision. */
  readonly decided: number
  /** Decisions naming at least one destination. */
  readonly toDestinations: number
  /** Decisions sending the track to the review playlist. */
  readonly toReview: number
  /** Of those sent to review, how many had no recording data. */
  readonly withoutRecordingData: number
  /** Liked tracks still waiting for enrichment. */
  readonly waitingForEnrichment: number
  /** Liked tracks ready to classify. */
  readonly pending: number
  /** Decisions made against destinations that have since changed. */
  readonly outdated: number
  readonly recent: readonly DecisionSummary[]
}

/** Queue message asking classification to decide the next batch of tracks. */
export const ClassificationMessage = Schema.Struct({
  kind: Schema.Literal("music.classification"),
  ownerId: Schema.NonEmptyString,
})

export class ClassificationPersistenceError extends Data.TaggedError(
  "ClassificationPersistenceError"
)<{ readonly cause: unknown }> {
  override get message() {
    return "Could not save classification decisions"
  }
}
