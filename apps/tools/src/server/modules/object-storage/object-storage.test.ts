import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { ObjectStorage, ObjectStorageError, readBytes } from "."
import { makeFakeR2 } from "./testing"

const text = (value: string) => new TextEncoder().encode(value)
const read = (key: string) =>
  Effect.gen(function* () {
    const storage = yield* ObjectStorage
    const object = yield* storage.get(key)
    return Option.isNone(object)
      ? undefined
      : new TextDecoder().decode(yield* readBytes(key, object.value))
  })

describe.each<[string, () => Layer.Layer<ObjectStorage>]>([
  ["memory implementation", () => ObjectStorage.layerMemory()],
  ["R2 adapter", () => ObjectStorage.layer(makeFakeR2())],
])("%s", (_name, layer) => {
  it.effect("puts, gets metadata and bytes, and reports missing keys", () =>
    Effect.gen(function* () {
      const storage = yield* ObjectStorage
      yield* storage.put("a/one", text("hello"), {
        contentType: "text/plain",
        customMetadata: { owner: "x" },
      })
      const found = yield* storage.get("a/one")
      expect(Option.isSome(found)).toBe(true)
      if (Option.isSome(found)) {
        expect(found.value).toMatchObject({
          size: 5,
          contentType: "text/plain",
          customMetadata: { owner: "x" },
        })
        expect(found.value.etag).toBeTruthy()
        expect(
          new TextDecoder().decode(yield* readBytes("a/one", found.value))
        ).toBe("hello")
      }
      expect(Option.isNone(yield* storage.get("a/missing"))).toBe(true)
    }).pipe(Effect.provide(layer()))
  )
  it.effect("accepts stream bodies and overwrites", () =>
    Effect.gen(function* () {
      const storage = yield* ObjectStorage
      yield* storage.put("k", new Blob(["streamed"]).stream())
      expect(yield* read("k")).toBe("streamed")
      yield* storage.put("k", text("again"))
      expect(yield* read("k")).toBe("again")
    }).pipe(Effect.provide(layer()))
  )
  it.effect("deletes listed keys, tolerating missing ones", () =>
    Effect.gen(function* () {
      const storage = yield* ObjectStorage
      yield* storage.put("a", text("1"))
      yield* storage.put("b", text("2"))
      yield* storage.delete(["a", "nope"])
      expect(yield* read("a")).toBeUndefined()
      expect(yield* read("b")).toBe("2")
    }).pipe(Effect.provide(layer()))
  )
  it.effect("deleteByPrefix removes only that prefix", () =>
    Effect.gen(function* () {
      const storage = yield* ObjectStorage
      for (const key of ["p/1", "p/2", "p/sub/3", "q/1", "p"])
        yield* storage.put(key, text(key))
      expect(yield* storage.deleteByPrefix("p/")).toBe(3)
      expect(yield* read("p/2")).toBeUndefined()
      expect(yield* read("q/1")).toBe("q/1")
      expect(yield* read("p")).toBe("p")
    }).pipe(Effect.provide(layer()))
  )
})

describe("R2 adapter specifics", () => {
  it.effect("paginates deleteByPrefix and chunks deletes at 1000 keys", () => {
    const bucket = makeFakeR2()
    return Effect.gen(function* () {
      const storage = yield* ObjectStorage
      for (let i = 0; i < 2500; i++)
        bucket.stored.set(`big/${i}`, { bytes: text("x") })
      bucket.stored.set("other", { bytes: text("x") })
      expect(yield* storage.deleteByPrefix("big/")).toBe(2500)
      expect([...bucket.stored.keys()]).toEqual(["other"])
      expect(bucket.calls.list).toBe(3)
      expect(Math.max(...bucket.calls.delete.map((keys) => keys.length))).toBe(
        1000
      )
      yield* storage.delete(Array.from({ length: 1001 }, (_, i) => `k${i}`))
      expect(bucket.calls.delete.slice(-2).map((keys) => keys.length)).toEqual([
        1000, 1,
      ])
    }).pipe(Effect.provide(ObjectStorage.layer(bucket)))
  })
  it.effect("maps binding failures to ObjectStorageError reasons", () => {
    const failing = {
      put: () => Promise.reject(new Error("boom")),
      get: () => Promise.reject(new Error("boom")),
      delete: () => Promise.reject(new Error("boom")),
      list: () => Promise.reject(new Error("boom")),
    } as unknown as R2Bucket
    return Effect.gen(function* () {
      const storage = yield* ObjectStorage
      const reasons = [
        yield* Effect.flip(storage.put("k", text("x"))),
        yield* Effect.flip(storage.get("k")),
        yield* Effect.flip(storage.delete(["k"])),
        yield* Effect.flip(storage.deleteByPrefix("k")),
      ].map((error) => {
        expect(error).toBeInstanceOf(ObjectStorageError)
        return error.reason
      })
      expect(reasons).toEqual([
        "PutFailed",
        "GetFailed",
        "DeleteFailed",
        "ListFailed",
      ])
    }).pipe(Effect.provide(ObjectStorage.layer(failing)))
  })
})
