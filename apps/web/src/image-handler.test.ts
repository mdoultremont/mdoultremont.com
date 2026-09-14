import { describe, expect, test, vi } from "vitest"
import type { ImageBindings } from "./image-handler"
import { handleImageRequest } from "./image-handler"

const metadata = {
  "/media/profile/source.png": {
    width: 100,
    height: 80,
    version: "version-1",
  },
}

const sourceBytes = new Uint8Array([137, 80, 78, 71])

function makeEnv(output: ImageBindings["IMAGES"]["input"]): ImageBindings {
  return {
    ASSETS: {
      fetch: vi.fn<() => Promise<Response>>(
        async () =>
          new Response(sourceBytes, {
            headers: { "Content-Type": "image/png" },
          })
      ),
    },
    IMAGES: { input: output },
  }
}

describe("image endpoint", () => {
  test("validates the source, version, and finite widths", async () => {
    const input = vi.fn<ImageBindings["IMAGES"]["input"]>()
    const env = makeEnv(input)
    const base = "http://localhost/images/media/profile/source.png"

    expect(
      (
        await handleImageRequest(
          new Request(`${base}?width=51&v=version-1`),
          env,
          metadata
        )
      )?.status
    ).toBe(404)
    expect(
      (
        await handleImageRequest(
          new Request(`${base}?width=50&v=wrong`),
          env,
          metadata
        )
      )?.status
    ).toBe(404)
    expect(input).not.toHaveBeenCalled()
  })

  test("returns a short-lived original when transformation fails", async () => {
    const env = makeEnv(() => {
      throw new Error("unsupported input")
    })
    const response = await handleImageRequest(
      new Request(
        "http://localhost/images/media/profile/source.png?width=100&v=version-1"
      ),
      env,
      metadata
    )

    expect(response?.status).toBe(200)
    expect(response?.headers.get("content-type")).toBe("image/png")
    expect(response?.headers.get("cache-control")).toBe("no-store")
    expect(new Uint8Array(await response!.arrayBuffer())).toEqual(sourceBytes)
  })
})
