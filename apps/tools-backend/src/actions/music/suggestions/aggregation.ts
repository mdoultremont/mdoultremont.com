import { sql, type SQL } from "drizzle-orm"
import { Array, Order } from "effect"
import { musicRecordings } from "#backend/modules/database"

interface RecordingGroup {
  readonly id: string
  readonly criteria: readonly string[]
  readonly matches: SQL
}

// These fixed JSON paths are SQL literals to keep combinations below D1's
// bound-parameter limit.
const genres: readonly RecordingGroup[] = [
  ["alternative", "alternative"],
  ["blues", "blues"],
  ["electronic", "electronic"],
  ["folkcountry", "folk and country"],
  ["funksoulrnb", "funk, soul and R&B"],
  ["jazz", "jazz"],
  ["pop", "pop"],
  ["raphiphop", "rap and hip-hop"],
  ["rock", "rock"],
].map(([genre, label]) => ({
  id: `genre:${genre}`,
  criteria: [`${label} genre probability >= 0.6`],
  matches: sql`json_extract(${musicRecordings.acoustic}, ${sql.raw(`'$.genre."genre_dortmund:${genre}"'`)}) >= 0.6`,
}))

const moods: readonly RecordingGroup[] = [
  "happy",
  "party",
  "relaxed",
  "sad",
].map((mood) => ({
  id: `mood:${mood}`,
  criteria: [`${mood} mood probability >= 0.6`],
  matches: sql`json_extract(${musicRecordings.acoustic}, ${sql.raw(`'$.mood.${mood}'`)}) >= 0.6`,
}))

const tempos: readonly RecordingGroup[] = [
  {
    id: "tempo:slow",
    criteria: ["tempo > 0 and < 90 BPM"],
    matches: sql`json_extract(${musicRecordings.acoustic}, '$.bpm') > 0 AND json_extract(${musicRecordings.acoustic}, '$.bpm') < 90`,
  },
  {
    id: "tempo:fast",
    criteria: ["tempo >= 130 BPM"],
    matches: sql`json_extract(${musicRecordings.acoustic}, '$.bpm') >= 130`,
  },
]

const combinations = (
  left: readonly RecordingGroup[],
  right: readonly RecordingGroup[]
): readonly RecordingGroup[] =>
  left.flatMap((a) =>
    right.map((b) => ({
      id: `${a.id}&${b.id}`,
      criteria: [...a.criteria, ...b.criteria],
      matches: sql`(${a.matches}) AND (${b.matches})`,
    }))
  )

export const recordingGroups: readonly RecordingGroup[] = [
  ...genres,
  ...moods,
  ...tempos,
  ...combinations(genres, moods),
  ...combinations(genres, tempos),
  ...combinations(moods, tempos),
]

export interface RecordingGroupCounts {
  readonly eligibleTracks: number
  readonly analyzedTracks: number
  readonly counts: readonly number[]
}

interface RecordingCandidate {
  readonly id: string
  readonly criteria: readonly string[]
  readonly estimatedTrackCount: number
}

export function summarizeRecordingGroups(summary: RecordingGroupCounts) {
  return {
    eligibleTracks: summary.eligibleTracks,
    analyzedTracks: summary.analyzedTracks,
    candidates: Array.sort(
      recordingGroups
        .map(({ id, criteria }, index) => ({
          id,
          criteria,
          estimatedTrackCount: summary.counts[index] ?? 0,
        }))
        .filter(
          (group) =>
            group.estimatedTrackCount >=
            Math.max(2, Math.ceil(summary.analyzedTracks * 0.03))
        ),
      (a: RecordingCandidate, b: RecordingCandidate) =>
        Order.Number(b.estimatedTrackCount, a.estimatedTrackCount) ||
        Order.String(a.id, b.id)
    ),
  }
}
