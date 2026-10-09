import { Clock, Context, Effect, Layer } from "effect"
import {
  Spotify,
  type SpotifyError,
  type SpotifyPlaylist,
} from "@/backend/modules/spotify"
import {
  CreatedPlaylistConfigurationError,
  type Destination,
  type DestinationConfiguration,
  DestinationConflict,
  DestinationInputError,
  type DestinationPersistenceError,
  type OwnedPlaylist,
  PlaylistNotUsable,
} from "./errors"
import { DestinationStore } from "./store"

/** Every error a Destinations operation can fail with. */
export type DestinationsError =
  | DestinationInputError
  | DestinationConflict
  | DestinationPersistenceError
  | PlaylistNotUsable
  | CreatedPlaylistConfigurationError
  | SpotifyError

/**
 * Destinations: playlists paired with app-owned classification descriptions,
 * plus the review playlist for tracks with no accepted destination.
 */
export class Destinations extends Context.Service<
  Destinations,
  {
    readonly read: (
      ownerId: string
    ) => Effect.Effect<DestinationConfiguration, DestinationPersistenceError>
    readonly save: (input: {
      readonly ownerId: string
      readonly playlistId: string
      readonly description: string
      readonly enabled: boolean
    }) => Effect.Effect<
      Destination,
      | DestinationInputError
      | DestinationConflict
      | DestinationPersistenceError
      | PlaylistNotUsable
      | SpotifyError
    >
    /** Creates a private Spotify playlist, then saves it as a destination. */
    readonly create: (input: {
      readonly ownerId: string
      readonly name: string
      readonly description: string
    }) => Effect.Effect<
      { readonly playlist: OwnedPlaylist; readonly destination: Destination },
      | DestinationInputError
      | CreatedPlaylistConfigurationError
      | PlaylistNotUsable
      | SpotifyError
    >
    readonly setReviewPlaylist: (input: {
      readonly ownerId: string
      readonly playlistId: string | null
    }) => Effect.Effect<
      string | null,
      | DestinationInputError
      | DestinationConflict
      | DestinationPersistenceError
      | PlaylistNotUsable
      | SpotifyError
    >
    readonly remove: (input: {
      readonly ownerId: string
      readonly playlistId: string
    }) => Effect.Effect<
      void,
      DestinationInputError | DestinationPersistenceError
    >
  }
>()("backend/features/Destinations") {
  static readonly layerNoDeps = Layer.effect(
    Destinations,
    Effect.gen(function* () {
      const store = yield* DestinationStore
      const spotify = yield* Spotify

      const read = Effect.fn("Destinations.read")(function* (ownerId: string) {
        return yield* store.read(ownerId)
      })

      const save = Effect.fn("Destinations.save")(function* (input: {
        readonly ownerId: string
        readonly playlistId: string
        readonly description: string
        readonly enabled: boolean
      }) {
        const playlistId = yield* validPlaylistId(input.playlistId)
        const description = yield* validDescription(
          input.description,
          input.enabled
        )
        yield* usable(spotify.playlist(input.ownerId, playlistId))
        const configuration = yield* store.read(input.ownerId)
        if (input.enabled && configuration.reviewPlaylistId === playlistId)
          return yield* new DestinationConflict()
        const existing = configuration.destinations.find(
          (destination) => destination.playlistId === playlistId
        )
        const now = yield* Clock.currentTimeMillis
        const destination: Destination = {
          playlistId,
          description,
          enabled: input.enabled,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        }
        yield* store.save(input.ownerId, destination)
        return destination
      })

      const create = Effect.fn("Destinations.create")(function* (input: {
        readonly ownerId: string
        readonly name: string
        readonly description: string
      }) {
        const name = yield* validName(input.name)
        const description = yield* validDescription(input.description, false)
        const playlist = yield* usable(
          spotify.createPrivatePlaylist(input.ownerId, name)
        )
        const now = yield* Clock.currentTimeMillis
        const destination: Destination = {
          playlistId: playlist.id,
          description,
          // A playlist created without a description stays off until it has one.
          enabled: Boolean(description),
          createdAt: now,
          updatedAt: now,
        }
        yield* store
          .save(input.ownerId, destination)
          .pipe(
            Effect.mapError(
              (cause) =>
                new CreatedPlaylistConfigurationError({ playlist, cause })
            )
          )
        return { playlist, destination }
      })

      const setReviewPlaylist = Effect.fn("Destinations.setReviewPlaylist")(
        function* (input: {
          readonly ownerId: string
          readonly playlistId: string | null
        }) {
          const playlistId =
            input.playlistId === null
              ? null
              : yield* validPlaylistId(input.playlistId)
          if (playlistId !== null)
            yield* usable(spotify.playlist(input.ownerId, playlistId))
          const configuration = yield* store.read(input.ownerId)
          if (
            configuration.destinations.some(
              (destination) =>
                destination.enabled && destination.playlistId === playlistId
            )
          )
            return yield* new DestinationConflict()
          yield* store.setReview(
            input.ownerId,
            playlistId,
            yield* Clock.currentTimeMillis
          )
          return playlistId
        }
      )

      const remove = Effect.fn("Destinations.remove")(function* (input: {
        readonly ownerId: string
        readonly playlistId: string
      }) {
        const playlistId = yield* validPlaylistId(input.playlistId)
        yield* store.remove(input.ownerId, playlistId)
      })

      return Destinations.of({
        read,
        save,
        create,
        setReviewPlaylist,
        remove,
      })
    })
  )

  /** Production layer. Needs `Database` and the Spotify configuration. */
  static readonly layer = Destinations.layerNoDeps.pipe(
    Layer.provide(Layer.mergeAll(DestinationStore.layer, Spotify.layer))
  )
}

const notUsable = (cause: unknown) =>
  Effect.fail(new PlaylistNotUsable({ cause }))

/**
 * Playlist-specific Spotify failures become `PlaylistNotUsable`. Connection
 * problems (not connected, reconnect needed, rate limited, unavailable) stay
 * `SpotifyError` so the caller can say what to fix.
 */
function usable(effect: Effect.Effect<SpotifyPlaylist, SpotifyError>) {
  return effect.pipe(
    Effect.map(({ id, name }): OwnedPlaylist => ({ id, name })),
    Effect.catchReasons("SpotifyError", {
      AccessDenied: notUsable,
      InvalidInput: notUsable,
      InvalidResponse: notUsable,
      Rejected: notUsable,
    })
  )
}

function validPlaylistId(value: string) {
  const id = value.trim()
  return /^[A-Za-z0-9]{1,64}$/u.test(id)
    ? Effect.succeed(id)
    : Effect.fail(
        new DestinationInputError({
          message: "Choose a valid Spotify playlist",
        })
      )
}

function validDescription(value: string, required: boolean) {
  const description = value.trim()
  return (required && !description) || description.length > 2000
    ? Effect.fail(
        new DestinationInputError({
          message:
            "Add a track description of up to 2000 characters before enabling this playlist",
        })
      )
    : Effect.succeed(description)
}

function validName(value: string) {
  const name = value.trim()
  return !name || name.length > 100
    ? Effect.fail(
        new DestinationInputError({
          message: "Enter a playlist name of 1–100 characters",
        })
      )
    : Effect.succeed(name)
}
