import { Data, Schema } from "effect"

export type {
  Ingestion,
  IngestionKind,
  IngestionStatus,
} from "@mdoultremont/tools-contracts/music"

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
export class InvalidSourcePage extends Data.TaggedError("InvalidSourcePage")<{
  readonly message: string
}> {}
