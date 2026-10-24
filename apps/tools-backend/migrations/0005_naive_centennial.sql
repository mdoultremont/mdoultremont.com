CREATE TABLE `music_source_tracks` (
	`owner_id` text NOT NULL,
	`source_id` text NOT NULL,
	`track_id` text NOT NULL,
	`added_at` text NOT NULL,
	`present` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `source_id`, `track_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `spotify_connections`(`owner_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `music_source_tracks_owner_track_idx` ON `music_source_tracks` (`owner_id`,`track_id`);--> statement-breakpoint
CREATE TABLE `music_sources` (
	`owner_id` text NOT NULL,
	`source_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`snapshot_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `source_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `spotify_connections`(`owner_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `music_tracks` (
	`owner_id` text NOT NULL,
	`track_id` text NOT NULL,
	`name` text NOT NULL,
	`artist_names` text NOT NULL,
	`isrc` text,
	`added_at` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `track_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `spotify_connections`(`owner_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `music_tracks_isrc_idx` ON `music_tracks` (`isrc`);--> statement-breakpoint
DROP INDEX `music_ingestions_active_owner_idx`;--> statement-breakpoint
ALTER TABLE `music_ingestions` ADD `source_id` text DEFAULT 'liked' NOT NULL;--> statement-breakpoint
ALTER TABLE `music_ingestions` ADD `snapshot_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `music_ingestions_active_source_idx` ON `music_ingestions` (`owner_id`,`source_id`) WHERE "music_ingestions"."status" IN ('queued', 'running');--> statement-breakpoint
INSERT INTO music_sources (owner_id, source_id, enabled, created_at, updated_at)
SELECT owner_id, 'liked', 1, connected_at, connected_at FROM spotify_connections;
--> statement-breakpoint
DROP TABLE `music_liked_tracks`;--> statement-breakpoint
ALTER TABLE `music_ingestions` RENAME COLUMN `unliked` TO `removed`;
