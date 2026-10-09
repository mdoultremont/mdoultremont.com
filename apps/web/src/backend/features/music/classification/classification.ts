import { Clock, Context, Effect, Layer, Option } from "effect"
import {
  type DestinationPersistenceError,
  Destinations,
} from "@/backend/features/music/destinations"
import { Jev, type JevError } from "@/backend/modules/jev"
import { JobQueue, type JobQueueError } from "@/backend/primitives/job-queue"
import {
  ClassificationMessage,
  type ClassificationPersistenceError,
  type ClassificationStatus,
} from "./errors"
import { ClassificationStore, type PendingTrack } from "./store"

/** Pinned so decisions never change because the provider moved `jev-latest`. */
export const classifierModel = "jev-1.13.0"
/** A destination is accepted when Jev's yes-probability reaches this. */
export const acceptanceThreshold = 0.5
/** Tracks decided per queue message. */
const batchSize = 20

export type ClassificationError =
  | ClassificationPersistenceError
  | DestinationPersistenceError
  | JobQueueError
  | JevError

interface Setup {
  readonly destinations: readonly {
    readonly playlistId: string
    readonly description: string
  }[]
  readonly fingerprint: string
}

/**
 * Classification: deciding, from a track's recording data and the
 * destination descriptions, which destinations the track belongs to.
 * Runs only while the owner has marked the setup Ready.
 */
export class MusicClassification extends Context.Service<
  MusicClassification,
  {
    /** Queues a batch if setup is Ready. Safe to call often. */
    readonly request: (
      ownerId: string
    ) => Effect.Effect<void, DestinationPersistenceError | JobQueueError>
    /** Decides one batch of tracks and queues the next while work remains. */
    readonly processNext: (
      ownerId: string
    ) => Effect.Effect<{ readonly decided: number }, ClassificationError>
    readonly status: (
      ownerId: string
    ) => Effect.Effect<
      ClassificationStatus,
      ClassificationPersistenceError | DestinationPersistenceError
    >
    /** Replaces every decision, e.g. after adding or rewording a destination. */
    readonly reclassify: (
      ownerId: string
    ) => Effect.Effect<
      void,
      | ClassificationPersistenceError
      | DestinationPersistenceError
      | JobQueueError
    >
  }
>()("backend/features/music/MusicClassification") {
  static readonly layerNoDeps = Layer.effect(
    MusicClassification,
    Effect.gen(function* () {
      const store = yield* ClassificationStore
      const destinations = yield* Destinations
      const jev = yield* Jev
      const queue = yield* JobQueue

      /** The setup to classify against, or `null` when classification must not run. */
      const currentSetup = Effect.fn("MusicClassification.currentSetup")(
        function* (ownerId: string) {
          const configuration = yield* destinations.read(ownerId)
          const enabled = configuration.destinations
            .filter(
              (destination) => destination.enabled && destination.description
            )
            .map(({ playlistId, description }) => ({ playlistId, description }))
          // Sorted so the fingerprint does not depend on storage order.
          // oxlint-disable-next-line unicorn/no-array-sort -- `enabled` is a fresh array
          enabled.sort((a, b) => a.playlistId.localeCompare(b.playlistId))
          const fingerprint = yield* sha256({
            model: classifierModel,
            threshold: acceptanceThreshold,
            destinations: enabled,
          })
          const runnable =
            configuration.ready &&
            configuration.reviewPlaylistId !== null &&
            enabled.length > 0
          return { runnable, setup: { destinations: enabled, fingerprint } }
        }
      )

      const request = Effect.fn("MusicClassification.request")(function* (
        ownerId: string
      ) {
        const { runnable } = yield* currentSetup(ownerId)
        if (runnable)
          yield* queue.send(
            ClassificationMessage.make({
              kind: "music.classification",
              ownerId,
            })
          )
      })

      const decide = Effect.fn("MusicClassification.decide")(function* (
        ownerId: string,
        track: PendingTrack,
        setup: Setup
      ) {
        const classifiedAt = yield* Clock.currentTimeMillis
        // Without recording data there is nothing permitted to classify.
        if (track.recording === null)
          return yield* store.save({
            ownerId,
            trackId: track.trackId,
            destinationIds: [],
            review: true,
            reason: "no_recording_data",
            probabilities: {},
            model: null,
            fingerprint: setup.fingerprint,
            classifiedAt,
          })

        // The classifier state holds CC0 recording data only. Spotify fields
        // must never reach Jev (Spotify Developer Terms).
        const state = {
          recording: {
            title: track.recording.title,
            artistCredit: track.recording.artistCredit,
            durationMs: track.recording.durationMs,
          },
          acoustic: track.recording.acoustic,
        }
        // Jev refusing this one input must not block every later track; a
        // missing key or rejected credentials still stop the batch.
        const response = yield* jev
          .noul({
            model: classifierModel,
            state,
            questions: Object.fromEntries(
              setup.destinations.map((destination, index) => [
                `destination_${index}`,
                `Does this recording belong in a playlist described as: ${destination.description}?`,
              ])
            ),
          })
          .pipe(
            Effect.map(Option.some),
            Effect.catchIf(
              (error) => error.reason === "InvalidResponse",
              () => Effect.succeed(Option.none())
            )
          )
        if (Option.isNone(response))
          return yield* store.save({
            ownerId,
            trackId: track.trackId,
            destinationIds: [],
            review: true,
            reason: "classifier_failed",
            probabilities: {},
            model: classifierModel,
            fingerprint: setup.fingerprint,
            classifiedAt,
          })
        const answer = response.value
        const probabilities = Object.fromEntries(
          setup.destinations.map((destination, index) => [
            destination.playlistId,
            answer.probabilities[`destination_${index}`] ?? 0,
          ])
        )
        const destinationIds = setup.destinations
          .map((destination) => destination.playlistId)
          .filter((id) => (probabilities[id] ?? 0) >= acceptanceThreshold)
        yield* store.save({
          ownerId,
          trackId: track.trackId,
          destinationIds,
          review: destinationIds.length === 0,
          reason: "classified",
          probabilities,
          model: answer.model,
          fingerprint: setup.fingerprint,
          classifiedAt,
        })
      })

      const processNext = Effect.fn("MusicClassification.processNext")(
        function* (ownerId: string) {
          const { runnable, setup } = yield* currentSetup(ownerId)
          if (!runnable) return { decided: 0 }
          const tracks = yield* store.pending(ownerId, batchSize)
          // Each decision is saved as it is made, so a failure keeps earlier ones.
          for (const track of tracks) yield* decide(ownerId, track, setup)
          if (tracks.length === batchSize) yield* request(ownerId)
          return { decided: tracks.length }
        }
      )

      const status = Effect.fn("MusicClassification.status")(function* (
        ownerId: string
      ) {
        const { setup } = yield* currentSetup(ownerId)
        const configuration = yield* destinations.read(ownerId)
        const counts = yield* store.counts(ownerId, setup.fingerprint)
        const recent = yield* store.recent(ownerId, 25)
        return {
          ready: configuration.ready,
          ...counts,
          recent,
        } satisfies ClassificationStatus
      })

      const reclassify = Effect.fn("MusicClassification.reclassify")(function* (
        ownerId: string
      ) {
        yield* store.clear(ownerId)
        yield* request(ownerId)
      })

      return MusicClassification.of({
        request,
        processNext,
        status,
        reclassify,
      })
    })
  )

  /** Production layer. Needs the platform (`Database`, `JobQueue`, config). */
  static readonly layer = MusicClassification.layerNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(ClassificationStore.layer, Destinations.layer, Jev.layer)
    )
  )
}

function sha256(value: unknown) {
  return Effect.promise(async () => {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(value))
    )
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("")
  })
}
