import { Data } from "effect"

export class ObjectStorageError extends Data.TaggedError("ObjectStorageError")<{
  readonly reason:
    | "PutFailed"
    | "GetFailed"
    | "DeleteFailed"
    | "ListFailed"
    | "MissingObject"
  readonly key: string
  readonly cause?: unknown
}> {
  override get message() {
    return `Object storage ${this.reason} for ${this.key}`
  }
}
