import { Context, Effect, Layer } from "effect"
import { makeMemoryObjectStorage, type MemoryObject } from "./memory"
import { makeR2ObjectStorage } from "./r2"
import type { ObjectStorageApi, StoredObject } from "./types"

import { ObjectStorageError } from "./errors"

export { ObjectStorageError }
export { makeMemoryObjectStorage, type MemoryObject } from "./memory"
export type { ObjectStorageApi, PutOptions, StoredObject } from "./types"

/**
 * Key-addressed binary storage (R2 in production). Knows nothing about what
 * callers store; they own their key layout.
 */
export class ObjectStorage extends Context.Service<
  ObjectStorage,
  ObjectStorageApi
>()("server/modules/ObjectStorage") {
  /** Backed by an R2 bucket binding. */
  static readonly layer = (bucket: R2Bucket) =>
    Layer.sync(ObjectStorage, () =>
      ObjectStorage.of(makeR2ObjectStorage(bucket))
    )
  /** Test implementation. Pass a map to inspect what was stored. */
  static readonly layerMemory = (objects?: Map<string, MemoryObject>) =>
    Layer.sync(ObjectStorage, () =>
      ObjectStorage.of(makeMemoryObjectStorage(objects))
    )
}

/** Reads a whole object body into memory. */
export const readBytes = (key: string, object: StoredObject) =>
  Effect.tryPromise({
    try: async () =>
      new Uint8Array(await new Response(object.body).arrayBuffer()),
    catch: (cause) =>
      new ObjectStorageError({ reason: "GetFailed", key, cause }),
  })
