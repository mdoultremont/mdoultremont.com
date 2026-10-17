import { z } from "zod"
import { TrackParseError, type TrackPoint } from "./types.ts"

export function validCoordinates(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  )
}

const parsedPointsSchema = z.array(
  z.tuple([
    z.number().finite(),
    z.number().min(-90).max(90),
    z.number().min(-180).max(180),
    z.number().finite().nullable(),
    z.number().finite().nullable(),
  ])
)

export function normalizePoints(points: TrackPoint[]): TrackPoint[] {
  if (!parsedPointsSchema.safeParse(points).success) {
    throw new TrackParseError(
      "This file contains invalid track coordinates, timestamps, or altitudes."
    )
  }
  if (points.length === 0)
    throw new TrackParseError("This file contains no valid track points.")
  points.sort((a, b) => a[0] - b[0])
  return points.filter(
    (point, index) => index === 0 || point[0] !== points[index - 1]![0]
  )
}
