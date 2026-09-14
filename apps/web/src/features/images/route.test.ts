import { beforeEach, describe, expect, test, vi } from "vitest"
import { Route } from "../../routes/images.$"

const sourceBytes = new Uint8Array([137, 80, 78, 71])
const bindings = vi.hoisted(() => ({
  ASSETS: { fetch: vi.fn<() => Promise<Response>>() },
  IMAGES: { input: vi.fn<Env["IMAGES"]["input"]>() },
}))
vi.mock("cloudflare:workers", () => ({ env: bindings }))
vi.mock("virtual:portfolio-images", () => ({
  default: {
    "/media/profile/source.png": {
      width: 100,
      height: 80,
      version: "version-1",
    },
  },
}))

beforeEach(() => {
  vi.resetAllMocks()
  bindings.ASSETS.fetch.mockImplementation(
    async () =>
      new Response(sourceBytes, { headers: { "Content-Type": "image/png" } })
  )
})

async function getImage(query: string): Promise<Response> {
  const handlers = Route.options.server!.handlers
  if (typeof handlers !== "object" || typeof handlers.GET !== "function")
    throw new Error("Expected an image GET handler")
  const response = await handlers.GET({
    request: new Request(
      `http://localhost/images/media/profile/source.png?${query}`
    ),
    params: { _splat: "media/profile/source.png" },
    context: undefined,
    pathname: "/images/$",
    next: vi.fn<() => never>(),
  })
  if (!(response instanceof Response))
    throw new Error("Expected the image handler to return a Response")
  return response
}

describe("image server route", () => {
  test("rejects unknown versions and widths before accessing the bindings", async () => {
    expect((await getImage("width=51&v=version-1")).status).toBe(404)
    expect((await getImage("width=100&v=wrong")).status).toBe(404)
    expect(bindings.ASSETS.fetch).not.toHaveBeenCalled()
    expect(bindings.IMAGES.input).not.toHaveBeenCalled()
  })

  test("returns an uncached original when transformation fails", async () => {
    bindings.IMAGES.input.mockImplementation(() => {
      throw new Error("unsupported input")
    })
    const response = await getImage("width=100&v=version-1")
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("image/png")
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(sourceBytes)
  })
})
