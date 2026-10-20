/** UTC epoch milliseconds, degrees, and metres above sea level. */
export type TrackPoint = [
  tMs: number,
  lat: number,
  lon: number,
  gpsAlt: number | null,
  baroAlt: number | null,
]

export interface ParsedTrack {
  points: TrackPoint[]
  startedAt: Date
  source: "gpx" | "igc"
  sourceDetail?: string
  name?: string
}

export interface FlightMetrics {
  takeoffIndex: number
  landingIndex: number
  takeoffAt: Date
  landingAt: Date
  durationS: number
  takeoff: { lat: number; lon: number }
  landing: { lat: number; lon: number }
  distanceM: number
  /** Null when no observations from the selected altitude source are available. */
  maxAltM: number | null
  avgAltM: number | null
  maxSpeedMps: number
  elevationGainM: number | null
  maxClimbMps: number | null
  /** Positive magnitude of the strongest descent. */
  maxSinkMps: number | null
}

export class TrackParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TrackParseError"
  }
}

export interface ProfilePoint {
  /** Index into the original track points. */
  i: number
  tS: number
  altM: number | null
  speedKmh: number
  varioMps: number
  distKm: number
}
