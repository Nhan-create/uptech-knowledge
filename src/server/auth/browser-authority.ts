import { authenticateSession, type DatabasePool } from "../db/core.ts";
import {
  hashCredential,
  WEB_SESSION_COOKIE_NAME,
} from "../sessions/session-security.ts";
import { ONBOARDING_COOKIE_NAME } from "./google/crypto.ts";

type SessionAuthenticator = typeof authenticateSession;

export interface BrowserAuthorityInspection {
  readonly active: boolean;
  readonly staleCookieHeaders: readonly string[];
}

function cookieValues(headers: Headers, name: string): string[] {
  const cookieHeader = headers.get("cookie");
  if (cookieHeader === null) return [];
  const values: string[] = [];
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf("=");
    if (separator >= 0 && trimmed.slice(0, separator) === name) {
      values.push(trimmed.slice(separator + 1));
    }
  }
  return values;
}

function clearingCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function inspectBrowserAuthority(
  headers: Headers,
  pool: Pick<DatabasePool, "query">,
  authenticate: SessionAuthenticator = authenticateSession,
): Promise<BrowserAuthorityInspection> {
  let active = false;
  const staleCookieHeaders: string[] = [];
  for (const [name, expectedKind] of [
    [WEB_SESSION_COOKIE_NAME, "session"],
    [ONBOARDING_COOKIE_NAME, "onboarding"],
  ] as const) {
    const values = cookieValues(headers, name);
    if (values.length === 0) continue;
    if (values.length !== 1 || values[0].length === 0) {
      staleCookieHeaders.push(clearingCookie(name));
      continue;
    }

    let digest: Uint8Array;
    try {
      digest = Buffer.from(hashCredential(values[0]), "hex");
    } catch {
      staleCookieHeaders.push(clearingCookie(name));
      continue;
    }

    const context = await authenticate(digest, pool);
    const matchesExpectedAuthority =
      expectedKind === "onboarding"
        ? context?.kind === "onboarding"
        : context?.kind === "session" &&
          context.clientType === "WEB" &&
          context.tokenKind === "WEB_SESSION";
    if (matchesExpectedAuthority) {
      active = true;
    } else {
      staleCookieHeaders.push(clearingCookie(name));
    }
  }
  return Object.freeze({
    active,
    staleCookieHeaders: Object.freeze(staleCookieHeaders),
  });
}
