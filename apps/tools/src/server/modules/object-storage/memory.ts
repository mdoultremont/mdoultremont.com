import { Effect, Option } from "effect"
import { ObjectStorageError } from "./errors"
import type { ObjectStorageApi, PutOptions } from "./types"

export interface MemoryObject {
  readonly bytes: Uint8Array
  readonly options: PutOptions
}

/** In-memory implementation for tests. `objects` is exposed so tests can inspect it. */
export const makeMemoryObjectStorage = (
  objects: Map<string, MemoryObject> = new Map()
): ObjectStorageApi & { readonly objects: Map<string, MemoryObject> } => {
  const put: ObjectStorageApi["put"] = Effect.fn("ObjectStorage.put")(
    function* (key, body, options) {
      const bytes = yield* Effect.tryPromise({
        try: async () =>
          body instanceof Uint8Array
            ? new Uint8Array(body)
            : new Uint8Array(await new Response(body).arrayBuffer()),
        catch: (cause) =>
          new ObjectStorageError({ reason: "PutFailed", key, cause }),
      })
      objects.set(key, { bytes, options: options ?? {} })
    }
  )
  const get: ObjectStorageApi["get"] = (key) =>
    Effect.sync(() => {
      const object = objects.get(key)
      if (!object) return Option.none()
      return Option.some({
        body: new Blob([new Uint8Array(object.bytes)]).stream(),
        size: object.bytes.byteLength,
        contentType: object.options.contentType,
        etag: `"${object.bytes.byteLength}"`,
        customMetadata: object.options.customMetadata ?? {},
      })
    })
  const remove: ObjectStorageApi["delete"] = (keys) =>
    Effect.sync(() => {
      for (const key of keys) objects.delete(key)
    })
  const deleteByPrefix: ObjectStorageApi["deleteByPrefix"] = (prefix) =>
    Effect.sync(() => {
      let deleted = 0
      for (const key of objects.keys())
        if (key.startsWith(prefix)) {
          objects.delete(key)
          deleted++
        }
      return deleted
    })
  return { put, get, delete: remove, deleteByPrefix, objects }
}
