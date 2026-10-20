import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { getTableColumns } from "drizzle-orm"
import { afterEach, describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { TestClock } from "effect/testing"
import {
  Database,
  flightFiles,
  flightTracks,
  flights,
} from "#backend/modules/database"
import { makeTestD1 } from "#backend/modules/database/testing"
import { gzipText, gunzipText } from "#backend/modules/compression"
import {
  ObjectStorage,
  ObjectStorageError,
  makeMemoryObjectStorage,
  type MemoryObject,
  type ObjectStorageApi,
} from "#backend/modules/object-storage"
import { FlightImport } from "#backend/actions/flights/import"
import { Equipment } from "#backend/actions/flights/equipment"
import { FlightPreparation } from "#backend/actions/flights/prepare"
import { FlightStats } from "#backend/actions/flights/stats"
import { prepareFlight, parseTrackFile } from "#backend/actions/flights/track"
import { Flights, defaultTitle } from "./index"

const fixture = readFileSync(
  new URL("../track/fixtures/flight.gpx", import.meta.url),
  "utf8"
)
const bodies = (days = 0) => ({
  filename: "flight.gpx",
  text:
    days === 0
      ? fixture
      : fixture.replace(/\d{4}-\d{2}-\d{2}T[^<]+/gu, (timestamp) =>
          new Date(
            new Date(timestamp).getTime() + days * 86400000
          ).toISOString()
        ),
})
const cleanups: (() => void)[] = []
afterEach(() => {
  for (const close of cleanups.splice(0)) close()
})
function setup(
  decorate: (storage: ObjectStorageApi) => ObjectStorageApi = (s) => s,
  decorateBinding: (binding: D1Database) => D1Database = (b) => b
) {
  const d1 = makeTestD1()
  cleanups.push(d1.close)
  d1.seedOwner("owner")
  d1.seedOwner("other")
  const objects = new Map<string, MemoryObject>()
  const layer = Layer.mergeAll(
    Flights.layer,
    Equipment.layer,
    FlightImport.layer,
    FlightPreparation.layer,
    FlightStats.layer
  ).pipe(
    Layer.provideMerge(Database.layer(decorateBinding(d1.binding))),
    Layer.provideMerge(
      Layer.succeed(
        ObjectStorage,
        ObjectStorage.of(decorate(makeMemoryObjectStorage(objects)))
      )
    )
  )
  return { ...d1, layer, objects }
}

describe("flight logbook", () => {
  it.effect(
    "round-trips the stored original and point tuples, isolates every owner read and mutation",
    () => {
      const { layer, objects } = setup()
      return Effect.gen(function* () {
        yield* TestClock.setTime(Date.UTC(2026, 9, 16))
        const importer = yield* FlightImport
        const logbook = yield* Flights
        const stats = yield* FlightStats
        const imported = yield* importer.importFile("owner", bodies())
        expect(imported.status).toBe("imported")
        const detail = yield* logbook.detail("owner", imported.flightId)
        expect(detail.points).toEqual(
          parseTrackFile("flight.gpx", fixture).points
        )
        expect(detail.analysis).toEqual(prepareFlight(detail.points).analysis)
        expect(detail.flight.createdAt).toBe(Date.UTC(2026, 9, 16))
        expect(detail.files[0]).toMatchObject({
          filename: "flight.gpx",
          sizeBytes: new TextEncoder().encode(fixture).length,
        })
        const original = yield* logbook.download("owner", detail.files[0]!.id)
        expect(original).toMatchObject({
          contentType: "application/gpx+xml; charset=utf-8",
          sizeBytes: new TextEncoder().encode(fixture).length,
        })
        expect(
          yield* Effect.promise(() => new Response(original.body).text())
        ).toBe(fixture)
        expect([...objects.keys()]).toEqual(
          expect.arrayContaining([
            `flights/owner/${imported.flightId}/files/${detail.files[0]!.id}`,
            `flights/owner/${imported.flightId}/track.json.gz`,
          ])
        )
        expect(yield* logbook.list("other")).toEqual([])
        expect((yield* stats.dashboard("other")).totals.flights).toBe(0)
        expect(
          (yield* Effect.flip(logbook.detail("other", imported.flightId)))._tag
        ).toBe("FlightNotFound")
        expect(
          (yield* Effect.flip(logbook.download("other", detail.files[0]!.id)))
            ._tag
        ).toBe("FlightNotFound")
        expect(
          (yield* Effect.flip(
            logbook.update("other", imported.flightId, {
              title: "Flight",
              takeoffName: "x",
              landingName: "x",
              notes: "x",
              equipmentIds: [],
            })
          ))._tag
        ).toBe("FlightNotFound")
        expect(
          (yield* Effect.flip(logbook.remove("other", imported.flightId)))._tag
        ).toBe("FlightNotFound")
        expect(
          yield* logbook.list(
            "owner",
            new Date(detail.flight.takeoffAt).getUTCFullYear()
          )
        ).toHaveLength(1)
        expect(yield* logbook.list("owner", 1900)).toEqual([])
        yield* logbook.remove("owner", imported.flightId)
        const database = yield* Database
        expect(
          yield* database.use((db) => db.select().from(flightFiles).all())
        ).toEqual([])
        expect(
          yield* database.use((db) => db.select().from(flightTracks).all())
        ).toEqual([])
        expect(objects.size).toBe(0)
      }).pipe(Effect.provide(layer))
    }
  )
  it.effect(
    "returns a saved sentinel profile without recalculation and lists only summaries without R2",
    () => {
      let reads = 0
      const { layer, sqlite } = setup((real) => ({
        ...real,
        get: (key) => {
          reads++
          return real.get(key)
        },
      }))
      return Effect.gen(function* () {
        const imported = yield* FlightImport.use((i) =>
          i.importFile("owner", bodies())
        )
        const row = sqlite
          .prepare("SELECT object_key FROM flight_analyses WHERE flight_id = ?")
          .get(imported.flightId)!
        const track = sqlite
          .prepare(
            "SELECT sha256, point_count FROM flight_tracks WHERE flight_id = ?"
          )
          .get(imported.flightId)!
        const sentinel = {
          takeoffIndex: 0,
          landingIndex: 1,
          takeoffAt: 123456,
          profile: [
            {
              i: 0,
              tS: 0,
              altM: 9876,
              speedKmh: 777,
              varioMps: -42,
              distKm: 0,
            },
            {
              i: 1,
              tS: 100,
              altM: null,
              speedKmh: 42,
              varioMps: 12,
              distKm: 20,
            },
          ],
        }
        yield* ObjectStorage.use((o) =>
          gzipText(
            JSON.stringify({
              schemaVersion: 1,
              pointsSha256: track.sha256,
              pointCount: track.point_count,
              analysis: sentinel,
            })
          ).pipe(
            Effect.flatMap((bytes) => o.put(String(row.object_key), bytes))
          )
        )
        const logbook = yield* Flights
        const before = reads
        const summaries = yield* logbook.list("owner")
        expect(reads).toBe(before)
        expect(new Set(Object.keys(summaries[0]!))).toEqual(
          new Set([
            "id",
            "title",
            "takeoffAt",
            "takeoffName",
            "durationS",
            "distanceM",
            "maxAltM",
            "maxSpeedMps",
            "source",
            "preview",
            "needsPreparation",
          ])
        )
        expect(summaries[0]).toMatchObject({ needsPreparation: false })
        expect(summaries[0]!.preview!.length).toBeLessThanOrEqual(120)
        expect(
          (yield* logbook.detail("owner", imported.flightId)).analysis
        ).toEqual(sentinel)
        expect(
          (yield* logbook.detail("owner", imported.flightId)).analysis
        ).toEqual(sentinel)
        expect(yield* logbook.list("owner")).toEqual(summaries)
      }).pipe(Effect.provide(layer))
    }
  )
  it.effect(
    "distinguishes an absent track row from a missing stored object",
    () => {
      const { layer, objects, sqlite } = setup()
      return Effect.gen(function* () {
        const imported = yield* FlightImport.use((i) =>
          i.importFile("owner", bodies())
        )
        const logbook = yield* Flights
        objects.clear()
        expect(
          yield* Effect.flip(logbook.detail("owner", imported.flightId))
        ).toMatchObject({ _tag: "ObjectStorageError", reason: "MissingObject" })
        sqlite
          .prepare("DELETE FROM flight_tracks WHERE flight_id = ?")
          .run(imported.flightId)
        expect(yield* logbook.detail("owner", imported.flightId)).toMatchObject(
          { points: [], analysis: null }
        )
        expect(
          yield* Effect.flip(logbook.detail("owner", "missing"))
        ).toMatchObject({ _tag: "FlightNotFound" })
      }).pipe(Effect.provide(layer))
    }
  )
  it.effect(
    "imports a real one-point GPX as ready with a dot preview and null analysis",
    () => {
      const { layer } = setup()
      return Effect.gen(function* () {
        const text =
          '<gpx><trk><name>Solo fix</name><trkseg><trkpt lat="46" lon="6"><time>2026-01-01T12:00:00Z</time><ele>900</ele></trkpt></trkseg></trk></gpx>'
        expect(parseTrackFile("single.gpx", text).points).toHaveLength(1)
        const imported = yield* FlightImport.use((i) =>
          i.importFile("owner", { filename: "single.gpx", text })
        )
        const logbook = yield* Flights
        expect(yield* logbook.detail("owner", imported.flightId)).toMatchObject(
          {
            flight: {
              title: "Solo fix",
              durationS: 0,
              distanceM: 0,
              needsPreparation: false,
            },
            points: [[Date.UTC(2026, 0, 1, 12), 46, 6, 900, null]],
            analysis: null,
          }
        )
        expect((yield* logbook.list("owner"))[0]).toMatchObject({
          preview: [{ i: 0, x: 50, y: 50 }],
          needsPreparation: false,
        })
        expect(
          yield* FlightPreparation.use((p) =>
            p.prepare("owner", imported.flightId)
          )
        ).toMatchObject({ status: "already-prepared" })
      }).pipe(Effect.provide(layer))
    }
  )
  it.effect(
    "returns profiles with null altitude and original indices around GPS spikes",
    () => {
      const { layer } = setup()
      return Effect.gen(function* () {
        const text = readFileSync(
          new URL("../track/fixtures/spike.gpx", import.meta.url),
          "utf8"
        )
        const missingAltitude = text.replace(/<ele>[^<]*<\/ele>/gu, "")
        const imported = yield* FlightImport.use((i) =>
          i.importFile("owner", {
            filename: "spike.gpx",
            text: missingAltitude,
          })
        )
        const points = parseTrackFile("spike.gpx", missingAltitude).points.map(
          (p) => [p[0], p[1], p[2], null, null]
        )
        const detail = yield* Flights.use((f) =>
          f.detail("owner", imported.flightId)
        )
        expect(detail.points).toEqual(points)
        expect(detail.analysis).toMatchObject({
          takeoffIndex: 20,
          landingIndex: 80,
        })
        expect(detail.analysis!.profile.some((p) => p.i === 45)).toBe(false)
        expect(detail.analysis!.profile.some((p) => p.i === 46)).toBe(true)
        expect(
          detail.analysis!.profile.every(
            (p) => p.altM === null && p.varioMps === 0
          )
        ).toBe(true)
      }).pipe(Effect.provide(layer))
    }
  )
  it.effect(
    "maps malformed and invalid stored track calculations to compression errors",
    () => {
      const { layer } = setup()
      return Effect.gen(function* () {
        const imported = yield* FlightImport.use((i) =>
          i.importFile("owner", bodies())
        )
        const storage = yield* ObjectStorage
        const key = `flights/owner/${imported.flightId}/track.json.gz`
        for (const text of [
          "not json",
          "{}",
          "[[0,46,6,null]]",
          "[[0,100,6,null,null]]",
          "[[0,46,6,null,null],[0,46,6,null,null]]",
        ]) {
          yield* storage.put(key, yield* gzipText(text))
          expect(
            yield* Effect.flip(
              Flights.use((f) => f.detail("owner", imported.flightId))
            )
          ).toMatchObject({ _tag: "CompressionError", reason: "InvalidData" })
        }
        yield* storage.put(key, new Uint8Array([1, 2, 3]))
        expect(
          yield* Effect.flip(
            Flights.use((f) => f.detail("owner", imported.flightId))
          )
        ).toMatchObject({ _tag: "CompressionError", reason: "InvalidData" })
      }).pipe(Effect.provide(layer))
    }
  )
  it.effect(
    "detects same hash and ±2 minute takeoffs, including concurrent requests",
    () => {
      const { layer } = setup()
      return Effect.gen(function* () {
        const importer = yield* FlightImport
        const logbook = yield* Flights
        const imported = yield* importer.importFile("owner", bodies())
        expect(yield* importer.importFile("owner", bodies())).toEqual({
          status: "duplicate",
          flightId: imported.flightId,
        })
        expect(
          yield* importer.importFile("owner", {
            ...bodies(),
            text: fixture.replace("</gpx>", "<!--different bytes--></gpx>"),
          })
        ).toEqual({ status: "duplicate", flightId: imported.flightId })
        const shifted = {
          filename: "flight.gpx",
          text: fixture.replace(/\d{4}-\d{2}-\d{2}T[^<]+/gu, (t) =>
            new Date(new Date(t).getTime() + 120000).toISOString()
          ),
        }
        expect((yield* importer.importFile("owner", shifted)).status).toBe(
          "duplicate"
        )
        const concurrent = yield* Effect.all(
          [
            importer.importFile("owner", bodies(1)),
            importer.importFile("owner", bodies(1)),
          ],
          { concurrency: "unbounded" }
        )
        expect(concurrent.map((r) => r.status)).toEqual(
          expect.arrayContaining(["duplicate", "imported"])
        )
        expect(yield* logbook.list("owner")).toHaveLength(2)
        expect((yield* importer.importFile("other", bodies())).status).toBe(
          "imported"
        )
      }).pipe(Effect.provide(layer))
    }
  )
  it.effect(
    "reuses nearest earlier named sites and checks equipment ownership and retirement",
    () => {
      const { layer } = setup()
      return Effect.gen(function* () {
        const importer = yield* FlightImport
        const logbook = yield* Flights
        const equipment = yield* Equipment
        const first = yield* importer.importFile("owner", bodies())
        const kit = yield* equipment.create("owner", {
          kind: "wing",
          name: "Wing",
          notes: "",
          retired: false,
        })
        const foreign = yield* equipment.create("other", {
          kind: "wing",
          name: "Other",
          notes: "",
          retired: false,
        })
        const values = {
          title: "Edited title",
          takeoffName: "Launch",
          landingName: "Field",
          notes: "Nice day",
          equipmentIds: [kit.id],
        }
        expect(
          (yield* Effect.flip(
            logbook.update("owner", first.flightId, {
              ...values,
              equipmentIds: [foreign.id],
            })
          ))._tag
        ).toBe("FlightInputError")
        yield* logbook.update("owner", first.flightId, values)
        yield* equipment.update("owner", kit.id, {
          kind: "wing",
          name: "Wing",
          notes: "",
          retired: true,
        })
        yield* logbook.update("owner", first.flightId, values)
        const second = yield* importer.importFile("owner", bodies(1))
        const later = yield* logbook.detail("owner", second.flightId)
        expect(later.flight).toMatchObject({
          takeoffName: "Launch",
          landingName: "Field",
        })
        expect(
          (yield* Effect.flip(logbook.update("owner", second.flightId, values)))
            ._tag
        ).toBe("FlightInputError")
        expect(
          (yield* Effect.flip(
            equipment.update("other", kit.id, {
              kind: "other",
              name: "x",
              notes: "",
              retired: false,
            })
          ))._tag
        ).toBe("FlightNotFound")
        expect(
          (yield* Effect.flip(equipment.remove("other", kit.id)))._tag
        ).toBe("FlightNotFound")
        expect(yield* equipment.list("owner")).toHaveLength(1)
        yield* equipment.remove("owner", kit.id)
        expect(
          (yield* logbook.detail("owner", first.flightId)).equipment
        ).toEqual([])
      }).pipe(Effect.provide(layer))
    }
  )
  it.effect(
    "zero-fills twelve UTC months, groups years/sites and excludes null altitude records",
    () => {
      const { layer } = setup()
      return Effect.gen(function* () {
        yield* TestClock.setTime(Date.UTC(2026, 9, 16))
        const database = yield* Database
        const stats = yield* FlightStats
        const base = {
          userId: "owner",
          startedAt: Date.UTC(2026, 9, 1),
          takeoffAt: Date.UTC(2026, 9, 1),
          landingAt: Date.UTC(2026, 9, 1, 1),
          durationS: 3600,
          distanceM: 1000,
          maxSpeedMps: 9,
          source: "manual" as const,
          takeoffName: "Launch",
          createdAt: 1,
          updatedAt: 1,
        }
        yield* database.use((db) =>
          db.insert(flights).values({ ...base, id: "latest" })
        )
        yield* database.use((db) =>
          db.insert(flights).values({
            ...base,
            id: "previous",
            startedAt: Date.UTC(2025, 0, 1),
            takeoffAt: Date.UTC(2025, 0, 1),
            maxAltM: 2000,
            elevationGainM: 100,
            maxClimbMps: 2,
          })
        )
        const result = yield* stats.dashboard("owner")
        expect(result.totals).toEqual({ flights: 2, hours: 2, distanceM: 2000 })
        expect(result.perMonth).toHaveLength(12)
        expect(result.perMonth[0]).toMatchObject({
          period: "2025-11",
          flights: 0,
          seconds: 0,
        })
        expect(result.perMonth[11]).toMatchObject({
          period: "2026-10",
          flights: 1,
          seconds: 3600,
        })
        expect(result.perYear.map((p) => p.period)).toEqual(["2025", "2026"])
        expect(
          result.records.find((r) => r.metric === "altitude")
        ).toMatchObject({ flightId: "previous", value: 2000 })
        expect(result.recentFlights.map((f) => f.id)).toEqual([
          "latest",
          "previous",
        ])
        expect(result.topSites).toEqual([
          { name: "Launch", flights: 2, hours: 2 },
        ])
      }).pipe(Effect.provide(layer))
    }
  )
  it.effect(
    "rejects NUL and oversized UTF-8 input before any storage write",
    () => {
      const { layer, objects } = setup()
      return Effect.gen(function* () {
        const importer = yield* FlightImport
        expect(
          (yield* Effect.flip(
            importer.importFile("owner", {
              filename: "flight.gpx",
              text: fixture + "\0",
            })
          ))._tag
        ).toBe("FlightInputError")
        expect(
          (yield* Effect.flip(
            importer.importFile("owner", {
              filename: "flight.gpx",
              text: "é".repeat(2_500_001),
            })
          )).message
        ).toContain("5 MB")
        expect(objects.size).toBe(0)
      }).pipe(Effect.provide(layer))
    }
  )
  it.effect("stores incompressible tracks above the old 1.8 MB D1 cap", () => {
    const { layer, objects } = setup()
    return Effect.gen(function* () {
      const importer = yield* FlightImport
      let noise = ""
      for (let i = 0; i < 130_000; i++)
        noise += crypto.randomUUID().replaceAll("-", "")
      const imported = yield* importer.importFile("owner", {
        filename: "flight.gpx",
        text: fixture.replace("</gpx>", `<!--${noise}--></gpx>`),
      })
      expect(imported.status).toBe("imported")
      expect(
        Math.max(...[...objects.values()].map((o) => o.bytes.byteLength))
      ).toBeGreaterThan(1_800_000)
    }).pipe(Effect.provide(layer))
  })
  it.effect("does not write objects for duplicates", () => {
    const { layer, objects } = setup()
    return Effect.gen(function* () {
      const importer = yield* FlightImport
      yield* importer.importFile("owner", bodies())
      const before = objects.size
      expect((yield* importer.importFile("owner", bodies())).status).toBe(
        "duplicate"
      )
      expect(objects.size).toBe(before)
    }).pipe(Effect.provide(layer))
  })
  it.effect("removes written objects when the D1 batch fails", () => {
    const { layer, sqlite, objects } = setup()
    return Effect.gen(function* () {
      const importer = yield* FlightImport
      sqlite.exec(
        "CREATE TRIGGER reject_file BEFORE INSERT ON flight_files BEGIN SELECT RAISE(ABORT, 'forced storage failure'); END;"
      )
      expect(
        (yield* Effect.flip(importer.importFile("owner", bodies())))._tag
      ).toBe("DatabaseError")
      expect(objects.size).toBe(0)
    }).pipe(Effect.provide(layer))
  })
  for (const objectPart of ["/files/", "/track.json.gz", "/analysis/"]) {
    it.effect(
      `cleans import objects when the ${objectPart} upload fails after a partial write`,
      () => {
        const { layer, objects, sqlite } = setup((real) => ({
          ...real,
          put: (key, body, options) =>
            real
              .put(key, body, options)
              .pipe(
                Effect.flatMap(() =>
                  key.includes(objectPart)
                    ? Effect.fail(
                        new ObjectStorageError({ reason: "PutFailed", key })
                      )
                    : Effect.void
                )
              ),
        }))
        return Effect.gen(function* () {
          const result = yield* Effect.flip(
            FlightImport.use((i) => i.importFile("owner", bodies()))
          )
          expect(result._tag).toBe("ObjectStorageError")
          expect(objects.size).toBe(0)
          expect(
            sqlite.prepare("SELECT count(*) AS n FROM flights").get()?.n
          ).toBe(0)
          expect(
            sqlite.prepare("SELECT count(*) AS n FROM flight_analyses").get()?.n
          ).toBe(0)
        }).pipe(Effect.provide(layer))
      }
    )
  }
  it.effect(
    "keeps objects when the D1 batch committed but then errored",
    () => {
      const { layer, objects, sqlite } = setup(
        undefined,
        (binding) =>
          ({
            ...binding,
            prepare: binding.prepare.bind(binding),
            batch: async (statements: D1PreparedStatement[]) => {
              const results = await binding.batch(statements)
              if (sqlite.prepare("SELECT count(*) AS n FROM flights").get()?.n)
                throw new Error("response lost after commit")
              return results
            },
          }) as unknown as D1Database
      )
      return Effect.gen(function* () {
        yield* Effect.flip(
          FlightImport.use((i) => i.importFile("owner", bodies()))
        )
        expect(
          sqlite.prepare("SELECT count(*) AS count FROM flights").get()?.count
        ).toBe(1)
        expect(objects.size).toBe(3)
      }).pipe(Effect.provide(layer))
    }
  )
  it("preserves existing flight tables and accepts previous-schema inserts", () => {
    const d1 = makeTestD1()
    cleanups.push(d1.close)
    d1.seedOwner("owner")
    const previous = JSON.parse(
      readFileSync(
        new URL(
          "../../../../migrations/meta/0003_snapshot.json",
          import.meta.url
        ),
        "utf8"
      )
    )
    for (const name of ["flights", "flight_tracks", "flight_files"]) {
      const actual = d1.sqlite
        .prepare(`SELECT name FROM pragma_table_info('${name}')`)
        .all()
        .map((row) => String(row.name))
      expect(actual).toEqual(Object.keys(previous.tables[name].columns))
    }
    d1.sqlite
      .prepare(
        `INSERT INTO flights (${Object.keys(previous.tables.flights.columns).join(", ")}) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?`
      )
      .run(
        "old",
        "owner",
        1,
        1,
        2,
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
    d1.sqlite
      .prepare(
        `INSERT INTO flight_tracks (${Object.keys(previous.tables.flight_tracks.columns).join(", ")}) SELECT ?,?,?,?,?`
      )
      .run("old", "old-track", "hash", 10, 2)
    d1.sqlite
      .prepare(
        `INSERT INTO flight_files (${Object.keys(previous.tables.flight_files.columns).join(", ")}) SELECT ?,?,?,?,?,?,?,?,?`
      )
      .run(
        "file",
        "old",
        "owner",
        "old.gpx",
        "gpx",
        "application/xml",
        10,
        "hash",
        "original"
      )
    expect(
      d1.sqlite.prepare("SELECT count(*) AS n FROM flight_tracks").get()?.n
    ).toBe(1)
    expect(
      d1.sqlite.prepare("SELECT count(*) AS n FROM flight_analyses").get()?.n
    ).toBe(0)
    expect(Object.values(getTableColumns(flights)).map((c) => c.name)).toEqual(
      Object.keys(previous.tables.flights.columns)
    )
  })
  it.effect("succeeds on delete even when object cleanup fails", () => {
    const { layer, sqlite } = setup((real) => ({
      ...real,
      deleteByPrefix: (prefix) =>
        Effect.fail(
          new ObjectStorageError({ reason: "ListFailed", key: prefix })
        ),
    }))
    return Effect.gen(function* () {
      const imported = yield* FlightImport.use((i) =>
        i.importFile("owner", bodies())
      )
      const removed = yield* Flights.use((f) =>
        f.remove("owner", imported.flightId)
      )
      expect(removed).toEqual({ id: imported.flightId })
      expect(
        sqlite.prepare("SELECT count(*) AS count FROM flights").get()?.count
      ).toBe(0)
    }).pipe(Effect.provide(layer))
  })
  it.effect("fails a download whose stored object is missing", () => {
    const { layer, objects } = setup()
    return Effect.gen(function* () {
      const imported = yield* FlightImport.use((i) =>
        i.importFile("owner", bodies())
      )
      const detail = yield* Flights.use((f) =>
        f.detail("owner", imported.flightId)
      )
      objects.clear()
      expect(
        (yield* Effect.flip(
          Flights.use((f) => f.download("owner", detail.files[0]!.id))
        ))._tag
      ).toBe("ObjectStorageError")
    }).pipe(Effect.provide(layer))
  })
  it.effect(
    "prepares legacy data once, preserves edited metadata and kit, and does no work on retry",
    () => {
      let puts = 0
      let reads = 0
      const { layer, sqlite } = setup((real) => ({
        ...real,
        put: (...args) => {
          puts++
          return real.put(...args)
        },
        get: (key) => {
          reads++
          return real.get(key)
        },
      }))
      return Effect.gen(function* () {
        const imported = yield* FlightImport.use((i) =>
          i.importFile("owner", bodies())
        )
        const logbook = yield* Flights
        const original = yield* logbook.detail("owner", imported.flightId)
        const kit = yield* Equipment.use((e) =>
          e.create("owner", {
            kind: "wing",
            name: "Wing",
            notes: "",
            retired: false,
          })
        )
        yield* logbook.update("owner", imported.flightId, {
          title: "  My title  ",
          takeoffName: "Edited launch",
          landingName: "Edited landing",
          notes: "My notes",
          equipmentIds: [kit.id],
        })
        sqlite
          .prepare("DELETE FROM flight_analyses WHERE flight_id = ?")
          .run(imported.flightId)
        sqlite
          .prepare(
            "UPDATE flights SET duration_s = 17, distance_m = 123, max_speed_mps = 1 WHERE id = ?"
          )
          .run(imported.flightId)
        const legacy = yield* logbook.detail("owner", imported.flightId)
        expect(legacy.points).toEqual(original.points)
        expect(legacy.analysis).toBeNull()
        expect(legacy.flight.needsPreparation).toBe(true)
        expect((yield* logbook.list("owner"))[0]).toMatchObject({
          preview: null,
          needsPreparation: true,
        })
        const preparation = yield* FlightPreparation
        expect(yield* preparation.prepare("owner", imported.flightId)).toEqual({
          flightId: imported.flightId,
          status: "prepared",
        })
        const ready = yield* logbook.detail("owner", imported.flightId)
        expect(ready.analysis).toEqual(original.analysis)
        expect(ready.points).toEqual(original.points)
        expect(ready.flight).toMatchObject({
          title: "My title",
          takeoffName: "Edited launch",
          landingName: "Edited landing",
          notes: "My notes",
          durationS: original.flight.durationS,
          distanceM: original.flight.distanceM,
          maxSpeedMps: original.flight.maxSpeedMps,
        })
        expect(ready.equipment.map((e) => e.id)).toEqual([kit.id])
        const before = { puts, reads }
        expect(
          yield* preparation.prepare("owner", imported.flightId)
        ).toMatchObject({ status: "already-prepared" })
        expect({ puts, reads }).toEqual(before)
        expect(
          yield* Effect.flip(preparation.prepare("other", imported.flightId))
        ).toMatchObject({ _tag: "FlightNotFound" })
        expect({ puts, reads }).toEqual(before)
        sqlite
          .prepare("DELETE FROM flight_analyses WHERE flight_id = ?")
          .run(imported.flightId)
        sqlite
          .prepare("DELETE FROM flight_tracks WHERE flight_id = ?")
          .run(imported.flightId)
        expect(
          yield* preparation.prepare("owner", imported.flightId)
        ).toMatchObject({ status: "unavailable" })
        expect({ puts, reads }).toEqual(before)
        expect((yield* logbook.list("owner"))[0]).toMatchObject({
          preview: null,
          needsPreparation: false,
        })
      }).pipe(Effect.provide(layer))
    }
  )
  it.effect(
    "preserves edits made while an existing flight is being prepared",
    () => {
      let editing = ""
      const { layer, sqlite } = setup((real) => ({
        ...real,
        put: (key, body, options) =>
          real.put(key, body, options).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                if (editing && key.includes("/analysis/")) {
                  sqlite
                    .prepare(
                      "UPDATE flights SET notes = 'Concurrent notes', takeoff_name = 'Concurrent launch', landing_name = 'Concurrent landing' WHERE id = ?"
                    )
                    .run(editing)
                  sqlite
                    .prepare(
                      "UPDATE flight_titles SET title = 'Concurrent title' WHERE flight_id = ?"
                    )
                    .run(editing)
                }
              })
            )
          ),
      }))
      return Effect.gen(function* () {
        const imported = yield* FlightImport.use((i) =>
          i.importFile("owner", bodies())
        )
        sqlite
          .prepare("DELETE FROM flight_analyses WHERE flight_id = ?")
          .run(imported.flightId)
        editing = imported.flightId
        expect(
          yield* FlightPreparation.use((p) =>
            p.prepare("owner", imported.flightId)
          )
        ).toMatchObject({ status: "prepared" })
        expect(
          (yield* Flights.use((f) => f.detail("owner", imported.flightId)))
            .flight
        ).toMatchObject({
          title: "Concurrent title",
          notes: "Concurrent notes",
          takeoffName: "Concurrent launch",
          landingName: "Concurrent landing",
        })
      }).pipe(Effect.provide(layer))
    }
  )
  it.effect(
    "validates edited titles and selects sanitized import defaults",
    () => {
      const { layer } = setup()
      return Effect.gen(function* () {
        const imported = yield* FlightImport.use((i) =>
          i.importFile("owner", bodies())
        )
        const logbook = yield* Flights
        for (const title of [
          "",
          "   ",
          "a".repeat(201),
          "hidden\u0000text",
          "hidden\u0085text",
        ]) {
          expect(
            yield* Effect.flip(
              logbook.update("owner", imported.flightId, {
                title,
                takeoffName: "",
                landingName: "",
                notes: "",
                equipmentIds: [],
              })
            )
          ).toMatchObject({ _tag: "FlightInputError" })
        }
        expect(defaultTitle(0, "  Track\u0000 name  ", "Launch")).toBe(
          "Track name"
        )
        expect(defaultTitle(0, "\u0000 ", " Launch ")).toBe("Launch")
        expect(defaultTitle(0)).toBe("Flight 1970-01-01 00:00 UTC")
        expect(defaultTitle(0, "a".repeat(300))).toHaveLength(200)
        expect(defaultTitle(0, `${"a".repeat(199)}🪂`)).toBe("a".repeat(199))
        expect(defaultTitle(0, `${"a".repeat(198)}🪂`)).toBe(
          `${"a".repeat(198)}🪂`
        )
      }).pipe(Effect.provide(layer))
    }
  )
  it.effect(
    "rejects missing, corrupt, mismatched and out-of-range snapshots as typed errors",
    () => {
      const { layer, sqlite, objects } = setup()
      return Effect.gen(function* () {
        const imported = yield* FlightImport.use((i) =>
          i.importFile("owner", bodies())
        )
        const row = sqlite
          .prepare("SELECT object_key FROM flight_analyses WHERE flight_id = ?")
          .get(imported.flightId)!
        const key = String(row.object_key)
        const stored = objects.get(key)!
        const snapshot = JSON.parse(yield* gunzipText(stored.bytes))
        const logbook = yield* Flights
        objects.delete(key)
        expect(
          yield* Effect.flip(logbook.detail("owner", imported.flightId))
        ).toMatchObject({ _tag: "ObjectStorageError", reason: "MissingObject" })
        for (const damaged of [
          "not json",
          {},
          { ...snapshot, schemaVersion: 999 },
          { ...snapshot, pointsSha256: "wrong" },
          { ...snapshot, pointCount: 1 },
          {
            ...snapshot,
            analysis: {
              ...snapshot.analysis,
              landingIndex: snapshot.pointCount,
            },
          },
          {
            ...snapshot,
            analysis: {
              ...snapshot.analysis,
              profile: [{ ...snapshot.analysis.profile[0], i: -1 }],
            },
          },
          {
            ...snapshot,
            analysis: {
              ...snapshot.analysis,
              profile: [
                { ...snapshot.analysis.profile[0], speedKmh: "not a number" },
              ],
            },
          },
        ]) {
          yield* ObjectStorage.use((o) =>
            gzipText(JSON.stringify(damaged)).pipe(
              Effect.flatMap((bytes) => o.put(key, bytes))
            )
          )
          expect(
            yield* Effect.flip(logbook.detail("owner", imported.flightId))
          ).toMatchObject({ _tag: "CompressionError" })
        }
        objects.set(key, stored)
        expect(
          (yield* logbook.detail("owner", imported.flightId)).analysis
        ).toEqual(snapshot.analysis)
        sqlite
          .prepare("DELETE FROM flight_analyses WHERE flight_id = ?")
          .run(imported.flightId)
        sqlite
          .prepare(
            "UPDATE flight_tracks SET sha256 = 'wrong' WHERE flight_id = ?"
          )
          .run(imported.flightId)
        const size = objects.size
        expect(
          yield* Effect.flip(
            FlightPreparation.use((p) => p.prepare("owner", imported.flightId))
          )
        ).toMatchObject({ _tag: "CompressionError" })
        expect(objects.size).toBe(size)
      }).pipe(Effect.provide(layer))
    }
  )
  it.effect(
    "cleans only its unpublished attempt when analysis upload fails",
    () => {
      let fail = false
      const { layer, sqlite, objects } = setup((real) => ({
        ...real,
        put: (key, body, options) =>
          real
            .put(key, body, options)
            .pipe(
              Effect.flatMap(() =>
                fail && key.includes("/analysis/")
                  ? Effect.fail(
                      new ObjectStorageError({ reason: "PutFailed", key })
                    )
                  : Effect.void
              )
            ),
      }))
      return Effect.gen(function* () {
        const imported = yield* FlightImport.use((i) =>
          i.importFile("owner", bodies())
        )
        sqlite
          .prepare("DELETE FROM flight_analyses WHERE flight_id = ?")
          .run(imported.flightId)
        const before = [...objects.keys()]
        fail = true
        expect(
          yield* Effect.flip(
            FlightPreparation.use((p) => p.prepare("owner", imported.flightId))
          )
        ).toMatchObject({ _tag: "ObjectStorageError" })
        expect([...objects.keys()]).toEqual(before)
        expect(
          sqlite.prepare("SELECT count(*) AS n FROM flight_analyses").get()?.n
        ).toBe(0)
      }).pipe(Effect.provide(layer))
    }
  )
  it.effect(
    "concurrent preparation publishes once and a loser cannot overwrite winner measurements",
    () => {
      let racing = false
      let publications = 0
      const { layer, sqlite, objects } = setup(
        undefined,
        (binding) =>
          ({
            ...binding,
            prepare: binding.prepare.bind(binding),
            batch: async (statements: D1PreparedStatement[]) => {
              const result = await binding.batch(statements)
              if (racing && statements.length === 2 && ++publications === 1)
                sqlite.prepare("UPDATE flights SET max_speed_mps = 777").run()
              return result
            },
          }) as D1Database
      )
      return Effect.gen(function* () {
        const imported = yield* FlightImport.use((i) =>
          i.importFile("owner", bodies())
        )
        sqlite
          .prepare("DELETE FROM flight_analyses WHERE flight_id = ?")
          .run(imported.flightId)
        const before = objects.size
        racing = true
        const p = yield* FlightPreparation
        const results = yield* Effect.all(
          [
            p.prepare("owner", imported.flightId),
            p.prepare("owner", imported.flightId),
          ],
          { concurrency: "unbounded" }
        )
        expect(new Set(results.map((r) => r.status))).toEqual(
          new Set(["already-prepared", "prepared"])
        )
        expect(publications).toBe(2)
        expect(
          sqlite.prepare("SELECT count(*) AS n FROM flight_analyses").get()?.n
        ).toBe(1)
        expect(objects.size).toBe(before + 1)
        expect(
          (yield* Flights.use((f) => f.list("owner")))[0]!.maxSpeedMps
        ).toBe(777)
        const ready = yield* Flights.use((f) =>
          f.detail("owner", imported.flightId)
        )
        expect(ready.analysis).not.toBeNull()
      }).pipe(Effect.provide(layer))
    }
  )
  for (const fault of [
    "before-commit",
    "lost-response",
    "failed-read",
  ] as const) {
    it.effect(`retains uncertain preparation objects after ${fault}`, () => {
      let enabled = false
      let failedReads = false
      const { layer, sqlite, objects } = setup(
        undefined,
        (binding) =>
          ({
            ...binding,
            prepare: (query: string) => {
              if (failedReads && query.startsWith("select"))
                throw new Error("read unavailable")
              return binding.prepare(query)
            },
            batch: async (statements: D1PreparedStatement[]) => {
              if (enabled && statements.length === 2) {
                if (fault === "before-commit")
                  throw new Error("ambiguous write failure")
                const result = await binding.batch(statements)
                if (fault === "lost-response")
                  throw new Error("lost committed response")
                failedReads = true
                return result
              }
              return binding.batch(statements)
            },
          }) as D1Database
      )
      return Effect.gen(function* () {
        const imported = yield* FlightImport.use((i) =>
          i.importFile("owner", bodies())
        )
        sqlite
          .prepare("DELETE FROM flight_analyses WHERE flight_id = ?")
          .run(imported.flightId)
        const before = [...objects.keys()]
        enabled = true
        expect(
          yield* Effect.flip(
            FlightPreparation.use((p) => p.prepare("owner", imported.flightId))
          )
        ).toMatchObject({ _tag: "DatabaseError" })
        expect(objects.size).toBe(before.length + 1)
        expect(before.every((key) => objects.has(key))).toBe(true)
        enabled = false
        failedReads = false
        const result = yield* FlightPreparation.use((p) =>
          p.prepare("owner", imported.flightId)
        )
        expect(result.status).toBe(
          fault === "before-commit" ? "prepared" : "already-prepared"
        )
        expect(
          (yield* Flights.use((f) => f.detail("owner", imported.flightId)))
            .analysis
        ).not.toBeNull()
      }).pipe(Effect.provide(layer))
    })
  }
  it.effect(
    "cannot resurrect a flight deleted while its preparation object is uploaded",
    () => {
      let deleting = ""
      const { layer, sqlite, objects } = setup((real) => ({
        ...real,
        put: (key, body, options) =>
          real.put(key, body, options).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                if (deleting && key.includes("/analysis/"))
                  sqlite
                    .prepare("DELETE FROM flights WHERE id = ?")
                    .run(deleting)
              })
            )
          ),
      }))
      return Effect.gen(function* () {
        const imported = yield* FlightImport.use((i) =>
          i.importFile("owner", bodies())
        )
        sqlite
          .prepare("DELETE FROM flight_analyses WHERE flight_id = ?")
          .run(imported.flightId)
        deleting = imported.flightId
        const before = objects.size
        expect(
          yield* Effect.flip(
            FlightPreparation.use((p) => p.prepare("owner", imported.flightId))
          )
        ).toMatchObject({ _tag: "FlightNotFound" })
        expect(
          sqlite.prepare("SELECT count(*) AS n FROM flight_analyses").get()?.n
        ).toBe(0)
        expect(
          sqlite.prepare("SELECT count(*) AS n FROM flights").get()?.n
        ).toBe(0)
        expect(objects.size).toBe(before)
      }).pipe(Effect.provide(layer))
    }
  )
})
it.effect("gzip is lossless for unicode and compact track JSON", () =>
  Effect.gen(function* () {
    const text = "\uFEFFé 🪂 \\u0000 [[1,2,3,null,4]]"
    const compressed = yield* gzipText(text)
    expect(compressed[0]).toBe(31)
    expect(yield* gunzipText(compressed)).toBe(text)
  })
)

it.effect(
  "migration grants Flights only to active back-office administrators",
  () =>
    Effect.sync(() => {
      const sqlite = new DatabaseSync(":memory:")
      try {
        for (const file of ["0000_init.sql", "0001_app_access.sql"])
          sqlite.exec(
            readFileSync(
              new URL(`../../../../migrations/${file}`, import.meta.url),
              "utf8"
            )
          )
        sqlite.exec(`INSERT INTO auth_users (id,name,email,deleted_at) VALUES ('admin','Admin','admin@example.invalid',NULL),('member','Member','member@example.invalid',NULL),('removed','Removed','removed@example.invalid',1);
      INSERT INTO app_access (user_id,app,granted_at) VALUES ('admin','backOffice',1),('admin','music',1),('member','music',1),('removed','backOffice',1);`)
        sqlite.exec(
          readFileSync(
            new URL(
              "../../../../migrations/0002_brave_calypso.sql",
              import.meta.url
            ),
            "utf8"
          )
        )
        expect(
          sqlite
            .prepare("SELECT user_id FROM app_access WHERE app = 'flights'")
            .all()
            .map((row) => row.user_id)
        ).toEqual(["admin"])
        expect(
          sqlite
            .prepare(
              "SELECT user_id FROM app_access WHERE app = 'music' ORDER BY user_id"
            )
            .all()
            .map((row) => row.user_id)
        ).toEqual(["admin", "member"])
      } finally {
        sqlite.close()
      }
    })
)

it.effect("rolls back every import row if a file insert fails", () => {
  const { layer, sqlite } = setup()
  return Effect.gen(function* () {
    const importer = yield* FlightImport
    const logbook = yield* Flights
    sqlite.exec(
      "CREATE TRIGGER reject_file BEFORE INSERT ON flight_files BEGIN SELECT RAISE(ABORT, 'forced storage failure'); END;"
    )
    expect(
      (yield* Effect.flip(importer.importFile("owner", bodies())))._tag
    ).toBe("DatabaseError")
    expect(yield* logbook.list("owner")).toEqual([])
    expect(
      sqlite.prepare("SELECT count(*) AS count FROM flight_tracks").get()?.count
    ).toBe(0)
    sqlite.exec("DROP TRIGGER reject_file")
    expect((yield* importer.importFile("owner", bodies())).status).toBe(
      "imported"
    )
  }).pipe(Effect.provide(layer))
})
