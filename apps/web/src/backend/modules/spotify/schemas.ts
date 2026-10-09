import { Schema } from "effect"

export const spotifyScopes = [
  "user-library-read",
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
  "playlist-modify-public",
] as const

// Public types returned by the module.

export interface SpotifyPlaylist {
  readonly id: string
  readonly name: string
  readonly public: boolean | null
  readonly collaborative: boolean
  readonly ownerId: string
}

export interface SpotifySavedTrack {
  readonly id: string
  readonly name: string
  readonly artistNames: readonly string[]
  readonly isrc: string | null
  readonly durationMs: number | null
  readonly addedAt: string
}

export interface SpotifyPage<T> {
  readonly items: readonly T[]
  readonly next: string | null
  readonly total: number
}

export type SpotifyConnectionStatus =
  | { readonly status: "disconnected" }
  | {
      readonly status: "reconnect_needed"
      readonly accountId: string
      readonly displayName: string | null
    }
  | {
      readonly status: "connected"
      readonly accountId: string
      readonly displayName: string | null
    }

// Spotify Web API payloads. Only the fields this module reads are declared;
// Schema ignores the rest.

export const TokenResponse = Schema.Struct({
  access_token: Schema.NonEmptyString,
  refresh_token: Schema.optional(Schema.String),
  scope: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Finite),
})

export const Profile = Schema.Struct({
  id: Schema.NonEmptyString,
  account_id: Schema.optional(Schema.NonEmptyString),
  display_name: Schema.optional(Schema.NullOr(Schema.String)),
})

export const Page = Schema.Struct({
  items: Schema.Array(Schema.Unknown),
  next: Schema.NullOr(Schema.String),
  total: Schema.Finite,
})

export const Playlist = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  owner: Schema.Struct({ id: Schema.NonEmptyString }),
  public: Schema.optional(Schema.NullOr(Schema.Boolean)),
  collaborative: Schema.optional(Schema.Boolean),
})

/** A relinked track carries the ID the owner actually saved in `linked_from`. */
export const Track = Schema.Struct({
  id: Schema.optional(Schema.NullOr(Schema.String)),
  type: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  artists: Schema.optional(
    Schema.Array(Schema.Struct({ name: Schema.optional(Schema.String) }))
  ),
  external_ids: Schema.optional(
    Schema.Struct({ isrc: Schema.optional(Schema.String) })
  ),
  duration_ms: Schema.optional(Schema.Unknown),
  linked_from: Schema.optional(
    Schema.NullOr(Schema.Struct({ id: Schema.optional(Schema.Unknown) }))
  ),
})

export const SavedTrackItem = Schema.Struct({
  added_at: Schema.NonEmptyString,
  track: Track,
})

/** Playlist items moved from `track` to `item` in 2026; both are accepted. */
export const PlaylistItem = Schema.Struct({
  item: Schema.optional(Schema.NullOr(Track)),
  track: Schema.optional(Schema.NullOr(Track)),
})

export const LibraryContains = Schema.Tuple([Schema.Boolean])

export const Snapshot = Schema.Struct({ snapshot_id: Schema.NonEmptyString })

export const toPlaylist = (value: typeof Playlist.Type): SpotifyPlaylist => ({
  id: value.id,
  name: value.name,
  ownerId: value.owner.id,
  public: value.public ?? null,
  collaborative: value.collaborative === true,
})
