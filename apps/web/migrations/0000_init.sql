CREATE TABLE `auth_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_accounts_user_id_idx` ON `auth_accounts` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `auth_accounts_provider_account_idx` ON `auth_accounts` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_sessions_token_unique` ON `auth_sessions` (`token`);--> statement-breakpoint
CREATE INDEX `auth_sessions_user_id_idx` ON `auth_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `auth_users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_users_email_unique` ON `auth_users` (`email`);--> statement-breakpoint
CREATE TABLE `auth_verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_verifications_identifier_idx` ON `auth_verifications` (`identifier`);--> statement-breakpoint
CREATE TABLE `music_decisions` (
	`owner_id` text NOT NULL,
	`track_id` text NOT NULL,
	`destination_ids` text NOT NULL,
	`review` integer NOT NULL,
	`reason` text NOT NULL,
	`probabilities` text NOT NULL,
	`model` text,
	`fingerprint` text NOT NULL,
	`classified_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `track_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `spotify_connections`(`owner_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `music_deliveries` (
	`owner_id` text NOT NULL,
	`track_id` text NOT NULL,
	`playlist_id` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `track_id`, `playlist_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `spotify_connections`(`owner_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `music_destinations` (
	`owner_id` text NOT NULL,
	`playlist_id` text NOT NULL,
	`description` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `playlist_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `spotify_connections`(`owner_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `music_ingestions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`cursor` text,
	`pages` integer DEFAULT 0 NOT NULL,
	`seen` integer DEFAULT 0 NOT NULL,
	`added` integer DEFAULT 0 NOT NULL,
	`unliked` integer DEFAULT 0 NOT NULL,
	`total` integer,
	`error` text,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `spotify_connections`(`owner_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `music_ingestions_active_owner_idx` ON `music_ingestions` (`owner_id`) WHERE "music_ingestions"."status" IN ('queued', 'running');--> statement-breakpoint
CREATE INDEX `music_ingestions_owner_started_idx` ON `music_ingestions` (`owner_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `music_liked_tracks` (
	`owner_id` text NOT NULL,
	`track_id` text NOT NULL,
	`name` text NOT NULL,
	`artist_names` text NOT NULL,
	`isrc` text,
	`liked_at` text NOT NULL,
	`liked` integer DEFAULT true NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `track_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `spotify_connections`(`owner_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `music_liked_tracks_isrc_idx` ON `music_liked_tracks` (`isrc`);--> statement-breakpoint
CREATE TABLE `music_recordings` (
	`isrc` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`recording_id` text,
	`title` text,
	`artist_credit` text,
	`duration_ms` integer,
	`acoustic` text,
	`error` text,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `music_recordings_status_idx` ON `music_recordings` (`status`);--> statement-breakpoint
CREATE TABLE `music_settings` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`review_playlist_id` text,
	`ready` integer DEFAULT false NOT NULL,
	`automatic_delivery` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `spotify_connections`(`owner_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `spotify_connections` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`spotify_user_id` text NOT NULL,
	`display_name` text,
	`encrypted_refresh_token` text NOT NULL,
	`scopes` text NOT NULL,
	`connected_at` integer NOT NULL,
	`needs_reconnect` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE cascade
);
