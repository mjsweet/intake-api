import {
  pgTable,
  uuid,
  varchar,
  pgEnum,
  timestamp,
  integer,
} from "drizzle-orm/pg-core";

export const workflowEnum = pgEnum("workflow", ["migrate", "newsite"]);

export const modeEnum = pgEnum("mode", [
  "full",
  "prd",
  "autonomous",
  "quickstart",
]);

export const statusEnum = pgEnum("status", [
  "draft",
  "sent",
  "submitted",
  "imported",
]);

export const fileCategoryEnum = pgEnum("file_category", [
  "logo",
  "photo",
  "document",
  "other",
]);

export const intakeRecords = pgTable("intake_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  token: varchar("token", { length: 64 }).unique().notNull(),
  projectName: varchar("project_name", { length: 255 }).notNull(),
  workflow: workflowEnum("workflow").notNull(),
  mode: modeEnum("mode").notNull(),
  status: statusEnum("status").default("draft").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  submittedAt: timestamp("submitted_at"),
  expiresAt: timestamp("expires_at").notNull(),
  passwordHash: varchar("password_hash", { length: 128 }),
});

export const intakeFiles = pgTable("intake_files", {
  id: uuid("id").defaultRandom().primaryKey(),
  intakeId: uuid("intake_id")
    .references(() => intakeRecords.id)
    .notNull(),
  filename: varchar("filename", { length: 255 }).notNull(),
  originalName: varchar("original_name", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 127 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  r2Key: varchar("r2_key", { length: 512 }).notNull(),
  category: fileCategoryEnum("category").default("other").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type IntakeRecord = typeof intakeRecords.$inferSelect;
export type NewIntakeRecord = typeof intakeRecords.$inferInsert;
export type IntakeFile = typeof intakeFiles.$inferSelect;
export type NewIntakeFile = typeof intakeFiles.$inferInsert;
