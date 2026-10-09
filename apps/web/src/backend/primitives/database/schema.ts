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
  automationEnabled: integer("automation_enabled", { mode: "boolean" })
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

export const musicDecisions = sqliteTable(
  "music_decisions",
  {
    ownerId: text("owner_id")
      .notNull()
      .references(() => spotifyConnections.ownerId, { onDelete: "cascade" }),
    trackId: text("track_id").notNull(),
    decision: text("decision").notNull(),
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
