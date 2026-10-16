import type { Effect, Option } from "effect"
import type { ObjectStorageError } from "./errors"

export interface PutOptions {
  readonly contentType?: string
  readonly customMetadata?: Readonly<Record<string, string>>
}

export interface StoredObject {
  /** Single-use stream; read it once or use `readBytes`. */
  readonly body: ReadableStream<Uint8Array>
  readonly size: number
  readonly contentType: string | undefined
  readonly etag: string
  readonly customMetadata: Readonly<Record<string, string>>
}

export interface ObjectStorageApi {
  /**
   * Writes (or overwrites) one object. A stream body needs a known length
   * (R2 rejects unknown-length streams), so prefer bytes for small payloads.
   */
  readonly put: (
    key: string,
    body: Uint8Array | ReadableStream<Uint8Array>,
    options?: PutOptions
  ) => Effect.Effect<void, ObjectStorageError>
  readonly get: (
    key: string
  ) => Effect.Effect<Option.Option<StoredObject>, ObjectStorageError>
  /** Deleting a key that does not exist succeeds. */
  readonly delete: (
    keys: readonly string[]
  ) => Effect.Effect<void, ObjectStorageError>
  /** Deletes every object whose key starts with `prefix`; returns how many. */
  readonly deleteByPrefix: (
    prefix: string
  ) => Effect.Effect<number, ObjectStorageError>
}
