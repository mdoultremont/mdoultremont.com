CREATE TABLE `app_owners` (
	`github_id` text PRIMARY KEY NOT NULL,
	`login` text NOT NULL,
	`name` text,
	`avatar_url` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `app_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`github_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`github_id`) REFERENCES `app_owners`(`github_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `app_sessions_expires_at_idx` ON `app_sessions` (`expires_at`);--> statement-breakpoint
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
	FOREIGN KEY (`owner_id`) REFERENCES `app_owners`(`github_id`) ON UPDATE no action ON DELETE cascade
);
