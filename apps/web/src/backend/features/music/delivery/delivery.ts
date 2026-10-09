import { Array, Clock, Context, Effect, Layer } from "effect"
import {
  type DestinationConfiguration,
  type DestinationPersistenceError,
  Destinations,
} from "@/backend/features/music/destinations"
import { Spotify, type SpotifyError } from "@/backend/modules/spotify"
import { JobQueue, type JobQueueError } from "@/backend/primitives/job-queue"
import {
  DeliveryMessage,
  type DeliveryPersistenceError,
  type DeliveryStatus,
} from "./errors"
import { DeliveryStore, type TrackPlaylist } from "./store"

/** Track-and-playlist pairs written per queue message. */
const batchSize = 100

export type DeliveryError =
  | DeliveryPersistenceError
  | DestinationPersistenceError
  | JobQueueError
  | SpotifyError

interface Plan {
  /** Pairs to write, newest likes first. `uncertain` marks an earlier write with an unknown outcome. */
  readonly todo: readonly (TrackPlaylist & { readonly uncertain: boolean })[]
  readonly delivered: number
  readonly lastDeliveredAt: number | null
}

/**
 * Delivery: adding tracks to the playlists named in their decisions. Only
 * adds, only to enabled destinations (or the review playlist), and only
 * tracks that are still liked.
 */
export class MusicDelivery extends Context.Service<
  MusicDelivery,
  {
    /** Queues a delivery batch ("Write now"). */
    readonly request: (ownerId: string) => Effect.Effect<void, JobQueueError>
    /** Queues a batch only when automatic delivery is on. */
    readonly requestIfAutomatic: (
      ownerId: string
    ) => Effect.Effect<void, DeliveryPersistenceError | JobQueueError>
    /** Writes one batch and queues the next while work remains. */
    readonly processNext: (
      ownerId: string
    ) => Effect.Effect<
      { readonly delivered: number; readonly unliked: number },
      DeliveryError
    >
    readonly status: (
      ownerId: string
    ) => Effect.Effect<
      DeliveryStatus,
      DeliveryPersistenceError | DestinationPersistenceError
    >
    /** Turns automatic delivery on or off; turning it on starts a batch. */
    readonly setAutomatic: (
      ownerId: string,
      automatic: boolean
    ) => Effect.Effect<boolean, DeliveryPersistenceError | JobQueueError>
  }
>()("backend/features/music/MusicDelivery") {
  static readonly layerNoDeps = Layer.effect(
    MusicDelivery,
    Effect.gen(function* () {
      const store = yield* DeliveryStore
      const destinations = yield* Destinations
      const spotify = yield* Spotify
      const queue = yield* JobQueue

      const request = (ownerId: string) =>
        queue.send(DeliveryMessage.make({ kind: "music.delivery", ownerId }))

      const requestIfAutomatic = Effect.fn("MusicDelivery.requestIfAutomatic")(
        function* (ownerId: string) {
          if (yield* store.automatic(ownerId)) yield* request(ownerId)
        }
      )

      const plan = Effect.fn("MusicDelivery.plan")(function* (ownerId: string) {
        const configuration = yield* destinations.read(ownerId)
        const decisions = yield* store.decisions(ownerId)
        const records = yield* store.deliveries(ownerId)
        const delivered = new Set<string>()
        const uncertain = new Set<string>()
        let lastDeliveredAt: number | null = null
        for (const record of records) {
          const key = `${record.trackId}|${record.playlistId}`
          if (record.status === "delivered") {
            delivered.add(key)
            lastDeliveredAt = Math.max(lastDeliveredAt ?? 0, record.updatedAt)
          } else uncertain.add(key)
        }
        const todo: Plan["todo"][number][] = []
        for (const decision of decisions)
          for (const playlistId of targets(decision, configuration)) {
            const key = `${decision.trackId}|${playlistId}`
            if (!delivered.has(key))
              todo.push({
                trackId: decision.trackId,
                playlistId,
                uncertain: uncertain.has(key),
              })
          }
        return { todo, delivered: delivered.size, lastDeliveredAt } as Plan
      })

      const processNext = Effect.fn("MusicDelivery.processNext")(function* (
        ownerId: string
      ) {
        const { todo } = yield* plan(ownerId)
        const batch = todo.slice(0, batchSize)
        if (batch.length === 0) return { delivered: 0, unliked: 0 }

        // Re-check right before writing: the stored liked state can be a day old.
        const trackIds = [...new Set(batch.map((pair) => pair.trackId))]
        const liked = yield* spotify.likedTracks(ownerId, trackIds)
        const unliked = trackIds.filter((id) => !liked.has(id))
        yield* store.markUnliked(ownerId, unliked)

        let delivered = 0
        const byPlaylist = Array.groupBy(
          batch.filter((pair) => liked.has(pair.trackId)),
          (pair) => pair.playlistId
        )
        for (const [playlistId, pairs] of Object.entries(byPlaylist)) {
          // An earlier write may have reached Spotify before failing; adding
          // again would duplicate the track.
          const present = pairs.some((pair) => pair.uncertain)
            ? yield* spotify.playlistTrackIds(ownerId, playlistId)
            : new Set<string>()
          const alreadyThere = pairs.filter((pair) => present.has(pair.trackId))
          const toAdd = pairs.filter((pair) => !present.has(pair.trackId))
          const now = yield* Clock.currentTimeMillis
          yield* store.markDelivered(ownerId, alreadyThere, now)
          yield* store.markPending(ownerId, toAdd, now)
          yield* spotify.addTracksToPlaylist(
            ownerId,
            playlistId,
            toAdd.map((pair) => pair.trackId)
          )
          yield* store.markDelivered(ownerId, toAdd, now)
          delivered += pairs.length
        }
        if (todo.length > batch.length) yield* request(ownerId)
        return { delivered, unliked: unliked.length }
      })

      const status = Effect.fn("MusicDelivery.status")(function* (
        ownerId: string
      ) {
        const { todo, delivered, lastDeliveredAt } = yield* plan(ownerId)
        return {
          automatic: yield* store.automatic(ownerId),
          delivered,
          toWrite: todo.length,
          lastDeliveredAt,
        } satisfies DeliveryStatus
      })

      const setAutomatic = Effect.fn("MusicDelivery.setAutomatic")(function* (
        ownerId: string,
        automatic: boolean
      ) {
        yield* store.setAutomatic(
          ownerId,
          automatic,
          yield* Clock.currentTimeMillis
        )
        if (automatic) yield* request(ownerId)
        return automatic
      })

      return MusicDelivery.of({
        request,
        requestIfAutomatic,
        processNext,
        status,
        setAutomatic,
      })
    })
  )

  /** Production layer. Needs the platform (`Database`, `JobQueue`, config). */
  static readonly layer = MusicDelivery.layerNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(DeliveryStore.layer, Destinations.layer, Spotify.layer)
    )
  )
}

/** Where a decision sends its track right now: enabled destinations, or the review playlist. */
function targets(
  decision: {
    readonly destinationIds: readonly string[]
    readonly review: boolean
  },
  configuration: DestinationConfiguration
): readonly string[] {
  if (decision.review)
    return configuration.reviewPlaylistId === null
      ? []
      : [configuration.reviewPlaylistId]
  const enabled = new Set(
    configuration.destinations
      .filter((destination) => destination.enabled)
      .map((destination) => destination.playlistId)
  )
  return decision.destinationIds.filter((id) => enabled.has(id))
}
