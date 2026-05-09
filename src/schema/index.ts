import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const intakeRecords = sqliteTable("intake_records", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  token: text("token", { length: 64 }).unique().notNull(),
  projectName: text("project_name").notNull(),
  workflow: text("workflow", { enum: ["migrate", "newsite"] }).notNull(),
  mode: text("mode", {
    enum: ["full", "prd", "autonomous", "quickstart"],
  }).notNull(),
  status: text("status", {
    enum: ["draft", "sent", "submitted", "imported"],
  })
    .default("draft")
    .notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  submittedAt: text("submitted_at"),
  expiresAt: text("expires_at").notNull(),
  passwordHash: text("password_hash"),
});

export const intakeFiles = sqliteTable("intake_files", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  intakeId: text("intake_id")
    .references(() => intakeRecords.id)
    .notNull(),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  r2Key: text("r2_key").notNull(),
  category: text("category", {
    enum: ["logo", "photo", "document", "video", "other"],
  })
    .default("other")
    .notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type IntakeRecord = typeof intakeRecords.$inferSelect;
export type NewIntakeRecord = typeof intakeRecords.$inferInsert;
export type IntakeFile = typeof intakeFiles.$inferSelect;
export type NewIntakeFile = typeof intakeFiles.$inferInsert;
