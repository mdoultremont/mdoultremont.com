import { sql, type SQL } from "drizzle-orm"
import { Array, Order } from "effect"
import { musicRecordings } from "#backend/modules/database"
import type { DestinationSuggestion } from "@mdoultremont/tools-contracts/music"

interface RecordingGroup {
  readonly name: string
  readonly description: string
  readonly matches: SQL
}

const genres = [
  ["alternative", "Alternative"],
  ["blues", "Blues"],
  ["electronic", "Electronic"],
  ["folkcountry", "Folk and country"],
  ["funksoulrnb", "Funk, soul and R&B"],
  ["jazz", "Jazz"],
  ["pop", "Pop"],
  ["raphiphop", "Rap and hip-hop"],
  ["rock", "Rock"],
] as const
const moods = [
  ["happy", "Happy listening", "Happy, cheerful tracks with a positive mood."],
  ["party", "Party", "Upbeat tracks with a party mood."],
  ["relaxed", "Relaxed listening", "Relaxed tracks with a calm mood."],
  ["sad", "Melancholy", "Sad, melancholy tracks."],
] as const

export const recordingGroups: readonly RecordingGroup[] = [
  ...genres.map(([genre, name]) => ({
    name,
    description: `Tracks with ${/^[aeiou]/iu.test(name) ? "an" : "a"} ${name.toLowerCase()} sound.`,
    matches: sql`json_extract(${musicRecordings.acoustic}, ${`$.genre."genre_dortmund:${genre}"`}) >= 0.6`,
  })),
  ...moods.map(([mood, name, description]) => ({
    name,
    description,
    matches: sql`json_extract(${musicRecordings.acoustic}, ${`$.mood.${mood}`}) >= 0.6`,
  })),
  {
    name: "Slow tempo",
    description: "Slow-paced tracks with a tempo below 90 BPM.",
    matches: sql`json_extract(${musicRecordings.acoustic}, '$.bpm') > 0 AND json_extract(${musicRecordings.acoustic}, '$.bpm') < 90`,
  },
  {
    name: "Fast tempo",
    description: "Fast-paced tracks with a tempo of at least 130 BPM.",
    matches: sql`json_extract(${musicRecordings.acoustic}, '$.bpm') >= 130`,
  },
]

export interface RecordingGroupCounts {
  readonly eligibleTracks: number
  readonly analyzedTracks: number
  readonly counts: readonly number[]
}

export function summarizeRecordingGroups(summary: RecordingGroupCounts) {
  return {
    eligibleTracks: summary.eligibleTracks,
    analyzedTracks: summary.analyzedTracks,
    candidates: Array.sort(
      recordingGroups
        .map(({ name, description }, index) => ({
          name,
          description,
          estimatedTrackCount: summary.counts[index] ?? 0,
        }))
        .filter(
          (group) =>
            group.estimatedTrackCount >=
            Math.max(2, Math.ceil(summary.analyzedTracks * 0.03))
        ),
      (a: DestinationSuggestion, b: DestinationSuggestion) =>
        Order.Number(b.estimatedTrackCount, a.estimatedTrackCount) ||
        Order.String(a.name, b.name)
    ).slice(0, 12),
  }
}
