import { parseGpx } from "./parse-gpx.ts"
import { parseIgc } from "./parse-igc.ts"
import { TrackParseError, type ParsedTrack } from "./types.ts"

export function parseTrackFile(filename: string, text: string): ParsedTrack {
  if (text.includes("\0") || filename.includes("\0"))
    throw new TrackParseError(
      "This file contains a NUL byte. Export a valid GPX or IGC text file."
    )
  const extension = filename.toLowerCase().split(".").pop()
  if (extension === "gpx") return parseGpx(text)
  if (extension === "igc") return parseIgc(text)
  if (/<(?:[\w-]+:)?gpx(?:\s|>)/i.test(text)) return parseGpx(text)
  if (/^H[FP]DTE/m.test(text) || /^B\d{6}\d{7}[NS]/m.test(text))
    return parseIgc(text)
  throw new TrackParseError(
    "Unsupported track format. Choose a GPX or IGC file."
  )
}
