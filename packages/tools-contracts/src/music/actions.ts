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
  OwnedPlaylistSchema,
  SpotifyConnectionStatusSchema,
  SpotifyPlaylistSchema,
  SpotifySavedTracksPageSchema,
} from "./schemas"

const action = actionsFor("music")

/** Only Spotify's own next-page links for Liked Songs are accepted as a cursor. */
const isSavedTracksCursor = (value: string) => {
  try {
    const url = new URL(value, "https://api.spotify.com")
    return (
      url.origin === "https://api.spotify.com" &&
      url.pathname === "/v1/me/tracks" &&
      url.searchParams.has("offset") &&
      url.searchParams.size <= 2 &&
      [...url.searchParams.keys()].every(
        (key) => key === "offset" || key === "limit"
      )
    )
  } catch {
    return false
  }
}

const SavedTracksCursor = Schema.String.check(
  Schema.makeFilter((value: string) =>
    isSavedTracksCursor(value) ? true : "Invalid cursor"
  )
)

/**
 * The music control area's operations. Pipeline steps run in the background:
 * a start or retry returns at once with the step's status, and the matching
 * status action reports progress.
 */
export const musicActions = {
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
        "Disconnects Spotify. Liked tracks, decisions and settings are kept.",
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
        "Adds or updates a destination: an owned Spotify playlist with the description of the tracks that belong in it (up to 2000 characters, required to enable it).",
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
        "Chooses the playlist that receives tracks with no accepted destination, or none with null. It cannot be an enabled destination.",
      effect: "write",
      http: { method: "PUT", path: "/music/review-playlist" },
      input: Schema.Struct({ playlistId: Schema.NullOr(Schema.String) }),
      output: Schema.Struct({ reviewPlaylistId: Schema.NullOr(Schema.String) }),
    }),
  },
  ingestion: {
    status: action({
      description:
        "The latest ingestion of Spotify Liked Songs and how many tracks are liked and un-liked.",
      effect: "read",
      http: { method: "GET", path: "/music/ingestion" },
      input: NoInput,
      output: IngestionStatusSchema,
    }),
    start: action({
      description:
        "Starts reading Spotify Liked Songs in the background: `full` reads every like, `incremental` only likes newer than those known. Returns the ingestion already in progress if there is one.",
      effect: "write",
      http: { method: "POST", path: "/music/ingestion" },
      input: Schema.Struct({ kind: IngestionKindSchema }),
      output: IngestionSchema,
    }),
  },
  enrichment: {
    status: action({
      description:
        "How many liked tracks have MusicBrainz and AcousticBrainz recording data, and how many lookups are pending or unresolved.",
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
