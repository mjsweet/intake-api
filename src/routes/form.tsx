import { Hono } from "hono";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { intakeRecords } from "../schema";
import { downloadFromR2 } from "../lib/storage";
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
