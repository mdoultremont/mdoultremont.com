import { Effect } from "effect"

const inputBrand = Symbol("verified CC0 classifier input")
// Keep the request payload separate from the caller-visible value. Mutation or copied brands cannot add fields.
const verifiedInputs = new WeakMap<
  object,
  Pick<Cc0ClassifierInput, "recording" | "acoustic">
>()
const moodFields = new Set(["happy", "party", "relaxed", "sad"])
const genreFields = new Set([
  "genre_dortmund",
  "genre_electronic",
  "genre_rosamerica",
  "genre_tzanetakis",
])

export class ClassifierInputError extends Error {
  readonly _tag = "ClassifierInputError"
}

export class ClassifierProviderError extends Error {
  readonly _tag = "ClassifierProviderError"
}

export interface MusicBrainzCoreRecording {
  readonly source: "musicbrainz-core-cc0"
  readonly id: string
  readonly title: string
  readonly artistCredit: string
  readonly durationMs: number | null
}

export interface AcousticBrainzRecording {
  readonly source: "acousticbrainz-cc0"
  readonly recordingId: string
  readonly bpm: number | null
  readonly danceability: number | null
  readonly mood: Readonly<Record<string, number>>
  readonly genre: Readonly<Record<string, number>>
}

export interface Cc0ClassifierInput {
  readonly [inputBrand]: true
  readonly recording: {
    readonly title: string
    readonly artistCredit: string
    readonly durationMs: number | null
  }
  readonly acoustic: {
    readonly bpm: number | null
    readonly danceability: number | null
    readonly mood: Readonly<Record<string, number>>
    readonly genre: Readonly<Record<string, number>>
  }
}

export interface ClassificationDestination {
  readonly id: string
  readonly description: string
}

export interface ClassificationDecision {
  readonly destinationId: string
  readonly yesProbability: number
}

export function buildCc0Input(
  recording: MusicBrainzCoreRecording,
  acoustic: AcousticBrainzRecording
): Cc0ClassifierInput {
  if (
    recording.source !== "musicbrainz-core-cc0" ||
    acoustic.source !== "acousticbrainz-cc0" ||
    !isUuid(recording.id) ||
    recording.id !== acoustic.recordingId ||
    !recording.title ||
    !recording.artistCredit ||
    !validOptionalNumber(recording.durationMs) ||
    !validOptionalNumber(acoustic.bpm) ||
    !validOptionalNumber(acoustic.danceability) ||
    !validProbabilityMap(acoustic.mood) ||
    !validProbabilityMap(acoustic.genre)
  )
    throw new ClassifierInputError(
      "Classifier input lacks verified CC0 recording provenance"
    )

  // Construct every field explicitly. Provider payloads and Spotify lookup fields never cross this boundary.
  const input: Cc0ClassifierInput = {
    [inputBrand]: true,
    recording: {
      title: recording.title,
      artistCredit: recording.artistCredit,
      durationMs: recording.durationMs,
    },
    acoustic: {
      bpm: acoustic.bpm,
      danceability: acoustic.danceability,
      mood: Object.fromEntries(
        Object.entries(acoustic.mood).filter(([key]) => moodFields.has(key))
      ),
      genre: Object.fromEntries(
        Object.entries(acoustic.genre).filter(([key]) =>
          genreFields.has(key.split(":")[0] ?? "")
        )
      ),
    },
  }
  const payload = {
    recording: Object.freeze({ ...input.recording }),
    acoustic: Object.freeze({
      ...input.acoustic,
      mood: Object.freeze({ ...input.acoustic.mood }),
      genre: Object.freeze({ ...input.acoustic.genre }),
    }),
  }
  verifiedInputs.set(input, payload)
  return input
}

export function isCc0ClassifierInput(
  value: unknown
): value is Cc0ClassifierInput {
  return (
    typeof value === "object" && value !== null && verifiedInputs.has(value)
  )
}

export async function fingerprintCc0Input(
  input: Cc0ClassifierInput
): Promise<string> {
  if (!isCc0ClassifierInput(input))
    throw new ClassifierInputError(
      "Classifier input was not built from verified CC0 data"
    )
  const encoded = new TextEncoder().encode(
    JSON.stringify(verifiedInputs.get(input))
  )
  const digest = await crypto.subtle.digest("SHA-256", encoded)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

export function classifyWithJev(options: {
  readonly input: Cc0ClassifierInput
  readonly destinations: readonly ClassificationDestination[]
  readonly apiKey: string
  readonly model: string
  readonly fetcher?: typeof fetch
}): Effect.Effect<
  readonly ClassificationDecision[],
  ClassifierInputError | ClassifierProviderError
> {
  return Effect.tryPromise({
    try: async () => {
      if (!isCc0ClassifierInput(options.input))
        throw new ClassifierInputError(
          "Classifier input was not built from verified CC0 data"
        )
      if (!options.model || options.model.endsWith("-latest"))
        throw new ClassifierInputError(
          "An explicit evaluated Jev model version is required"
        )
      if (!options.apiKey)
        throw new ClassifierProviderError("Jev is not configured")
      if (options.destinations.length === 0) return []
      if (options.destinations.some((item) => !item.id || !item.description))
        throw new ClassifierInputError(
          "Destinations need an ID and description"
        )

      const questions = Object.fromEntries(
        options.destinations.map((item, index) => [
          `destination_${index}`,
          {
            type: "noul",
            instructions: `Does this recording belong in a playlist described as: ${item.description}?`,
          },
        ])
      )
      const response = await (options.fetcher ?? fetch)(
        "https://api.typesafe.ai/v1/systemone",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: options.model,
            state: verifiedInputs.get(options.input),
            questions,
          }),
        }
      )
      if (!response.ok)
        throw new ClassifierProviderError(`Jev returned ${response.status}`)
      const payload: unknown = await response.json()
      if (!isRecord(payload) || !isRecord(payload.answers))
        throw new ClassifierProviderError("Jev returned an invalid response")
      const answers = payload.answers
      return options.destinations.map((item, index) => {
        const answer = answers[`destination_${index}`]
        if (
          !isRecord(answer) ||
          answer.type !== "noul" ||
          !validProbability(answer.noul)
        )
          throw new ClassifierProviderError(
            "Jev returned an invalid yes probability"
          )
        return { destinationId: item.id, yesProbability: answer.noul }
      })
    },
    catch: (cause) =>
      cause instanceof ClassifierInputError ||
      cause instanceof ClassifierProviderError
        ? cause
        : new ClassifierProviderError("Jev could not classify the recording", {
            cause,
          }),
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isUuid(value: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(
    value
  )
}

function validOptionalNumber(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0)
  )
}

function validProbability(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  )
}

function validProbabilityMap(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every(validProbability)
}
