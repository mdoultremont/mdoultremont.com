import { Data, Schema } from "effect"

export interface DeliveryStatus {
  /** Whether delivery runs by itself after each classification batch. */
  readonly automatic: boolean
  /** Track-and-playlist pairs written to Spotify. */
  readonly delivered: number
  /** Pairs decided but not written yet. */
  readonly toWrite: number
  /** Pairs Spotify refused to write (e.g. a playlist no longer editable). */
  readonly refused: number
  readonly lastDeliveredAt: number | null
}

/** Queue message asking delivery to write the next batch. */
export const DeliveryMessage = Schema.Struct({
  kind: Schema.Literal("music.delivery"),
  ownerId: Schema.NonEmptyString,
})

export class DeliveryPersistenceError extends Data.TaggedError(
  "DeliveryPersistenceError"
)<{ readonly cause: unknown }> {
  override get message() {
    return "Could not save delivery progress"
  }
}
