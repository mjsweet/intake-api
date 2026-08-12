CREATE TABLE `intake_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`intake_id` text NOT NULL,
	`number` integer NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`r2_key` text NOT NULL,
	`submitted_at` text NOT NULL,
	FOREIGN KEY (`intake_id`) REFERENCES `intake_records`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `intake_submissions_intake_number_unique` ON `intake_submissions` (`intake_id`,`number`);--> statement-breakpoint
ALTER TABLE `intake_records` ADD `kind` text DEFAULT 'single' NOT NULL;