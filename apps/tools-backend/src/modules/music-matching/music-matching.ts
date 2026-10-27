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
 * A title reduced to what identifies the recording: case, accents,
 * punctuation, featured artists, and reissue notes removed, mix names kept.
 * "Song (Original Mix)" and "Song - Remastered" both become "song".
 */
export function titleKey(title: string) {
  const [base = "", ...notes] = fold(title).split(" - ")
  const parts = [
    base,
    ...notes.filter((note) => !reissueNote.test(note.trim())),
  ]
  return words(
    parts
      .join(" ")
      .replaceAll(/[([](?:feat|ft|featuring|with)\.?\s[^)\]]*[)\]]/gu, " ")
      .replaceAll(/\s(?:feat|ft|featuring)\.?\s.*$/gu, " ")
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

/** Whether an artist credit such as "A feat. B" or "A & B" names the artist. */
export function creditNames(credit: string, artist: string) {
  const name = artistKey(artist)
  return name !== "" && ` ${artistKey(credit)} `.includes(` ${name} `)
}
