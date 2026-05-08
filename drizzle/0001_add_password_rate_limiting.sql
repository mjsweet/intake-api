ALTER TABLE "intake_records" ADD COLUMN "password_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "intake_records" ADD COLUMN "locked_until" timestamp;
