import { Effect, Layer } from "effect"
import { MusicClassification } from "@/server/actions/music/classification"
import { MusicDelivery } from "@/server/actions/music/delivery"
import { Destinations } from "@/server/actions/music/destinations"
import { MusicEnrichment } from "@/server/actions/music/enrichment"
import { MusicIngestion } from "@/server/actions/music/ingestion"
import { MusicPipeline } from "@/server/actions/music/pipeline"
import { Spotify } from "@/server/modules/spotify"
import { catalog } from "@/shared/actions"
import { bind } from "./bind"

const actions = catalog.music

export const musicHandlers = {
  spotify: {
    status: bind(actions.spotify.status, Spotify.layer, (_, caller) =>
      Spotify.use((spotify) => spotify.status(caller.userId))
    ),
    // The OAuth flow is bound to the browser session that starts it, so an
    // action can only hand out the page that starts it.
    connect: bind(actions.spotify.connect, Layer.empty, (_, caller) =>
      Effect.succeed({
        url: new URL("/api/music/spotify/connect", caller.origin).href,
      })
    ),
    disconnect: bind(actions.spotify.disconnect, Spotify.layer, (_, caller) =>
      Spotify.use((spotify) => spotify.disconnect(caller.userId)).pipe(
        Effect.as({ status: "disconnected" } as const)
      )
    ),
    playlists: bind(actions.spotify.playlists, Spotify.layer, (_, caller) =>
      Spotify.use((spotify) => spotify.playlists(caller.userId)).pipe(
        Effect.map((items) => ({ items }))
      )
    ),
    likedTracks: bind(
      actions.spotify.likedTracks,
      Spotify.layer,
      (input, caller) =>
        Spotify.use((spotify) =>
          spotify.savedTracksPage(caller.userId, input.cursor)
        )
    ),
  },
  destinations: {
    get: bind(actions.destinations.get, Destinations.layer, (_, caller) =>
      Destinations.use((destinations) => destinations.read(caller.userId))
    ),
    save: bind(actions.destinations.save, Destinations.layer, (input, caller) =>
      Destinations.use((destinations) =>
        destinations.save({ ownerId: caller.userId, ...input })
      ).pipe(Effect.map((destination) => ({ destination })))
    ),
    create: bind(
      actions.destinations.create,
      Destinations.layer,
      (input, caller) =>
        Destinations.use((destinations) =>
          destinations.create({ ownerId: caller.userId, ...input })
        )
    ),
    remove: bind(
      actions.destinations.remove,
      Destinations.layer,
      (input, caller) =>
        Destinations.use((destinations) =>
          destinations.remove({ ownerId: caller.userId, ...input })
        ).pipe(Effect.as({ status: "removed" } as const))
    ),
    setReviewPlaylist: bind(
      actions.destinations.setReviewPlaylist,
      Destinations.layer,
      (input, caller) =>
        Destinations.use((destinations) =>
          destinations.setReviewPlaylist({ ownerId: caller.userId, ...input })
        ).pipe(Effect.map((reviewPlaylistId) => ({ reviewPlaylistId })))
    ),
  },
  ingestion: {
    status: bind(actions.ingestion.status, MusicIngestion.layer, (_, caller) =>
      MusicIngestion.use((ingestion) => ingestion.status(caller.userId))
    ),
    start: bind(
      actions.ingestion.start,
      MusicIngestion.layer,
      (input, caller) =>
        MusicIngestion.use((ingestion) =>
          ingestion.start(caller.userId, input.kind)
        )
    ),
  },
  enrichment: {
    status: bind(
      actions.enrichment.status,
      MusicEnrichment.layer,
      (_, caller) =>
        MusicEnrichment.use((enrichment) => enrichment.status(caller.userId))
    ),
    retry: bind(actions.enrichment.retry, MusicEnrichment.layer, (_, caller) =>
      Effect.gen(function* () {
        const enrichment = yield* MusicEnrichment
        yield* enrichment.retryUnresolved(caller.userId)
        return yield* enrichment.status(caller.userId)
      })
    ),
  },
  classification: {
    status: bind(
      actions.classification.status,
      MusicClassification.layer,
      (_, caller) =>
        MusicClassification.use((classification) =>
          classification.status(caller.userId)
        )
    ),
    setReady: bind(
      actions.classification.setReady,
      MusicPipeline.layer,
      (input, caller) =>
        MusicPipeline.use((pipeline) =>
          pipeline.setReady(caller.userId, input.ready)
        ).pipe(Effect.map((ready) => ({ ready })))
    ),
    reclassify: bind(
      actions.classification.reclassify,
      MusicClassification.layer,
      (_, caller) =>
        Effect.gen(function* () {
          const classification = yield* MusicClassification
          yield* classification.reclassify(caller.userId)
          return yield* classification.status(caller.userId)
        })
    ),
  },
  delivery: {
    status: bind(actions.delivery.status, MusicDelivery.layer, (_, caller) =>
      MusicDelivery.use((delivery) => delivery.status(caller.userId))
    ),
    start: bind(actions.delivery.start, MusicDelivery.layer, (_, caller) =>
      Effect.gen(function* () {
        const delivery = yield* MusicDelivery
        yield* delivery.request(caller.userId)
        return yield* delivery.status(caller.userId)
      })
    ),
    setAutomatic: bind(
      actions.delivery.setAutomatic,
      MusicDelivery.layer,
      (input, caller) =>
        Effect.gen(function* () {
          const delivery = yield* MusicDelivery
          yield* delivery.setAutomatic(caller.userId, input.automatic)
          return yield* delivery.status(caller.userId)
        })
    ),
  },
}
