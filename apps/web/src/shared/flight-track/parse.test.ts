import { describe, expect, it } from "vitest"
import flightGpx from "./fixtures/flight.gpx?raw"
import segmentsGpx from "./fixtures/two-segments.gpx?raw"
import missingTimesGpx from "./fixtures/missing-times.gpx?raw"
import oldIgc from "./fixtures/old-date.igc?raw"
import midnightIgc from "./fixtures/new-date-midnight.igc?raw"
import {
  bRecord,
  flightPoints,
  gpxFor,
  START_MS,
} from "./fixtures/synthetic.ts"
import { parseGpx } from "./parse-gpx.ts"
import { parseIgc } from "./parse-igc.ts"
import { parseTrackFile } from "./parse.ts"
import { TrackParseError } from "./types.ts"

describe("GPX parsing", () => {
  it("reads realistic coordinates, elevations, UTC timestamps, and metadata", () => {
    const track = parseGpx(flightGpx)
    expect(track.points).toHaveLength(101)
    expect(track.points[0]).toEqual([START_MS, 46, 6, 1000, null])
    expect(track.points.at(-1)?.[0]).toBe(START_MS + 100_000)
    expect(track.points.at(-1)?.[3]).toBe(1030)
    expect(track.startedAt.toISOString()).toBe("2026-06-12T10:00:00.000Z")
    expect(track.source).toBe("gpx")
    expect(track.sourceDetail).toBe("Synthetic logger")
    expect(track.name).toBe("Evening thermal")
  })
  it("concatenates segments and multiple tracks in document order before sorting", () => {
    expect(parseGpx(segmentsGpx).points).toEqual(parseGpx(flightGpx).points)
    const text =
      '<gpx><trk><trkseg><trkpt lat="1" lon="2"><time>2026-01-01T00:00:02Z</time></trkpt></trkseg></trk><trk><trkseg><trkpt lat="3" lon="4"><time>2026-01-01T00:00:01Z</time></trkpt></trkseg></trk></gpx>'
    expect(parseGpx(text).points.map((p) => p[1])).toEqual([3, 1])
  })
  it("supports prefixes, singleton nodes, GPX 1.0 names, and missing elevation", () => {
    const track = parseGpx(
      '<g:gpx xmlns:g="urn:gpx" version="1.0"><g:name>Route</g:name><g:rte><g:rtept lat="-46" lon="-6"><g:time>2026-06-12T12:00:00+02:00</g:time></g:rtept></g:rte></g:gpx>'
    )
    expect(track.points).toEqual([[START_MS, -46, -6, null, null]])
    expect(track.name).toBe("Route")
  })
  it("sorts timestamps and drops duplicate timestamps stably", () => {
    const points = flightPoints().slice(0, 3)
    expect(
      parseGpx(gpxFor([points[2]!, points[0]!, points[1]!, points[1]!])).points
    ).toEqual(points)
  })
  it("prefers track fixes over route fixes", () => {
    const text = gpxFor(flightPoints().slice(0, 2)).replace(
      "</gpx>",
      '<rte><rtept lat="90" lon="0"/></rte></gpx>'
    )
    expect(parseGpx(text).points).toHaveLength(2)
  })
  it("reports missing timestamps clearly", () => {
    expect(() => parseGpx(missingTimesGpx)).toThrow(
      /missing its time.*timestamps/
    )
  })
  it.each(["<gpx>", "<not-gpx/>", "<gpx/>"])(
    "rejects malformed or empty input: %s",
    (text) => {
      expect(() => parseGpx(text)).toThrow(TrackParseError)
    }
  )
  it.each(["91", "NaN", ""])("rejects invalid latitude %s", (latitude) => {
    expect(() =>
      parseGpx(flightGpx.replace(/lat="[^"]+"/, `lat="${latitude}"`))
    ).toThrow(/latitude/)
  })
  it("rejects invalid time, unzoned time, longitude, and elevation", () => {
    const text = gpxFor(flightPoints().slice(0, 2))
    expect(() =>
      parseGpx(text.replace("2026-06-12T10:00:00.000Z", "invalid"))
    ).toThrow(/timestamp/)
    expect(() =>
      parseGpx(text.replace("2026-06-12T10:00:00.000Z", "2026-06-12T10:00:00"))
    ).toThrow(/timezone/)
    expect(() => parseGpx(text.replace('lon="6"', 'lon="181"'))).toThrow(
      /longitude/
    )
    expect(() =>
      parseGpx(text.replace("<ele>1000</ele>", "<ele>invalid</ele>"))
    ).toThrow(/elevation/)
  })
})

describe("IGC parsing", () => {
  it("reads old-style date and fixed-width positions and altitude headers", () => {
    const track = parseIgc(oldIgc)
    expect(track.points).toHaveLength(4)
    expect(track.points[0]).toEqual([START_MS, 46, 6, 1020, 1000])
    expect(track.points.at(-1)?.[0]).toBe(START_MS + 15_000)
    expect(track.source).toBe("igc")
    expect(track.sourceDetail).toContain("Test wing")
    expect(track.sourceDetail).toContain("Test logger")
    expect(track.sourceDetail).toContain("Test pilot")
  })
  it("reads new-style date with UTC midnight rollover", () => {
    const track = parseIgc(midnightIgc)
    expect(track.startedAt.toISOString()).toBe("2026-06-12T23:59:50.000Z")
    expect(new Date(track.points.at(-1)![0]).toISOString()).toBe(
      "2026-06-13T00:00:05.000Z"
    )
    expect(track.points[2]![0] - track.points[1]![0]).toBe(5000)
  })
  it("skips invalid fixes, handles missing GNSS and signed altitude, and drops duplicates", () => {
    const track = parseIgc(
      [
        "HFDTE120626",
        bRecord("100000", "V"),
        bRecord("100001", "A", "-0010", "00000"),
        bRecord("100001"),
        bRecord("100002"),
      ].join("\n")
    )
    expect(track.points).toHaveLength(2)
    expect(track.points[0]?.slice(3)).toEqual([0, -10])
  })
  it("treats GNSS zero as missing only when all valid GNSS altitudes are zero", () => {
    const track = parseIgc(
      `HFDTE120626\n${bRecord("100000", "A", "01000", "00000")}\n${bRecord("100001", "A", "01000", "00000")}\n${bRecord("100002", "V")}`
    )
    expect(track.points.map((p) => p[3])).toEqual([null, null])
  })
  it("reads southern and western hemispheres, minutes, and record extensions", () => {
    const record = "B1000004530000S00715000WA010000102012345"
    expect(parseIgc(`HFDTE120626\n${record}`).points[0]?.slice(1, 3)).toEqual([
      -45.5, -7.25,
    ])
  })
  it("sorts out-of-order fixes without treating a small reversal as midnight", () => {
    expect(
      parseIgc(
        `HFDTE120626\n${bRecord("100002")}\n${bRecord("100001")}`
      ).points.map((p) => p[0])
    ).toEqual([START_MS + 1000, START_MS + 2000])
  })
  it.each([
    "",
    "HFDTE310226",
    `HFDTE120626\n${bRecord("250000")}`,
    "HFDTE120626\nBbad",
    `HFDTE120626\n${bRecord("100000").replace("4600000N", "4660000N")}`,
  ])("rejects invalid input %s", (text) => {
    expect(() => parseIgc(text)).toThrow(TrackParseError)
  })
})

it("detects format by case-insensitive extension or content and rejects other files", () => {
  expect(parseTrackFile("FLIGHT.GPX", flightGpx).source).toBe("gpx")
  expect(parseTrackFile("flight.IGC", oldIgc).source).toBe("igc")
  expect(parseTrackFile("upload", flightGpx).source).toBe("gpx")
  expect(parseTrackFile("upload.txt", midnightIgc).source).toBe("igc")
  expect(() => parseTrackFile("file.txt", "hello")).toThrow(/GPX or IGC/)
})

it.each(["flight.gpx", "flight.igc"])(
  "rejects NUL bytes before parsing %s",
  (filename) => {
    expect(() =>
      parseTrackFile(
        filename,
        (filename.endsWith("gpx") ? flightGpx : oldIgc) + "\0"
      )
    ).toThrow(/NUL/)
  }
)
