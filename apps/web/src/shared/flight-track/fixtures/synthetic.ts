import type { TrackPoint } from "../types.ts"

export const START_MS = Date.UTC(2026, 5, 12, 10)
/** 20 s walking, 60 s airborne at 10 m/s, 20 s stationary. */
export function flightPoints(stepS = 1): TrackPoint[] {
  const points: TrackPoint[] = []
  for (let t = 0; t <= 100; t += stepS) {
    const flownS = Math.max(0, Math.min(60, t - 20))
    const northM = Math.min(t, 20) + flownS * 10
    const alt = flownS <= 30 ? 1000 + flownS * 2 : 1060 - (flownS - 30)
    points.push([START_MS + t * 1000, 46 + northM / 111_195, 6, alt, null])
  }
  return points
}

export function gpxFor(points: readonly TrackPoint[]): string {
  return `<?xml version="1.0"?><gpx version="1.1" creator="Synthetic logger" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>Evening thermal</name></metadata><trk><trkseg>${points.map((point) => `<trkpt lat="${point[1]}" lon="${point[2]}">${point[3] === null ? "" : `<ele>${point[3]}</ele>`}<time>${new Date(point[0]).toISOString()}</time></trkpt>`).join("")}</trkseg></trk></gpx>`
}

export function bRecord(
  time: string,
  validity = "A",
  pressureAlt = "01000",
  gpsAlt = "01020"
): string {
  return `B${time}4600000N00600000E${validity}${pressureAlt}${gpsAlt}`
}
