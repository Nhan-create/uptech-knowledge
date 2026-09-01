import { authenticateSession, type DatabasePool } from "../db/core.ts";
import {
  hashCredential,
  WEB_SESSION_COOKIE_NAME,
} from "../sessions/session-security.ts";
import { ONBOARDING_COOKIE_NAME } from "./google/crypto.ts";
import {
  authenticateWebSession,
  WebSessionAuthenticationError,
} from "./web-session.ts";

type SessionAuthenticator = typeof authenticateSession;
type WebSessionAuthenticator = typeof authenticateWebSession;

export interface BrowserAuthorityInspection {
  readonly active: boolean;
  readonly activeKind: "WEB_SESSION" | "ONBOARDING" | null;
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
  options: {
    readonly sessionPepper: Uint8Array;
    readonly authenticateSession?: SessionAuthenticator;
    readonly authenticateWebSession?: WebSessionAuthenticator;
  },
): Promise<BrowserAuthorityInspection> {
  const authenticate = options.authenticateSession ?? authenticateSession;
  const authenticateWeb =
    options.authenticateWebSession ?? authenticateWebSession;
  let active = false;
  let activeKind: BrowserAuthorityInspection["activeKind"] = null;
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

    if (expectedKind === "session") {
      try {
        await authenticateWeb(
          new Headers({ cookie: `${WEB_SESSION_COOKIE_NAME}=${values[0]}` }),
          options.sessionPepper,
          pool,
        );
        active = true;
        activeKind = "WEB_SESSION";
      } catch (error) {
        if (!(error instanceof WebSessionAuthenticationError)) {
          throw error;
        }
        staleCookieHeaders.push(clearingCookie(name));
      }
      continue;
    }

    const context = await authenticate(digest, pool);
    const matchesExpectedAuthority =
      context?.kind === "onboarding";
    if (matchesExpectedAuthority) {
      active = true;
      activeKind = "ONBOARDING";
      // There is no production onboarding route yet. Retire this legacy
      // browser credential so the user can choose another account instead of
      // being trapped behind a credential that has no usable destination.
      staleCookieHeaders.push(clearingCookie(name));
    } else {
      staleCookieHeaders.push(clearingCookie(name));
    }
  }
  return Object.freeze({
    active,
    activeKind,
    staleCookieHeaders: Object.freeze(staleCookieHeaders),
  });
}
