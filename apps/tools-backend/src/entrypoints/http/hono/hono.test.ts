import { readFileSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { Effect, Layer, Schema } from "effect"
import { Base64 } from "effect/encoding"
import {
  actionRegistry,
  bind,
  createRegistry,
  handlers,
} from "#backend/entrypoints/actions"
import { actionsFor, catalog } from "@mdoultremont/tools-contracts"

vi.mock("cloudflare:workers", () => ({ env: {} }))
import { refusal } from "../oauth"
import type { Authenticate } from "."
import { makeHarness, code, origin } from "./testing"

const fixture = readFileSync(
  new URL(
    "../../../../../../packages/flight-track/src/fixtures/flight.gpx",
    import.meta.url
  ),
  "utf8"
)

const jsonRequest = (
  method: string,
  body?: unknown,
  headers: Record<string, string> = { Origin: origin }
): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json", ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

/** A request to an action's public route, path parameters filled in. */
const routeOf = (entry: (typeof actionRegistry.actions)[number]) =>
  `/api/v1${entry.spec.http.path.replaceAll(/:[^/]+/g, "x")}`

let api: ReturnType<typeof makeHarness>
beforeEach(() => {
  api = makeHarness()
  api.d1.seedOwner()
})
afterEach(() => api.close())

describe("authentication and app access", () => {
  test("every action requires a caller with its app, over HTTP and oRPC", async () => {
    for (const entry of actionRegistry.actions) {
      const { method } = entry.spec.http
      const http = () =>
        api.request(
          routeOf(entry),
          jsonRequest(method, method === "GET" ? undefined : {})
        )
      const rpc = () =>
        api.request(
          `/api/rpc/${entry.path.join("/")}`,
          jsonRequest("POST", { json: {} })
        )

      api.signOut()
      expect([entry.name, (await http()).status]).toEqual([entry.name, 401])
      expect([entry.name, (await rpc()).status]).toEqual([entry.name, 401])

      const others = (["music", "backOffice", "flights"] as const).filter(
        (app) => app !== entry.spec.app
      )
      api.signIn(others)
      const forbidden = await http()
      expect([entry.name, forbidden.status]).toEqual([entry.name, 403])
      expect(await forbidden.json()).toEqual({
        error: {
          code: "FORBIDDEN",
          message: "You do not have access to this app",
        },
      })
      expect([entry.name, (await rpc()).status]).toEqual([entry.name, 403])
    }
    api.signIn(["music"])
    expect(await code(api.client.flights.stats.get())).toBe("FORBIDDEN")
    expect((await api.request("/api/flights/files/x")).status).toBe(403)
    api.signOut()
    expect(await code(api.client.flights.stats.get())).toBe("UNAUTHORIZED")
    expect((await api.request("/api/v1")).status).toBe(401)
  })

  test("authenticates each request once", async () => {
    const authenticate = vi.fn<Authenticate>(async () => ({
      userId: "owner",
      apps: ["flights"],
      origin,
    }))
    const counted = makeHarness({ authenticate })
    counted.d1.seedOwner()
    for (const path of ["/api/v1", "/api/v1/flights/stats"]) {
      authenticate.mockClear()
      expect((await counted.request(path)).status).toBe(200)
      expect([path, authenticate.mock.calls.length]).toEqual([path, 1])
    }
    counted.close()
  })

  test("sends a refusal in each wire's error body, with its headers", async () => {
    const refused = makeHarness({
      authenticate: async () =>
        refusal("SERVICE_UNAVAILABLE", "Sign-in could not be checked", {
          "WWW-Authenticate": 'Bearer resource_metadata="x"',
          "Retry-After": "5",
        }),
    })
    for (const response of [
      await refused.request("/api/v1/flights"),
      await refused.request("/api/mcp", jsonRequest("POST", {}, {})),
    ]) {
      expect(response.status).toBe(503)
      expect(response.headers.get("WWW-Authenticate")).toContain("Bearer")
      expect(response.headers.get("Retry-After")).toBe("5")
      expect(await response.json()).toEqual({
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Sign-in could not be checked",
        },
      })
    }
    const rpc = await refused.client.flights.stats
      .get()
      .catch((error: unknown) => error)
    expect(rpc).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: "Sign-in could not be checked",
      status: 503,
    })
    refused.close()
  })

  test("asks MCP for a bearer token and every other route for either credential", async () => {
    const credentials = vi.fn<Authenticate>(async () => ({
      userId: "owner",
      apps: ["flights"],
      origin,
    }))
    const seen = makeHarness({ authenticate: credentials })
    seen.d1.seedOwner()
    await seen.request("/api/v1")
    await seen.request("/api/rpc/flights/stats/get", jsonRequest("POST", {}))
    await seen.request("/api/mcp", jsonRequest("POST", {}, {}))
    expect(credentials.mock.calls.map(([, accepted]) => accepted)).toEqual([
      "bearer-or-session",
      "bearer-or-session",
      "bearer",
    ])
    seen.close()
  })
})

describe("flights", () => {
  test("imports, lists, reads, downloads and deletes through oRPC", async () => {
    api.signIn(["flights"])
    const imported = await api.client.flights.import({
      filename: "flight.gpx",
      text: fixture,
    })
    expect(imported.status).toBe("imported")
    const { flightId } = imported
    expect((await api.client.flights.list()).flights).toHaveLength(1)
    expect(
      (await api.client.flights.list({ year: 1950 })).flights
    ).toHaveLength(0)
    const detail = await api.client.flights.get({ flightId })
    expect(detail.points.length).toBeGreaterThan(2)
    expect((await api.client.flights.stats.get()).totals.flights).toBe(1)
    expect(
      (
        await api.client.flights.import({
          filename: "flight.gpx",
          text: fixture,
        })
      ).status
    ).toBe("duplicate")

    const fileId = detail.files[0]!.id
    const file = await api.request(`/api/flights/files/${fileId}`)
    expect(file.status).toBe(200)
    expect(await file.text()).toBe(fixture)
    expect(file.headers.get("Content-Disposition")).toContain(
      'attachment; filename="flight.gpx"'
    )
    const payload = await api.client.flights.files.download({ fileId })
    expect(payload).toMatchObject({
      filename: "flight.gpx",
      contentType: "application/gpx+xml; charset=utf-8",
    })
    const bytes = new TextEncoder().encode(fixture)
    expect(payload.sizeBytes).toBe(bytes.byteLength)
    expect(payload.contentBase64).toBe(Base64.encode(bytes))
    const missing = await api.request("/api/flights/files/missing")
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Original file not found" },
    })

    const item = await api.client.flights.equipment.create({
      kind: "wing",
      name: "Wing",
      notes: "",
      retired: false,
    })
    await api.client.flights.update({
      flightId,
      takeoffName: "Site",
      landingName: "Field",
      notes: "",
      equipmentIds: [item.equipment.id],
    })
    expect((await api.client.flights.get({ flightId })).equipment).toHaveLength(
      1
    )
    await api.client.flights.equipment.update({
      equipmentId: item.equipment.id,
      kind: "wing",
      name: "Wing 2",
      notes: "",
      retired: true,
    })
    expect((await api.client.flights.equipment.list()).equipment[0]!.name).toBe(
      "Wing 2"
    )
    await api.client.flights.equipment.delete({
      equipmentId: item.equipment.id,
    })
    await api.client.flights.delete({ flightId })
    expect(await code(api.client.flights.get({ flightId }))).toBe("NOT_FOUND")
  })

  test("serves the same actions at their public HTTP routes", async () => {
    api.signIn(["flights"])
    const imported = await api.request(
      "/api/v1/flights/imports",
      jsonRequest("POST", { filename: "flight.gpx", text: fixture })
    )
    expect(imported.status).toBe(200)
    const { flightId } = (await imported.json()) as { flightId: string }

    const list = await api.request(
      `/api/v1/flights?input=${encodeURIComponent(JSON.stringify({ year: 1950 }))}`
    )
    expect(await list.json()).toEqual({ flights: [] })
    const detail = (await (
      await api.request(`/api/v1/flights/${flightId}`)
    ).json()) as {
      files: { id: string }[]
    }
    const download = (await (
      await api.request(`/api/v1/flights/files/${detail.files[0]!.id}`)
    ).json()) as { contentBase64: string }
    expect(Base64.decodeString(download.contentBase64)).toEqual(
      expect.objectContaining({ success: fixture })
    )

    const update = {
      takeoffName: "Site",
      landingName: "Field",
      notes: "",
      equipmentIds: [],
    }
    expect(
      await (
        await api.request(
          `/api/v1/flights/${flightId}`,
          jsonRequest("PUT", update)
        )
      ).json()
    ).toEqual({ id: flightId })
    const conflicting = await api.request(
      `/api/v1/flights/${flightId}`,
      jsonRequest("PUT", { ...update, flightId: "other" })
    )
    expect(conflicting.status).toBe(400)
    expect((await api.request(`/api/v1/flights?input=nope`)).status).toBe(400)
    expect((await api.request(`/api/v1/flights/stats`)).status).toBe(200)
    const unknown = await api.request("/api/v1/flights/nope/nope")
    expect(unknown.status).toBe(404)
    expect(
      (await api.request(`/api/v1/flights/${flightId}`, jsonRequest("DELETE")))
        .status
    ).toBe(200)
    const gone = await api.request(`/api/v1/flights/${flightId}`)
    expect(await gone.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Flight not found" },
    })
  })

  test("caps bodies at 6 MB and file content at 5 MB on every transport", async () => {
    api.signIn(["flights"])
    const declared = await api.request(
      "/api/rpc/flights/import",
      jsonRequest("POST", {}, { Origin: origin, "Content-Length": "6000001" })
    )
    expect(declared.status).toBe(413)
    const streamed = await api.request("/api/v1/flights/imports", {
      ...jsonRequest("POST"),
      body: " ".repeat(6_000_001),
    })
    expect(streamed.status).toBe(413)
    expect(
      await code(
        api.client.flights.import({
          filename: "a.gpx",
          text: " ".repeat(6_000_001),
        })
      )
    ).toBe("PAYLOAD_TOO_LARGE")

    const tooLarge = { filename: "a.gpx", text: "é".repeat(2_500_001) }
    expect(await code(api.client.flights.import(tooLarge))).toBe(
      "PAYLOAD_TOO_LARGE"
    )
    const viaHttp = await api.request(
      "/api/v1/flights/imports",
      jsonRequest("POST", tooLarge)
    )
    expect(await viaHttp.json()).toEqual({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "File content exceeds 5 MB",
      },
    })
  })

  test("maps validation and action failures to codes", async () => {
    api.signIn(["flights"])
    expect(
      await code(
        api.client.flights.equipment.create({
          kind: "spaceship",
          name: "x",
          notes: "",
          retired: false,
        } as never)
      )
    ).toBe("BAD_REQUEST")
    const invalidYear = await api.request(
      `/api/v1/flights?input=${encodeURIComponent('{"year":1800}')}`
    )
    expect(invalidYear.status).toBe(400)
    expect(
      await code(
        api.client.flights.import({ filename: "x.gpx", text: "not a track" })
      )
    ).toBe("BAD_REQUEST")
    expect(
      await code(
        api.client.flights.equipment.delete({ equipmentId: "missing" })
      )
    ).toBe("NOT_FOUND")
    const error = await api.client.flights
      .get({ flightId: "missing" })
      .catch((cause: unknown) => cause)
    expect(error).toMatchObject({
      code: "NOT_FOUND",
      message: "Flight not found",
    })
  })
})

describe("manifest and registry", () => {
  test("lists the caller's actions with schemas, routes and file fields", async () => {
    api.signIn(["flights"])
    const { actions } = (await (await api.request("/api/v1")).json()) as {
      actions: {
        name: string
        http: unknown
        file?: unknown
        inputSchema: { type: string }
      }[]
    }
    expect(actions.map((action) => action.name)).toEqual(
      actionRegistry.actions
        .filter((entry) => entry.spec.app === "flights")
        .map((entry) => entry.name)
    )
    expect(
      actions.find((action) => action.name === "flights.import")
    ).toMatchObject({
      http: { method: "POST", path: "/flights/imports" },
      file: {
        contentField: "text",
        filenameField: "filename",
        maxBytes: 5_000_000,
      },
      inputSchema: { type: "object" },
    })
  })

  test("serves a newly declared action on every transport without routing code", async () => {
    const echo = actionsFor("flights")({
      description: "Echoes a word.",
      effect: "write",
      http: { method: "POST", path: "/flights/echo/:word" },
      input: Schema.Struct({ word: Schema.String, times: Schema.Number }),
      output: Schema.Struct({ echoed: Schema.String, by: Schema.String }),
    })
    const tree = { ...catalog, flights: { ...catalog.flights, echo } }
    const extended = makeHarness({
      registry: createRegistry(tree, {
        ...handlers,
        flights: {
          ...handlers.flights,
          echo: bind(echo, Layer.empty, (input, caller) =>
            Effect.succeed({
              echoed: input.word.repeat(input.times),
              by: caller.userId,
            })
          ),
        },
      }),
    })
    extended.signIn(["flights"])

    const { actions } = (await (await extended.request("/api/v1")).json()) as {
      actions: { name: string; description: string }[]
    }
    expect(actions).toContainEqual(
      expect.objectContaining({
        name: "flights.echo",
        description: "Echoes a word.",
      })
    )
    const viaHttp = await extended.request(
      "/api/v1/flights/echo/ha",
      jsonRequest("POST", { times: 2 })
    )
    expect(await viaHttp.json()).toEqual({ echoed: "haha", by: "owner" })
    const viaRpc = await extended.request(
      "/api/rpc/flights/echo",
      jsonRequest("POST", { json: { word: "ho", times: 3 } })
    )
    expect(await viaRpc.json()).toEqual({
      json: { echoed: "hohoho", by: "owner" },
    })
    const invalid = await extended.request(
      "/api/v1/flights/echo/ha",
      jsonRequest("POST", { times: "2" })
    )
    expect(invalid.status).toBe(400)
    extended.close()
  })

  test("passes paths it does not own to the TanStack handler", async () => {
    api.signIn(["flights"])
    for (const path of [
      "/api/auth/get-session",
      "/api/music/spotify/connect",
      "/api/invitations/accept",
      "/api/rpc/flights/nope",
    ]) {
      api.fallback.mockClear()
      const response = await api.request(path)
      expect([path, response.status]).toEqual([path, 218])
      expect(api.fallback).toHaveBeenCalledTimes(1)
    }
  })
})
