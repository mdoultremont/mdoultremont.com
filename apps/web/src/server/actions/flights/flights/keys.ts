/**
 * Object-storage layout for one user's flights:
 *   flights/{userId}/{flightId}/files/{fileId}   original upload, raw bytes
 *   flights/{userId}/{flightId}/track.json.gz    gzipped JSON of the track points
 * Everything of one flight shares `flightPrefix`, so deleting it is one prefix delete.
 */
export const flightPrefix = (userId: string, flightId: string) =>
  `flights/${userId}/${flightId}/`
export const fileKey = (userId: string, flightId: string, fileId: string) =>
  `${flightPrefix(userId, flightId)}files/${fileId}`
export const trackKey = (userId: string, flightId: string) =>
  `${flightPrefix(userId, flightId)}track.json.gz`
