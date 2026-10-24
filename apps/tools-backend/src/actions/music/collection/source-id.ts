import type { SourceId } from "@mdoultremont/tools-contracts/music"

export const storedSourceId = (source: SourceId) =>
  source.kind === "liked" ? "liked" : source.playlistId

export const sourceIdFromStorage = (value: string): SourceId =>
  value === "liked"
    ? { kind: "liked" }
    : { kind: "playlist", playlistId: value }
