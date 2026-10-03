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

export const musicBaselineRuns = sqliteTable(
  "music_baseline_runs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => spotifyConnections.ownerId, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    cutoff: text("cutoff").notNull(),
    status: text("status", {
      enum: ["queued", "running", "completed", "failed"],
    }).notNull(),
    cursor: text("cursor"),
    pages: integer("pages").notNull().default(0),
    scanned: integer("scanned").notNull().default(0),
    recorded: integer("recorded").notNull().default(0),
    recent: integer("recent").notNull().default(0),
    total: integer("total"),
    error: text("error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("music_baseline_runs_account_idx").on(
      table.ownerId,
      table.accountId
    ),
    index("music_baseline_runs_status_idx").on(table.status),
  ]
)

export const musicBaselineTracks = sqliteTable(
  "music_baseline_tracks",
  {
    runId: text("run_id")
      .notNull()
      .references(() => musicBaselineRuns.id, { onDelete: "cascade" }),
    spotifyTrackId: text("spotify_track_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.spotifyTrackId] })]
)

export const musicDiscoveryCheckpoints = sqliteTable(
  "music_discovery_checkpoints",
  {
    ownerId: text("owner_id")
      .primaryKey()
      .references(() => spotifyConnections.ownerId, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    cutoff: text("cutoff").notNull(),
    baselineRunId: text("baseline_run_id")
      .notNull()
      .references(() => musicBaselineRuns.id, { onDelete: "cascade" }),
    updatedAt: integer("updated_at").notNull(),
  }
)

export const musicRuns = sqliteTable(
  "music_runs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => spotifyConnections.ownerId, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    mode: text("mode", { enum: ["catchup", "full", "reclassify"] }).notNull(),
    status: text("status", {
      enum: ["queued", "running", "completed", "failed"],
    }).notNull(),
    phase: text("phase", { enum: ["discover", "sync"] }).notNull(),
    cursor: text("cursor"),
    cutoff: text("cutoff").notNull(),
    checkpoint: text("checkpoint").notNull(),
    scanned: integer("scanned").notNull().default(0),
    processed: integer("processed").notNull().default(0),
    delivered: integer("delivered").notNull().default(0),
    error: text("error"),
    leaseToken: text("lease_token"),
    leaseUntil: integer("lease_until").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("music_runs_active_owner_idx")
      .on(table.ownerId)
      .where(sql`${table.status} IN ('queued', 'running')`),
  ]
)
export const musicRunTracks = sqliteTable(
  "music_run_tracks",
  {
    runId: text("run_id")
      .notNull()
      .references(() => musicRuns.id, { onDelete: "cascade" }),
    trackId: text("track_id").notNull(),
    isrc: text("isrc"),
    addedAt: text("added_at").notNull(),
    retryAttempts: integer("retry_attempts").notNull().default(0),
    attempted: integer("attempted", { mode: "boolean" })
      .notNull()
      .default(false),
    completed: integer("completed", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => [primaryKey({ columns: [table.runId, table.trackId] })]
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
