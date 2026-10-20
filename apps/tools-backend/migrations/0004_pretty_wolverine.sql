CREATE TABLE `flight_analyses` (
	`flight_id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`object_key` text NOT NULL,
	`preview` text NOT NULL,
	FOREIGN KEY (`flight_id`) REFERENCES `flights`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `flight_titles` (
	`flight_id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	FOREIGN KEY (`flight_id`) REFERENCES `flights`(`id`) ON UPDATE no action ON DELETE cascade
);
