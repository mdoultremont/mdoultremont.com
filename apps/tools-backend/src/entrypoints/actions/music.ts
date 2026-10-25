import { Effect, Layer } from "effect"
import { MusicClassification } from "#backend/actions/music/classification"
import { MusicDelivery } from "#backend/actions/music/delivery"
import { Destinations } from "#backend/actions/music/destinations"
import { DestinationSuggestions } from "#backend/actions/music/suggestions"
import { MusicEnrichment } from "#backend/actions/music/enrichment"
import { MusicIngestion } from "#backend/actions/music/ingestion"
import { Sources } from "#backend/actions/music/sources"
import { MusicPipeline } from "#backend/actions/music/pipeline"
import { Spotify } from "#backend/modules/spotify"
import { catalog } from "@mdoultremont/tools-contracts"
import { bind } from "./bind"

const actions = catalog.music

export const musicHandlers = {
  player: {
    token: bind(actions.player.token, Spotify.layer, (_, caller) =>
      Spotify.use((spotify) => spotify.playbackToken(caller.userId))
    ),
    status: bind(actions.player.status, Spotify.layer, (_, caller) =>
      Spotify.use((spotify) => spotify.playerStatus(caller.userId))
    ),
    play: bind(actions.player.play, Spotify.layer, (input, caller) =>
      Spotify.use((spotify) =>
        spotify.play(caller.userId, input.deviceId, input.trackId)
      ).pipe(Effect.as({ status: "accepted" } as const))
    ),
    pause: bind(actions.player.pause, Spotify.layer, (input, caller) =>
      Spotify.use((spotify) =>
        spotify.pause(caller.userId, input.deviceId)
      ).pipe(Effect.as({ status: "accepted" } as const))
    ),
    resume: bind(actions.player.resume, Spotify.layer, (input, caller) =>
      Spotify.use((spotify) =>
        spotify.resume(caller.userId, input.deviceId)
      ).pipe(Effect.as({ status: "accepted" } as const))
    ),
  },
  spotify: {
    playlistTracks: bind(
      actions.spotify.playlistTracks,
      Spotify.layer,
      (input, caller) =>
        Effect.gen(function* () {
          const spotify = yield* Spotify
          const ownedPlaylist = yield* spotify.playlist(
            caller.userId,
            input.playlistId
          )
          return yield* spotify.playlistTracksPage(
            caller.userId,
            ownedPlaylist.id,
            input.cursor
          )
        })
    ),
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
    suggest: bind(
      actions.destinations.suggest,
      DestinationSuggestions.layer,
      (_, caller) =>
        DestinationSuggestions.use((suggestions) =>
          suggestions.suggest(caller.userId)
        )
    ),
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
  sources: {
    get: bind(actions.sources.get, Sources.layer, (_, caller) =>
      Sources.use((sources) => sources.read(caller.userId)).pipe(
        Effect.map((sources) => ({ sources }))
      )
    ),
    add: bind(actions.sources.add, Sources.layer, (input, caller) =>
      Sources.use((sources) =>
        sources.add(caller.userId, input.playlistId)
      ).pipe(Effect.as({ status: "added" } as const))
    ),
    setEnabled: bind(
      actions.sources.setEnabled,
      Sources.layer,
      (input, caller) =>
        Sources.use((sources) =>
          sources.setEnabled(caller.userId, input.sourceId, input.enabled)
        ).pipe(Effect.as({ enabled: input.enabled }))
    ),
    remove: bind(actions.sources.remove, Sources.layer, (input, caller) =>
      Sources.use((sources) =>
        sources.remove(caller.userId, input.playlistId)
      ).pipe(Effect.as({ status: "removed" } as const))
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
        ).pipe(Effect.map((ingestions) => ({ ingestions })))
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
