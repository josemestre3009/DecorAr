/**
 * Pure sanitizer for log context (DECOR-31). Called by every log site that
 * might carry request- or event-derived data, so a token, cookie, service
 * key, password or full email never reaches stdout/stderr in plain text.
 *
 * Deliberately conservative: a key is censored if its name merely *contains*
 * one of the sensitive fragments (case-insensitive), and a string value is
 * masked if it *looks like* a bearer token, JWT or email, regardless of
 * which key holds it. False positives (an unrelated field named
 * "tokenCount") are an acceptable trade-off for never leaking a secret.
 */

const SENSITIVE_KEY_FRAGMENTS = [
  "token",
  "cookie",
  "authorization",
  "key",
  "secret",
  "password",
  "payload",
] as const;

const REDACTED = "[redacted]";

const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._-]+/gi;
const JWT_PATTERN = /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return REDACTED;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local.slice(0, 1)}***@${domain}`;
}

function maskString(value: string): string {
  return value
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(JWT_PATTERN, REDACTED)
    .replace(EMAIL_PATTERN, (match) => maskEmail(match));
}

function isSensitiveKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => lowered.includes(fragment));
}

/** Depth bound so a cyclical or pathological context can never hang sanitization. */
const MAX_DEPTH = 4;

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return REDACTED;

  if (typeof value === "string") return maskString(value);

  if (value instanceof Error) {
    return {
      code: "code" in value ? String((value as { code: unknown }).code) : undefined,
      message: maskString(value.message),
      name: value.name,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1));
  }

  if (typeof value === "object" && value !== null) {
    return sanitizeRecord(value as Record<string, unknown>, depth + 1);
  }

  return value;
}

function sanitizeRecord(
  context: Readonly<Record<string, unknown>>,
  depth: number,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(context)) {
    result[key] = isSensitiveKey(key) ? REDACTED : sanitizeValue(value, depth);
  }

  return result;
}

/**
 * Sanitizes a log context before it is written. Never throws: an
 * unexpected shape is redacted rather than allowed through unmasked.
 */
export function sanitizeLogContext(
  context: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> | undefined {
  if (context === undefined) return undefined;

  try {
    return sanitizeRecord(context, 0);
  } catch {
    return { sanitizeError: REDACTED };
  }
}
