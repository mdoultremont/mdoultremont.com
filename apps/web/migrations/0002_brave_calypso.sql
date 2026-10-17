CREATE TABLE `flight_equipment` (
	`flight_id` text NOT NULL,
	`equipment_id` text NOT NULL,
	PRIMARY KEY(`flight_id`, `equipment_id`),
	FOREIGN KEY (`flight_id`) REFERENCES `flights`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `equipment` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	`retired` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `equipment_user_idx` ON `equipment` (`user_id`);--> statement-breakpoint
CREATE TABLE `flight_files` (
	`id` text PRIMARY KEY NOT NULL,
	`flight_id` text NOT NULL,
	`user_id` text NOT NULL,
	`filename` text NOT NULL,
	`format` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`object_key` text NOT NULL,
	FOREIGN KEY (`flight_id`) REFERENCES `flights`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `flight_files_user_sha256_idx` ON `flight_files` (`user_id`,`sha256`);--> statement-breakpoint
CREATE INDEX `flight_files_flight_idx` ON `flight_files` (`flight_id`);--> statement-breakpoint
CREATE TABLE `flight_tracks` (
	`flight_id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`sha256` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`point_count` integer NOT NULL,
	FOREIGN KEY (`flight_id`) REFERENCES `flights`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `flights` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`takeoff_at` integer NOT NULL,
	`landing_at` integer NOT NULL,
	`duration_s` integer NOT NULL,
	`takeoff_lat` real,
	`takeoff_lon` real,
	`takeoff_name` text,
	`landing_lat` real,
	`landing_lon` real,
	`landing_name` text,
	`distance_m` real NOT NULL,
	`max_alt_m` real,
	`avg_alt_m` real,
	`max_speed_mps` real NOT NULL,
	`elevation_gain_m` real,
	`max_climb_mps` real,
	`max_sink_mps` real,
	`notes` text,
	`source` text NOT NULL,
	`source_detail` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `flights_user_takeoff_idx` ON `flights` (`user_id`,`takeoff_at`);--> statement-breakpoint
-- Existing back-office users administer private apps; invited music-only users
-- must not automatically receive this personal logbook. Removed users stay out.
INSERT OR IGNORE INTO `app_access` (`user_id`, `app`, `granted_at`)
SELECT a.`user_id`, 'flights', cast(unixepoch('subsecond') * 1000 as integer)
FROM `app_access` a JOIN `auth_users` u ON u.`id` = a.`user_id`
WHERE a.`app` = 'backOffice' AND u.`deleted_at` IS NULL;
