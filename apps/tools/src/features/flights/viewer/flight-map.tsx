import { memo, useEffect, useRef, useState } from "react"
import type { Map as MapLibreMap, Marker } from "maplibre-gl"
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"
// Required for MapLibre controls and marker positioning.
// oxlint-disable-next-line import/no-unassigned-import
import "maplibre-gl/dist/maplibre-gl.css"
import type { TrackPoint } from "@mdoultremont/flight-track"
import { nearestPointIndex } from "./logic"

export interface FlightMapProps {
  points: readonly TrackPoint[]
  activeIndex: number | null
  takeoffIndex: number
  landingIndex: number
  onActiveIndex: (index: number) => void
  /** Ready after the track layers load. Null on teardown. Canvas permits image export. */
  onMapReady?: (map: MapLibreMap | null) => void
}

export const FlightMap = memo(function FlightMap({
  points,
  activeIndex,
  takeoffIndex,
  landingIndex,
  onActiveIndex,
  onMapReady,
}: FlightMapProps) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const hoverRef = useRef<Marker | null>(null)
  const callbacks = useRef({ onActiveIndex, onMapReady })
  callbacks.current = { onActiveIndex, onMapReady }
  const selected = useRef(activeIndex)
  selected.current = activeIndex
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")

  useEffect(() => {
    if (typeof window === "undefined" || !container.current || !points.length)
      return
    let disposed = false
    let styleLoaded = false
    let map: MapLibreMap | undefined
    let frame = 0
    let resize: ResizeObserver | undefined
    setStatus("loading")
    void import("maplibre-gl")
      .then((maplibre) => {
        if (disposed || !container.current) return
        // MapLibre 6 ships its worker separately; let Vite resolve and bundle it.
        maplibre.setWorkerUrl(mapWorkerUrl)
        map = new maplibre.Map({
          container: container.current,
          style:
            import.meta.env.VITE_MAP_STYLE_URL ||
            "https://tiles.openfreemap.org/styles/liberty",
          center: [points[0]![2], points[0]![1]],
          zoom: 11,
          canvasContextAttributes: { preserveDrawingBuffer: true },
          attributionControl: { compact: true },
        })
        mapRef.current = map
        map.addControl(
          new maplibre.NavigationControl({ showCompass: false }),
          "top-right"
        )
        const bounds = new maplibre.LngLatBounds()
        for (const point of points) bounds.extend([point[2], point[1]])
        const fitTrack = () =>
          map?.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 0 })
        let fitted = false
        resize = new ResizeObserver(([entry]) => {
          map?.resize()
          if (
            !fitted &&
            entry &&
            entry.contentRect.width > 0 &&
            entry.contentRect.height > 0
          ) {
            fitTrack()
            fitted = true
          }
        })
        resize.observe(container.current)
        map.on("error", (event) => {
          console.warn("Flight map error", event.error)
          if (!disposed && !styleLoaded) setStatus("error")
        })
        map.once("style.load", () => {
          if (disposed || !map) return
          styleLoaded = true
          map.addSource("flight-track", {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates: points.map((p) => [p[2], p[1]]),
              },
            },
          })
          map.addLayer({
            id: "flight-casing",
            type: "line",
            source: "flight-track",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
              "line-color": "#ffffff",
              "line-width": 7,
              "line-opacity": 0.9,
            },
          })
          map.addLayer({
            id: "flight-line",
            type: "line",
            source: "flight-track",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": "#15805d", "line-width": 3 },
          })
          map.addLayer({
            id: "flight-hit",
            type: "line",
            source: "flight-track",
            paint: {
              "line-width": 28,
              "line-color": "#15805d",
              "line-opacity": 0,
            },
          })
          for (const [index, color, label] of [
            [takeoffIndex, "#15803d", "Takeoff"],
            [landingIndex, "#dc2626", "Landing"],
          ] as const) {
            const point = points[index]
            if (!point) continue
            const element = document.createElement("div")
            element.title = label
            element.setAttribute("aria-label", label)
            element.style.cssText = `width:18px;height:18px;border:3px solid white;border-radius:50%;background:${color};box-shadow:0 1px 5px #0006;`
            new maplibre.Marker({ element })
              .setLngLat([point[2], point[1]])
              .addTo(map)
          }
          const cursor = document.createElement("div")
          cursor.setAttribute("aria-label", "Selected track position")
          cursor.style.cssText =
            "width:16px;height:16px;border-radius:50%;background:#0c4a6e;border:3px solid white;box-shadow:0 0 0 2px #0c4a6e;pointer-events:none;"
          const initial = points[selected.current ?? takeoffIndex] ?? points[0]!
          hoverRef.current = new maplibre.Marker({ element: cursor })
            .setLngLat([initial[2], initial[1]])
            .addTo(map)
          cursor.style.visibility =
            selected.current === null ? "hidden" : "visible"
          map.on("mousemove", "flight-hit", (event) => {
            if (frame) cancelAnimationFrame(frame)
            frame = requestAnimationFrame(() => {
              frame = 0
              if (!map || disposed) return
              const index = nearestPointIndex(
                points,
                event.point,
                (coordinate) => map!.project(coordinate)
              )
              if (index !== null) callbacks.current.onActiveIndex(index)
            })
          })
          map.on("mouseenter", "flight-hit", () => {
            if (map) map.getCanvas().style.cursor = "crosshair"
          })
          map.on("mouseleave", "flight-hit", () => {
            if (map) map.getCanvas().style.cursor = ""
          })
          setStatus("ready")
          callbacks.current.onMapReady?.(map)
        })
      })
      .catch(() => {
        if (!disposed) setStatus("error")
      })
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      resize?.disconnect()
      callbacks.current.onMapReady?.(null)
      hoverRef.current = null
      mapRef.current = null
      map?.remove()
    }
  }, [points, takeoffIndex, landingIndex])

  useEffect(() => {
    const marker = hoverRef.current
    if (!marker) return
    const point = activeIndex === null ? undefined : points[activeIndex]
    marker.getElement().style.visibility = point ? "visible" : "hidden"
    if (point) marker.setLngLat([point[2], point[1]])
  }, [activeIndex, points])

  return (
    <div className="relative overflow-hidden rounded-2xl border bg-muted">
      <section
        ref={container}
        className="h-[360px] w-full sm:h-[460px]"
        aria-label="Flight track map"
      />
      {status !== "ready" && (
        <output className="absolute left-3 top-14 max-w-[75%] rounded-md border bg-background px-3 py-2 text-xs text-foreground">
          {status === "loading"
            ? "Loading flight map…"
            : "Map tiles unavailable. Flight profiles remain available below."}
        </output>
      )}
      <div className="absolute top-3 left-3 flex gap-4 rounded-md bg-background/95 px-3 py-2 text-xs text-foreground shadow-sm">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-green-700" />
          Takeoff
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-red-600" />
          Landing
        </span>
      </div>
    </div>
  )
})
