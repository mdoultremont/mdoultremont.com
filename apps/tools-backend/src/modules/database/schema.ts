import { sql } from "drizzle-orm"
import {
  real,
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
  /** Set when the user is removed: they can no longer sign in. Not Better Auth's. */
  deletedAt: integer("deleted_at"),
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

/**
 * The OAuth provider's tables (`@better-auth/oauth-provider`): clients that
 * act for a user, protected resources, consents, and the opaque access and
 * refresh tokens they hold. Columns follow `npx auth generate` for provider
 * 1.7.10; Better Auth reads and writes them through its Drizzle adapter.
 */
export const oauthClients = sqliteTable(
  "oauth_clients",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().unique(),
    clientSecret: text("client_secret"),
    clientDiscoveryId: text("client_discovery_id"),
    disabled: integer("disabled", { mode: "boolean" }).default(false),
    skipConsent: integer("skip_consent", { mode: "boolean" }),
    enableEndSession: integer("enable_end_session", { mode: "boolean" }),
    subjectType: text("subject_type"),
    scopes: text("scopes", { mode: "json" }),
    clientCredentialsScopes: text("client_credentials_scopes", {
      mode: "json",
    }).default([]),
    userId: text("user_id").references(() => authUsers.id, {
      onDelete: "cascade",
    }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts", { mode: "json" }),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("software_id"),
    softwareVersion: text("software_version"),
    softwareStatement: text("software_statement"),
    redirectUris: text("redirect_uris", { mode: "json" }).notNull(),
    postLogoutRedirectUris: text("post_logout_redirect_uris", { mode: "json" }),
    backchannelLogoutUri: text("backchannel_logout_uri"),
    backchannelLogoutSessionRequired: integer(
      "backchannel_logout_session_required",
      { mode: "boolean" }
    ),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
    applicationType: text("application_type"),
    jwks: text("jwks"),
    jwksUri: text("jwks_uri"),
    grantTypes: text("grant_types", { mode: "json" }),
    responseTypes: text("response_types", { mode: "json" }),
    requirePKCE: integer("require_pkce", { mode: "boolean" }),
    dpopBoundAccessTokens: integer("dpop_bound_access_tokens", {
      mode: "boolean",
    }).default(false),
    referenceId: text("reference_id"),
    metadata: text("metadata", { mode: "json" }),
  },
  (table) => [index("oauth_clients_user_id_idx").on(table.userId)]
)

export const oauthResources = sqliteTable("oauth_resources", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull().unique(),
  name: text("name").notNull(),
  accessTokenTtl: integer("access_token_ttl"),
  refreshTokenTtl: integer("refresh_token_ttl"),
  signingAlgorithm: text("signing_algorithm"),
  signingKeyId: text("signing_key_id"),
  allowedScopes: text("allowed_scopes", { mode: "json" }),
  customClaims: text("custom_claims", { mode: "json" }),
  dpopBoundAccessTokensRequired: integer("dpop_bound_access_tokens_required", {
    mode: "boolean",
  }).default(false),
  disabled: integer("disabled", { mode: "boolean" }).default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
  policyVersion: integer("policy_version").default(1),
  metadata: text("metadata", { mode: "json" }),
})

export const oauthClientResources = sqliteTable(
  "oauth_client_resources",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => oauthResources.identifier, { onDelete: "cascade" }),
    metadata: text("metadata", { mode: "json" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("oauth_client_resources_client_resource_idx").on(
      table.clientId,
      table.resourceId
    ),
    index("oauth_client_resources_client_id_idx").on(table.clientId),
    index("oauth_client_resources_resource_id_idx").on(table.resourceId),
  ]
)

export const oauthRefreshTokens = sqliteTable(
  "oauth_refresh_tokens",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => authSessions.id, {
      onDelete: "set null",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources", { mode: "json" }),
    requestedUserInfoClaims: text("requested_user_info_claims", {
      mode: "json",
    }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    revoked: integer("revoked", { mode: "timestamp_ms" }),
    rotatedAt: integer("rotated_at", { mode: "timestamp_ms" }),
    rotationReplayResponse: text("rotation_replay_response"),
    rotationReplayExpiresAt: integer("rotation_replay_expires_at", {
      mode: "timestamp_ms",
    }),
    authTime: integer("auth_time", { mode: "timestamp_ms" }),
    confirmation: text("confirmation", { mode: "json" }),
    scopes: text("scopes", { mode: "json" }).notNull(),
  },
  (table) => [
    index("oauth_refresh_tokens_client_id_idx").on(table.clientId),
    index("oauth_refresh_tokens_session_id_idx").on(table.sessionId),
    index("oauth_refresh_tokens_user_id_idx").on(table.userId),
    index("oauth_refresh_tokens_authorization_code_id_idx").on(
      table.authorizationCodeId
    ),
  ]
)

export const oauthAccessTokens = sqliteTable(
  "oauth_access_tokens",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => authSessions.id, {
      onDelete: "set null",
    }),
    userId: text("user_id").references(() => authUsers.id, {
      onDelete: "cascade",
    }),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources", { mode: "json" }),
    requestedUserInfoClaims: text("requested_user_info_claims", {
      mode: "json",
    }),
    refreshId: text("refresh_id").references(() => oauthRefreshTokens.id, {
      onDelete: "cascade",
    }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    revoked: integer("revoked", { mode: "timestamp_ms" }),
    confirmation: text("confirmation", { mode: "json" }),
    scopes: text("scopes", { mode: "json" }).notNull(),
  },
  (table) => [
    index("oauth_access_tokens_client_id_idx").on(table.clientId),
    index("oauth_access_tokens_session_id_idx").on(table.sessionId),
    index("oauth_access_tokens_user_id_idx").on(table.userId),
    index("oauth_access_tokens_authorization_code_id_idx").on(
      table.authorizationCodeId
    ),
    index("oauth_access_tokens_refresh_id_idx").on(table.refreshId),
  ]
)

export const oauthConsents = sqliteTable(
  "oauth_consents",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    userId: text("user_id").references(() => authUsers.id, {
      onDelete: "cascade",
    }),
    referenceId: text("reference_id"),
    resources: text("resources", { mode: "json" }),
    requestedUserInfoClaims: text("requested_user_info_claims", {
      mode: "json",
    }),
    scopes: text("scopes", { mode: "json" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("oauth_consents_client_id_idx").on(table.clientId),
    index("oauth_consents_user_id_idx").on(table.userId),
  ]
)

export const oauthClientAssertions = sqliteTable("oauth_client_assertions", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
})

/**
 * Authorization grants that were revoked, by the hashed authorization code
 * every token of the grant carries. Not Better Auth's: the provider deletes a
 * grant's tokens in several statements, so a refresh racing the deletion can
 * leave a live successor. A token whose grant is listed here is refused.
 */
export const oauthRevokedGrants = sqliteTable("oauth_revoked_grants", {
  authorizationCodeId: text("authorization_code_id").primaryKey(),
  revokedAt: integer("revoked_at").notNull(),
})

/**
 * Authorization codes presented at the token endpoint, by hash, with the
 * client and PKCE challenge they were issued for. Not Better Auth's: the
 * provider deletes a code before it stores the code's tokens, so a replay
 * landing in between finds nothing to revoke. Claiming the code here first
 * makes a second redemption detectable, and its grant is listed in
 * `oauthRevokedGrants` even when its tokens do not exist yet.
 */
export const oauthRedeemedCodes = sqliteTable("oauth_redeemed_codes", {
  authorizationCodeId: text("authorization_code_id").primaryKey(),
  clientId: text("client_id").notNull(),
  codeChallenge: text("code_challenge"),
  redeemedAt: integer("redeemed_at").notNull(),
})

/** Which apps each user may use. */
export const appAccess = sqliteTable(
  "app_access",
  {
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    app: text("app").notNull(),
    grantedAt: integer("granted_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.app] }),
    index("app_access_app_idx").on(table.app),
  ]
)

/**
 * Invitations to become a user. Only the token's hash is stored; the token
 * itself is in the emailed link. An accepted invitation keeps its row.
 */
export const invitations = sqliteTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    /** JSON array of app IDs granted on acceptance. */
    apps: text("apps").notNull(),
    invitedBy: text("invited_by").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    acceptedAt: integer("accepted_at"),
    acceptedBy: text("accepted_by").references(() => authUsers.id, {
      onDelete: "set null",
    }),
  },
  (table) => [index("invitations_email_idx").on(table.email)]
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

export const musicSources = sqliteTable(
  "music_sources",
  {
    ownerId: text("owner_id")
      .notNull()
      .references(() => spotifyConnections.ownerId, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    snapshotId: text("snapshot_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.sourceId] })]
)

export const musicTracks = sqliteTable(
  "music_tracks",
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
    addedAt: text("added_at").notNull(),
    firstSeenAt: integer("first_seen_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.trackId] }),
    index("music_tracks_isrc_idx").on(table.isrc),
  ]
)

export const musicSourceTracks = sqliteTable(
  "music_source_tracks",
  {
    ownerId: text("owner_id")
      .notNull()
      .references(() => spotifyConnections.ownerId, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull(),
    trackId: text("track_id").notNull(),
    addedAt: text("added_at").notNull(),
    present: integer("present", { mode: "boolean" }).notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.sourceId, table.trackId] }),
    index("music_source_tracks_owner_track_idx").on(
      table.ownerId,
      table.trackId
    ),
  ]
)

export const musicIngestions = sqliteTable(
  "music_ingestions",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => spotifyConnections.ownerId, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull().default("liked"),
    snapshotId: text("snapshot_id"),
    kind: text("kind", { enum: ["full", "incremental"] }).notNull(),
    status: text("status", {
      enum: ["queued", "running", "completed", "failed"],
    }).notNull(),
    cursor: text("cursor"),
    pages: integer("pages").notNull().default(0),
    seen: integer("seen").notNull().default(0),
    added: integer("added").notNull().default(0),
    removed: integer("removed").notNull().default(0),
    total: integer("total"),
    error: text("error"),
    startedAt: integer("started_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    finishedAt: integer("finished_at"),
  },
  (table) => [
    // Each source can make progress independently.
    uniqueIndex("music_ingestions_active_source_idx")
      .on(table.ownerId, table.sourceId)
      .where(sql`${table.status} IN ('queued', 'running')`),
    index("music_ingestions_owner_started_idx").on(
      table.ownerId,
      table.startedAt
    ),
  ]
)

export const tagSources = ["lastfm", "discogs", "listenbrainz"] as const
export type TagSource = (typeof tagSources)[number]

/** One tag from a provider, with what it describes and its weight in 0..1 relative to that provider's top tag. */
export interface RecordingTag {
  readonly source: TagSource
  readonly scope: "recording" | "release" | "artist"
  readonly name: string
  readonly weight: number
}

const lookupStatus = (name: string) =>
  text(name, { enum: ["found", "not_found", "failed"] })

/**
 * Recording data per ISRC, shared by every liked track with that ISRC so it
 * is fetched once: MusicBrainz core fields, the AcousticBrainz analysis, and
 * tags from Last.fm, Discogs, and ListenBrainz. A `null` tag-source status
 * means that source has not been asked yet.
 */
export const musicRecordings = sqliteTable(
  "music_recordings",
  {
    isrc: text("isrc").primaryKey(),
    status: text("status", {
      enum: ["found", "not_found", "ambiguous", "failed"],
    }).notNull(),
    /** How the recording was matched; `null` rows predate the search fallback and matched by ISRC. */
    match: text("match", { enum: ["isrc", "search"] }),
    recordingId: text("recording_id"),
    title: text("title"),
    artistCredit: text("artist_credit"),
    /** First credited artist, used for artist-level lookups. */
    primaryArtist: text("primary_artist"),
    durationMs: integer("duration_ms"),
    tags: text("tags", { mode: "json" }).$type<readonly RecordingTag[]>(),
    lastfmStatus: lookupStatus("lastfm_status"),
    discogsStatus: lookupStatus("discogs_status"),
    listenbrainzStatus: lookupStatus("listenbrainz_status"),
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

/** Personal paragliding logbook. All dates are UTC epoch milliseconds. */
export const flights = sqliteTable(
  "flights",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    startedAt: integer("started_at").notNull(),
    takeoffAt: integer("takeoff_at").notNull(),
    landingAt: integer("landing_at").notNull(),
    durationS: integer("duration_s").notNull(),
    takeoffLat: real("takeoff_lat"),
    takeoffLon: real("takeoff_lon"),
    takeoffName: text("takeoff_name"),
    landingLat: real("landing_lat"),
    landingLon: real("landing_lon"),
    landingName: text("landing_name"),
    distanceM: real("distance_m").notNull(),
    maxAltM: real("max_alt_m"),
    avgAltM: real("avg_alt_m"),
    maxSpeedMps: real("max_speed_mps").notNull(),
    elevationGainM: real("elevation_gain_m"),
    maxClimbMps: real("max_climb_mps"),
    maxSinkMps: real("max_sink_mps"),
    notes: text("notes"),
    source: text("source", { enum: ["gpx", "igc", "manual"] }).notNull(),
    sourceDetail: text("source_detail"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("flights_user_takeoff_idx").on(table.userId, table.takeoffAt),
  ]
)

export const flightTitles = sqliteTable("flight_titles", {
  flightId: text("flight_id")
    .primaryKey()
    .references(() => flights.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
})
export const flightAnalyses = sqliteTable("flight_analyses", {
  flightId: text("flight_id")
    .primaryKey()
    .references(() => flights.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  objectKey: text("object_key").notNull(),
  preview: text("preview", { mode: "json" })
    .$type<readonly { i: number; x: number; y: number }[]>()
    .notNull(),
})

export const flightEquipmentItems = sqliteTable(
  "equipment",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["wing", "harness", "reserve", "instrument", "other"],
    }).notNull(),
    name: text("name").notNull(),
    notes: text("notes"),
    retired: integer("retired", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("equipment_user_idx").on(table.userId)]
)

export const flightEquipment = sqliteTable(
  "flight_equipment",
  {
    flightId: text("flight_id")
      .notNull()
      .references(() => flights.id, { onDelete: "cascade" }),
    equipmentId: text("equipment_id")
      .notNull()
      .references(() => flightEquipmentItems.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.flightId, table.equipmentId] })]
)

/**
 * Track metadata. The gzipped JSON of compact TrackPoint tuples lives in object
 * storage under `objectKey`; `sizeBytes` and `sha256` describe the uncompressed JSON.
 */
export const flightTracks = sqliteTable("flight_tracks", {
  flightId: text("flight_id")
    .primaryKey()
    .references(() => flights.id, { onDelete: "cascade" }),
  objectKey: text("object_key").notNull(),
  sha256: text("sha256").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  pointCount: integer("point_count").notNull(),
})

/**
 * Original uploaded file metadata. The exact bytes live in object storage under
 * `objectKey`; `sizeBytes` and `sha256` describe them.
 */
export const flightFiles = sqliteTable(
  "flight_files",
  {
    id: text("id").primaryKey(),
    flightId: text("flight_id")
      .notNull()
      .references(() => flights.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    format: text("format", { enum: ["gpx", "igc"] }).notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    objectKey: text("object_key").notNull(),
  },
  (table) => [
    uniqueIndex("flight_files_user_sha256_idx").on(table.userId, table.sha256),
    index("flight_files_flight_idx").on(table.flightId),
  ]
)
