import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, gt, sql } from "drizzle-orm";
import { intakeRecords, intakeSubmissions } from "../schema";
import type { IntakeRecord } from "../schema";
import {
  downloadFromR2,
  uploadToR2,
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
import { sendSubmissionNotification } from "../lib/notify";
import { createSubmission, isPlainObject } from "../lib/submissions";
import {
  gateCookieName,
  issueGateValue,
  verifyGateValue,
  GATE_TTL_SECONDS,
} from "../lib/gate";
import type { Env } from "../index";

const form = new Hono<{ Bindings: Env }>();

// Perpetual links live for years; cap client submissions and uploads per
// record per hour so a leaked URL cannot flood D1/R2 or the notification
// inbox. The upload cap is generous — a busy month of wedding galleries stays
// far below it.
const MAX_SUBMISSIONS_PER_HOUR = 20;
const MAX_UPLOADS_PER_HOUR = 100;

function getDb(c: { env: Env }) {
  return drizzle(c.env.DB);
}

// The password gate page only hides the form render. For the mutation routes
// the proof of PIN entry is an HttpOnly HMAC cookie set by /verify.
async function pinGatePassed(
  c: Context<{ Bindings: Env }>,
  record: IntakeRecord
): Promise<boolean> {
  if (!record.passwordHash) return true;
  const cookie = getCookie(c, gateCookieName(record.token));
  return verifyGateValue(
    c.env.INTAKE_API_KEY,
    record.token,
    record.passwordHash,
    cookie
  );
}

async function uploadRateLimited(
  db: ReturnType<typeof getDb>,
  record: IntakeRecord
): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const [recent] = await db
    .select({ count: sql<number>`count(*)` })
    .from(intakeFiles)
    .where(
      and(
        eq(intakeFiles.intakeId, record.id),
        gt(intakeFiles.createdAt, oneHourAgo)
      )
    );
  return Number(recent?.count ?? 0) >= MAX_UPLOADS_PER_HOUR;
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

  if (record.expiresAt < new Date().toISOString()) {
    return c.text("This intake form has expired. Please contact us for a new link.", 410);
  }

  // Perpetual forms never close — the same link renders a fresh form after
  // every submission.
  if (
    record.kind !== "perpetual" &&
    (record.status === "submitted" || record.status === "imported")
  ) {
    return c.redirect(`/${token}/thanks`);
  }

  // If password-protected, show the gate (unless a valid gate cookie from an
  // earlier /verify is presented — lets perpetual-form clients return without
  // re-entering the PIN every visit).
  if (record.passwordHash && !(await pinGatePassed(c, record))) {
    const brand = getBrand(c.req.header("host"));
    return c.html(<PasswordGatePage token={token} brand={brand} />);
  }

  // Mark as sent on first view
  if (record.status === "draft") {
    await db
      .update(intakeRecords)
      .set({ status: "sent", updatedAt: new Date().toISOString() })
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

  if (record.expiresAt < new Date().toISOString()) {
    return c.text("This intake form has expired. Please contact us for a new link.", 410);
  }

  const body = await c.req.parseBody();
  const password = body.password as string;

  const brand = getBrand(c.req.header("host"));

  if (!password || !record.passwordHash) {
    return c.html(<PasswordGatePage token={token} error={true} brand={brand} />);
  }

  // Throttle PIN guessing: the Workers rate-limit binding caps attempts per
  // token+IP (absent in local dev), and failed attempts carry a small delay.
  if (c.env.VERIFY_LIMIT) {
    const ip = c.req.header("cf-connecting-ip") ?? "unknown";
    const { success } = await c.env.VERIFY_LIMIT.limit({
      key: `verify:${token}:${ip}`,
    });
    if (!success) {
      return c.text("Too many PIN attempts. Please wait a minute and try again.", 429);
    }
  }

  const submittedHash = await hashPassword(password);

  if (submittedHash !== record.passwordHash) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return c.html(<PasswordGatePage token={token} error={true} brand={brand} />);
  }

  // Password correct — set the gate cookie so submit/upload routes (and
  // return visits on perpetual forms) can prove the PIN was entered. The
  // lifetime is enforced server-side by the timestamp inside the value;
  // maxAge only tells the browser when to drop it.
  setCookie(
    c,
    gateCookieName(token),
    await issueGateValue(c.env.INTAKE_API_KEY, token, record.passwordHash),
    {
      path: `/${token}`,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      maxAge: GATE_TTL_SECONDS,
    }
  );

  // Mark as sent on first verified view
  if (record.status === "draft") {
    await db
      .update(intakeRecords)
      .set({ status: "sent", updatedAt: new Date().toISOString() })
      .where(eq(intakeRecords.token, token));
  }

  return renderDynamicForm(c, token);
});

// POST /:token/submit - Submit form response (client-facing, no auth required)
form.post("/:token/submit", async (c) => {
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

  if (
    record.kind !== "perpetual" &&
    (record.status === "submitted" || record.status === "imported")
  ) {
    return c.json({ error: "Form already submitted" }, 409);
  }

  if (!(await pinGatePassed(c, record))) {
    return c.json({ error: "PIN verification required" }, 401);
  }

  const body = await c.req.json<{
    submitted_data: Record<string, unknown>;
    partial?: boolean;
  }>();

  if (!isPlainObject(body.submitted_data)) {
    return c.json({ error: "submitted_data must be an object" }, 400);
  }

  // Perpetual forms append a submission per submit; the record stays open.
  if (record.kind === "perpetual") {
    if (body.partial) {
      return c.json({ success: true, status: record.status });
    }

    // Cheap pre-check blocks obvious floods before the R2 write; the cap is
    // then enforced atomically inside createSubmission's INSERT.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const [recent] = await db
      .select({ count: sql<number>`count(*)` })
      .from(intakeSubmissions)
      .where(
        and(
          eq(intakeSubmissions.intakeId, record.id),
          gt(intakeSubmissions.submittedAt, oneHourAgo)
        )
      );

    if (Number(recent?.count ?? 0) >= MAX_SUBMISSIONS_PER_HOUR) {
      return c.json(
        { error: "Too many submissions — please try again later" },
        429
      );
    }

    const submission = await createSubmission(
      db,
      c.env.INTAKE_BUCKET,
      record,
      body.submitted_data,
      { maxPerHour: MAX_SUBMISSIONS_PER_HOUR }
    );

    if (!submission) {
      return c.json(
        { error: "Too many submissions — please try again later" },
        429
      );
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
      submission_number: submission.number,
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

  if (!body.partial) {
    c.executionCtx.waitUntil(
      sendSubmissionNotification(c.env, c.req.header("host"), record, body.submitted_data)
    );
  }

  return c.json({ success: true, status: body.partial ? record.status : "submitted" });
});

// POST /:token/upload - Upload file (client-facing, no auth required)
form.post("/:token/upload", async (c) => {
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

  if (
    record.kind !== "perpetual" &&
    (record.status === "submitted" || record.status === "imported")
  ) {
    return c.json({ error: "Form already submitted" }, 409);
  }

  if (!(await pinGatePassed(c, record))) {
    return c.json({ error: "PIN verification required" }, 401);
  }

  if (await uploadRateLimited(db, record)) {
    return c.json({ error: "Too many uploads — please try again later" }, 429);
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

  if (record.expiresAt < new Date().toISOString()) {
    return c.json({ error: "Intake form has expired" }, 410);
  }

  if (
    record.kind !== "perpetual" &&
    (record.status === "submitted" || record.status === "imported")
  ) {
    return c.json({ error: "Form already submitted" }, 409);
  }

  if (!(await pinGatePassed(c, record))) {
    return c.json({ error: "PIN verification required" }, 401);
  }

  if (await uploadRateLimited(db, record)) {
    return c.json({ error: "Too many uploads — please try again later" }, 429);
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

  if (record.expiresAt < new Date().toISOString()) {
    return c.json({ error: "Intake form has expired" }, 410);
  }

  if (
    record.kind !== "perpetual" &&
    (record.status === "submitted" || record.status === "imported")
  ) {
    return c.json({ error: "Form already submitted" }, 409);
  }

  if (!(await pinGatePassed(c, record))) {
    return c.json({ error: "PIN verification required" }, 401);
  }

  if (await uploadRateLimited(db, record)) {
    return c.json({ error: "Too many uploads — please try again later" }, 429);
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

// GET /:token/files/:fileId - Download file (client-facing, no auth required)
form.get("/:token/files/:fileId", async (c) => {
  const db = getDb(c);
  const token = c.req.param("token");
  const fileId = c.req.param("fileId");

  const [record] = await db
    .select()
    .from(intakeRecords)
    .where(eq(intakeRecords.token, token))
    .limit(1);

  if (!record) {
    return c.text("Not found", 404);
  }

  // PIN-protected records serve their files only to gated sessions — the
  // form's own <img> tags load fine because the gate cookie precedes render.
  if (!(await pinGatePassed(c, record))) {
    return c.text("PIN verification required", 401);
  }

  const [file] = await db
    .select()
    .from(intakeFiles)
    .where(eq(intakeFiles.id, fileId))
    .limit(1);

  if (!file || file.intakeId !== record.id) {
    return c.text("File not found", 404);
  }

  const object = await downloadFromR2(c.env.INTAKE_BUCKET, file.r2Key);
  if (!object) {
    return c.text("File not found in storage", 404);
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `inline; filename="${file.originalName}"`,
      "Content-Length": file.sizeBytes.toString(),
      "Cache-Control": "private, max-age=3600",
    },
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

  return c.html(
    <ThanksPage
      projectName={projectName}
      brand={brand}
      perpetual={record?.kind === "perpetual"}
      token={record?.token}
    />
  );
});

export default form;
