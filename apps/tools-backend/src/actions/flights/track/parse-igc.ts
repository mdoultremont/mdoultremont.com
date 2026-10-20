import { normalizePoints, validCoordinates } from "./normalize.ts"
import { TrackParseError, type ParsedTrack, type TrackPoint } from "./types.ts"

function parseDate(value: string): number {
  const day = Number(value.slice(0, 2))
  const month = Number(value.slice(2, 4))
  const shortYear = Number(value.slice(4, 6))
  const year = shortYear >= 80 ? 1900 + shortYear : 2000 + shortYear
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new TrackParseError("The IGC flight date is invalid.")
  }
  return date.getTime()
}

export function parseIgc(text: string): ParsedTrack {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
  const dateLine = lines.find((line) => /^H[FP]DTE(?:DATE:)?\d{6}/.test(line))
  const dateText = dateLine?.match(/^H[FP]DTE(?:DATE:)?(\d{6})/)?.[1]
  if (!dateText)
    throw new TrackParseError(
      "This IGC file is missing its flight date (HFDTE header)."
    )
  let dayMs = parseDate(dateText)
  let previousSeconds: number | undefined
  const points: TrackPoint[] = []
  const details: string[] = []
  for (const line of lines) {
    if (/^H[FOP](?:GTY|PLT|FTY|RFW|RHW)/.test(line) || /^A\w/.test(line)) {
      const detail = line.startsWith("A")
        ? line.slice(1)
        : line.slice(line.indexOf(":") + 1)
      if (detail && !details.includes(detail)) details.push(detail)
    }
    if (!line.startsWith("B")) continue
    const match =
      /^B\d{6}\d{7}[NS]\d{8}[EW][AV](?:\d{5}|-\d{4})(?:\d{5}|-\d{4})/.test(line)
    // Fixed widths avoid confusing signed altitudes or extension fields.
    if (
      !match ||
      line.length < 35 ||
      !/^[ -]?\d+$/.test(line.slice(25, 30)) ||
      !/^[ -]?\d+$/.test(line.slice(30, 35))
    ) {
      throw new TrackParseError("This IGC file contains a malformed B record.")
    }
    const hours = Number(line.slice(1, 3))
    const minutes = Number(line.slice(3, 5))
    const seconds = Number(line.slice(5, 7))
    if (hours > 23 || minutes > 59 || seconds > 59)
      throw new TrackParseError("An IGC point has an invalid time.")
    const secondsOfDay = hours * 3600 + minutes * 60 + seconds
    if (
      previousSeconds !== undefined &&
      previousSeconds - secondsOfDay > 43_200
    )
      dayMs += 86_400_000
    previousSeconds = secondsOfDay
    if (line[24] === "V") continue
    const latMinutes = Number(line.slice(9, 14)) / 1000
    const lonMinutes = Number(line.slice(18, 23)) / 1000
    const lat =
      (Number(line.slice(7, 9)) + latMinutes / 60) * (line[14] === "S" ? -1 : 1)
    const lon =
      (Number(line.slice(15, 18)) + lonMinutes / 60) *
      (line[23] === "W" ? -1 : 1)
    if (!validCoordinates(lat, lon) || latMinutes >= 60 || lonMinutes >= 60) {
      throw new TrackParseError(
        "An IGC point has invalid latitude or longitude."
      )
    }
    const pressureAlt = Number(line.slice(25, 30))
    const gpsAlt = Number(line.slice(30, 35))
    points.push([dayMs + secondsOfDay * 1000, lat, lon, gpsAlt, pressureAlt])
  }
  if (points.every((point) => point[3] === 0)) {
    for (const point of points) point[3] = null
  }
  const normalized = normalizePoints(points)
  return {
    points: normalized,
    startedAt: new Date(normalized[0]![0]),
    source: "igc",
    ...(details.length ? { sourceDetail: details.join(" · ") } : {}),
  }
}
