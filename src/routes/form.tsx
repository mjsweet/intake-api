import { Hono } from "hono";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { intakeRecords } from "../schema";
import {
  downloadFromR2,
  buildR2Key,
  generatePresignedUploadUrl,
  isAllowedMimeType,
  MAX_PRESIGN_SIZE,
  PRESIGN_EXPIRES,
} from "../lib/storage";
import { intakeFiles } from "../schema";
import { DynamicFormPage } from "../views/dynamic-form";
import type { FormDefinition } from "../views/dynamic-form";
import { ThanksPage } from "../views/thanks";
import { PasswordGatePage } from "../views/password-gate";
import { getBrand } from "../lib/brands";
import type { Env } from "../index";

const form = new Hono<{ Bindings: Env }>();

function getDb(c: { env: Env }) {
  const sql = neon(c.env.DATABASE_URL);
  return drizzle(sql);
}

async function hashPassword(password: string): Promise<string> {
  const encoded = new TextEncoder().encode(password);
  const buffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Fetch form definition from R2 and render the dynamic form
async function renderDynamicForm(
  c: { html: (content: unknown) => Response; env: Env; req: { header: (name: string) => string | undefined } },
  token: string
) {
  const brand = getBrand(c.req.header("host"));

  const obj = await downloadFromR2(
    c.env.INTAKE_BUCKET,
    `forms/${token}/definition.json`
  );

  if (!obj) {
    return c.html(
      <html lang="en">
        <body>
          <p>No form definition found for this token.</p>
        </body>
      </html>
    );
  }

  const text = await obj.text();
  const definition: FormDefinition = JSON.parse(text);

  return c.html(<DynamicFormPage token={token} definition={definition} brand={brand} />);
}

// GET /:token - Render intake form (or password gate)
form.get("/:token", async (c) => {
  const db = getDb(c);
  const token = c.req.param("token");

  const [record] = await db
    .select()
    .from(intakeRecords)
    .where(eq(intakeRecords.token, token))
    .limit(1);

  if (!record) {
    return c.text("This intake form was not found.", 404);
  }

  if (record.expiresAt < new Date()) {
    return c.text("This intake form has expired. Please contact us for a new link.", 410);
  }

  if (record.status === "submitted" || record.status === "imported") {
    return c.redirect(`/${token}/thanks`);
  }

  // If password-protected, show the gate
  if (record.passwordHash) {
    const brand = getBrand(c.req.header("host"));
    return c.html(<PasswordGatePage token={token} brand={brand} />);
  }

  // Mark as sent on first view
  if (record.status === "draft") {
    await db
      .update(intakeRecords)
      .set({ status: "sent", updatedAt: new Date() })
      .where(eq(intakeRecords.token, token));
  }

  return renderDynamicForm(c, token);
});

// POST /:token/verify - Verify password and render form
form.post("/:token/verify", async (c) => {
  const db = getDb(c);
  const token = c.req.param("token");

  const [record] = await db
    .select()
    .from(intakeRecords)
    .where(eq(intakeRecords.token, token))
    .limit(1);

  if (!record) {
    return c.text("This intake form was not found.", 404);
  }

  if (record.expiresAt < new Date()) {
    return c.text("This intake form has expired. Please contact us for a new link.", 410);
  }

  const body = await c.req.parseBody();
  const password = body.password as string;

  const brand = getBrand(c.req.header("host"));

  if (!password || !record.passwordHash) {
    return c.html(<PasswordGatePage token={token} error={true} brand={brand} />);
  }

  const submittedHash = await hashPassword(password);

  if (submittedHash !== record.passwordHash) {
    return c.html(<PasswordGatePage token={token} error={true} brand={brand} />);
  }

  // Password correct — mark as sent on first verified view
  if (record.status === "draft") {
    await db
      .update(intakeRecords)
      .set({ status: "sent", updatedAt: new Date() })
      .where(eq(intakeRecords.token, token));
  }

  return renderDynamicForm(c, token);
});

// POST /:token/upload/presign - Get presigned URL for direct R2 upload (client-facing)
form.post("/:token/upload/presign", async (c) => {
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

  if (record.status === "submitted" || record.status === "imported") {
    return c.json({ error: "Form already submitted" }, 409);
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

// POST /:token/upload/confirm - Confirm presigned upload completed (client-facing)
form.post("/:token/upload/confirm", async (c) => {
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

  if (record.status === "submitted" || record.status === "imported") {
    return c.json({ error: "Form already submitted" }, 409);
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

// GET /:token/thanks - Confirmation page
form.get("/:token/thanks", async (c) => {
  const db = getDb(c);
  const token = c.req.param("token");

  const [record] = await db
    .select()
    .from(intakeRecords)
    .where(eq(intakeRecords.token, token))
    .limit(1);

  const projectName = record?.projectName ?? "Your Project";
  const brand = getBrand(c.req.header("host"));

  return c.html(<ThanksPage projectName={projectName} brand={brand} />);
});

export default form;
