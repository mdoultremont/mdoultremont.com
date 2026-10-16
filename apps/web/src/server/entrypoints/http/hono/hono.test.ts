import { readFileSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, vi } from "vitest"
import { it } from "@effect/vitest"
import { createORPCClient, isDefinedError, ORPCError } from "@orpc/client"
import { RPCLink } from "@orpc/client/fetch"
import type { ContractRouterClient } from "@orpc/contract"
import { Effect, Option } from "effect"
import { makeTestD1 } from "@/server/modules/database/testing"
import { makeFakeR2 } from "@/server/modules/object-storage/testing"
import type { flightsContract } from "@/shared/flights/contract"

const state = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  user: null as { id: string; apps: string[] } | null,
}))
vi.mock("cloudflare:workers", () => ({ env: state.env }))
vi.mock("../auth.server", () => ({
  userFromRequest: () => Effect.succeed(Option.fromNullishOr(state.user)),
}))
import { createApi } from "."

const origin = "https://portfolio.example"
const fallback = vi.fn<(request: Request) => Response>(
  () => new Response("tanstack", { status: 218 })
)
const app = createApi(fallback)
const client: ContractRouterClient<typeof flightsContract> = createORPCClient(
  new RPCLink({
    url: `${origin}/api/rpc/flights`,
    headers: { Origin: origin },
    fetch: async (request) => app.fetch(request),
  })
)
const post = (
  path: string,
  headers: Record<string, string> = {},
  body = "{}"
) =>
  app.fetch(
    new Request(`${origin}/api/rpc/flights/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body,
    })
  )
const fixture = readFileSync(
  new URL(
    "../../../../shared/flight-track/fixtures/flight.gpx",
    import.meta.url
  ),
  "utf8"
)
const code = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (error: unknown) => (error instanceof ORPCError ? error.code : "other")
  )

let d1: ReturnType<typeof makeTestD1>
beforeEach(() => {
  d1 = makeTestD1()
  d1.seedOwner()
  state.env.DB = d1.binding
  state.env.FILES = makeFakeR2()
  state.user = null
  fallback.mockClear()
})
afterEach(() => d1.close())

const procedures = [
  "list",
  "get",
  "update",
  "delete",
  "import",
  "stats/get",
  "equipment/list",
  "equipment/create",
  "equipment/update",
  "equipment/delete",
]

describe("API shell", () => {
  it.effect("requires sign-in and the flights app on every procedure", () =>
    Effect.promise(async () => {
      for (const path of procedures) {
        state.user = null
        expect((await post(path, { Origin: origin })).status).toBe(401)
        state.user = { id: "owner", apps: ["music"] }
        expect((await post(path, { Origin: origin })).status).toBe(403)
      }
      state.user = null
      expect(await code(client.stats.get())).toBe("UNAUTHORIZED")
      state.user = { id: "owner", apps: ["music"] }
      expect(await code(client.stats.get())).toBe("FORBIDDEN")
      const download = new Request(`${origin}/api/apps/flights/files/x`)
      expect((await app.fetch(download)).status).toBe(403)
      state.user = null
      expect((await app.fetch(download)).status).toBe(401)
    })
  )

  it.effect("rejects cross-origin and origin-less mutations", () =>
    Effect.promise(async () => {
      state.user = { id: "owner", apps: ["flights"] }
      for (const headers of [
        { Origin: "https://attacker.example" },
        {} as Record<string, string>,
      ]) {
        const response = await post("import", headers)
        expect(response.status).toBe(403)
      }
      expect(await post("stats/get", { Origin: origin })).toHaveProperty(
        "status",
        200
      )
    })
  )

  it.effect("passes unmatched /api paths to the TanStack handler", () =>
    Effect.promise(async () => {
      state.user = { id: "owner", apps: ["flights"] }
      for (const path of [
        "/api/auth/get-session",
        "/api/apps/music/ready",
        "/api/rpc/flights/nope",
        "/api/rpc/other/list",
      ]) {
        fallback.mockClear()
        const response = await app.fetch(new Request(`${origin}${path}`))
        expect(response.status).toBe(218)
        expect(fallback).toHaveBeenCalledTimes(1)
      }
    })
  )

  it.effect("caps request bodies at 6 MB", () =>
    Effect.promise(async () => {
      state.user = { id: "owner", apps: ["flights"] }
      const declared = await post(
        "import",
        { Origin: origin, "Content-Length": "6000001" },
        "{}"
      )
      expect(declared.status).toBe(413)
      const streamed = await post(
        "import",
        { Origin: origin },
        " ".repeat(6_000_001)
      )
      expect(streamed.status).toBe(413)
      expect(
        await code(
          client.import({
            filename: "a.gpx",
            text: " ".repeat(6_000_001),
          })
        )
      ).toBe("PAYLOAD_TOO_LARGE")
    })
  )

  it.effect("imports, lists, reads, downloads and deletes through oRPC", () =>
    Effect.promise(async () => {
      state.user = { id: "owner", apps: ["flights"] }
      const imported = await client.import({
        filename: "flight.gpx",
        text: fixture,
      })
      expect(imported.status).toBe("imported")
      const { flightId } = imported
      expect((await client.list({})).flights).toHaveLength(1)
      expect((await client.list({ year: 1950 })).flights).toHaveLength(0)
      const detail = await client.get({ flightId })
      expect(detail.points.length).toBeGreaterThan(2)
      expect((await client.stats.get()).totals.flights).toBe(1)
      expect(
        (await client.import({ filename: "flight.gpx", text: fixture })).status
      ).toBe("duplicate")

      const fileId = detail.files[0]!.id
      const file = await app.fetch(
        new Request(`${origin}/api/apps/flights/files/${fileId}`)
      )
      expect(file.status).toBe(200)
      expect(await file.text()).toBe(fixture)
      const missing = await app.fetch(
        new Request(`${origin}/api/apps/flights/files/missing`)
      )
      expect(missing.status).toBe(404)

      const item = await client.equipment.create({
        kind: "wing",
        name: "Wing",
        notes: "",
        retired: false,
      })
      await client.update({
        flightId,
        takeoffName: "Site",
        landingName: "Field",
        notes: "",
        equipmentIds: [item.equipment.id],
      })
      expect((await client.get({ flightId })).equipment).toHaveLength(1)
      await client.equipment.update({
        equipmentId: item.equipment.id,
        kind: "wing",
        name: "Wing 2",
        notes: "",
        retired: true,
      })
      expect((await client.equipment.list()).equipment[0]!.name).toBe("Wing 2")
      await client.equipment.delete({ equipmentId: item.equipment.id })
      await client.delete({ flightId })
      expect(await code(client.get({ flightId }))).toBe("NOT_FOUND")
    })
  )

  it.effect("maps validation and action failures to oRPC errors", () =>
    Effect.promise(async () => {
      state.user = { id: "owner", apps: ["flights"] }
      expect(
        await code(
          client.equipment.create({
            kind: "spaceship",
            name: "x",
            notes: "",
            retired: false,
          } as never)
        )
      ).toBe("BAD_REQUEST")
      expect(await code(client.list({ year: 1800 }))).toBe("BAD_REQUEST")
      expect(
        await code(client.import({ filename: "x.gpx", text: "not a track" }))
      ).toBe("BAD_REQUEST")
      expect(
        await code(client.equipment.delete({ equipmentId: "missing" }))
      ).toBe("NOT_FOUND")
      const error = await client
        .get({ flightId: "missing" })
        .catch((cause: unknown) => cause)
      expect(isDefinedError(error)).toBe(false)
      expect((error as ORPCError<string, unknown>).message).toBe(
        "Flight not found"
      )
    })
  )
})
