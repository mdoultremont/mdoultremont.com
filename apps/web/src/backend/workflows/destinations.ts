import { Context, Effect } from "effect"

export interface Destination {
  readonly playlistId: string
  readonly description: string
  readonly enabled: boolean
  readonly createdAt: number
  readonly updatedAt: number
}

export interface DestinationConfiguration {
  readonly destinations: readonly Destination[]
  readonly reviewPlaylistId: string | null
}

export interface OwnedPlaylist {
  readonly id: string
  readonly name: string
}

export class DestinationInputError extends Error {
  readonly _tag = "DestinationInputError"
  constructor(message: string) {
    super(message)
    this.name = "DestinationInputError"
  }
}

export class DestinationConflict extends Error {
  readonly _tag = "DestinationConflict"
  constructor() {
    super("The review playlist cannot also be an active destination")
    this.name = "DestinationConflict"
  }
}

export class DestinationPersistenceError extends Error {
  readonly _tag = "DestinationPersistenceError"
  constructor(cause: unknown) {
    super("Could not save the playlist configuration", { cause })
    this.name = "DestinationPersistenceError"
  }
}

export class PlaylistAccessError extends Error {
  readonly _tag = "PlaylistAccessError"
  constructor(
    readonly code:
      | "invalid"
      | "not_connected"
      | "reconnect_needed"
      | "rate_limited"
      | "temporary",
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = "PlaylistAccessError"
  }
}

export class CreatedPlaylistConfigurationError extends Error {
  readonly _tag = "CreatedPlaylistConfigurationError"
  constructor(
    readonly playlist: OwnedPlaylist,
    cause: unknown
  ) {
    super(
      `Created Spotify playlist “${playlist.name}”, but could not save its destination settings. Attach playlist ${playlist.id} to finish setup.`,
      { cause }
    )
    this.name = "CreatedPlaylistConfigurationError"
  }
}

export class DestinationStore extends Context.Service<
  DestinationStore,
  {
    readonly read: (
      ownerId: string
    ) => Effect.Effect<DestinationConfiguration, DestinationPersistenceError>
    readonly save: (
      ownerId: string,
      destination: Destination
    ) => Effect.Effect<void, DestinationPersistenceError | DestinationConflict>
    readonly remove: (
      ownerId: string,
      playlistId: string
    ) => Effect.Effect<void, DestinationPersistenceError>
    readonly setReview: (
      ownerId: string,
      playlistId: string | null
    ) => Effect.Effect<void, DestinationPersistenceError | DestinationConflict>
  }
>()("portfolio/DestinationStore") {}

export class OwnedPlaylists extends Context.Service<
  OwnedPlaylists,
  {
    readonly get: (
      ownerId: string,
      playlistId: string
    ) => Effect.Effect<OwnedPlaylist, PlaylistAccessError>
    readonly createPrivate: (
      ownerId: string,
      name: string
    ) => Effect.Effect<OwnedPlaylist, PlaylistAccessError>
  }
>()("portfolio/OwnedPlaylists") {}

export function readDestinations(ownerId: string) {
  return Effect.gen(function* () {
    const store = yield* DestinationStore
    return yield* store.read(ownerId)
  })
}

export function saveDestination(input: {
  readonly ownerId: string
  readonly playlistId: string
  readonly description: string
  readonly enabled: boolean
  readonly now: number
}) {
  return Effect.gen(function* () {
    const playlistId = yield* validate(() => validPlaylistId(input.playlistId))
    const description = yield* validate(() =>
      validDescription(input.description)
    )
    const playlists = yield* OwnedPlaylists
    yield* playlists.get(input.ownerId, playlistId)
    const store = yield* DestinationStore
    const configuration = yield* store.read(input.ownerId)
    if (input.enabled && configuration.reviewPlaylistId === playlistId)
      return yield* Effect.fail(new DestinationConflict())
    const existing = configuration.destinations.find(
      (destination) => destination.playlistId === playlistId
    )
    const destination: Destination = {
      playlistId,
      description,
      enabled: input.enabled,
      createdAt: existing?.createdAt ?? input.now,
      updatedAt: input.now,
    }
    yield* store.save(input.ownerId, destination)
    return destination
  })
}

export function createDestination(input: {
  readonly ownerId: string
  readonly name: string
  readonly description: string
  readonly now: number
}) {
  return Effect.gen(function* () {
    const name = yield* validate(() => validName(input.name))
    const description = yield* validate(() =>
      validDescription(input.description)
    )
    const playlists = yield* OwnedPlaylists
    const playlist = yield* playlists.createPrivate(input.ownerId, name)
    const store = yield* DestinationStore
    const destination: Destination = {
      playlistId: playlist.id,
      description,
      enabled: true,
      createdAt: input.now,
      updatedAt: input.now,
    }
    yield* store
      .save(input.ownerId, destination)
      .pipe(
        Effect.mapError(
          (cause) => new CreatedPlaylistConfigurationError(playlist, cause)
        )
      )
    return { playlist, destination }
  })
}

export function setReviewPlaylist(input: {
  readonly ownerId: string
  readonly playlistId: string | null
}) {
  return Effect.gen(function* () {
    const playlistId =
      input.playlistId === null
        ? null
        : yield* validate(() => validPlaylistId(input.playlistId!))
    if (playlistId !== null) {
      const playlists = yield* OwnedPlaylists
      yield* playlists.get(input.ownerId, playlistId)
    }
    const store = yield* DestinationStore
    const configuration = yield* store.read(input.ownerId)
    if (
      configuration.destinations.some(
        (destination) =>
          destination.enabled && destination.playlistId === playlistId
      )
    )
      return yield* Effect.fail(new DestinationConflict())
    yield* store.setReview(input.ownerId, playlistId)
    return playlistId
  })
}

export function removeDestination(input: {
  readonly ownerId: string
  readonly playlistId: string
}) {
  return Effect.gen(function* () {
    const store = yield* DestinationStore
    const playlistId = yield* validate(() => validPlaylistId(input.playlistId))
    yield* store.remove(input.ownerId, playlistId)
  })
}

function validPlaylistId(value: string) {
  const id = value.trim()
  if (!/^[A-Za-z0-9]{1,64}$/u.test(id))
    throw new DestinationInputError("Choose a valid Spotify playlist")
  return id
}

function validDescription(value: string) {
  const description = value.trim()
  if (!description || description.length > 2000)
    throw new DestinationInputError(
      "Enter a classification description of 1–2000 characters"
    )
  return description
}

function validName(value: string) {
  const name = value.trim()
  if (!name || name.length > 100)
    throw new DestinationInputError("Enter a playlist name of 1–100 characters")
  return name
}

function validate<T>(read: () => T): Effect.Effect<T, DestinationInputError> {
  return Effect.try({
    try: read,
    catch: (cause) =>
      cause instanceof DestinationInputError
        ? cause
        : new DestinationInputError("Invalid playlist configuration"),
  })
}
