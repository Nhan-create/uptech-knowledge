import { ONBOARDING_COOKIE_NAME } from "./google/crypto.ts";
import { GOOGLE_WORKSPACE_SETUP_COOKIE_NAME } from "../onboarding/google-workspace/crypto.ts";
import { WEB_SESSION_COOKIE_NAME } from "../sessions/session-security.ts";

const REPLACEMENT_COOKIE_NAMES = Object.freeze([
  WEB_SESSION_COOKIE_NAME,
  ONBOARDING_COOKIE_NAME,
]);
const STALE_CLEAR_COOKIE_NAMES = Object.freeze([
  ...REPLACEMENT_COOKIE_NAMES,
  GOOGLE_WORKSPACE_SETUP_COOKIE_NAME,
]);

function clearingCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function isValidatedClear(value: unknown): value is string {
  return typeof value === "string" && STALE_CLEAR_COOKIE_NAMES.some(
    (name) => value === clearingCookie(name),
  );
}

function isReplacementCookie(value: unknown): value is string {
  if (typeof value !== "string" || /[\r\n]/u.test(value)) return false;
  const match = /^(__Host-uptech_(?:session|onboarding))=([^;\s]+); Path=\/; HttpOnly; Secure; SameSite=Lax(?:; Max-Age=([1-9]\d*))?$/u.exec(value);
  if (match === null || !REPLACEMENT_COOKIE_NAMES.includes(match[1] as never)) {
    return false;
  }
  return match[1] === WEB_SESSION_COOKIE_NAME
    ? match[3] === undefined
    : match[3] !== undefined;
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
