import { afterEach, expect, vi } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { Database } from "#backend/modules/database"
import { makeTestD1 } from "#backend/modules/database/testing"
import { gzipText } from "#backend/modules/compression"
import { sha256Hex } from "#backend/modules/hashing"
import {
  ObjectStorage,
  makeMemoryObjectStorage,
  type MemoryObject,
} from "#backend/modules/object-storage"
import { Flights } from "./index"

vi.mock("#backend/actions/flights/track", () => {
  throw new Error("Flight reads imported the calculation unit")
})
vi.mock("../track/metrics.ts", () => ({
  computeMetrics: () => {
    throw new Error("Read calculated metrics")
  },
}))
vi.mock("../track/prepare.ts", () => ({
  prepareFlight: () => {
    throw new Error("Read prepared track")
  },
}))
const close: (() => void)[] = []
afterEach(() => {
  for (const cleanup of close.splice(0)) cleanup()
})

it.effect(
  "serves a sentinel saved profile with every calculation entry disabled",
  () => {
    const d1 = makeTestD1()
    close.push(d1.close)
    d1.seedOwner("owner")
    d1.sqlite
      .prepare(
        "INSERT INTO flights SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?"
      )
      .run(
        "saved",
        "owner",
        1000,
        1000,
        2000,
        1,
        46,
        6,
        null,
        46,
        6,
        null,
        10,
        null,
        null,
        1,
        null,
        null,
        null,
        null,
        "gpx",
        null,
        1,
        1
      )
    const objects = new Map<string, MemoryObject>()
    let reads = 0
    const memory = makeMemoryObjectStorage(objects)
    const layer = Flights.layer.pipe(
      Layer.provideMerge(Database.layer(d1.binding)),
      Layer.provideMerge(
        Layer.succeed(ObjectStorage, {
          ...memory,
          get: (key) => {
            reads++
            return memory.get(key)
          },
        })
      )
    )
    return Effect.gen(function* () {
      const points = [
        [1000, 46, 6, null, null],
        [2000, 46.0001, 6, null, null],
      ]
      const json = JSON.stringify(points)
      const hash = yield* sha256Hex(json)
      const profile = [
        { i: 0, tS: 0, altM: 54321, speedKmh: 4321, varioMps: -123, distKm: 0 },
        {
          i: 1,
          tS: 1,
          altM: 12345,
          speedKmh: 1234,
          varioMps: 321,
          distKm: 987,
        },
      ]
      const analysis = {
        takeoffIndex: 0,
        landingIndex: 1,
        takeoffAt: 1000,
        profile,
      }
      d1.sqlite
        .prepare("INSERT INTO flight_tracks VALUES (?,?,?,?,?)")
        .run("saved", "points", hash, json.length, 2)
      d1.sqlite.prepare("INSERT INTO flight_analyses VALUES (?,?,?,?)").run(
        "saved",
        1,
        "analysis",
        JSON.stringify([
          { i: 0, x: 4, y: 96 },
          { i: 1, x: 96, y: 4 },
        ])
      )
      const storage = yield* ObjectStorage
      yield* storage.put("points", yield* gzipText(json))
      yield* storage.put(
        "analysis",
        yield* gzipText(
          JSON.stringify({
            schemaVersion: 1,
            pointsSha256: hash,
            pointCount: 2,
            analysis,
          })
        )
      )
      const flights = yield* Flights
      expect((yield* flights.list("owner"))[0]).toMatchObject({
        title: "Flight 1970-01-01 00:00 UTC",
        needsPreparation: false,
      })
      expect(reads).toBe(0)
      expect((yield* flights.detail("owner", "saved")).analysis).toEqual(
        analysis
      )
      expect(reads).toBe(2)
    }).pipe(Effect.provide(layer))
  }
)
