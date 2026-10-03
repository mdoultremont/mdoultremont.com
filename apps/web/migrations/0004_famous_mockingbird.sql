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
CREATE TABLE `music_discovery_checkpoints` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`cutoff` text NOT NULL,
	`baseline_run_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `spotify_connections`(`owner_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`baseline_run_id`) REFERENCES `music_baseline_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
