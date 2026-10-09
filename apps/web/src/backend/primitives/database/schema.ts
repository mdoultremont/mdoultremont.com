import { sql } from "drizzle-orm"
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

export const appOwners = sqliteTable("app_owners", {
  githubId: text("github_id").primaryKey(),
  login: text("login").notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  updatedAt: integer("updated_at").notNull(),
})

export const appSessions = sqliteTable(
  "app_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    githubId: text("github_id")
      .notNull()
      .references(() => appOwners.githubId, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [index("app_sessions_expires_at_idx").on(table.expiresAt)]
)

export const spotifyConnections = sqliteTable("spotify_connections", {
  ownerId: text("owner_id")
    .primaryKey()
    .references(() => appOwners.githubId, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  spotifyUserId: text("spotify_user_id").notNull(),
  displayName: text("display_name"),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  scopes: text("scopes").notNull(),
  connectedAt: integer("connected_at").notNull(),
  needsReconnect: integer("needs_reconnect", { mode: "boolean" })
    .notNull()
    .default(false),
})

export const musicDestinations = sqliteTable(
  "music_destinations",
  {
    ownerId: text("owner_id")
      .notNull()
      .references(() => spotifyConnections.ownerId, { onDelete: "cascade" }),
    playlistId: text("playlist_id").notNull(),
    description: text("description").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.playlistId] })]
)

export const musicSettings = sqliteTable("music_settings", {
  ownerId: text("owner_id")
    .primaryKey()
    .references(() => spotifyConnections.ownerId, { onDelete: "cascade" }),
  reviewPlaylistId: text("review_playlist_id"),
  /** The owner's statement that destinations are set up and classification may run. */
  ready: integer("ready", { mode: "boolean" }).notNull().default(false),
  automaticDelivery: integer("automatic_delivery", { mode: "boolean" })
    .notNull()
    .default(false),
  updatedAt: integer("updated_at").notNull(),
})

/** One Spotify Liked Songs entry as last seen by ingestion. Display fields are never classifier input. */
export const musicLikedTracks = sqliteTable(
  "music_liked_tracks",
  {
    ownerId: text("owner_id")
      .notNull()
      .references(() => spotifyConnections.ownerId, { onDelete: "cascade" }),
    trackId: text("track_id").notNull(),
    name: text("name").notNull(),
    artistNames: text("artist_names", { mode: "json" })
      .$type<readonly string[]>()
      .notNull(),
    isrc: text("isrc"),
    likedAt: text("liked_at").notNull(),
    liked: integer("liked", { mode: "boolean" }).notNull().default(true),
    firstSeenAt: integer("first_seen_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.trackId] }),
    index("music_liked_tracks_isrc_idx").on(table.isrc),
  ]
)

export const musicIngestions = sqliteTable(
  "music_ingestions",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => spotifyConnections.ownerId, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["full", "incremental"] }).notNull(),
    status: text("status", {
      enum: ["queued", "running", "completed", "failed"],
    }).notNull(),
    cursor: text("cursor"),
    pages: integer("pages").notNull().default(0),
    seen: integer("seen").notNull().default(0),
    added: integer("added").notNull().default(0),
    unliked: integer("unliked").notNull().default(0),
    total: integer("total"),
    error: text("error"),
    startedAt: integer("started_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    finishedAt: integer("finished_at"),
  },
  (table) => [
    // At most one ingestion in progress per owner.
    uniqueIndex("music_ingestions_active_owner_idx")
      .on(table.ownerId)
      .where(sql`${table.status} IN ('queued', 'running')`),
    index("music_ingestions_owner_started_idx").on(
      table.ownerId,
      table.startedAt
    ),
  ]
)

/**
 * Recording data per ISRC, shared by every liked track with that ISRC so it
 * is fetched once. Only CC0 MusicBrainz core fields and AcousticBrainz
 * analysis are stored.
 */
export const musicRecordings = sqliteTable(
  "music_recordings",
  {
    isrc: text("isrc").primaryKey(),
    status: text("status", {
      enum: ["found", "not_found", "ambiguous", "failed"],
    }).notNull(),
    recordingId: text("recording_id"),
    title: text("title"),
    artistCredit: text("artist_credit"),
    durationMs: integer("duration_ms"),
    acoustic: text("acoustic", { mode: "json" }).$type<{
      readonly bpm: number | null
      readonly danceability: number | null
      readonly mood: Readonly<Record<string, number>>
      readonly genre: Readonly<Record<string, number>>
    }>(),
    error: text("error"),
    fetchedAt: integer("fetched_at").notNull(),
  },
  (table) => [index("music_recordings_status_idx").on(table.status)]
)

/** The latest classification of one liked track. Reclassification replaces it. */
export const musicDecisions = sqliteTable(
  "music_decisions",
  {
    ownerId: text("owner_id")
      .notNull()
      .references(() => spotifyConnections.ownerId, { onDelete: "cascade" }),
    trackId: text("track_id").notNull(),
    /** Destination playlists the track belongs to; empty when it goes to review. */
    destinationIds: text("destination_ids", { mode: "json" })
      .$type<readonly string[]>()
      .notNull(),
    review: integer("review", { mode: "boolean" }).notNull(),
    reason: text("reason", {
      enum: ["classified", "no_recording_data"],
    }).notNull(),
    /** Yes-probability per destination playlist ID, as returned by the classifier. */
    probabilities: text("probabilities", { mode: "json" })
      .$type<Readonly<Record<string, number>>>()
      .notNull(),
    model: text("model"),
    /** Identifies the destinations and threshold the decision was made against. */
    fingerprint: text("fingerprint").notNull(),
    classifiedAt: integer("classified_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.trackId] })]
)
export const musicDeliveries = sqliteTable(
  "music_deliveries",
  {
    ownerId: text("owner_id")
      .notNull()
      .references(() => spotifyConnections.ownerId, { onDelete: "cascade" }),
    trackId: text("track_id").notNull(),
    playlistId: text("playlist_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.trackId, table.playlistId] }),
  ]
)
