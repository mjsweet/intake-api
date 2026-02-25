CREATE TYPE "public"."file_category" AS ENUM('logo', 'photo', 'document', 'other');--> statement-breakpoint
CREATE TYPE "public"."mode" AS ENUM('full', 'prd', 'autonomous', 'quickstart');--> statement-breakpoint
CREATE TYPE "public"."status" AS ENUM('draft', 'sent', 'submitted', 'imported');--> statement-breakpoint
CREATE TYPE "public"."workflow" AS ENUM('migrate', 'newsite');--> statement-breakpoint
CREATE TABLE "intake_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intake_id" uuid NOT NULL,
	"filename" varchar(255) NOT NULL,
	"original_name" varchar(255) NOT NULL,
	"mime_type" varchar(127) NOT NULL,
	"size_bytes" integer NOT NULL,
	"r2_key" varchar(512) NOT NULL,
	"category" "file_category" DEFAULT 'other' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intake_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" varchar(64) NOT NULL,
	"project_name" varchar(255) NOT NULL,
	"workflow" "workflow" NOT NULL,
	"mode" "mode" NOT NULL,
	"status" "status" DEFAULT 'draft' NOT NULL,
	"scraped_data" jsonb,
	"submitted_data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"submitted_at" timestamp,
	"expires_at" timestamp NOT NULL,
	"password_hash" varchar(128),
	CONSTRAINT "intake_records_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "intake_files" ADD CONSTRAINT "intake_files_intake_id_intake_records_id_fk" FOREIGN KEY ("intake_id") REFERENCES "public"."intake_records"("id") ON DELETE no action ON UPDATE no action;