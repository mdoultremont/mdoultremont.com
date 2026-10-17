import { XMLParser, XMLValidator } from "fast-xml-parser"
import { normalizePoints, validCoordinates } from "./normalize.ts"
import { TrackParseError, type ParsedTrack, type TrackPoint } from "./types.ts"

type XmlNode = Record<string, unknown>
const node = (value: unknown): XmlNode =>
  typeof value === "object" && value !== null ? (value as XmlNode) : {}
const list = (value: unknown): unknown[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value]
const string = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined

export function parseGpx(text: string): ParsedTrack {
  if (XMLValidator.validate(text) !== true)
    throw new TrackParseError("This GPX file is not valid XML.")
  let root: XmlNode
  try {
    root = node(
      new XMLParser({
        ignoreAttributes: false,
        removeNSPrefix: true,
        parseTagValue: false,
        parseAttributeValue: false,
      }).parse(text)
    )
  } catch {
    throw new TrackParseError("This GPX file could not be read.")
  }
  if (!root.gpx)
    throw new TrackParseError("This file does not contain a GPX document.")
  const gpx = node(root.gpx)
  const tracks = list(gpx.trk)
  let fixes = tracks.flatMap((track) =>
    list(node(track).trkseg).flatMap((segment) => list(node(segment).trkpt))
  )
  if (fixes.length === 0)
    fixes = list(gpx.rte).flatMap((route) => list(node(route).rtept))
  const points: TrackPoint[] = fixes.map((fix) => {
    const point = node(fix)
    const latText = string(point["@_lat"])
    const lonText = string(point["@_lon"])
    const lat = latText === undefined ? NaN : Number(latText)
    const lon = lonText === undefined ? NaN : Number(lonText)
    if (!validCoordinates(lat, lon))
      throw new TrackParseError(
        "A GPX track point has invalid latitude or longitude."
      )
    const time = string(point.time)
    if (!time)
      throw new TrackParseError(
        "A GPX track point is missing its time. Flights need timestamps on every point."
      )
    // Require an explicit zone rather than interpreting local computer time.
    const tMs = /(?:Z|[+-]\d{2}:\d{2})$/i.test(time) ? Date.parse(time) : NaN
    if (!Number.isFinite(tMs))
      throw new TrackParseError(
        "A GPX track point has an invalid timestamp (include a timezone)."
      )
    const elevation = string(point.ele)
    const alt = elevation === undefined ? null : Number(elevation)
    if (alt !== null && !Number.isFinite(alt))
      throw new TrackParseError("A GPX track point has an invalid elevation.")
    return [tMs, lat, lon, alt, null]
  })
  const normalized = normalizePoints(points)
  const sourceDetail = string(gpx["@_creator"])
  const name =
    string(node(gpx.metadata).name) ??
    string(gpx.name) ??
    string(node(tracks[0]).name)
  return {
    points: normalized,
    startedAt: new Date(normalized[0]![0]),
    source: "gpx",
    ...(sourceDetail ? { sourceDetail } : {}),
    ...(name ? { name } : {}),
  }
}
