import { Data } from "effect"

export class SourceConflict extends Data.TaggedError("SourceConflict")<{}> {
  override get message() {
    return "A source cannot also be a destination or the review playlist"
  }
}

export class SourceInputError extends Data.TaggedError("SourceInputError")<{
  readonly message: string
}> {}

export class SourcePersistenceError extends Data.TaggedError(
  "SourcePersistenceError"
)<{
  readonly cause: unknown
}> {
  override get message() {
    return "Could not save the source configuration"
  }
}
