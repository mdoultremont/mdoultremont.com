CREATE TABLE `spotify_connections` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`display_name` text,
	`encrypted_refresh_token` text NOT NULL,
	`scopes` text NOT NULL,
	`connected_at` integer NOT NULL,
	`needs_reconnect` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `app_owners`(`github_id`) ON UPDATE no action ON DELETE cascade
);
