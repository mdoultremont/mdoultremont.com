import { Effect } from "effect"
import type { ClassificationDecision } from "../modules/cc0-classifier"
import { choosePlaylistTargets } from "./classification-policy"

export type SyncMode = "catchup" | "full" | "reclassify"

export interface LikedTrack {
  readonly id: string
  readonly isrc: string | null
}

export interface SyncDestination {
  readonly playlistId: string
  readonly description: string
  readonly enabled: boolean
}

export interface SavedClassification {
  readonly fingerprint: string
  readonly probabilities: readonly ClassificationDecision[]
}

export interface SyncPorts {
  currentLikes(): Promise<readonly LikedTrack[]>
  isCurrentlyLiked(trackId: string): Promise<boolean>
  destinations(): Promise<readonly SyncDestination[]>
  reviewPlaylistId(): Promise<string>
  permittedInput(
    track: LikedTrack
  ): Promise<{ readonly fingerprint: string; readonly value: unknown } | null>
  classify(
    input: unknown,
    destinations: readonly SyncDestination[]
  ): Promise<readonly ClassificationDecision[]>
  loadDecision(trackId: string): Promise<SavedClassification | null>
  saveDecision(trackId: string, decision: SavedClassification): Promise<void>
  wasDelivered(trackId: string, playlistId: string): Promise<boolean>
  markDelivered(trackId: string, playlistId: string): Promise<void>
  contains(playlistId: string, trackId: string): Promise<boolean>
  add(playlistId: string, trackId: string): Promise<void>
}

export interface SyncReport {
  readonly scanned: number
  readonly delivered: number
  readonly skippedUnliked: number
  readonly failed: number
  readonly errors?: readonly unknown[]
}

export function syncCurrentLikes(input: {
  readonly mode: SyncMode
  readonly ports: SyncPorts
  readonly threshold: number
  readonly classifierVersion: string
  readonly writesEnabled?: boolean
}): Effect.Effect<SyncReport, Error> {
  return Effect.tryPromise({
    try: async () => {
      const { ports } = input
      const [likes, allDestinations, reviewPlaylistId] = await Promise.all([
        ports.currentLikes(),
        ports.destinations(),
        ports.reviewPlaylistId(),
      ])
      const destinations = allDestinations.filter(
        (destination) => destination.enabled
      )
      if (
        !reviewPlaylistId ||
        destinations.some(
          (destination) => destination.playlistId === reviewPlaylistId
        )
      )
        throw new Error("Review playlist configuration is invalid")
      const ids = new Set(
        destinations.map((destination) => destination.playlistId)
      )
      if (ids.size !== destinations.length)
        throw new Error("Destination playlists must be distinct")

      let delivered = 0
      let skippedUnliked = 0
      let failed = 0
      const errors: unknown[] = []
      for (const track of new Map(
        likes.map((item) => [item.id, item])
      ).values()) {
        try {
          if (!(await ports.isCurrentlyLiked(track.id))) {
            skippedUnliked++
            continue
          }
          const cc0 = await ports.permittedInput(track)
          const fingerprint = JSON.stringify({
            permittedInput: cc0?.fingerprint ?? "unresolved",
            destinations: destinations.map((destination) => [
              destination.playlistId,
              destination.description,
            ]),
            classifierVersion: input.classifierVersion,
            threshold: input.threshold,
          })
          const previous =
            input.mode === "reclassify"
              ? null
              : await ports.loadDecision(track.id)
          let probabilities: readonly ClassificationDecision[]
          if (previous?.fingerprint === fingerprint) {
            probabilities = previous.probabilities
          } else {
            probabilities = cc0
              ? await ports.classify(cc0.value, destinations)
              : []
            assertDecisions(probabilities, ids)
            await ports.saveDecision(track.id, { fingerprint, probabilities })
          }
          assertDecisions(probabilities, ids)
          const targets = choosePlaylistTargets({
            probabilities,
            threshold: input.threshold,
            reviewPlaylistId,
          })
          // Dry runs still resolve/classify, but never record delivery or mutate Spotify.
          if (input.writesEnabled === false) continue
          for (const playlistId of targets) {
            if (!(await ports.isCurrentlyLiked(track.id))) {
              skippedUnliked++
              break
            }
            if (
              input.mode === "catchup" &&
              (await ports.wasDelivered(track.id, playlistId))
            )
              continue
            // Always inspect remote membership before a write, including after a lost response.
            if (!(await ports.contains(playlistId, track.id))) {
              await ports.add(playlistId, track.id)
              delivered++
            }
            await ports.markDelivered(track.id, playlistId)
          }
        } catch (cause) {
          failed++
          errors.push(cause)
        }
      }
      return {
        scanned: likes.length,
        delivered,
        skippedUnliked,
        failed,
        ...(errors.length ? { errors } : {}),
      }
    },
    catch: (cause) =>
      cause instanceof Error
        ? cause
        : new Error("Playlist sync failed", { cause }),
  })
}

function assertDecisions(
  decisions: readonly ClassificationDecision[],
  destinationIds: ReadonlySet<string>
) {
  const seen = new Set<string>()
  for (const decision of decisions) {
    if (
      !destinationIds.has(decision.destinationId) ||
      seen.has(decision.destinationId) ||
      !Number.isFinite(decision.yesProbability) ||
      decision.yesProbability < 0 ||
      decision.yesProbability > 1
    )
      throw new Error("Classifier returned an invalid destination decision")
    seen.add(decision.destinationId)
  }
}
