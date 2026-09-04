import type { DatabasePool } from "../db/core.ts";
import { getRuntimeDatabasePool } from "../db/runtime-pool.ts";
import { loadWebSessionRuntimeConfig } from "./google/config.ts";
import {
  deriveCsrfCredential,
  isCanonicalProof,
  ONBOARDING_COOKIE_NAME,
} from "./google/crypto.ts";
import {
  inspectBrowserAuthority,
  type BrowserAuthorityInspection,
} from "./browser-authority.ts";
import {
  RECOVERY_ACTION_DESCRIPTORS,
  RECOVERY_OPERATION_FAMILIES,
  RECOVERY_STATES,
  resolveRecoveryActions,
  type RecoveryActionDescriptor,
  type RecoveryAuthority,
  type RecoveryState,
} from "./recovery-actions.ts";
import {
  resolveWebRouteAuthorityDetailed,
  type DetailedWebRouteAuthorityDecision,
} from "./web-route-authority.ts";
import { clearedWebSessionCookie } from "./web-session.ts";

export type LoginPageAuthorityDecision = "HOME" | "LOGIN" | "UNAVAILABLE";

export type LoginPageModel =
  | Readonly<{ kind: "REDIRECT"; destination: "/admin" | "/home" }>
  | Readonly<{
      kind: "RENDER";
      state: RecoveryState | null;
      actions: readonly RecoveryActionDescriptor[];
      csrfToken: string | null;
      staleCookieHeaders: readonly string[];
    }>;

export interface LoginPageModelDependencies {
  readonly loadConfig: () => {
    readonly databaseUrl: string;
    readonly sessionPepper: Uint8Array;
  };
  readonly getPool: (
    databaseUrl: string,
  ) => Pick<DatabasePool, "connect" | "query">;
  readonly inspectAuthority: (
    headers: Headers,
    pool: Pick<DatabasePool, "query">,
    options: Readonly<{ sessionPepper: Uint8Array }>,
  ) => Promise<BrowserAuthorityInspection>;
  readonly resolveWebRoute: (
    headers: Headers,
  ) => Promise<DetailedWebRouteAuthorityDecision>;
}

const modelProductionDependencies: LoginPageModelDependencies = Object.freeze({
  loadConfig: loadWebSessionRuntimeConfig,
  getPool: getRuntimeDatabasePool,
  inspectAuthority: inspectBrowserAuthority,
  resolveWebRoute: (headers: Headers) => resolveWebRouteAuthorityDetailed(headers, "HOME"),
});

const LEGACY_RECOVERY_STATES: Readonly<Record<string, RecoveryState>> = Object.freeze({
  personal_gmail: "PERSONAL_GOOGLE_ACCOUNT",
  personal_account: "PERSONAL_GOOGLE_ACCOUNT",
  unknown_workspace: "UNKNOWN_WORKSPACE",
  workspace_not_found: "UNKNOWN_WORKSPACE",
  access_required: "USER_NOT_PROVISIONED",
  not_provisioned: "USER_NOT_PROVISIONED",
  access_mapping_conflict: "ACCESS_MAPPING_CONFLICT",
  user_suspended: "USER_SUSPENDED",
  suspended: "USER_SUSPENDED",
  user_removed: "USER_REMOVED",
  directory_sync_pending: "DIRECTORY_SYNC_PENDING",
  directory_stale: "DIRECTORY_STALE",
  directory_stale_access_request_available: "DIRECTORY_STALE_ACCESS_REQUEST_AVAILABLE",
  workspace_suspended: "WORKSPACE_SUSPENDED",
  session_expired: "SESSION_EXPIRED",
  rate_limited: "RATE_LIMITED",
  temporarily_unavailable: "PROVIDER_UNAVAILABLE",
  login_failed: "INTERNAL_ERROR",
  // Normal OIDC access_denied has no Directory-consent meaning; keep its
  // legacy callback key on the generic, non-privileged recovery path.
  provider_rejected: "INTERNAL_ERROR",
  // The login transaction emits this for an existing browser authority. A
  // truly current Web authority redirects before this display fallback.
  active_authority: "SESSION_REVOKED",
});

function publicRecoveryState(input: unknown): RecoveryState | null {
  if (typeof input !== "string") return null;
  if ((RECOVERY_STATES as readonly string[]).includes(input)) {
    return input as RecoveryState;
  }
  return LEGACY_RECOVERY_STATES[input] ?? null;
}

function exactCookie(headers: Headers, name: string): string | null {
  const values = (headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));
  return values.length === 1 && isCanonicalProof(values[0]) ? values[0] : null;
}

function hasExactOperations(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length &&
    actual.every((operation, index) => operation === expected[index]);
}

function stateForAuthority(authority: RecoveryAuthority): RecoveryState | null {
  const operations = authority.operations;
  if (hasExactOperations(operations, RECOVERY_OPERATION_FAMILIES.FIRST_DOMAIN)) {
    return "UNKNOWN_WORKSPACE";
  }
  if (hasExactOperations(operations, RECOVERY_OPERATION_FAMILIES.ACCESS_REQUEST)) {
    return "USER_NOT_PROVISIONED";
  }
  if (hasExactOperations(operations, RECOVERY_OPERATION_FAMILIES.BOOTSTRAP_STATUS)) {
    return "DIRECTORY_BOOTSTRAP_SYNC_PENDING";
  }
  return null;
}

function render(
  state: RecoveryState | null,
  authority: RecoveryAuthority | null,
  csrfToken: string | null,
  staleCookieHeaders: readonly string[],
): LoginPageModel {
  const actions = state === null
    ? Object.freeze([RECOVERY_ACTION_DESCRIPTORS.START_NORMAL_LOGIN])
    : resolveRecoveryActions({ state, authority });
  return Object.freeze({
    kind: "RENDER",
    state,
    actions,
    csrfToken,
    staleCookieHeaders: Object.freeze([...staleCookieHeaders]),
  });
}

export async function resolveLoginPageModel(
  headers: Headers,
  requestedError: unknown,
  dependencies: LoginPageModelDependencies = modelProductionDependencies,
): Promise<LoginPageModel> {
  try {
    const config = dependencies.loadConfig();
    const pool = dependencies.getPool(config.databaseUrl);
    const inspected = await dependencies.inspectAuthority(headers, pool, {
      sessionPepper: config.sessionPepper,
    });
    if (inspected.activeKind === "WEB_SESSION") {
      const route = await dependencies.resolveWebRoute(headers);
      if (route.kind === "UNAVAILABLE") {
        return render("PROVIDER_UNAVAILABLE", null, null, []);
      }
      if (route.kind === "NOT_CURRENT") {
        const clears = [...inspected.staleCookieHeaders, clearedWebSessionCookie()];
        return render("SESSION_REVOKED", null, null, [...new Set(clears)]);
      }
      if (route.decision === "ADMIN") return Object.freeze({ kind: "REDIRECT", destination: "/admin" });
      return Object.freeze({ kind: "REDIRECT", destination: "/home" });
    }

    const rawCredential = inspected.activeKind === "ONBOARDING"
      ? exactCookie(headers, ONBOARDING_COOKIE_NAME)
      : null;
    const candidateAuthority = inspected.active && rawCredential !== null
      ? inspected.onboardingAuthority
      : null;
    const authorityState = candidateAuthority === null
      ? null
      : stateForAuthority(candidateAuthority);
    const authority = authorityState === null ? null : candidateAuthority;
    const state = publicRecoveryState(requestedError) ??
      authorityState;
    const csrfToken = authority === null || rawCredential === null
      ? null
      : deriveCsrfCredential(rawCredential, config.sessionPepper);
    return render(state, authority, csrfToken, inspected.staleCookieHeaders);
  } catch {
    return render("PROVIDER_UNAVAILABLE", null, null, []);
  }
}

export function resolveLoginPageError(
  requestedError: string | undefined,
  authority: LoginPageAuthorityDecision,
): string | undefined {
  if (authority === "UNAVAILABLE") {
    return "temporarily_unavailable";
  }
  return requestedError;
}

export async function resolveLoginPageAuthority(
  headers: Headers,
  _hasWebSessionCookie: boolean,
): Promise<LoginPageAuthorityDecision> {
  const model = await resolveLoginPageModel(headers, undefined);
  if (model.kind === "REDIRECT") return "HOME";
  return model.state === "PROVIDER_UNAVAILABLE" ? "UNAVAILABLE" : "LOGIN";
}
