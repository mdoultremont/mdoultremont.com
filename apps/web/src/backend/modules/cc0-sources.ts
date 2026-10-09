import type {
  AcousticBrainzRecording,
  MusicBrainzCoreRecording,
} from "./cc0-classifier"

export class Cc0SourceError extends Error {
  readonly _tag = "Cc0SourceError"
  constructor(
    message: string,
    readonly retryable = false,
    readonly retryAfterSeconds?: number
  ) {
    super(message)
  }
}

export function createCc0Sources(options: {
  readonly fetcher?: typeof fetch
  readonly wait?: (milliseconds: number) => Promise<void>
  readonly now?: () => number
}) {
  const fetcher = options.fetcher ?? fetch
  const wait =
    options.wait ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  const now = options.now ?? Date.now
  let nextMusicBrainzRequestAt = 0

  async function resolveByIsrc(
    isrc: string
  ): Promise<MusicBrainzCoreRecording | null> {
    if (!/^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/u.test(isrc)) return null
    const delay = nextMusicBrainzRequestAt - now()
    if (delay > 0) await wait(delay)
    nextMusicBrainzRequestAt = now() + 1100
    const response = await fetcher(
      `https://musicbrainz.org/ws/2/isrc/${isrc}?fmt=json&inc=artist-credits`,
      {
        headers: {
          "User-Agent": "mdoultremont-music/0.1 (https://mdoultremont.com)",
        },
      }
    )
    if (response.status === 404) return null
    if (!response.ok)
      throw new Cc0SourceError(
        `MusicBrainz returned ${response.status}`,
        response.status === 429 || response.status >= 500,
        retryAfter(response)
      )
    const payload: unknown = await response.json()
    if (!isRecord(payload) || !Array.isArray(payload.recordings))
      throw new Cc0SourceError("MusicBrainz returned invalid recording data")
    // Multiple recordings for the same ISRC cannot be mapped to one exact Spotify recording safely.
    if (payload.recordings.length !== 1) return null
    const recording = payload.recordings[0]
    if (
      !isRecord(recording) ||
      !isUuid(recording.id) ||
      typeof recording.title !== "string"
    )
      throw new Cc0SourceError("MusicBrainz returned an invalid recording")
    const credit = Array.isArray(recording["artist-credit"])
      ? recording["artist-credit"]
          .flatMap((part: unknown) =>
            isRecord(part) && typeof part.name === "string" ? [part.name] : []
          )
          .join("")
      : ""
    if (!credit) return null
    return {
      source: "musicbrainz-core-cc0",
      id: recording.id,
      title: recording.title,
      artistCredit: credit,
      durationMs:
        typeof recording.length === "number" &&
        Number.isFinite(recording.length)
          ? recording.length
          : null,
    }
  }

  async function acousticByRecordingId(
    recordingId: string
  ): Promise<AcousticBrainzRecording | null> {
    if (!isUuid(recordingId)) return null
    const base = `https://acousticbrainz.org/api/v1/${recordingId}`
    const [lowResponse, highResponse] = await Promise.all([
      fetcher(`${base}/low-level`),
      fetcher(`${base}/high-level`),
    ])
    if (lowResponse.status === 404 || highResponse.status === 404) return null
    if (!lowResponse.ok || !highResponse.ok)
      throw new Cc0SourceError(
        `AcousticBrainz returned ${lowResponse.status}/${highResponse.status}`,
        [lowResponse, highResponse].some(
          (response) => response.status === 429 || response.status >= 500
        ),
        Math.max(retryAfter(lowResponse) ?? 0, retryAfter(highResponse) ?? 0)
      )
    const low: unknown = await lowResponse.json()
    const high: unknown = await highResponse.json()
    if (!isRecord(low) || !isRecord(high))
      throw new Cc0SourceError("AcousticBrainz returned invalid data")
    const rhythm = child(low, "rhythm")
    const highlevel = child(high, "highlevel")
    if (!rhythm || !highlevel) return null
    const mood = Object.fromEntries(
      ["mood_happy", "mood_party", "mood_relaxed", "mood_sad"].flatMap(
        (key) => {
          const value = child(highlevel, key)?.all
          const label = key.slice(5)
          return isRecord(value) && validProbability(value[label])
            ? [[label, value[label]]]
            : []
        }
      )
    )
    const genre = Object.fromEntries(
      [
        "genre_dortmund",
        "genre_electronic",
        "genre_rosamerica",
        "genre_tzanetakis",
      ].flatMap((key) => {
        const item = child(highlevel, key)
        return item &&
          typeof item.value === "string" &&
          validProbability(item.probability)
          ? [[`${key}:${item.value}`, item.probability]]
          : []
      })
    )
    return {
      source: "acousticbrainz-cc0",
      recordingId,
      bpm: finiteNumber(rhythm.bpm),
      danceability: finiteNumber(rhythm.danceability),
      mood,
      genre,
    }
  }

  return { resolveByIsrc, acousticByRecordingId }
}

function child(
  value: Record<string, unknown>,
  key: string
): Record<string, unknown> | null {
  return isRecord(value[key]) ? value[key] : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(
      value
    )
  )
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null
}

function validProbability(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  )
}

function retryAfter(response: Response): number | undefined {
  const header = response.headers.get("Retry-After")
  if (header === null) return undefined
  const value = Number(header)
  return Number.isFinite(value) && value >= 0 ? value : undefined
}
