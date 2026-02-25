import { Hono } from "hono";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { intakeRecords, intakeFiles } from "../schema";
import { generateToken } from "../lib/tokens";
import { uploadToR2, downloadFromR2, buildR2Key } from "../lib/storage";
import { authMiddleware } from "../middleware/auth";
import type { Env } from "../index";

const api = new Hono<{ Bindings: Env }>();

// Require bearer token for all API routes
api.use("*", authMiddleware);

function getDb(c: { env: Env }) {
  const sql = neon(c.env.DATABASE_URL);
  return drizzle(sql);
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
    form_definition: Record<string, unknown>;
    password?: string;
  }>();

  if (!body.form_definition) {
    return c.json({ error: "form_definition is required" }, 400);
  }

  const token = generateToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

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

  if (record.expiresAt < new Date()) {
    return c.json({ error: "Intake form has expired" }, 410);
  }

  // Fetch response from R2 if it exists
  let response: Record<string, unknown> | null = null;
  const responseObj = await downloadFromR2(
    c.env.INTAKE_BUCKET,
    `forms/${token}/response.json`
  );
  if (responseObj) {
    const text = await responseObj.text();
    response = JSON.parse(text);
  }

  return c.json({
    id: record.id,
    token: record.token,
    project_name: record.projectName,
    workflow: record.workflow,
    mode: record.mode,
    status: record.status,
    response,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    submitted_at: record.submittedAt,
    expires_at: record.expiresAt,
  });
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

// GET /api/intake/:token/response - Get form response from R2
api.get("/intake/:token/response", async (c) => {
  const token = c.req.param("token");

  const obj = await downloadFromR2(
    c.env.INTAKE_BUCKET,
    `forms/${token}/response.json`
  );
  if (!obj) {
    return c.json({ error: "No response found" }, 404);
  }

  const text = await obj.text();
  return c.json(JSON.parse(text));
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

  if (record.expiresAt < new Date()) {
    return c.json({ error: "Intake form has expired" }, 410);
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
    updatedAt: new Date(),
  };

  if (!body.partial) {
    updateData.status = "submitted";
    updateData.submittedAt = new Date();
  }

  await db
    .update(intakeRecords)
    .set(updateData)
    .where(eq(intakeRecords.token, token));

  return c.json({ success: true, status: body.partial ? record.status : "submitted" });
});

// PATCH /api/intake/:token/status - Update status
api.patch("/intake/:token/status", async (c) => {
  const db = getDb(c);
  const token = c.req.param("token");
  const { status } = await c.req.json<{ status: string }>();

  await db
    .update(intakeRecords)
    .set({ status: status as "draft" | "sent" | "submitted" | "imported", updatedAt: new Date() })
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
      category: category as "logo" | "photo" | "document" | "other",
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

export default api;
