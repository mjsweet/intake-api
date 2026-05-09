CREATE TABLE `intake_files` (
	`id` text PRIMARY KEY NOT NULL,
	`intake_id` text NOT NULL,
	`filename` text NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`r2_key` text NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`intake_id`) REFERENCES `intake_records`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `intake_records` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text(64) NOT NULL,
	`project_name` text NOT NULL,
	`workflow` text NOT NULL,
	`mode` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`submitted_at` text,
	`expires_at` text NOT NULL,
	`password_hash` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `intake_records_token_unique` ON `intake_records` (`token`);