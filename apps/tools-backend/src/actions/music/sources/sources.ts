import { Clock, Context, Effect, Layer } from "effect"
import {
  SourceStore,
  sourceIdFromStorage,
  SourceConflict,
  SourceInputError,
  type SourcePersistenceError,
  type Source,
  type SourceId,
} from "#backend/actions/music/collection"
import {
  MusicIngestion,
  type IngestionPersistenceError,
} from "#backend/actions/music/ingestion"
import { Spotify, type SpotifyError } from "#backend/modules/spotify"
import type { JobQueueError } from "#backend/modules/job-queue"

export type SourcesError =
  | SourceConflict
  | SourceInputError
  | SourcePersistenceError
  | IngestionPersistenceError
  | JobQueueError
  | SpotifyError

export class Sources extends Context.Service<
  Sources,
  {
    readonly read: (
      ownerId: string
    ) => Effect.Effect<readonly Source[], SourcePersistenceError>
    readonly add: (
      ownerId: string,
      playlistId: string
    ) => Effect.Effect<void, SourcesError>
    readonly setEnabled: (
      ownerId: string,
      source: SourceId,
      enabled: boolean
    ) => Effect.Effect<void, SourcesError>
    readonly remove: (
      ownerId: string,
      playlistId: string
    ) => Effect.Effect<void, SourcePersistenceError | SourceInputError>
  }
>()("server/actions/music/Sources") {
  static readonly layerNoDeps = Layer.effect(
    Sources,
    Effect.gen(function* () {
      const store = yield* SourceStore
      const spotify = yield* Spotify
      const ingestion = yield* MusicIngestion
      const add = Effect.fn("Sources.add")(function* (
        ownerId: string,
        value: string
      ) {
        const playlistId = yield* validPlaylistId(value)
        yield* spotify.playlist(ownerId, playlistId)
        yield* store.add(ownerId, playlistId, yield* Clock.currentTimeMillis)
        yield* ingestion.startSource(
          ownerId,
          { kind: "playlist", playlistId },
          "full"
        )
      })
      const setEnabled = Effect.fn("Sources.setEnabled")(function* (
        ownerId: string,
        source: SourceId,
        enabled: boolean
      ) {
        if (source.kind === "playlist")
          yield* validPlaylistId(source.playlistId)
        if (!(yield* store.get(ownerId, source)))
          return yield* new SourceInputError({
            message: "Choose an existing source",
          })
        if (enabled && source.kind === "playlist")
          yield* spotify.playlist(ownerId, source.playlistId)
        yield* store.setEnabled(
          ownerId,
          source,
          enabled,
          yield* Clock.currentTimeMillis
        )
        if (enabled) yield* ingestion.startSource(ownerId, source, "full")
      })
      const remove = Effect.fn("Sources.remove")(function* (
        ownerId: string,
        value: string
      ) {
        const playlistId = yield* validPlaylistId(value)
        yield* store.remove(ownerId, playlistId, yield* Clock.currentTimeMillis)
      })
      return Sources.of({ read: store.read, add, setEnabled, remove })
    })
  )
  static readonly layer = Sources.layerNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(SourceStore.layer, Spotify.layer, MusicIngestion.layer)
    )
  )
}

function validPlaylistId(value: string) {
  return /^[A-Za-z0-9]{1,64}$/u.test(value) &&
    sourceIdFromStorage(value).kind === "playlist"
    ? Effect.succeed(value)
    : Effect.fail(
        new SourceInputError({
          message: "Choose a valid Spotify playlist source",
        })
      )
}
