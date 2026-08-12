/**
 * Submission storage for perpetual forms.
 *
 * A single-kind record stores one response at forms/{token}/response.json and
 * closes. A perpetual record stays open: every submit appends an
 * intake_submissions row with its own R2 payload, so nothing is overwritten
 * and each request can be processed (imported) independently.
 */
import { sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { intakeSubmissions } from "../schema";
import type { IntakeRecord, IntakeSubmission } from "../schema";
import { uploadToR2 } from "./storage";

export function submissionR2Key(token: string, submissionId: string): string {
  return `forms/${token}/submissions/${submissionId}.json`;
}

export function isPlainObject(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Append a submission. With opts.maxPerHour set (client-facing routes), the
 * hourly cap is enforced inside the INSERT itself — the count and the insert
 * happen in one statement on SQLite's single writer, so a concurrent burst
 * cannot overshoot the cap the way a separate check-then-insert would.
 * Returns null when the cap blocks the insert (the pre-written R2 object is
 * left unreferenced, which is harmless).
 */
export async function createSubmission(
  db: DrizzleD1Database,
  bucket: R2Bucket,
  record: IntakeRecord,
  data: Record<string, unknown>,
  opts: { maxPerHour?: number } = {}
): Promise<IntakeSubmission | null> {
  const id = crypto.randomUUID();
  const r2Key = submissionR2Key(record.token, id);

  // R2 first: a failed insert leaves an unreferenced object, but the reverse
  // order would leave a row whose payload never landed.
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  await uploadToR2(bucket, r2Key, bytes.buffer as ArrayBuffer, "application/json");

  // The number is computed inside the INSERT so concurrent submits serialise
  // on SQLite's single writer instead of racing a read-then-insert; the unique
  // index on (intake_id, number) backstops it.
  if (opts.maxPerHour) {
    const submittedAt = new Date().toISOString();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const rows = (await db.all(sql`
      INSERT INTO intake_submissions (id, intake_id, number, status, r2_key, submitted_at)
      SELECT ${id}, ${record.id},
             (SELECT COALESCE(MAX(number), 0) + 1 FROM intake_submissions WHERE intake_id = ${record.id}),
             'new', ${r2Key}, ${submittedAt}
      WHERE (SELECT COUNT(*) FROM intake_submissions
             WHERE intake_id = ${record.id} AND submitted_at > ${oneHourAgo}) < ${opts.maxPerHour}
      RETURNING id, intake_id AS "intakeId", number, status, r2_key AS "r2Key", submitted_at AS "submittedAt"
    `)) as IntakeSubmission[];
    return rows[0] ?? null;
  }

  const [submission] = await db
    .insert(intakeSubmissions)
    .values({
      id,
      intakeId: record.id,
      number: sql<number>`(SELECT COALESCE(MAX(number), 0) + 1 FROM intake_submissions WHERE intake_id = ${record.id})`,
      r2Key,
    })
    .returning();

  return submission;
}

export function serialiseSubmission(s: IntakeSubmission) {
  return {
    id: s.id,
    number: s.number,
    status: s.status,
    submitted_at: s.submittedAt,
  };
}
