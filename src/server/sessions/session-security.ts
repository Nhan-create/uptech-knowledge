import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const SESSION_TOKEN_BYTES = 32;
export const CSRF_TOKEN_BYTES = 32;

export const SESSION_IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1_000;
export const SESSION_ABSOLUTE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1_000;
export const SESSION_ROTATION_INTERVAL_MS = 24 * 60 * 60 * 1_000;
export const SESSION_PREVIOUS_TOKEN_GRACE_MS = 30 * 1_000;

export const WEB_SESSION_COOKIE_NAME = "__Host-uptech_session";
export const WEB_SESSION_COOKIE_ATTRIBUTES =
  "Path=/; HttpOnly; Secure; SameSite=Lax";

const SHA_256_HEX_PATTERN = /^[a-f0-9]{64}$/u;
const BASE64URL_CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export interface IssuedCredential {
  readonly raw_token: string;
  readonly token_hash: string;
}

export interface SessionTimestamps {
  readonly created_at_ms: number;
  readonly last_seen_at_ms: number;
  readonly rotated_at_ms: number;
}

export type SessionTimingDecision =
  | {
      readonly allowed: true;
      readonly should_rotate: boolean;
    }
  | {
      readonly allowed: false;
      readonly reason:
        | "invalid_timestamps"
        | "absolute_timeout"
        | "idle_timeout";
    };

function isCanonicalCredential(rawToken: string, byteLength: number): boolean {
  if (!BASE64URL_CREDENTIAL_PATTERN.test(rawToken)) {
    return false;
  }

  const decoded = Buffer.from(rawToken, "base64url");
  return decoded.length === byteLength && decoded.toString("base64url") === rawToken;
}

function issueCredential(byteLength: number): IssuedCredential {
  const rawToken = randomBytes(byteLength).toString("base64url");
  return Object.freeze({
    raw_token: rawToken,
    token_hash: hashCredential(rawToken),
  });
}

export function issueSessionCredential(): IssuedCredential {
  return issueCredential(SESSION_TOKEN_BYTES);
}

export function issueCsrfCredential(): IssuedCredential {
  return issueCredential(CSRF_TOKEN_BYTES);
}

export function hashCredential(rawToken: string): string {
  if (!isCanonicalCredential(rawToken, SESSION_TOKEN_BYTES)) {
    throw new TypeError("credential must be a canonical 256-bit base64url value");
  }

  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function credentialMatchesHash(
  rawToken: string,
  expectedHash: string,
): boolean {
  if (
    !isCanonicalCredential(rawToken, SESSION_TOKEN_BYTES) ||
    !SHA_256_HEX_PATTERN.test(expectedHash)
  ) {
    return false;
  }

  const actual = createHash("sha256").update(rawToken, "utf8").digest();
  const expected = Buffer.from(expectedHash, "hex");
  return timingSafeEqual(actual, expected);
}

export function serializeWebSessionCookie(rawToken: string): string {
  if (!isCanonicalCredential(rawToken, SESSION_TOKEN_BYTES)) {
    throw new TypeError("session credential must be a canonical 256-bit value");
  }

  return `${WEB_SESSION_COOKIE_NAME}=${rawToken}; ${WEB_SESSION_COOKIE_ATTRIBUTES}`;
}

function isFiniteTimestamp(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function evaluateSessionTiming(
  timestamps: SessionTimestamps,
  nowMs: number,
): SessionTimingDecision {
  const { created_at_ms, last_seen_at_ms, rotated_at_ms } = timestamps;
  if (
    !isFiniteTimestamp(nowMs) ||
    !isFiniteTimestamp(created_at_ms) ||
    !isFiniteTimestamp(last_seen_at_ms) ||
    !isFiniteTimestamp(rotated_at_ms) ||
    created_at_ms > nowMs ||
    last_seen_at_ms < created_at_ms ||
    last_seen_at_ms > nowMs ||
    rotated_at_ms < created_at_ms ||
    rotated_at_ms > nowMs
  ) {
    return { allowed: false, reason: "invalid_timestamps" };
  }

  if (nowMs - created_at_ms >= SESSION_ABSOLUTE_TIMEOUT_MS) {
    return { allowed: false, reason: "absolute_timeout" };
  }

  if (nowMs - last_seen_at_ms >= SESSION_IDLE_TIMEOUT_MS) {
    return { allowed: false, reason: "idle_timeout" };
  }

  return {
    allowed: true,
    should_rotate:
      nowMs - rotated_at_ms >= SESSION_ROTATION_INTERVAL_MS,
  };
}

export function isPreviousTokenWithinGrace(
  rotatedAtMs: number,
  nowMs: number,
): boolean {
  if (
    !isFiniteTimestamp(rotatedAtMs) ||
    !isFiniteTimestamp(nowMs) ||
    rotatedAtMs > nowMs
  ) {
    return false;
  }

  return nowMs - rotatedAtMs <= SESSION_PREVIOUS_TOKEN_GRACE_MS;
}
