CREATE TABLE `app_access` (
	`user_id` text NOT NULL,
	`app` text NOT NULL,
	`granted_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `app`),
	FOREIGN KEY (`user_id`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `app_access_app_idx` ON `app_access` (`app`);--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`apps` text NOT NULL,
	`invited_by` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`accepted_by` text,
	FOREIGN KEY (`invited_by`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accepted_by`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_hash_unique` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invitations_email_idx` ON `invitations` (`email`);--> statement-breakpoint
ALTER TABLE `auth_users` ADD `deleted_at` integer;--> statement-breakpoint
-- Until now only owner accounts could sign in, so every existing user is the owner: give them every app.
INSERT INTO `app_access` (`user_id`, `app`, `granted_at`) SELECT `id`, 'music', cast(unixepoch('subsecond') * 1000 as integer) FROM `auth_users`;--> statement-breakpoint
INSERT INTO `app_access` (`user_id`, `app`, `granted_at`) SELECT `id`, 'backOffice', cast(unixepoch('subsecond') * 1000 as integer) FROM `auth_users`;
