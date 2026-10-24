import type { musicIngestions } from "#backend/modules/database"
import type { Ingestion, SourceId } from "@mdoultremont/tools-contracts/music"

export const storedSourceId = (source: SourceId) =>
  source.kind === "liked" ? "liked" : source.playlistId

export const sourceIdFromStorage = (value: string): SourceId =>
  value === "liked"
    ? { kind: "liked" }
    : { kind: "playlist", playlistId: value }

export function ingestionFromStorage({
  sourceId,
  ...row
}: typeof musicIngestions.$inferSelect): Ingestion {
  return { ...row, source: sourceIdFromStorage(sourceId) }
}
