import { Effect } from "effect"
import { Cc0SourceError, createCc0Sources } from "./cc0-sources"
import {
  buildCc0Input,
  fingerprintCc0Input,
  isCc0ClassifierInput,
  classifyWithJev,
  ClassifierProviderError,
} from "./cc0-classifier"
import { createSpotifyModule, SpotifyError } from "./spotify"
import { createSpotifyConnectionStore } from "./spotify-store"
import { createMusicRunStore } from "./music-run-store"
import { processMusicRun, RunTrackError } from "@/backend/workflows/music-runs"
import { syncCurrentLikes } from "@/backend/workflows/playlist-sync"

/** Fail closed until a checked-in, owner-labeled evaluation establishes a useful decision policy. */
export const liveMusicPolicy: {
  destinationAddsEnabled: boolean
  classifierVersion: string
  threshold: number
  model: string | null
} = {
  destinationAddsEnabled: false,
  classifierVersion: "cc0-review-only-v1",
  threshold: 1,
  model: null,
}

export function musicRunRuntime(bindings: Cloudflare.Env) {
  const store = createMusicRunStore(bindings.DB, {
    writesEnabled: liveMusicPolicy.destinationAddsEnabled,
  })
  const sources = createCc0Sources({})
  const spotify = createSpotifyModule({
    store: createSpotifyConnectionStore(bindings.DB),
    clientId: bindings.SPOTIFY_CLIENT_ID,
    clientSecret: bindings.SPOTIFY_CLIENT_SECRET,
    redirectUri: bindings.SPOTIFY_REDIRECT_URI,
    encryptionKey: bindings.SPOTIFY_TOKEN_ENCRYPTION_KEY,
  })
  const enqueue = async (runId: string) => {
    await bindings.MUSIC_BASELINE_QUEUE.send(
      { kind: "music-run", runId },
      { delaySeconds: 2 }
    )
  }
  return {
    store,
    async start(
      ownerId: string,
      mode: "catchup" | "full" | "reclassify",
      scheduled = false
    ) {
      const run = await store.start(ownerId, mode, scheduled)
      if (run) {
        try {
          await enqueue(run.id)
        } catch {
          await store.fail(
            run.id,
            "Run could not be queued; start again to recover pending work"
          )
          throw new Error("Run could not be queued")
        }
      }
      return run
    },
    async recover(ownerId: string) {
      for (const run of await store.recover(ownerId)) await enqueue(run.id)
    },
    process: (runId: string) =>
      processMusicRun(runId, {
        ...store,
        enqueue,
        page: async (ownerId, cursor) => {
          const page = await Effect.runPromise(
            spotify.savedTracksPage(ownerId, cursor ?? undefined)
          ).catch((cause) => {
            throw toRunTrackError(cause)
          })
          return {
            items: page.items.map(({ id, isrc, addedAt }) => ({
              id,
              isrc,
              addedAt,
            })),
            next: page.next,
          }
        },
        sync: async (run, track) => {
          const { reviewPlaylistId, destinations } = await store.configuration(
            run.ownerId
          )
          try {
            const report = await Effect.runPromise(
              syncCurrentLikes({
                mode: run.mode,
                threshold: liveMusicPolicy.threshold,
                writesEnabled: liveMusicPolicy.destinationAddsEnabled,
                classifierVersion: liveMusicPolicy.classifierVersion,
                ports: {
                  currentLikes: async () => [track],
                  isCurrentlyLiked: (id) =>
                    Effect.runPromise(spotify.isTrackLiked(run.ownerId, id)),
                  destinations: async () => destinations,
                  reviewPlaylistId: async () => reviewPlaylistId,
                  permittedInput: async (likedTrack) => {
                    if (!likedTrack.isrc) return null
                    const recording = await sources.resolveByIsrc(
                      likedTrack.isrc
                    )
                    if (!recording) return null
                    const acoustic = await sources.acousticByRecordingId(
                      recording.id
                    )
                    if (!acoustic) return null
                    const value = buildCc0Input(recording, acoustic)
                    return {
                      fingerprint: await fingerprintCc0Input(value),
                      value,
                    }
                  },
                  classify: async (input, targets) => {
                    if (!liveMusicPolicy.destinationAddsEnabled) return []
                    if (!liveMusicPolicy.model)
                      throw new Error("Evaluated model version required")
                    if (!isCc0ClassifierInput(input))
                      throw new Error("Verified CC0 input required")
                    return Effect.runPromise(
                      classifyWithJev({
                        input,
                        destinations: targets.map((target) => ({
                          id: target.playlistId,
                          description: target.description,
                        })),
                        apiKey: bindings.JEV_API_KEY,
                        model: liveMusicPolicy.model,
                      })
                    )
                  },
                  loadDecision: (id) => store.decision(run.ownerId, id),
                  saveDecision: (id, decision) =>
                    store.saveDecision(run.ownerId, id, decision),
                  wasDelivered: (id, playlist) =>
                    store.delivered(run.ownerId, id, playlist),
                  markDelivered: (id, playlist) =>
                    store.markDelivered(run.ownerId, id, playlist),
                  contains: (playlist, id) =>
                    Effect.runPromise(
                      spotify.isTrackInPlaylist(run.ownerId, playlist, id)
                    ),
                  add: (playlist, id) =>
                    Effect.runPromise(
                      spotify.addTrackToPlaylist(run.ownerId, playlist, id)
                    ),
                },
              })
            )
            return {
              ...report,
              ...(report.errors
                ? { errors: report.errors.map(toRunTrackError) }
                : {}),
            }
          } catch (cause) {
            throw toRunTrackError(cause)
          }
        },
      }),
  }
}

export function toRunTrackError(cause: unknown): RunTrackError {
  if (cause instanceof RunTrackError) return cause
  if (cause instanceof SpotifyError)
    return new RunTrackError(
      cause.message,
      cause.code === "temporary" ||
        cause.code === "rate_limited" ||
        cause.code === "invalid_response",
      cause.retryAfterSeconds,
      { cause }
    )
  if (cause instanceof Cc0SourceError)
    return new RunTrackError(
      cause.message,
      cause.retryable,
      cause.retryAfterSeconds,
      { cause }
    )
  if (cause instanceof ClassifierProviderError)
    return new RunTrackError(cause.message, true, undefined, { cause })
  return new RunTrackError(
    cause instanceof Error ? cause.message : "Track processing failed",
    cause instanceof TypeError,
    undefined,
    { cause }
  )
}
