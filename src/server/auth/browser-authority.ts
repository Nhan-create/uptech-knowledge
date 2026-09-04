import { authenticateSession, type DatabasePool } from "../db/core.ts";
import {
  hashCredential,
  WEB_SESSION_COOKIE_NAME,
} from "../sessions/session-security.ts";
import { ONBOARDING_COOKIE_NAME } from "./google/crypto.ts";
import {
  RECOVERY_AUTHORITY_KIND,
  RECOVERY_OPERATION_FAMILIES,
  type RecoveryAuthority,
  type RecoveryOperation,
} from "./recovery-actions.ts";
import {
  authenticateWebSession,
  WebSessionAuthenticationError,
} from "./web-session.ts";

type SessionAuthenticator = typeof authenticateSession;
type WebSessionAuthenticator = typeof authenticateWebSession;

export interface BrowserAuthorityInspection {
  readonly active: boolean;
  readonly activeKind: "WEB_SESSION" | "ONBOARDING" | null;
  readonly onboardingAuthority: RecoveryAuthority | null;
  readonly staleCookieHeaders: readonly string[];
}

function cookieValues(headers: Headers, name: string): (string | null)[] {
  const cookieHeader = headers.get("cookie");
  if (cookieHeader === null) return [];
  const values: (string | null)[] = [];
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(name)) continue;
    const remainder = trimmed.slice(name.length);
    if (remainder.startsWith("=")) {
      values.push(remainder.slice(1));
    } else if (remainder.length === 0 || /^\s/u.test(remainder)) {
      values.push(null);
    }
  }
  return values;
}

function clearingCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function isExactOperationFamily(
  operations: unknown,
): operations is readonly RecoveryOperation[] {
  return Object.values(RECOVERY_OPERATION_FAMILIES).some(
    (family) =>
      Array.isArray(operations) &&
      operations.length === family.length &&
      operations.every((operation, index) => operation === family[index]),
  );
}

function sanitizedOnboardingAuthority(context: unknown): RecoveryAuthority | null {
  if (context === null || typeof context !== "object") return null;
  const candidate = context as Readonly<{
    kind?: unknown;
    allowedOperations?: unknown;
    contextExpiresAt?: unknown;
  }>;
  if (
    candidate.kind !== "onboarding" ||
    !(candidate.contextExpiresAt instanceof Date) ||
    !Number.isFinite(candidate.contextExpiresAt.getTime()) ||
    candidate.contextExpiresAt.getTime() <= Date.now() ||
    !isExactOperationFamily(candidate.allowedOperations)
  ) {
    return null;
  }
  return Object.freeze({
    kind: RECOVERY_AUTHORITY_KIND,
    operations: Object.freeze([...candidate.allowedOperations]),
  });
}

function emptyInspection(staleCookieHeaders: string[]): BrowserAuthorityInspection {
  return Object.freeze({
    active: false,
    activeKind: null,
    onboardingAuthority: null,
    staleCookieHeaders: Object.freeze(staleCookieHeaders),
  });
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
  const webValues = cookieValues(headers, WEB_SESSION_COOKIE_NAME);
  const onboardingValues = cookieValues(headers, ONBOARDING_COOKIE_NAME);
  if (webValues.length > 0 && onboardingValues.length > 0) {
    return emptyInspection([
      clearingCookie(WEB_SESSION_COOKIE_NAME),
      clearingCookie(ONBOARDING_COOKIE_NAME),
    ]);
  }
  let active = false;
  let activeKind: BrowserAuthorityInspection["activeKind"] = null;
  let onboardingAuthority: RecoveryAuthority | null = null;
  const staleCookieHeaders: string[] = [];
  for (const [name, expectedKind] of [
    [WEB_SESSION_COOKIE_NAME, "session"],
    [ONBOARDING_COOKIE_NAME, "onboarding"],
  ] as const) {
    const values = name === WEB_SESSION_COOKIE_NAME ? webValues : onboardingValues;
    if (values.length === 0) continue;
    const value = values[0];
    if (values.length !== 1 || value === undefined || value === null || value.length === 0) {
      staleCookieHeaders.push(clearingCookie(name));
      continue;
    }

    let digest: Uint8Array;
    try {
      digest = Buffer.from(hashCredential(value), "hex");
    } catch {
      staleCookieHeaders.push(clearingCookie(name));
      continue;
    }

    if (expectedKind === "session") {
      try {
        await authenticateWeb(
          new Headers({ cookie: `${WEB_SESSION_COOKIE_NAME}=${value}` }),
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

    const authority = sanitizedOnboardingAuthority(
      await authenticate(digest, pool),
    );
    if (authority !== null) {
      active = true;
      activeKind = "ONBOARDING";
      onboardingAuthority = authority;
    } else {
      staleCookieHeaders.push(clearingCookie(name));
    }
  }
  return Object.freeze({
    active,
    activeKind,
    onboardingAuthority,
    staleCookieHeaders: Object.freeze(staleCookieHeaders),
  });
}
