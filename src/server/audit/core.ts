export type AuditMetadataValue =
  | string
  | number
  | boolean
  | null
  | readonly AuditMetadataValue[]
  | { readonly [key: string]: AuditMetadataValue };

export type RedactedAuditMetadata = Readonly<
  Record<string, AuditMetadataValue>
>;

const REDACTED = "[REDACTED]";
const MAX_KEYS = 32;
const MAX_ARRAY_ITEMS = 20;
const MAX_DEPTH = 3;
const MAX_STRING_LENGTH = 256;

const SENSITIVE_KEY_PARTS = new Set([
  "answer",
  "authorization",
  "body",
  "chunk",
  "code",
  "content",
  "cookie",
  "credential",
  "csrf",
  "documenttext",
  "email",
  "fence",
  "nonce",
  "password",
  "payload",
  "pkce",
  "prompt",
  "providerbody",
  "providerresponse",
  "query",
  "raw",
  "response",
  "secret",
  "signedurl",
  "state",
  "text",
  "token",
  "url",
]);

function compactKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveKey(key: string): boolean {
  const compact = compactKey(key);
  for (const part of SENSITIVE_KEY_PARTS) {
    if (compact.includes(part)) {
      return true;
    }
  }

  return false;
}

function sanitizeString(value: string): string {
  const oneLine = value.replace(/[\u0000-\u001f\u007f]/g, " ");
  return oneLine.length <= MAX_STRING_LENGTH
    ? oneLine
    : `${oneLine.slice(0, MAX_STRING_LENGTH)}…`;
}

function sanitizeValue(
  value: unknown,
  depth: number,
): AuditMetadataValue | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value === "string") {
    return sanitizeString(value);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (value instanceof Error || value instanceof Uint8Array) {
    return REDACTED;
  }

  if (depth >= MAX_DEPTH) {
    return REDACTED;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeValue(item, depth + 1))
      .filter((item): item is AuditMetadataValue => item !== undefined);
  }

  if (typeof value === "object") {
    const sanitized: Record<string, AuditMetadataValue> = {};
    for (const [key, item] of Object.entries(value)) {
      if (Object.keys(sanitized).length >= MAX_KEYS) {
        break;
      }

      if (isSensitiveKey(key)) {
        sanitized[key] = REDACTED;
        continue;
      }

      const sanitizedItem = sanitizeValue(item, depth + 1);
      if (sanitizedItem !== undefined) {
        sanitized[key] = sanitizedItem;
      }
    }

    return sanitized;
  }

  return undefined;
}

export function redactAuditMetadata(
  metadata: Readonly<Record<string, unknown>> | null | undefined,
  allowedTopLevelKeys: readonly string[],
): RedactedAuditMetadata {
  if (metadata === null || metadata === undefined) {
    return Object.freeze({});
  }

  const allowed = new Set(allowedTopLevelKeys);
  const redacted: Record<string, AuditMetadataValue> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (Object.keys(redacted).length >= MAX_KEYS) {
      break;
    }

    if (isSensitiveKey(key)) {
      redacted[key] = REDACTED;
      continue;
    }

    if (!allowed.has(key)) {
      continue;
    }

    const sanitized = sanitizeValue(value, 0);
    if (sanitized !== undefined) {
      redacted[key] = sanitized;
    }
  }

  return Object.freeze(redacted);
}
