/**
 * Submission notification via Cloudflare Email Service (send_email binding).
 *
 * Fire-and-forget: never blocks or fails the submission. If the NOTIFY binding
 * is absent (local dev, or Email Sending not yet enabled on the account) this
 * is a silent no-op.
 *
 * The from-address domain must be onboarded to Email Sending:
 *   npx wrangler email sending enable platform21.com.au
 */
import { getBrand } from "./brands";

// Structural type for the Email Service binding. Replace with the generated
// SendEmail type from `npx wrangler types` once the project's wrangler/types
// toolchain is upgraded past the Email Service release.
export interface EmailSender {
  send(message: {
    to: string | string[];
    from: { email: string; name?: string };
    replyTo?: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<{ messageId?: string }>;
}

interface NotifyEnv {
  NOTIFY?: EmailSender;
  NOTIFY_TO?: string;
  NOTIFY_FROM?: string;
}

interface IntakeRecordLike {
  token: string;
  projectName: string;
  workflow: string;
  mode: string | null;
}

const DEFAULT_TO = "matthew@platform21.com.au";
const DEFAULT_FROM = "intake@platform21.com.au";
const MAX_FIELDS = 25;
const MAX_VALUE_LENGTH = 300;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function flattenAnswers(data: Record<string, unknown>): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  for (const [key, raw] of Object.entries(data)) {
    if (rows.length >= MAX_FIELDS) {
      rows.push(["…", `${Object.keys(data).length - MAX_FIELDS} more fields in the full response`]);
      break;
    }
    if (raw === null || raw === undefined || raw === "") continue;
    let value: string;
    if (typeof raw === "string") value = raw;
    else if (typeof raw === "number" || typeof raw === "boolean") value = String(raw);
    else value = JSON.stringify(raw);
    if (value.length > MAX_VALUE_LENGTH) value = `${value.slice(0, MAX_VALUE_LENGTH)}…`;
    rows.push([key.replace(/_/g, " "), value]);
  }
  return rows;
}

/**
 * Send the "client submitted their intake form" notification.
 * Call inside executionCtx.waitUntil(); resolves without throwing.
 */
export async function sendSubmissionNotification(
  env: NotifyEnv,
  hostname: string | undefined,
  record: IntakeRecordLike,
  submittedData: Record<string, unknown>
): Promise<void> {
  if (!env.NOTIFY) return;

  try {
    const brand = getBrand(hostname);
    const to = env.NOTIFY_TO || DEFAULT_TO;
    const rows = flattenAnswers(submittedData);
    const subject = `Intake submitted: ${record.projectName}`;

    const textLines = [
      `${brand.name} intake form submitted.`,
      "",
      `Project: ${record.projectName}`,
      `Workflow: ${record.workflow}${record.mode ? ` (${record.mode})` : ""}`,
      `Token: ${record.token}`,
      "",
      "Key answers:",
      ...rows.map(([k, v]) => `  ${k}: ${v}`),
      "",
      "Retrieve the full response with the discovery agent, or:",
      `  GET https://intake.platform21.com.au/api/intake/${record.token}/response`,
    ];

    const html = `
      <h2 style="margin:0 0 12px">${escapeHtml(brand.name)} intake form submitted</h2>
      <p style="margin:0 0 16px">
        <strong>Project:</strong> ${escapeHtml(record.projectName)}<br>
        <strong>Workflow:</strong> ${escapeHtml(record.workflow)}${record.mode ? ` (${escapeHtml(record.mode)})` : ""}<br>
        <strong>Token:</strong> ${escapeHtml(record.token)}
      </p>
      <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:14px">
        ${rows
          .map(
            ([k, v]) =>
              `<tr><td style="border:1px solid #ddd;font-weight:600;vertical-align:top">${escapeHtml(k)}</td><td style="border:1px solid #ddd">${escapeHtml(v)}</td></tr>`
          )
          .join("\n")}
      </table>
      <p style="margin:16px 0 0;color:#555;font-size:13px">
        Retrieve the full response with the discovery agent, or
        <code>GET https://intake.platform21.com.au/api/intake/${escapeHtml(record.token)}/response</code>
      </p>`;

    const response = await env.NOTIFY.send({
      to,
      from: { email: env.NOTIFY_FROM || DEFAULT_FROM, name: `${brand.name} Intake` },
      subject,
      html,
      text: textLines.join("\n"),
    });
    console.log(`submission notification sent for ${record.token}: ${response.messageId ?? "ok"}`);
  } catch (err) {
    // Never fail the submission because the notification failed.
    console.error(`submission notification failed for ${record.token}:`, err);
  }
}
