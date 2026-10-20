import { afterEach, describe, expect, it, vi } from "vitest"
import type { Map as FlightMap } from "maplibre-gl"
import type { FlightDetail } from "@/features/flights/api"
import { projectTrack } from "./layout"
import { renderShareImage } from "./render"

vi.mock("maplibre-gl", () => ({
  LngLatBounds: class {
    extend() {
      return this
    }
  },
}))

afterEach(() => vi.unstubAllGlobals())

function context() {
  return {
    arc: vi.fn<CanvasRenderingContext2D["arc"]>(),
    beginPath: vi.fn<CanvasRenderingContext2D["beginPath"]>(),
    fill: vi.fn<CanvasRenderingContext2D["fill"]>(),
    stroke: vi.fn<CanvasRenderingContext2D["stroke"]>(),
    drawImage: vi.fn<CanvasRenderingContext2D["drawImage"]>(),
    getImageData: vi.fn<CanvasRenderingContext2D["getImageData"]>(),
    fillRect: vi.fn<CanvasRenderingContext2D["fillRect"]>(),
    moveTo: vi.fn<CanvasRenderingContext2D["moveTo"]>(),
    lineTo: vi.fn<CanvasRenderingContext2D["lineTo"]>(),
    fillText: vi.fn<CanvasRenderingContext2D["fillText"]>(),
    measureText: () => ({ width: 100 }),
    createLinearGradient: () => ({ addColorStop: vi.fn<() => void>() }),
  }
}

function setup() {
  const contexts: ReturnType<typeof context>[] = []
  vi.stubGlobal("document", {
    fonts: { ready: Promise.resolve() },
    createElement: () => {
      const ctx = context()
      contexts.push(ctx)
      return {
        getContext: () => ctx,
        toBlob: (done: (blob: Blob) => void) => done(new Blob(["image"])),
      }
    },
  })
  const detail = {
    flight: {
      title: "Saved flight title",
      takeoffAt: 0,
      durationS: 60,
      distanceM: 1000,
      maxAltM: null,
      maxSpeedMps: 10,
      elevationGainM: null,
    },
    equipment: [],
    files: [],
    points: [
      [0, 45, 6, null, null],
      [1000, 46, 7, null, null],
      [2000, 47, 8, null, null],
      [3000, 48, 9, null, null],
    ],
    analysis: {
      takeoffIndex: 1,
      landingIndex: 2,
      takeoffAt: 1000,
      profile: [],
    },
  } as unknown as FlightDetail
  let done: () => void
  const container = {
    getAttribute: () => null,
    querySelector: () => null,
    style: { cssText: "" },
    removeAttribute: vi.fn<(name: string) => void>(),
  }
  const map = {
    getContainer: () => container,
    getCenter: vi.fn<() => void>(),
    getZoom: vi.fn<() => void>(),
    getBearing: vi.fn<() => void>(),
    getPitch: vi.fn<() => void>(),
    getPadding: vi.fn<() => void>(),
    resize: vi.fn<() => void>(),
    fitBounds: vi.fn<() => void>(),
    jumpTo: vi.fn<() => void>(),
    getCanvas: vi.fn<() => void>(),
    off: vi.fn<() => void>(),
    once: (event: string, callback: () => void) => {
      if (event === "idle") done = callback
    },
    triggerRepaint: () => done(),
    project: ([x, y]: [number, number]) => ({ x: x * 10, y: y * 10 }),
  }
  return { detail, contexts, map: map as unknown as FlightMap, container }
}

describe("share image flight markers", () => {
  it("composites backend takeoff and landing indices on a captured map", async () => {
    const { detail, map, contexts, container } = setup()
    expect((await renderShareImage(detail, map)).fallback).toBe(false)
    expect(contexts[1]!.arc.mock.calls.map((call) => call.slice(0, 2))).toEqual(
      [
        [70, 460],
        [80, 470],
      ]
    )
    expect(container.removeAttribute).toHaveBeenCalledWith("style")
    expect(map.jumpTo).toHaveBeenCalledOnce()
  })

  it.each([false, true])(
    "uses backend indices in the fallback projection, failed capture %s",
    async (failedCapture) => {
      const { detail, map, contexts } = setup()
      if (failedCapture)
        vi.mocked(map.fitBounds).mockImplementation(() => {
          throw new Error("offline")
        })
      expect(
        (await renderShareImage(detail, failedCapture ? map : null)).fallback
      ).toBe(true)
      const projected = projectTrack(detail.points, 1080, 800, 120)
      expect(
        contexts[0]!.arc.mock.calls.map((call) => call.slice(0, 2))
      ).toEqual([projected[1], projected[2]].map((p) => [p!.x, p!.y]))
    }
  )

  it("keeps both fallback markers on a single recorded point", async () => {
    const { detail, contexts } = setup()
    await renderShareImage(
      { ...detail, points: detail.points.slice(0, 1), analysis: null },
      null
    )
    expect(contexts[0]!.arc.mock.calls.map((call) => call.slice(0, 2))).toEqual(
      [
        [540, 400],
        [540, 400],
      ]
    )
  })

  it("renders a flight without a track or markers", async () => {
    const { detail, contexts } = setup()
    expect(
      (await renderShareImage({ ...detail, points: [], analysis: null }, null))
        .fallback
    ).toBe(true)
    expect(contexts[0]!.arc).not.toHaveBeenCalled()
  })
})
