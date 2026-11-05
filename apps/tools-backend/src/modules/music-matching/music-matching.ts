/**
 * Spotify appends version notes after " - ", such as "Song - Remastered 2011"
 * or "Song - Jamie xx Remix". Notes that only describe a reissue name the same
 * recording and are dropped; mixes and edits are kept, since they are
 * different recordings.
 */
const reissueNote =
  /^(?:(?:\d{4} )?remaster(?:ed)?(?: \d{4})?(?: version)?|mono|stereo|(?:single|album|lp) version|original mix|original version)$/u

function fold(value: string) {
  return value
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll("&", " and ")
}

function words(value: string) {
  return value
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replaceAll(/\s+/gu, " ")
}

/**
 * A title without its featured artists, which MusicBrainz credits as artists
 * instead: "Song (feat. X)", "Song [ft. X]", "Song feat. X", and Spotify's
 * lowercase "Song (with X)". "Song (With Love)" is a title and stays.
 */
export function withoutFeatures(title: string) {
  return title
    .split(" - ")
    .map((part) =>
      part
        .replaceAll(/\s*[([](?:feat\.?|ft\.|featuring)\s[^)\]]*[)\]]/giu, "")
        .replaceAll(/\s*[([]with\s[^)\]]*[)\]]/gu, "")
        .replace(/\s+(?:feat\.?|ft\.|featuring)\s[^([]*/iu, " ")
        .trim()
    )
    .join(" - ")
}

/**
 * A title reduced to what identifies the recording: case, accents,
 * punctuation, featured artists, and reissue notes removed, mix names kept.
 * "Song (Original Mix)" and "Song - Remastered" both become "song".
 */
export function titleKey(title: string) {
  const [base = "", ...notes] = fold(withoutFeatures(title)).split(" - ")
  return words(
    [base, ...notes.filter((note) => !reissueNote.test(note.trim()))]
      .join(" ")
      .replaceAll(/[([]([^)\]]*)[)\]]/gu, (_whole, inner: string) =>
        reissueNote.test(inner.trim()) ? " " : ` ${inner} `
      )
  )
}

/** An artist name without case, accents, punctuation, a leading "The", or Discogs' "(2)" suffix. */
export function artistKey(name: string) {
  return words(fold(name).replace(/\s\(\d+\)$/u, "")).replace(/^the /u, "")
}

export function sameTitle(a: string, b: string) {
  return titleKey(a) === titleKey(b)
}

/**
 * Whether an artist credit such as "A feat. B", "A, B & C", or "A x B" names
 * the artist as one of its artists. "Simon & Garfunkel" names "Simon &
 * Garfunkel" but not "Simon"; "Kid Cudi" does not name "Kid".
 */
export function creditNames(credit: string, artist: string) {
  const name = artistKey(artist)
  if (name === "") return false
  return [
    credit,
    ...credit.split(
      /\s*(?:,|&|\/|\bfeat\.?|\bft\.|\bfeaturing\b|\bwith\b|\bx\b|\bvs\.?|\band\b)\s*/iu
    ),
  ].some((part) => artistKey(part) === name)
}
