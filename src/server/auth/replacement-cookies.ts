import { ONBOARDING_COOKIE_NAME } from "./google/crypto.ts";
import { WEB_SESSION_COOKIE_NAME } from "../sessions/session-security.ts";

const AUTHORITY_COOKIE_NAMES = Object.freeze([
  WEB_SESSION_COOKIE_NAME,
  ONBOARDING_COOKIE_NAME,
]);

function clearingCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function isValidatedClear(value: unknown): value is string {
  return typeof value === "string" && AUTHORITY_COOKIE_NAMES.some(
    (name) => value === clearingCookie(name),
  );
}

function isReplacementCookie(value: unknown): value is string {
  if (typeof value !== "string" || /[\r\n]/u.test(value)) return false;
  const match = /^(__Host-uptech_(?:session|onboarding))=([^;]+)(?:;|$)/u.exec(value);
  if (match === null || !AUTHORITY_COOKIE_NAMES.includes(match[1] as never)) {
    return false;
  }
  return !/(?:^|;)\s*Max-Age\s*=\s*(?:0|-\d+)\s*(?:;|$)/iu.test(value);
}

export function replacementCookieHeaders(
  staleCookieHeaders: readonly string[],
  replacementCookie: string,
): readonly string[] {
  if (!Array.isArray(staleCookieHeaders) || !staleCookieHeaders.every(isValidatedClear)) {
    throw new TypeError("Stale cookies must be canonical authority clears");
  }
  if (!isReplacementCookie(replacementCookie)) {
    throw new TypeError("Replacement cookie must be a non-clearing authority cookie");
  }
  return Object.freeze([...staleCookieHeaders, replacementCookie]);
}
