import { sql, type AnyColumn } from "drizzle-orm"
import { musicSources, musicSourceTracks } from "#backend/modules/database"

export { SourceStore } from "./store"
export {
  SourceConflict,
  SourceInputError,
  SourcePersistenceError,
} from "./errors"
export type {
  SourceId,
  Source,
  Ingestion,
} from "@mdoultremont/tools-contracts/music"
export { storedSourceId, sourceIdFromStorage } from "./source-id"

export function eligibleTrack(ownerId: AnyColumn, trackId: AnyColumn) {
  return sql`EXISTS (
    SELECT 1 FROM ${musicSourceTracks}
    INNER JOIN ${musicSources}
      ON ${musicSources.ownerId} = ${musicSourceTracks.ownerId}
      AND ${musicSources.sourceId} = ${musicSourceTracks.sourceId}
    WHERE ${musicSourceTracks.ownerId} = ${ownerId}
      AND ${musicSourceTracks.trackId} = ${trackId}
      AND ${musicSourceTracks.present} = 1 AND ${musicSources.enabled} = 1
  )`
}
