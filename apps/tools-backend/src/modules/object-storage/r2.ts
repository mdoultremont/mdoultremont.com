import { Effect, Option } from "effect"
import { ObjectStorageError } from "./errors"
import type { ObjectStorageApi } from "./types"

/** R2 accepts at most 1000 keys per delete and returns at most 1000 per list. */
const BATCH = 1000

export const makeR2ObjectStorage = (bucket: R2Bucket): ObjectStorageApi => {
  const put: ObjectStorageApi["put"] = Effect.fn("ObjectStorage.put")(
    function* (key, body, options) {
      yield* Effect.tryPromise({
        try: () =>
          bucket.put(key, body, {
            httpMetadata: options?.contentType
              ? { contentType: options.contentType }
              : undefined,
            customMetadata: options?.customMetadata
              ? { ...options.customMetadata }
              : undefined,
          }),
        catch: (cause) =>
          new ObjectStorageError({ reason: "PutFailed", key, cause }),
      })
    }
  )
  const get: ObjectStorageApi["get"] = Effect.fn("ObjectStorage.get")(
    function* (key) {
      const object = yield* Effect.tryPromise({
        try: () => bucket.get(key),
        catch: (cause) =>
          new ObjectStorageError({ reason: "GetFailed", key, cause }),
      })
      if (!object) return Option.none()
      return Option.some({
        body: object.body,
        size: object.size,
        contentType: object.httpMetadata?.contentType,
        etag: object.httpEtag,
        customMetadata: object.customMetadata ?? {},
      })
    }
  )
  const remove: ObjectStorageApi["delete"] = Effect.fn("ObjectStorage.delete")(
    function* (keys) {
      for (let i = 0; i < keys.length; i += BATCH) {
        const chunk = keys.slice(i, i + BATCH)
        yield* Effect.tryPromise({
          try: () => bucket.delete(chunk),
          catch: (cause) =>
            new ObjectStorageError({
              reason: "DeleteFailed",
              key: chunk[0] ?? "",
              cause,
            }),
        })
      }
    }
  )
  const deleteByPrefix: ObjectStorageApi["deleteByPrefix"] = Effect.fn(
    "ObjectStorage.deleteByPrefix"
  )(function* (prefix) {
    let cursor: string | undefined
    let deleted = 0
    while (true) {
      const page: R2Objects = yield* Effect.tryPromise({
        try: () => bucket.list({ prefix, cursor, limit: BATCH }),
        catch: (cause) =>
          new ObjectStorageError({ reason: "ListFailed", key: prefix, cause }),
      })
      yield* remove(page.objects.map((object) => object.key))
      deleted += page.objects.length
      if (!page.truncated) return deleted
      cursor = page.cursor
    }
  })
  return { put, get, delete: remove, deleteByPrefix }
}
