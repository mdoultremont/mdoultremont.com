import { Data, Schema } from "effect"

export type IngestionKind = "full" | "incremental"

export interface Ingestion {
  readonly id: string
  readonly ownerId: string
  readonly kind: IngestionKind
  readonly status: "queued" | "running" | "completed" | "failed"
  readonly cursor: string | null
  readonly pages: number
  /** Likes read from Spotify so far. */
  readonly seen: number
  /** Likes that were new, re-liked, or had changed since the last ingestion. */
  readonly added: number
  /** Liked tracks a full ingestion no longer found. */
  readonly unliked: number
  /** Spotify's count of Liked Songs, known after the first page. */
  readonly total: number | null
  readonly error: string | null
  readonly startedAt: number
  readonly updatedAt: number
  readonly finishedAt: number | null
}

export interface IngestionStatus {
  readonly latest: Ingestion | null
  readonly liked: number
  readonly unliked: number
}

/** Queue message asking for the next page of an ingestion. */
export const IngestionMessage = Schema.Struct({
  kind: Schema.Literal("music.ingestion"),
  ingestionId: Schema.NonEmptyString,
})

export class IngestionPersistenceError extends Data.TaggedError(
  "IngestionPersistenceError"
)<{ readonly cause: unknown }> {
  override get message() {
    return "Could not save ingestion progress"
  }
}

/** Spotify returned a page that cannot be trusted, such as a cursor that does not advance. */
export class InvalidLikesPage extends Data.TaggedError("InvalidLikesPage")<{
  readonly message: string
}> {}
