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
} from "@/server/modules/database"
import { makeTestD1 } from "@/server/modules/database/testing"
import { gzipText, gunzipText } from "@/server/modules/compression"
import {
  ObjectStorage,
  ObjectStorageError,
  makeMemoryObjectStorage,
  type MemoryObject,
  type ObjectStorageApi,
} from "@/server/modules/object-storage"
import { FlightImport } from "@/server/actions/flights/import"
import { Equipment } from "@/server/actions/flights/equipment"
import { FlightStats } from "@/server/actions/flights/stats"
import { parseTrackFile } from "@/shared/flight-track"
import { Flights } from "./index"

const fixture = readFileSync(
  new URL(
    "../../../../shared/flight-track/fixtures/flight.gpx",
    import.meta.url
  ),
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
  it.effect("removes the first object when the second write fails", () => {
    const { layer, objects } = setup((real) => ({
      ...real,
      put: (key, body, options) =>
        key.endsWith("track.json.gz")
          ? Effect.fail(new ObjectStorageError({ reason: "PutFailed", key }))
          : real.put(key, body, options),
    }))
    return Effect.gen(function* () {
      const result = yield* Effect.flip(
        FlightImport.use((i) => i.importFile("owner", bodies()))
      )
      expect(result._tag).toBe("ObjectStorageError")
      expect(objects.size).toBe(0)
    }).pipe(Effect.provide(layer))
  })
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
              // Only the 5-statement import batch loses its response.
              if (statements.length === 5)
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
        expect(objects.size).toBe(2)
      }).pipe(Effect.provide(layer))
    }
  )
  it("names every flights column in the import insert", () => {
    const d1 = makeTestD1()
    cleanups.push(d1.close)
    const actual = d1.sqlite
      .prepare("SELECT name FROM pragma_table_info('flights')")
      .all()
      .map((row) => String(row.name))
    // Fails when the schema and migrations diverge, or a column is added
    // without the import store learning about it.
    expect(Object.values(getTableColumns(flights)).map((c) => c.name)).toEqual(
      actual
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
              new URL(`../../../../../migrations/${file}`, import.meta.url),
              "utf8"
            )
          )
        sqlite.exec(`INSERT INTO auth_users (id,name,email,deleted_at) VALUES ('admin','Admin','admin@example.invalid',NULL),('member','Member','member@example.invalid',NULL),('removed','Removed','removed@example.invalid',1);
      INSERT INTO app_access (user_id,app,granted_at) VALUES ('admin','backOffice',1),('admin','music',1),('member','music',1),('removed','backOffice',1);`)
        sqlite.exec(
          readFileSync(
            new URL(
              "../../../../../migrations/0002_brave_calypso.sql",
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
