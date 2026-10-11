import { sql } from "drizzle-orm"
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`

/**
 * Better Auth's tables (users, sessions, linked sign-in accounts, one-time
 * verification values). Better Auth reads and writes them through its Drizzle
 * adapter; the column set follows `npx auth generate` for Better Auth 1.7.
 */
export const authUsers = sqliteTable("auth_users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .default(false)
    .notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(now)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(now)
    .$onUpdate(() => new Date())
    .notNull(),
})

export const authSessions = sqliteTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(now)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
  },
  (table) => [index("auth_sessions_user_id_idx").on(table.userId)]
)

export const authAccounts = sqliteTable(
  "auth_accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(now)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("auth_accounts_user_id_idx").on(table.userId),
    uniqueIndex("auth_accounts_provider_account_idx").on(
      table.providerId,
      table.accountId
    ),
  ]
)

export const authVerifications = sqliteTable(
  "auth_verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(now)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(now)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("auth_verifications_identifier_idx").on(table.identifier)]
)

export const spotifyConnections = sqliteTable("spotify_connections", {
  ownerId: text("owner_id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
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
      enum: ["classified", "no_recording_data", "classifier_failed"],
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
/**
 * One track written to one playlist. `pending` marks a write whose outcome is
 * unknown (for example a network failure after Spotify committed it); the
 * next delivery checks the playlist before writing again.
 */
export const musicDeliveries = sqliteTable(
  "music_deliveries",
  {
    ownerId: text("owner_id")
      .notNull()
      .references(() => spotifyConnections.ownerId, { onDelete: "cascade" }),
    trackId: text("track_id").notNull(),
    playlistId: text("playlist_id").notNull(),
    /** `refused`: Spotify denied writing to the playlist; skipped until the next Write now. */
    status: text("status", {
      enum: ["pending", "delivered", "refused"],
    }).notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.trackId, table.playlistId] }),
  ]
)
