import { Schema } from "effect"
import { actionsFor, NoInput } from "../actions/define"
import {
  ClassificationStatusSchema,
  DeliveryStatusSchema,
  DestinationConfigurationSchema,
  DestinationSchema,
  EnrichmentStatusSchema,
  IngestionKindSchema,
  IngestionSchema,
  IngestionStatusSchema,
  SourceIdSchema,
  SourceSchema,
  OwnedPlaylistSchema,
  SpotifyConnectionStatusSchema,
  SpotifyPlaylistSchema,
  SpotifySavedTracksPageSchema,
} from "./schemas"

import {
  CommandAcceptedSchema,
  DeviceIdSchema,
  PlayerStatusSchema,
} from "./player"

const action = actionsFor("music")

const isSpotifyPageCursor = (cursor: string, pathname: string) => {
  try {
    const url = new URL(cursor, "https://api.spotify.com")
    return (
      url.origin === "https://api.spotify.com" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.pathname === pathname &&
      url.searchParams.getAll("offset").length === 1 &&
      url.searchParams.getAll("limit").length <= 1 &&
      [...url.searchParams].every(
        ([key, value]) =>
          (key === "offset" || key === "limit") &&
          /^(0|[1-9]\d*)$/u.test(value) &&
          Number.isSafeInteger(Number(value)) &&
          (key !== "limit" || (Number(value) >= 1 && Number(value) <= 50))
      )
    )
  } catch {
    return false
  }
}

const SavedTracksCursor = Schema.String.check(
  Schema.makeFilter(
    (value: string) =>
      isSpotifyPageCursor(value, "/v1/me/tracks") || "Invalid cursor"
  )
)

const PlaylistTracksInput = Schema.Struct({
  playlistId: Schema.String.check(
    Schema.makeFilter(
      (id: string) => /^[A-Za-z0-9]+$/u.test(id) || "Invalid playlist ID"
    )
  ),
  cursor: Schema.optional(Schema.String),
}).check(
  Schema.makeFilter(
    (input) =>
      input.cursor === undefined ||
      isSpotifyPageCursor(
        input.cursor,
        "/v1/playlists/" + input.playlistId + "/items"
      ) ||
      "Invalid playlist tracks cursor"
  )
)

/**
 * The music control area's operations. Pipeline steps run in the background:
 * a start or retry returns at once with the step's status, and the matching
 * status action reports progress.
 */
export const musicActions = {
  player: {
    status: action({
      description:
        "Reads Spotify Connect devices and observed playback. Playback control requires Spotify Premium and playback permission. An accepted command is not proof of playing; read status to confirm.",
      effect: "read",
      http: { method: "GET", path: "/music/player" },
      input: NoInput,
      output: PlayerStatusSchema,
    }),
    play: action({
      description:
        "Requests exactly one track on the specified Spotify Connect device. Requires Spotify Premium. Accepted does not mean playing; read status to confirm. Does not retry playback.",
      effect: "write",
      http: { method: "PUT", path: "/music/player/play" },
      input: Schema.Struct({
        deviceId: DeviceIdSchema,
        trackId: Schema.NonEmptyString.check(
          Schema.isPattern(/^[A-Za-z0-9]+$/u)
        ),
      }),
      output: CommandAcceptedSchema,
    }),
    pause: action({
      description:
        "Pauses only the currently observed Spotify Connect device. Requires Spotify Premium. Accepted does not mean paused; read status to confirm. Never transfers playback.",
      effect: "write",
      http: { method: "PUT", path: "/music/player/pause" },
      input: Schema.Struct({ deviceId: DeviceIdSchema }),
      output: CommandAcceptedSchema,
    }),
    resume: action({
      description:
        "Resumes only the currently observed Spotify Connect device. Requires Spotify Premium. Accepted does not mean playing; read status to confirm. Never transfers playback.",
      effect: "write",
      http: { method: "PUT", path: "/music/player/resume" },
      input: Schema.Struct({ deviceId: DeviceIdSchema }),
      output: CommandAcceptedSchema,
    }),
  },
  spotify: {
    status: action({
      description:
        "Whether a Spotify account is connected for the music app, needs reconnecting, or is disconnected.",
      effect: "read",
      http: { method: "GET", path: "/music/spotify/status" },
      input: NoInput,
      output: SpotifyConnectionStatusSchema,
    }),
    connect: action({
      description:
        "The URL to open in a browser signed in to tools to connect or reconnect Spotify. Connecting starts a full ingestion.",
      effect: "read",
      http: { method: "GET", path: "/music/spotify/connect" },
      input: NoInput,
      output: Schema.Struct({ url: Schema.String }),
    }),
    disconnect: action({
      description:
        "Disconnects Spotify and deletes its sources, collected tracks, decisions and settings. Shared recording data is kept.",
      effect: "write",
      http: { method: "POST", path: "/music/spotify/disconnect" },
      input: NoInput,
      output: Schema.Struct({ status: Schema.Literal("disconnected") }),
    }),
    playlists: action({
      description: "Lists the connected account's Spotify playlists.",
      effect: "read",
      http: { method: "GET", path: "/music/spotify/playlists" },
      input: NoInput,
      output: Schema.Struct({ items: Schema.Array(SpotifyPlaylistSchema) }),
    }),
    likedTracks: action({
      description:
        "One page of the connected account's Spotify Liked Songs, newest first. Pass the previous page's `next` as `cursor` for the following page.",
      effect: "read",
      http: { method: "GET", path: "/music/spotify/liked-tracks" },
      input: Schema.Struct({ cursor: Schema.optional(SavedTracksCursor) }),
      output: SpotifySavedTracksPageSchema,
    }),
    playlistTracks: action({
      description:
        "One page of tracks in a playlist owned by the connected Spotify account, in playlist order. Pass the previous page's next as cursor. Spotify's total includes unavailable items omitted from the page.",
      effect: "read",
      http: {
        method: "GET",
        path: "/music/spotify/playlists/:playlistId/tracks",
      },
      input: PlaylistTracksInput,
      output: SpotifySavedTracksPageSchema,
    }),
  },
  destinations: {
    get: action({
      description:
        "The destination playlists with their classification descriptions, the review playlist, and whether setup is marked ready.",
      effect: "read",
      http: { method: "GET", path: "/music/destinations" },
      input: NoInput,
      output: DestinationConfigurationSchema,
    }),
    save: action({
      description:
        "Adds or updates a destination: an owned Spotify playlist with the description of the tracks that belong in it (up to 2000 characters, required to enable it). A source cannot also be a destination.",
      effect: "write",
      http: { method: "PUT", path: "/music/destinations/:playlistId" },
      input: Schema.Struct({
        playlistId: Schema.String,
        description: Schema.String,
        enabled: Schema.Boolean,
      }),
      output: Schema.Struct({ destination: DestinationSchema }),
    }),
    create: action({
      description:
        "Creates a private Spotify playlist (name of 1-100 characters) and adds it as a destination, enabled when it has a description.",
      effect: "write",
      http: { method: "POST", path: "/music/destinations" },
      input: Schema.Struct({ name: Schema.String, description: Schema.String }),
      output: Schema.Struct({
        playlist: OwnedPlaylistSchema,
        destination: DestinationSchema,
      }),
    }),
    remove: action({
      description:
        "Removes a destination. The Spotify playlist and its tracks stay.",
      effect: "write",
      http: { method: "DELETE", path: "/music/destinations/:playlistId" },
      input: Schema.Struct({ playlistId: Schema.String }),
      output: Schema.Struct({ status: Schema.Literal("removed") }),
    }),
    setReviewPlaylist: action({
      description:
        "Chooses the playlist that receives tracks with no accepted destination, or none with null. It cannot be a source or an enabled destination.",
      effect: "write",
      http: { method: "PUT", path: "/music/review-playlist" },
      input: Schema.Struct({ playlistId: Schema.NullOr(Schema.String) }),
      output: Schema.Struct({ reviewPlaylistId: Schema.NullOr(Schema.String) }),
    }),
  },
  sources: {
    get: action({
      description:
        "The sources read by the music app, with their enabled state, present and removed track counts, and latest ingestion. Liked Songs is built in and cannot be removed.",
      effect: "read",
      http: { method: "GET", path: "/music/sources" },
      input: NoInput,
      output: Schema.Struct({ sources: Schema.Array(SourceSchema) }),
    }),
    add: action({
      description:
        "Adds an owned Spotify playlist as a source and starts reading it in full. A source cannot also be a destination or the review playlist. The app never changes sources.",
      effect: "write",
      http: { method: "POST", path: "/music/sources" },
      input: Schema.Struct({ playlistId: Schema.String }),
      output: Schema.Struct({ status: Schema.Literal("added") }),
    }),
    setEnabled: action({
      description:
        "Enables or disables a source. Use { kind: 'liked' } for Liked Songs or { kind: 'playlist', playlistId } for a playlist. Enabling starts a full ingestion. Tracks in no enabled source keep their data and decisions but are not delivered.",
      effect: "write",
      http: { method: "PUT", path: "/music/sources/enabled" },
      input: Schema.Struct({
        sourceId: SourceIdSchema,
        enabled: Schema.Boolean,
      }),
      output: Schema.Struct({ enabled: Schema.Boolean }),
    }),
    remove: action({
      description:
        "Removes a playlist source. The Spotify playlist, its tracks, and their recording data and decisions stay. Liked Songs cannot be removed.",
      effect: "write",
      http: { method: "DELETE", path: "/music/sources/:playlistId" },
      input: Schema.Struct({ playlistId: Schema.String }),
      output: Schema.Struct({ status: Schema.Literal("removed") }),
    }),
  },
  ingestion: {
    status: action({
      description:
        "Each source's latest ingestion and the number of collected tracks present in an enabled source or removed from every enabled source.",
      effect: "read",
      http: { method: "GET", path: "/music/ingestion" },
      input: NoInput,
      output: IngestionStatusSchema,
    }),
    start: action({
      description:
        "Starts reading every enabled source in the background. `full` reads every page. `incremental` stops at known likes in Liked Songs and skips playlists whose snapshot has not changed. Returns each source's active ingestion.",
      effect: "write",
      http: { method: "POST", path: "/music/ingestion" },
      input: Schema.Struct({ kind: IngestionKindSchema }),
      output: Schema.Struct({ ingestions: Schema.Array(IngestionSchema) }),
    }),
  },
  enrichment: {
    status: action({
      description:
        "How many collected tracks have MusicBrainz and AcousticBrainz recording data, and how many lookups are pending or unresolved.",
      effect: "read",
      http: { method: "GET", path: "/music/enrichment" },
      input: NoInput,
      output: EnrichmentStatusSchema,
    }),
    retry: action({
      description:
        "Queues new lookups for tracks whose ISRC was not found, ambiguous or failed.",
      effect: "write",
      http: { method: "POST", path: "/music/enrichment/retry" },
      input: NoInput,
      output: EnrichmentStatusSchema,
    }),
  },
  classification: {
    status: action({
      description:
        "Classification progress, whether setup is ready, and the most recent decisions with Clef's probabilities.",
      effect: "read",
      http: { method: "GET", path: "/music/classification" },
      input: NoInput,
      output: ClassificationStatusSchema,
    }),
    setReady: action({
      description:
        "Marks setup ready, which starts classification, or pauses it. Ready needs a review playlist and an enabled destination with a description.",
      effect: "write",
      http: { method: "PUT", path: "/music/classification/ready" },
      input: Schema.Struct({ ready: Schema.Boolean }),
      output: Schema.Struct({ ready: Schema.Boolean }),
    }),
    reclassify: action({
      description:
        "Replaces every decision in the background, e.g. after adding or rewording a destination.",
      effect: "write",
      http: { method: "POST", path: "/music/classification/reclassify" },
      input: NoInput,
      output: ClassificationStatusSchema,
    }),
  },
  delivery: {
    status: action({
      description:
        "How many decided tracks were written to their Spotify playlists, how many are left, and how many Spotify refused.",
      effect: "read",
      http: { method: "GET", path: "/music/delivery" },
      input: NoInput,
      output: DeliveryStatusSchema,
    }),
    start: action({
      description:
        "Writes every decided track not yet in its playlists, in the background, and retries writes Spotify refused before. Only adds tracks.",
      effect: "write",
      http: { method: "POST", path: "/music/delivery/write" },
      input: NoInput,
      output: DeliveryStatusSchema,
    }),
    setAutomatic: action({
      description:
        "Turns automatic delivery after each classification batch on or off. Turning it on starts writing.",
      effect: "write",
      http: { method: "PUT", path: "/music/delivery/automatic" },
      input: Schema.Struct({ automatic: Schema.Boolean }),
      output: DeliveryStatusSchema,
    }),
  },
}
