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
CREATE TABLE `music_run_tracks` (
	`run_id` text NOT NULL,
	`track_id` text NOT NULL,
	`isrc` text,
	`added_at` text NOT NULL,
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
ALTER TABLE `music_settings` ADD `automation_enabled` integer DEFAULT false NOT NULL;