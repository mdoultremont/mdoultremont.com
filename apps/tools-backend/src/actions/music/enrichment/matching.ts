import type {
  MusicBrainzRecording,
  MusicBrainzSearchResult,
} from "#backend/modules/musicbrainz"
import {
  artistKey,
  creditNames,
  sameTitle,
  titleKey,
} from "#backend/modules/music-matching"

/**
 * What the collected track says it is. Used only to choose between
 * MusicBrainz candidates; never stored or sent to the classifier.
 */
export interface TrackHint {
  readonly title: string
  readonly artists: readonly string[]
}

export type RecordingMatch =
  | { readonly kind: "found"; readonly recording: MusicBrainzRecording }
  | { readonly kind: "ambiguous" }
  | { readonly kind: "not_found" }

/** A search result below this score is not considered. */
const minimumSearchScore = 90

/** Candidates that are the hinted title by one of the hinted artists. */
function narrow<R extends MusicBrainzRecording>(
  candidates: readonly R[],
  hint: TrackHint
) {
  return candidates.filter(
    (candidate) =>
      sameTitle(candidate.title, hint.title) &&
      hint.artists.some((artist) => creditNames(candidate.artistCredit, artist))
  )
}

/**
 * The first candidate when every candidate has the same title and artist:
 * MusicBrainz often lists one ISRC on duplicate recordings that describe the
 * same song, and their recording data is the same.
 */
function single(candidates: readonly MusicBrainzRecording[]): RecordingMatch {
  const [first] = candidates
  if (first === undefined) return { kind: "not_found" }
  const distinct = new Set(
    candidates.map(
      (candidate) =>
        `${titleKey(candidate.title)}|${artistKey(candidate.artistCredit)}`
    )
  )
  return distinct.size === 1
    ? { kind: "found", recording: first }
    : { kind: "ambiguous" }
}

/**
 * Chooses among the recordings an ISRC names. Different songs under one ISRC
 * are told apart by the track's title and artists; if that still leaves
 * several, none is chosen.
 */
export function matchIsrcRecordings(
  recordings: readonly MusicBrainzRecording[],
  hint: TrackHint
): RecordingMatch {
  const match = single(recordings)
  if (match.kind !== "ambiguous") return match
  const narrowed = narrow(recordings, hint)
  return narrowed.length === 0 ? match : single(narrowed)
}

/**
 * Chooses among search results for a track whose ISRC MusicBrainz does not
 * know. Only high-scoring results with the exact title, mix name included,
 * and a credited artist from the track count.
 */
export function matchSearchResults(
  results: readonly MusicBrainzSearchResult[],
  hint: TrackHint
): RecordingMatch {
  return single(
    narrow(
      results.filter((result) => result.score >= minimumSearchScore),
      hint
    )
  )
}

/** The track title without the version note Spotify appends after " - ". */
export function searchTitle(title: string) {
  return title.split(" - ")[0]!.trim()
}
