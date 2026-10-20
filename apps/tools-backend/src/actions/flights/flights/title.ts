export const cleanTitle = (value: string) =>
  Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code >= 32 && (code < 127 || code > 159)
    })
    .join("")
    .trim()
export function defaultTitle(
  takeoffAt: number,
  trackName?: string | null,
  takeoffName?: string | null
) {
  return (
    cleanTitle(trackName ?? "") ||
    cleanTitle(takeoffName ?? "") ||
    `Flight ${new Date(takeoffAt).toISOString().slice(0, 16).replace("T", " ")} UTC`
  )
    .slice(0, 200)
    .replace(/[\uD800-\uDBFF]$/u, "")
}
