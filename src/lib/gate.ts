/**
 * Server-side PIN gate for client-facing mutation routes.
 *
 * The password gate page alone only hides the form render — anyone holding the
 * token could still POST /:token/submit directly. On successful PIN
 * verification we set an HttpOnly cookie holding a timestamped HMAC (keyed by
 * the worker's INTAKE_API_KEY secret) over the token and the record's
 * password hash; mutation routes on PIN-protected records require it.
 *
 * The issued-at timestamp travels inside the cookie value and is covered by
 * the HMAC, so the 30-day lifetime is enforced server-side (the cookie maxAge
 * is a browser hint only). Binding the record's password hash means a cookie
 * can never outlive the PIN it was minted for.
 */

const encoder = new TextEncoder();

// Server-enforced cookie lifetime. Keep in step with the maxAge set in
// routes/form.tsx /verify.
export const GATE_TTL_SECONDS = 30 * 24 * 60 * 60;

export function gateCookieName(token: string): string {
  return `intake_gate_${token}`;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function gateMessage(token: string, passwordHash: string, issuedAt: number): string {
  return `pin-gate:${token}:${passwordHash}:${issuedAt}`;
}

export async function issueGateValue(
  secret: string,
  token: string,
  passwordHash: string
): Promise<string> {
  const issuedAt = Date.now();
  const mac = await hmacHex(secret, gateMessage(token, passwordHash, issuedAt));
  return `${issuedAt}.${mac}`;
}

export async function verifyGateValue(
  secret: string,
  token: string,
  passwordHash: string,
  value: string | undefined
): Promise<boolean> {
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot <= 0) return false;

  const issuedAt = Number(value.slice(0, dot));
  if (!Number.isInteger(issuedAt)) return false;
  const age = Date.now() - issuedAt;
  if (age < 0 || age > GATE_TTL_SECONDS * 1000) return false;

  const expected = await hmacHex(secret, gateMessage(token, passwordHash, issuedAt));
  const given = value.slice(dot + 1);
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
