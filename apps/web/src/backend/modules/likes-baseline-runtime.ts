import { Effect, Layer } from "effect"
import { createSpotifyModule } from "./spotify"
import { createSpotifyConnectionStore } from "./spotify-store"
import { likesBaselineStoreLayer } from "./likes-baseline-store"
import {
  BaselineClock,
  BaselineError,
  BaselineQueue,
  BaselineSpotify,
} from "@/backend/workflows/likes-baseline"

export function likesBaselineLayer(bindings: Cloudflare.Env) {
  const spotify = createSpotifyModule({
    store: createSpotifyConnectionStore(bindings.DB),
    clientId: bindings.SPOTIFY_CLIENT_ID,
    clientSecret: bindings.SPOTIFY_CLIENT_SECRET,
    redirectUri: bindings.SPOTIFY_REDIRECT_URI,
    encryptionKey: bindings.SPOTIFY_TOKEN_ENCRYPTION_KEY,
  })
  return Layer.mergeAll(
    likesBaselineStoreLayer(bindings.DB),
    Layer.succeed(BaselineSpotify, {
      savedTracksPage: (ownerId: string, cursor: string | null) =>
        Effect.mapError(
          Effect.map(
            spotify.savedTracksPage(ownerId, cursor ?? undefined),
            (page) => ({
              items: page.items.map((track) => ({
                id: track.id,
                addedAt: track.addedAt,
              })),
              next: page.next,
              total: page.total,
            })
          ),
          (cause) => new BaselineError("spotify", cause.message, { cause })
        ),
    }),
    Layer.succeed(BaselineQueue, {
      send: (runId: string) =>
        Effect.tryPromise({
          try: async () => {
            await bindings.MUSIC_BASELINE_QUEUE.send({
              kind: "likes-baseline",
              runId,
            })
          },
          catch: (cause) =>
            new BaselineError("queue", "Baseline work could not be queued", {
              cause,
            }),
        }),
    }),
    Layer.succeed(BaselineClock, {
      now: () => Effect.sync(() => Date.now()),
      id: () => Effect.sync(() => crypto.randomUUID()),
    })
  )
}
