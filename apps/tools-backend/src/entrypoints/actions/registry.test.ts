import { describe, expect, test } from "vitest"
import { Effect, Layer, Schema } from "effect"
import {
  type ActionName,
  actionsFor,
  catalog,
} from "@mdoultremont/tools-contracts"
import { FlightDetailSchema } from "@mdoultremont/tools-contracts/flights"
import { actionRegistry, bind, createRegistry, handlers } from "."

/**
 * Every business capability tools served before the action registry, and
 * the action that serves it now. Removing an action breaks this list.
 */
const legacy = {
  "GET /api/music/sources": "music.sources.get",
  "POST /api/music/sources": "music.sources.add",
  "PUT /api/music/sources/enabled": "music.sources.setEnabled",
  "DELETE /api/music/sources/:playlistId": "music.sources.remove",
  "oRPC flights/list": "flights.list",
  "POST /api/flights/:flightId/prepare": "flights.prepare",
  "oRPC flights/get": "flights.get",
  "oRPC flights/update": "flights.update",
  "oRPC flights/delete": "flights.delete",
  "oRPC flights/import": "flights.import",
  "oRPC flights/stats/get": "flights.stats.get",
  "oRPC flights/equipment/list": "flights.equipment.list",
  "oRPC flights/equipment/create": "flights.equipment.create",
  "oRPC flights/equipment/update": "flights.equipment.update",
  "oRPC flights/equipment/delete": "flights.equipment.delete",
  "GET /api/flights/files/:fileId": "flights.files.download",
  "GET /api/music/spotify/status": "music.spotify.status",
  "GET /api/music/spotify/connect": "music.spotify.connect",
  "POST /api/music/spotify/disconnect": "music.spotify.disconnect",
  "GET /api/music/spotify/playlists": "music.spotify.playlists",
  "GET /api/music/spotify/liked-tracks": "music.spotify.likedTracks",
  "GET /api/music/spotify/playlists/:playlistId/tracks":
    "music.spotify.playlistTracks",
  "GET /api/music/destinations": "music.destinations.get",
  "PUT /api/music/destinations": "music.destinations.save",
  "POST /api/music/destinations/create": "music.destinations.create",
  "DELETE /api/music/destinations": "music.destinations.remove",
  "PUT /api/music/review-playlist": "music.destinations.setReviewPlaylist",
  "GET /api/music/ingestion": "music.ingestion.status",
  "POST /api/music/ingestion": "music.ingestion.start",
  "GET /api/music/enrichment": "music.enrichment.status",
  "POST /api/music/enrichment": "music.enrichment.retry",
  "GET /api/music/classification": "music.classification.status",
  "PUT /api/music/ready": "music.classification.setReady",
  "POST /api/music/classification": "music.classification.reclassify",
  "GET /api/music/delivery": "music.delivery.status",
  "POST /api/music/delivery": "music.delivery.start",
  "PUT /api/music/delivery": "music.delivery.setAutomatic",
  "GET /api/back-office/users": "backOffice.users.list",
  "PUT /api/back-office/users": "backOffice.users.setAccess",
  "DELETE /api/back-office/users": "backOffice.users.remove",
  "POST /api/back-office/invitations": "backOffice.invitations.create",
  "POST /api/back-office/invitations/resend": "backOffice.invitations.resend",
  "DELETE /api/back-office/invitations": "backOffice.invitations.revoke",
} satisfies Record<string, ActionName>

const introduced = [
  "music.player.token",
  "music.player.status",
  "music.player.play",
  "music.player.pause",
  "music.player.resume",
] satisfies ActionName[]

const run = () => Effect.succeed({})

describe("action registry", () => {
  test("serves every former capability, and nothing outside the inventory", () => {
    const names = actionRegistry.actions.map((entry) => entry.name)
    expect(new Set(names)).toEqual(
      new Set([...Object.values(legacy), ...introduced])
    )
    expect(names).toHaveLength(new Set(names).size)
  })

  test("describes every action as JSON Schema with its route parameters", () => {
    const descriptors = actionRegistry.describe([
      "flights",
      "music",
      "backOffice",
    ])
    expect(descriptors).toHaveLength(actionRegistry.actions.length)
    for (const descriptor of descriptors) {
      const input = descriptor.inputSchema as {
        type: string
        properties: Record<string, { type?: string }>
      }
      expect([descriptor.name, input.type]).toEqual([descriptor.name, "object"])
      for (const [, param] of descriptor.http.path.matchAll(/:([^/]+)/g))
        expect([
          descriptor.name,
          param,
          input.properties[param!]?.type,
        ]).toEqual([descriptor.name, param, "string"])
      expect(JSON.parse(JSON.stringify(descriptor))).toEqual(descriptor)
      expect(descriptor.description.length).toBeGreaterThan(10)
    }
    expect(
      actionRegistry.describe(["music"]).every((d) => d.app === "music")
    ).toBe(true)
  })

  test("refuses two actions on one route and a handler bound to another action", () => {
    const action = actionsFor("flights")
    const first = action({
      description: "First.",
      effect: "read",
      http: { method: "GET", path: "/things/:a" },
      input: Schema.Struct({ a: Schema.String }),
      output: Schema.Struct({}),
    })
    const second = action({
      description: "Second.",
      effect: "read",
      http: { method: "GET", path: "/things/:b" },
      input: Schema.Struct({ b: Schema.String }),
      output: Schema.Struct({}),
    })
    expect(() =>
      createRegistry(
        { flights: { first, second } },
        {
          flights: {
            first: bind(first, Layer.empty, run),
            second: bind(second, Layer.empty, run),
          },
        }
      )
    ).toThrow("Actions flights.first and flights.second share GET /things/:")
    expect(() =>
      createRegistry(catalog, {
        ...handlers,
        flights: {
          ...handlers.flights,
          stats: { get: handlers.flights.equipment.list },
        },
      } as never)
    ).toThrow("Action flights.stats.get is not bound to its own handler")
  })
})

describe("the manifest", () => {
  const all = actionRegistry.describe(["music", "backOffice", "flights"])

  test("describes every action with object input and output schemas", () => {
    expect(all).toHaveLength(actionRegistry.actions.length)
    for (const { name, inputSchema, outputSchema } of all)
      expect([name, inputSchema.type, outputSchema.type]).toEqual([
        name,
        "object",
        "object",
      ])
  })

  test("describes a flight's track points as the exact tuple", () => {
    const flight = all.find(({ name }) => name === "flights.get")
    const finite = { type: "number" }
    const nullable = { anyOf: [finite, { type: "null" }] }
    expect(flight?.outputSchema.properties).toHaveProperty("points", {
      type: "array",
      items: {
        type: "array",
        prefixItems: [finite, finite, finite, nullable, nullable],
        minItems: 5,
        maxItems: 5,
      },
    })
  })

  test("encodes track points as they are, and refuses malformed ones", () => {
    const points = Schema.toCodecJson(
      Schema.Struct({ points: FlightDetailSchema.fields.points })
    )
    const track = { points: [[1, 45.1, 6.2, null, 1200.5]] }
    expect(Schema.encodeUnknownSync(points)(track)).toEqual(track)
    for (const point of [
      [1, 45.1, 6.2, null],
      [1, 45.1, 6.2, 1200, "NaN"],
      [1, 45.1, 6.2, undefined, null],
    ])
      expect(() =>
        Schema.decodeUnknownSync(points)({ points: [point] })
      ).toThrow(/points/)
  })
})

describe("flight analysis contract", () => {
  const analysis = Schema.toCodecJson(
    Schema.Struct({ analysis: FlightDetailSchema.fields.analysis })
  )
  const profile = [
    { i: 46, tS: 26, altM: null, speedKmh: 36, varioMps: 0, distKm: 0.26 },
  ]
  const value = {
    analysis: {
      takeoffIndex: 20,
      landingIndex: 80,
      takeoffAt: 1700000020000,
      profile,
    },
  }

  test("encodes complete profiles without copying the producer's array", () => {
    const encoded = Schema.encodeSync(analysis)(value)
    expect(encoded).toEqual(value)
    expect(
      Schema.encodeSync(FlightDetailSchema.fields.analysis)(value.analysis)!
        .profile
    ).toBe(profile)
    expect(
      Schema.decodeUnknownSync(analysis)(JSON.parse(JSON.stringify(encoded)))
    ).toEqual(value)
    expect(Schema.decodeUnknownSync(analysis)({ analysis: null })).toEqual({
      analysis: null,
    })
    for (const invalid of [
      { ...profile[0], i: 1.5 },
      { ...profile[0], altM: "missing" },
      { ...profile[0], speedKmh: Infinity },
      { i: 1, tS: 0 },
    ])
      expect(() =>
        Schema.decodeUnknownSync(analysis)({
          analysis: { ...value.analysis, profile: [invalid] },
        })
      ).toThrow(/profile/)
  })

  test("publishes nullable analysis and every profile field in the manifest", () => {
    const detail = actionRegistry
      .describe(["flights"])
      .find(({ name }) => name === "flights.get")!
    const numeric = { type: "number" }
    expect(detail.outputSchema.properties).toHaveProperty("analysis", {
      anyOf: [
        {
          type: "object",
          properties: {
            takeoffIndex: { type: "integer" },
            landingIndex: { type: "integer" },
            takeoffAt: numeric,
            profile: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  i: { type: "integer" },
                  tS: numeric,
                  altM: { anyOf: [numeric, { type: "null" }] },
                  speedKmh: numeric,
                  varioMps: numeric,
                  distKm: numeric,
                },
                required: ["i", "tS", "altM", "speedKmh", "varioMps", "distKm"],
                additionalProperties: true,
              },
            },
          },
          required: ["takeoffIndex", "landingIndex", "takeoffAt", "profile"],
          additionalProperties: true,
        },
        { type: "null" },
      ],
    })
  })
})
