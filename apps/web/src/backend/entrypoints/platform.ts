import { ConfigProvider, Effect, Layer } from "effect"
import { Spotify } from "@/backend/modules/spotify"
import { Database } from "@/backend/primitives/database"

/**
 * What every feature layer needs from the Worker: the D1 binding as the
 * `Database` primitive, and the Worker variables and secrets as Effect config.
 * Built per request or per queue batch; nothing is shared across requests.
 */
export const platformLayer = (bindings: Cloudflare.Env) =>
  Layer.mergeAll(
    Database.layer(bindings.DB),
    ConfigProvider.layer(ConfigProvider.fromUnknown(bindings))
  )

/**
 * Temporary bridge for the likes-baseline and music-run code that is not yet
 * an Effect service. Throws if Spotify configuration is missing.
 */
export function legacySpotify(bindings: Cloudflare.Env) {
  return Effect.runSync(
    Effect.provide(
      Spotify,
      Spotify.layer.pipe(Layer.provide(platformLayer(bindings)))
    )
  )
}
