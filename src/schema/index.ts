import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

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
  // single: one submission, then the form closes (classic intake).
  // perpetual: the link stays open; each submit creates an intake_submissions row.
  kind: text("kind", { enum: ["single", "perpetual"] })
    .default("single")
    .notNull(),
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

// One row per submit on a perpetual form. Response payloads live in R2 at
// forms/{token}/submissions/{id}.json; single-kind forms keep using
// forms/{token}/response.json and never write here.
export const intakeSubmissions = sqliteTable(
  "intake_submissions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    intakeId: text("intake_id")
      .references(() => intakeRecords.id)
      .notNull(),
    number: integer("number").notNull(),
    status: text("status", { enum: ["new", "imported"] })
      .default("new")
      .notNull(),
    r2Key: text("r2_key").notNull(),
    submittedAt: text("submitted_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    intakeNumberUnique: uniqueIndex("intake_submissions_intake_number_unique").on(
      table.intakeId,
      table.number
    ),
  })
);

export type IntakeRecord = typeof intakeRecords.$inferSelect;
export type NewIntakeRecord = typeof intakeRecords.$inferInsert;
export type IntakeFile = typeof intakeFiles.$inferSelect;
export type NewIntakeFile = typeof intakeFiles.$inferInsert;
export type IntakeSubmission = typeof intakeSubmissions.$inferSelect;
export type NewIntakeSubmission = typeof intakeSubmissions.$inferInsert;
