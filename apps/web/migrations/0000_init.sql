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
CREATE TABLE `music_baseline_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`account_id` text NOT NULL,
	`cutoff` text NOT NULL,
	`status` text NOT NULL,
	`cursor` text,
	`pages` integer DEFAULT 0 NOT NULL,
	`scanned` integer DEFAULT 0 NOT NULL,
	`recorded` integer DEFAULT 0 NOT NULL,
	`recent` integer DEFAULT 0 NOT NULL,
	`total` integer,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `spotify_connections`(`owner_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `music_baseline_runs_account_idx` ON `music_baseline_runs` (`owner_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `music_baseline_runs_status_idx` ON `music_baseline_runs` (`status`);--> statement-breakpoint
CREATE TABLE `music_baseline_tracks` (
	`run_id` text NOT NULL,
	`spotify_track_id` text NOT NULL,
	PRIMARY KEY(`run_id`, `spotify_track_id`),
	FOREIGN KEY (`run_id`) REFERENCES `music_baseline_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `music_decisions` (
	`owner_id` text NOT NULL,
	`track_id` text NOT NULL,
	`decision` text NOT NULL,
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
CREATE TABLE `music_discovery_checkpoints` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`cutoff` text NOT NULL,
	`baseline_run_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `spotify_connections`(`owner_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`baseline_run_id`) REFERENCES `music_baseline_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `music_run_tracks` (
	`run_id` text NOT NULL,
	`track_id` text NOT NULL,
	`isrc` text,
	`added_at` text NOT NULL,
	`retry_attempts` integer DEFAULT 0 NOT NULL,
	`attempted` integer DEFAULT false NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`run_id`, `track_id`),
	FOREIGN KEY (`run_id`) REFERENCES `music_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `music_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`account_id` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`phase` text NOT NULL,
	`cursor` text,
	`cutoff` text NOT NULL,
	`checkpoint` text NOT NULL,
	`scanned` integer DEFAULT 0 NOT NULL,
	`processed` integer DEFAULT 0 NOT NULL,
	`delivered` integer DEFAULT 0 NOT NULL,
	`error` text,
	`lease_token` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `spotify_connections`(`owner_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `music_runs_active_owner_idx` ON `music_runs` (`owner_id`) WHERE "music_runs"."status" IN ('queued', 'running');--> statement-breakpoint
CREATE TABLE `music_settings` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`review_playlist_id` text,
	`automation_enabled` integer DEFAULT false NOT NULL,
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
