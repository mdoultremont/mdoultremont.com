import { Data } from "effect"

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
  /** The owner's statement that this setup is complete and classification may run. */
  readonly ready: boolean
}

export interface OwnedPlaylist {
  readonly id: string
  readonly name: string
}

export class DestinationInputError extends Data.TaggedError(
  "DestinationInputError"
)<{ readonly message: string }> {}

export class DestinationConflict extends Data.TaggedError(
  "DestinationConflict"
)<{}> {
  override get message() {
    return "The review playlist cannot also be an active destination"
  }
}

export class DestinationPersistenceError extends Data.TaggedError(
  "DestinationPersistenceError"
)<{ readonly cause: unknown }> {
  override get message() {
    return "Could not save the playlist configuration"
  }
}

/** Ready needs a review playlist and at least one enabled destination with a description. */
export class SetupIncomplete extends Data.TaggedError("SetupIncomplete")<{
  readonly message: string
}> {}

/** The playlist exists but cannot be used: not owned, not found, or rejected by Spotify. */
export class PlaylistNotUsable extends Data.TaggedError("PlaylistNotUsable")<{
  readonly cause: unknown
}> {
  override get message() {
    return "Choose a playlist owned by the connected Spotify account that is still accessible"
  }
}

/** Spotify created the playlist, but saving its destination failed. The owner can attach it manually. */
export class CreatedPlaylistConfigurationError extends Data.TaggedError(
  "CreatedPlaylistConfigurationError"
)<{ readonly playlist: OwnedPlaylist; readonly cause: unknown }> {
  override get message() {
    return `Created Spotify playlist “${this.playlist.name}”, but could not save its destination settings. Attach playlist ${this.playlist.id} to finish setup.`
  }
}
