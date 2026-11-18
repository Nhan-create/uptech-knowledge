import type { QueryResultRow } from "pg";

import {
  EMPTY_USER_PROFILE,
  type UserProfileSnapshot,
  type WorkspaceRole,
} from "../../lib/user-profile.ts";
import type { DatabasePool } from "../db/core.ts";
import { getRuntimeDatabasePool } from "../db/runtime-pool.ts";
import { hashCredential, WEB_SESSION_COOKIE_NAME } from "../sessions/session-security.ts";
import { loadWebSessionRuntimeConfig } from "./google/config.ts";
import { isCanonicalProof, ONBOARDING_COOKIE_NAME } from "./google/crypto.ts";
import { authenticateWebSession } from "./web-session.ts";

const READ_CURRENT_BROWSER_PROFILE_SQL =
  "SELECT * FROM uptech.read_current_browser_profile_v1($1::bytea)";

interface BrowserProfileRow extends QueryResultRow {
  readonly auth_source: unknown;
  readonly workspace_role: unknown;
  readonly full_name: unknown;
  readonly email: unknown;
  readonly email_verified: unknown;
  readonly hosted_domain: unknown;
  readonly picture_url: unknown;
  readonly department: unknown;
  readonly org_unit_path: unknown;
  readonly google_is_admin: unknown;
  readonly google_is_delegated_admin: unknown;
}

export interface ReadCurrentUserProfileDependencies {
  readonly loadConfig: () => {
    readonly databaseUrl: string;
    readonly sessionPepper: Uint8Array;
  };
  readonly getPool: (
    databaseUrl: string,
  ) => Pick<DatabasePool, "query">;
  readonly authenticateWeb: typeof authenticateWebSession;
}

const productionDependencies: ReadCurrentUserProfileDependencies = Object.freeze({
  loadConfig: loadWebSessionRuntimeConfig,
  getPool: getRuntimeDatabasePool,
  authenticateWeb: authenticateWebSession,
});

function readCookieValues(headers: Headers, name: string): (string | null)[] {
  const cookieHeader = headers.get("cookie");
  if (cookieHeader === null) return [];
  const values: (string | null)[] = [];
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(name)) continue;
    const remainder = trimmed.slice(name.length);
    if (remainder.startsWith("=")) {
      values.push(remainder.slice(1).trim());
    } else if (remainder.length === 0 || /^\s/u.test(remainder)) {
      values.push(null);
    }
  }
  return values;
}

function extractSingleCredential(
  headers: Headers,
): { readonly kind: "WEB_SESSION" | "ONBOARDING"; readonly token: string } | null {
  const webValues = readCookieValues(headers, WEB_SESSION_COOKIE_NAME);
  const onboardingValues = readCookieValues(headers, ONBOARDING_COOKIE_NAME);
  if (webValues.length > 0 && onboardingValues.length > 0) {
    return null;
  }
  if (webValues.length === 1 && isCanonicalProof(webValues[0])) {
    return { kind: "WEB_SESSION", token: webValues[0] };
  }
  if (onboardingValues.length === 1 && isCanonicalProof(onboardingValues[0])) {
    return { kind: "ONBOARDING", token: onboardingValues[0] };
  }
  return null;
}

function optionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > maxLength ||
    /[\u0000-\u001f\u007f]/u.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

function optionalHttpsUrl(value: unknown): string | null {
  const candidate = optionalText(value, 2048);
  if (candidate === null) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

function optionalWorkspaceRole(value: unknown): WorkspaceRole | null {
  if (value === "OWNER" || value === "ADMIN" || value === "MEMBER") {
    return value;
  }
  return null;
}

function parseProfileRow(row: BrowserProfileRow): UserProfileSnapshot {
  if (row.auth_source !== "WEB_SESSION" && row.auth_source !== "ONBOARDING") {
    return EMPTY_USER_PROFILE;
  }
  return Object.freeze({
    authenticated: true,
    authSource: row.auth_source,
    fullName: optionalText(row.full_name, 500),
    email: optionalText(row.email, 320),
    emailVerified: row.email_verified === true,
    hostedDomain: optionalText(row.hosted_domain, 253),
    pictureUrl: optionalHttpsUrl(row.picture_url),
    department: optionalText(row.department, 200),
    orgUnitPath: optionalText(row.org_unit_path, 1024),
    workspaceRole: optionalWorkspaceRole(row.workspace_role),
    googleIsAdmin:
      typeof row.google_is_admin === "boolean" ? row.google_is_admin : null,
    googleIsDelegatedAdmin:
      typeof row.google_is_delegated_admin === "boolean"
        ? row.google_is_delegated_admin
        : null,
  });
}

function isUndefinedRoutineError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "42883"
  );
}

/**
 * Resolves the active user's verified Google identity and synced Directory
 * profile fields from the browser credential cookies. Never invents or falls
 * back to placeholder/fake personal data.
 */
export async function readCurrentUserProfile(
  headers: Headers,
  dependencies: ReadCurrentUserProfileDependencies = productionDependencies,
): Promise<UserProfileSnapshot> {
  const credential = extractSingleCredential(headers);
  if (credential === null) {
    return EMPTY_USER_PROFILE;
  }

  let config;
  let pool;
  try {
    config = dependencies.loadConfig();
    pool = dependencies.getPool(config.databaseUrl);
  } catch {
    return EMPTY_USER_PROFILE;
  }

  const tokenHash = Buffer.from(hashCredential(credential.token), "hex");
  try {
    const result = await pool.query<BrowserProfileRow>(
      READ_CURRENT_BROWSER_PROFILE_SQL,
      [tokenHash],
    );
    if (result.rows.length !== 1) {
      return EMPTY_USER_PROFILE;
    }
    return parseProfileRow(result.rows[0]!);
  } catch (error) {
    if (credential.kind === "WEB_SESSION" && isUndefinedRoutineError(error)) {
      try {
        const session = await dependencies.authenticateWeb(
          headers,
          config.sessionPepper,
          pool,
        );
        return Object.freeze({
          ...EMPTY_USER_PROFILE,
          authenticated: true,
          authSource: "WEB_SESSION",
          workspaceRole: session.context.workspaceRole,
        });
      } catch {
        return EMPTY_USER_PROFILE;
      }
    }
    return EMPTY_USER_PROFILE;
  }
}
