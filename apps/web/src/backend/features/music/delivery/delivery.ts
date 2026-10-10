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
  /** Pairs to write, newest likes first. */
  readonly todo: readonly TrackPlaylist[]
  readonly delivered: number
  readonly refused: number
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
    /** "Write now": queues a batch and retries playlists Spotify refused before. */
    readonly request: (
      ownerId: string
    ) => Effect.Effect<void, DeliveryPersistenceError | JobQueueError>
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

      const send = (ownerId: string) =>
        queue.send(DeliveryMessage.make({ kind: "music.delivery", ownerId }))

      /** "Write now": also gives refused playlists another chance. */
      const writeNow = Effect.fn("MusicDelivery.writeNow")(function* (
        ownerId: string
      ) {
        yield* store.clearRefused(ownerId)
        yield* send(ownerId)
      })

      const requestIfAutomatic = Effect.fn("MusicDelivery.requestIfAutomatic")(
        function* (ownerId: string) {
          if (yield* store.automatic(ownerId)) yield* send(ownerId)
        }
      )

      const plan = Effect.fn("MusicDelivery.plan")(function* (ownerId: string) {
        const configuration = yield* destinations.read(ownerId)
        const decisions = yield* store.decisions(ownerId)
        const records = yield* store.deliveries(ownerId)
        const settled = new Set<string>()
        let delivered = 0
        let refused = 0
        let lastDeliveredAt: number | null = null
        for (const record of records) {
          const key = `${record.trackId}|${record.playlistId}`
          if (record.status === "delivered") {
            settled.add(key)
            delivered += 1
            lastDeliveredAt = Math.max(lastDeliveredAt ?? 0, record.updatedAt)
          } else if (record.status === "refused") {
            settled.add(key)
            refused += 1
          }
        }
        const todo: TrackPlaylist[] = []
        for (const decision of decisions)
          for (const playlistId of targets(decision, configuration))
            if (!settled.has(`${decision.trackId}|${playlistId}`))
              todo.push({ trackId: decision.trackId, playlistId })
        return { todo, delivered, refused, lastDeliveredAt } satisfies Plan
      })

      /**
       * Writes the pairs for one playlist. Reads the playlist first: a track
       * may already be there (a curated playlist, or an earlier write whose
       * response was lost), and Spotify would add it a second time.
       */
      const writePlaylist = Effect.fn("MusicDelivery.writePlaylist")(
        function* (
          ownerId: string,
          playlistId: string,
          pairs: readonly TrackPlaylist[]
        ) {
          const now = yield* Clock.currentTimeMillis
          const present = yield* spotify.playlistTrackIds(ownerId, playlistId)
          const toAdd = pairs.filter((pair) => !present.has(pair.trackId))
          yield* store.markDelivered(
            ownerId,
            pairs.filter((pair) => present.has(pair.trackId)),
            now
          )
          yield* store.markPending(ownerId, toAdd, now)
          yield* spotify.addTracksToPlaylist(
            ownerId,
            playlistId,
            toAdd.map((pair) => pair.trackId)
          )
          yield* store.markDelivered(ownerId, toAdd, now)
          return pairs.length
        },
        // A refused playlist must not block the others or be retried in a loop.
        (effect, ownerId, _playlistId, pairs) =>
          effect.pipe(
            Effect.catchReason("SpotifyError", "AccessDenied", () =>
              Clock.currentTimeMillis.pipe(
                Effect.flatMap((now) => store.markRefused(ownerId, pairs, now)),
                Effect.as(0)
              )
            )
          )
      )

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
        for (const [playlistId, pairs] of Object.entries(byPlaylist))
          delivered += yield* writePlaylist(ownerId, playlistId, pairs)
        if (todo.length > batch.length) yield* send(ownerId)
        return { delivered, unliked: unliked.length }
      })

      const status = Effect.fn("MusicDelivery.status")(function* (
        ownerId: string
      ) {
        const { todo, delivered, refused, lastDeliveredAt } =
          yield* plan(ownerId)
        return {
          automatic: yield* store.automatic(ownerId),
          delivered,
          toWrite: todo.length,
          refused,
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
        if (automatic) yield* send(ownerId)
        return automatic
      })

      return MusicDelivery.of({
        request: writeNow,
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
