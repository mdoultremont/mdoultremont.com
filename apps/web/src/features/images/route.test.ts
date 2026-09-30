import { beforeEach, describe, expect, test, vi } from "vitest"
import { Route } from "../../routes/images.$"

const bindings = vi.hoisted(() => ({
  fetch: vi.fn<() => Promise<Response>>(),
}))
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
  vi.stubGlobal("fetch", bindings.fetch)
  bindings.fetch.mockImplementation(
    async () =>
      new Response("transformed", { headers: { "Content-Type": "image/webp" } })
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
    expect(bindings.fetch).not.toHaveBeenCalled()
  })

  test("uses fetch-based image resizing and preserves the transformed stream", async () => {
    const response = await getImage("width=100&v=version-1")

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("image/webp")
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable"
    )
    expect(bindings.fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: "/media/profile/source.png",
        search: "?v=version-1",
      }),
      expect.objectContaining({
        cf: {
          image: {
            width: 100,
            fit: "scale-down",
            format: "webp",
            quality: 80,
          },
          cacheTtl: 31_536_000,
        },
      })
    )
  })

  test("returns a small uncached placeholder when transformation fails", async () => {
    bindings.fetch.mockResolvedValue(
      new Response("unsupported input", { status: 503 })
    )
    const response = await getImage("width=100&v=version-1")
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("image/svg+xml")
    expect(response.headers.get("cache-control")).toBe("no-store")
    const body = new TextDecoder().decode(await response.arrayBuffer())
    expect(body).toContain("#e8e6e0")
    expect(body).toContain('width="1" height="1"')
  })

  test("returns a placeholder when transformation throws", async () => {
    bindings.fetch.mockRejectedValue(new Error("resource limit"))
    const response = await getImage("width=100&v=version-1")
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("image/svg+xml")
    expect(response.headers.get("cache-control")).toBe("no-store")
  })
})
