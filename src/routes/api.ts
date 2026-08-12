import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, desc, sql } from "drizzle-orm";
import { intakeRecords, intakeFiles, intakeSubmissions } from "../schema";
import { generateToken } from "../lib/tokens";
import {
  createSubmission,
  serialiseSubmission,
  isPlainObject,
  safeJsonParse,
} from "../lib/submissions";
import {
  uploadToR2,
  downloadFromR2,
  deleteManyFromR2,
  buildR2Key,
  generatePresignedUploadUrl,
  isAllowedMimeType,
  MAX_PRESIGN_SIZE,
  PRESIGN_EXPIRES,
} from "../lib/storage";
import { authMiddleware } from "../middleware/auth";
import { sendSubmissionNotification } from "../lib/notify";
import type { Env } from "../index";

const api = new Hono<{ Bindings: Env }>();

// Require bearer token for all API routes
api.use("*", authMiddleware);

function getDb(c: { env: Env }) {
  return drizzle(c.env.DB);
}

// Hash a password with SHA-256 (suitable for form PINs, not user accounts)
async function hashPassword(password: string): Promise<string> {
  const encoded = new TextEncoder().encode(password);
  const buffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// POST /api/intake - Create intake record with form definition
api.post("/intake", async (c) => {
  const db = getDb(c);
  const body = await c.req.json<{
    project_name: string;
    workflow: "migrate" | "newsite";
    mode?: "full" | "prd" | "autonomous" | "quickstart";
    kind?: "single" | "perpetual";
    expires_in_days?: number;
    form_definition: Record<string, unknown>;
    password?: string;
  }>();

  if (!body.form_definition) {
    return c.json({ error: "form_definition is required" }, 400);
  }

  const kind = body.kind ?? "single";
  if (kind !== "single" && kind !== "perpetual") {
    return c.json({ error: "kind must be 'single' or 'perpetual'" }, 400);
  }

  const token = generateToken();
  // Perpetual links are meant to be bookmarked and reused, so they get a
  // 10-year window by default; single forms keep the 30-day default. The cap
  // keeps the Date arithmetic inside the representable range.
  const expiresInDays = body.expires_in_days ?? (kind === "perpetual" ? 3650 : 30);
  if (
    !Number.isInteger(expiresInDays) ||
    expiresInDays < 1 ||
    expiresInDays > 36500
  ) {
    return c.json(
      { error: "expires_in_days must be an integer between 1 and 36500" },
      400
    );
  }
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + expiresInDays);
  const expiresAt = expiry.toISOString();

  const passwordHash = body.password
    ? await hashPassword(body.password)
    : null;

  const [record] = await db
    .insert(intakeRecords)
    .values({
      token,
      projectName: body.project_name,
      workflow: body.workflow,
      mode: body.mode ?? "full",
      kind,
      status: "draft",
      expiresAt,
      passwordHash,
    })
    .returning();

  // Upload form definition to R2
  const definitionKey = `forms/${token}/definition.json`;
  const definitionBytes = new TextEncoder().encode(
    JSON.stringify(body.form_definition)
  );
  await uploadToR2(
    c.env.INTAKE_BUCKET,
    definitionKey,
    definitionBytes.buffer,
    "application/json"
  );

  return c.json({
    id: record.id,
    token: record.token,
    url: `https://intake.platform21.com.au/${record.token}`,
    expires_at: record.expiresAt,
  });
});

// GET /api/intake/:token - Get intake metadata + response (if submitted)
api.get("/intake/:token", async (c) => {
  const db = getDb(c);
  const token = c.req.param("token");

  const [record] = await db
    .select()
    .from(intakeRecords)
    .where(eq(intakeRecords.token, token))
    .limit(1);

  if (!record) {
    return c.json({ error: "Not found" }, 404);
  }

  if (record.expiresAt < new Date().toISOString()) {
    return c.json({ error: "Intake form has expired" }, 410);
  }

  // Fetch response from R2 if it exists. For perpetual forms the "response"
  // is the latest submission; use the submissions endpoints for the full set.
  let response: Record<string, unknown> | null = null;
  let submissionSummary: Record<string, unknown> = {};

  if (record.kind === "perpetual") {
    const [latest] = await db
      .select()
      .from(intakeSubmissions)
      .where(eq(intakeSubmissions.intakeId, record.id))
      .orderBy(desc(intakeSubmissions.number))
      .limit(1);

    if (latest) {
      const obj = await downloadFromR2(c.env.INTAKE_BUCKET, latest.r2Key);
      if (obj) {
        response = safeJsonParse(await obj.text());
      }
    }

    const [counts] = await db
      .select({
        total: sql<number>`count(*)`,
        fresh: sql<number>`sum(case when status = 'new' then 1 else 0 end)`,
      })
      .from(intakeSubmissions)
      .where(eq(intakeSubmissions.intakeId, record.id));

    submissionSummary = {
      submission_count: Number(counts?.total ?? 0),
      new_submission_count: Number(counts?.fresh ?? 0),
      last_submitted_at: latest?.submittedAt ?? null,
    };
  } else {
    const responseObj = await downloadFromR2(
      c.env.INTAKE_BUCKET,
      `forms/${token}/response.json`
    );
    if (responseObj) {
      const text = await responseObj.text();
      response = safeJsonParse(text);
    }
  }

  return c.json({
    id: record.id,
    token: record.token,
    project_name: record.projectName,
    workflow: record.workflow,
    mode: record.mode,
    kind: record.kind,
    status: record.status,
    response,
    ...submissionSummary,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    submitted_at: record.submittedAt,
    expires_at: record.expiresAt,
  });
});

// GET /api/intake/:token/submissions - List submissions (perpetual forms)
// Optional ?status=new|imported filter.
api.get("/intake/:token/submissions", async (c) => {
  const db = getDb(c);
  const token = c.req.param("token");
  const statusFilter = c.req.query("status");

  if (statusFilter && statusFilter !== "new" && statusFilter !== "imported") {
    return c.json({ error: "status filter must be 'new' or 'imported'" }, 400);
  }

  const [record] = await db
    .select()
    .from(intakeRecords)
    .where(eq(intakeRecords.token, token))
    .limit(1);

  if (!record) {
    return c.json({ error: "Not found" }, 404);
  }

  const where = statusFilter
    ? and(
        eq(intakeSubmissions.intakeId, record.id),
        eq(intakeSubmissions.status, statusFilter as "new" | "imported")
      )
    : eq(intakeSubmissions.intakeId, record.id);

  const rawLimit = c.req.query("limit");
  const requestedLimit = rawLimit ? Number(rawLimit) : NaN;
  const limit =
    Number.isInteger(requestedLimit) && requestedLimit >= 1
      ? Math.min(requestedLimit, 500)
      : 100;

  const submissions = await db
    .select()
    .from(intakeSubmissions)
    .where(where)
    .orderBy(desc(intakeSubmissions.number))
    .limit(limit);

  return c.json(submissions.map(serialiseSubmission));
});

// GET /api/intake/:token/submissions/:submissionId - Metadata + submitted data
api.get("/intake/:token/submissions/:submissionId", async (c) => {
  const db = getDb(c);
  const token = c.req.param("token");
  const submissionId = c.req.param("submissionId");

  const [record] = await db
    .select()
    .from(intakeRecords)
    .where(eq(intakeRecords.token, token))
    .limit(1);

  if (!record) {
    return c.json({ error: "Not found" }, 404);
  }

  const [submission] = await db
    .select()
    .from(intakeSubmissions)
    .where(eq(intakeSubmissions.id, submissionId))
    .limit(1);

  if (!submission || submission.intakeId !== record.id) {
    return c.json({ error: "Submission not found" }, 404);
  }

  let data: Record<string, unknown> | null = null;
  const obj = await downloadFromR2(c.env.INTAKE_BUCKET, submission.r2Key);
  if (obj) {
    data = safeJsonParse(await obj.text());
  }

  return c.json({ ...serialiseSubmission(submission), data });
});

// PATCH /api/intake/:token/submissions/:submissionId/status - Mark processed
api.patch("/intake/:token/submissions/:submissionId/status", async (c) => {
  const db = getDb(c);
  const token = c.req.param("token");
  const submissionId = c.req.param("submissionId");
  const { status } = await c.req.json<{ status: string }>();

  if (status !== "new" && status !== "imported") {
    return c.json({ error: "status must be 'new' or 'imported'" }, 400);
  }

  const [record] = await db
    .select()
    .from(intakeRecords)
    .where(eq(intakeRecords.token, token))
    .limit(1);

  if (!record) {
    return c.json({ error: "Not found" }, 404);
  }

  const [submission] = await db
    .select()
    .from(intakeSubmissions)
    .where(eq(intakeSubmissions.id, submissionId))
    .limit(1);

  if (!submission || submission.intakeId !== record.id) {
    return c.json({ error: "Submission not found" }, 404);
  }

  await db
    .update(intakeSubmissions)
    .set({ status })
    .where(eq(intakeSubmissions.id, submissionId));

  return c.json({ success: true, status });
});

// GET /api/intake/:token/definition - Get form definition from R2
api.get("/intake/:token/definition", async (c) => {
  const token = c.req.param("token");

  const obj = await downloadFromR2(
    c.env.INTAKE_BUCKET,
    `forms/${token}/definition.json`
  );
  if (!obj) {
    return c.json({ error: "No form definition found" }, 404);
  }

  const text = await obj.text();
  return c.json(JSON.parse(text));
});

// GET /api/intake/:token/response - Get form response from R2.
// For perpetual forms this returns the latest submission's data, so agents
// using the classic response endpoint still see something sensible.
api.get("/intake/:token/response", async (c) => {
  const db = getDb(c);
  const token = c.req.param("token");

  const [record] = await db
    .select()
    .from(intakeRecords)
    .where(eq(intakeRecords.token, token))
    .limit(1);

  if (record?.kind === "perpetual") {
    const [latest] = await db
      .select()
      .from(intakeSubmissions)
      .where(eq(intakeSubmissions.intakeId, record.id))
      .orderBy(desc(intakeSubmissions.number))
      .limit(1);

    if (!latest) {
      return c.json({ error: "No response found" }, 404);
    }

    const obj = await downloadFromR2(c.env.INTAKE_BUCKET, latest.r2Key);
    if (!obj) {
      return c.json({ error: "No response found" }, 404);
    }
    return c.json(safeJsonParse(await obj.text()) ?? {});
  }

  const obj = await downloadFromR2(
    c.env.INTAKE_BUCKET,
    `forms/${token}/response.json`
  );
  if (!obj) {
    return c.json({ error: "No response found" }, 404);
  }

  const text = await obj.text();
  return c.json(safeJsonParse(text) ?? {});
});

// PUT /api/intake/:token - Submit/update form response (stored in R2)
api.put("/intake/:token", async (c) => {
  const db = getDb(c);
  const token = c.req.param("token");
  const body = await c.req.json<{
    submitted_data: Record<string, unknown>;
    partial?: boolean;
  }>();

  const [record] = await db
    .select()
    .from(intakeRecords)
    .where(eq(intakeRecords.token, token))
    .limit(1);

  if (!record) {
    return c.json({ error: "Not found" }, 404);
  }

  if (record.expiresAt < new Date().toISOString()) {
    return c.json({ error: "Intake form has expired" }, 410);
  }

  if (!isPlainObject(body.submitted_data)) {
    return c.json({ error: "submitted_data must be an object" }, 400);
  }

  // Perpetual forms append a submission per PUT instead of overwriting a
  // single response; drafts live in the browser, so partial saves are not
  // supported for them.
  if (record.kind === "perpetual") {
    if (body.partial) {
      return c.json(
        { error: "Partial saves are not supported for perpetual forms" },
        400
      );
    }

    const submission = await createSubmission(
      db,
      c.env.INTAKE_BUCKET,
      record,
      body.submitted_data
    );

    if (!submission) {
      return c.json({ error: "Failed to store submission" }, 500);
    }

    await db
      .update(intakeRecords)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(intakeRecords.token, token));

    c.executionCtx.waitUntil(
      sendSubmissionNotification(
        c.env,
        c.req.header("host"),
        record,
        body.submitted_data,
        submission.number
      )
    );

    return c.json({
      success: true,
      status: record.status,
      submission: serialiseSubmission(submission),
    });
  }

  // Store response in R2
  const responseKey = `forms/${token}/response.json`;
  const responseBytes = new TextEncoder().encode(
    JSON.stringify(body.submitted_data)
  );
  await uploadToR2(
    c.env.INTAKE_BUCKET,
    responseKey,
    responseBytes.buffer,
    "application/json"
  );

  // Update NEON metadata
  const updateData: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };

  if (!body.partial) {
    updateData.status = "submitted";
    updateData.submittedAt = new Date().toISOString();
  }

  await db
    .update(intakeRecords)
    .set(updateData)
    .where(eq(intakeRecords.token, token));

  if (!body.partial && record.status !== "submitted" && record.status !== "imported") {
    c.executionCtx.waitUntil(
      sendSubmissionNotification(c.env, c.req.header("host"), record, body.submitted_data)
    );
  }

  return c.json({ success: true, status: body.partial ? record.status : "submitted" });
});

// PATCH /api/intake/:token/status - Update status
api.patch("/intake/:token/status", async (c) => {
  const db = getDb(c);
  const token = c.req.param("token");
  const { status } = await c.req.json<{ status: string }>();

  await db
    .update(intakeRecords)
    .set({ status: status as "draft" | "sent" | "submitted" | "imported", updatedAt: new Date().toISOString() })
    .where(eq(intakeRecords.token, token));

  return c.json({ success: true });
});

// POST /api/intake/:token/upload - Upload file to R2
api.post("/intake/:token/upload", async (c) => {
  const db = getDb(c);
  const token = c.req.param("token");

  const [record] = await db
    .select()
    .from(intakeRecords)
    .where(eq(intakeRecords.token, token))
    .limit(1);

  if (!record) {
    return c.json({ error: "Not found" }, 404);
  }

  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  const category = (formData.get("category") as string) || "other";

  if (!file) {
    return c.json({ error: "No file provided" }, 400);
  }

  if (file.size > 10 * 1024 * 1024) {
    return c.json({ error: "File exceeds 10 MB limit" }, 413);
  }

  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filename = `${timestamp}-${safeName}`;
  const r2Key = buildR2Key(token, filename, category);

  await uploadToR2(c.env.INTAKE_BUCKET, r2Key, await file.arrayBuffer(), file.type);

  const [fileRecord] = await db
    .insert(intakeFiles)
    .values({
      intakeId: record.id,
      filename,
      originalName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      r2Key,
      category: category as "logo" | "photo" | "document" | "video" | "other",
    })
    .returning();

  return c.json({
    id: fileRecord.id,
    filename: fileRecord.originalName,
    category: fileRecord.category,
    size_bytes: fileRecord.sizeBytes,
  });
});

// GET /api/intake/:token/files - List uploaded files
api.get("/intake/:token/files", async (c) => {
  const db = getDb(c);
  const token = c.req.param("token");

  const [record] = await db
    .select()
    .from(intakeRecords)
    .where(eq(intakeRecords.token, token))
    .limit(1);

  if (!record) {
    return c.json({ error: "Not found" }, 404);
  }

  const files = await db
    .select()
    .from(intakeFiles)
    .where(eq(intakeFiles.intakeId, record.id));

  return c.json(
    files.map((f) => ({
      id: f.id,
      filename: f.originalName,
      mime_type: f.mimeType,
      size_bytes: f.sizeBytes,
      category: f.category,
      created_at: f.createdAt,
    }))
  );
});

// GET /api/intake/:token/files/:fileId - Download file from R2
api.get("/intake/:token/files/:fileId", async (c) => {
  const db = getDb(c);
  const fileId = c.req.param("fileId");

  const [file] = await db
    .select()
    .from(intakeFiles)
    .where(eq(intakeFiles.id, fileId))
    .limit(1);

  if (!file) {
    return c.json({ error: "File not found" }, 404);
  }

  const object = await downloadFromR2(c.env.INTAKE_BUCKET, file.r2Key);
  if (!object) {
    return c.json({ error: "File not found in storage" }, 404);
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `attachment; filename="${file.originalName}"`,
      "Content-Length": file.sizeBytes.toString(),
    },
  });
});

// POST /api/intake/:token/upload/presign - Get presigned URL for direct R2 upload
api.post("/intake/:token/upload/presign", async (c) => {
  const db = getDb(c);
  const token = c.req.param("token");

  const [record] = await db
    .select()
    .from(intakeRecords)
    .where(eq(intakeRecords.token, token))
    .limit(1);

  if (!record) {
    return c.json({ error: "Not found" }, 404);
  }

  const body = await c.req.json<{
    filename: string;
    content_type: string;
    size_bytes: number;
    category?: string;
  }>();

  if (!body.filename || !body.content_type || !body.size_bytes) {
    return c.json({ error: "filename, content_type, and size_bytes are required" }, 400);
  }

  if (body.size_bytes > MAX_PRESIGN_SIZE) {
    return c.json({ error: "File exceeds 500 MB limit" }, 413);
  }

  if (!isAllowedMimeType(body.content_type)) {
    return c.json({ error: "File type not allowed" }, 415);
  }

  const category = body.category || "other";
  const timestamp = Date.now();
  const safeName = body.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filename = `${timestamp}-${safeName}`;
  const r2Key = buildR2Key(token, filename, category);

  const uploadUrl = await generatePresignedUploadUrl(
    c.env.R2_ACCESS_KEY_ID,
    c.env.R2_SECRET_ACCESS_KEY,
    c.env.CF_ACCOUNT_ID,
    "intake-uploads",
    r2Key,
    body.content_type
  );

  return c.json({
    upload_url: uploadUrl,
    r2_key: r2Key,
    filename,
    expires_in: PRESIGN_EXPIRES,
  });
});

// POST /api/intake/:token/upload/confirm - Confirm presigned upload completed
api.post("/intake/:token/upload/confirm", async (c) => {
  const db = getDb(c);
  const token = c.req.param("token");

  const [record] = await db
    .select()
    .from(intakeRecords)
    .where(eq(intakeRecords.token, token))
    .limit(1);

  if (!record) {
    return c.json({ error: "Not found" }, 404);
  }

  const body = await c.req.json<{
    r2_key: string;
    filename: string;
    original_name: string;
    content_type: string;
    size_bytes: number;
    category?: string;
  }>();

  if (!body.r2_key || !body.filename || !body.original_name || !body.content_type || !body.size_bytes) {
    return c.json({ error: "r2_key, filename, original_name, content_type, and size_bytes are required" }, 400);
  }

  // Verify object exists in R2
  const head = await c.env.INTAKE_BUCKET.head(body.r2_key);
  if (!head) {
    return c.json({ error: "Object not found in storage — upload may not have completed" }, 404);
  }

  const category = (body.category || "other") as "logo" | "photo" | "document" | "video" | "other";

  const [fileRecord] = await db
    .insert(intakeFiles)
    .values({
      intakeId: record.id,
      filename: body.filename,
      originalName: body.original_name,
      mimeType: body.content_type,
      sizeBytes: body.size_bytes,
      r2Key: body.r2_key,
      category,
    })
    .returning();

  return c.json({
    id: fileRecord.id,
    filename: fileRecord.originalName,
    category: fileRecord.category,
    size_bytes: fileRecord.sizeBytes,
  });
});

// DELETE /api/intake/:token - Delete intake record, files, and R2 objects
api.delete("/intake/:token", async (c) => {
  const db = getDb(c);
  const token = c.req.param("token");

  const [record] = await db
    .select()
    .from(intakeRecords)
    .where(eq(intakeRecords.token, token))
    .limit(1);

  if (!record) {
    return c.json({ error: "Not found" }, 404);
  }

  const files = await db
    .select()
    .from(intakeFiles)
    .where(eq(intakeFiles.intakeId, record.id));

  const submissions = await db
    .select()
    .from(intakeSubmissions)
    .where(eq(intakeSubmissions.intakeId, record.id));

  // Batched R2 deletes (1000 keys per call) keep even long-lived perpetual
  // forms well inside the Workers subrequest limit.
  await deleteManyFromR2(c.env.INTAKE_BUCKET, [
    ...files.map((f) => f.r2Key),
    ...submissions.map((s) => s.r2Key),
    `forms/${token}/definition.json`,
    `forms/${token}/response.json`,
  ]);

  if (files.length > 0) {
    await db.delete(intakeFiles).where(eq(intakeFiles.intakeId, record.id));
  }

  if (submissions.length > 0) {
    await db
      .delete(intakeSubmissions)
      .where(eq(intakeSubmissions.intakeId, record.id));
  }

  // Delete the record
  await db.delete(intakeRecords).where(eq(intakeRecords.token, token));

  return c.json({
    success: true,
    deleted: { record: 1, files: files.length, submissions: submissions.length },
  });
});

export default api;
