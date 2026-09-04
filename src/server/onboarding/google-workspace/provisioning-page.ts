import type { DatabasePool } from "../../db/core.ts";
import { getRuntimeDatabasePool } from "../../db/runtime-pool.ts";
import {
  inspectBrowserAuthority,
  type BrowserAuthorityInspection,
} from "../../auth/browser-authority.ts";
import { loadWebSessionRuntimeConfig } from "../../auth/google/config.ts";
import {
  deriveCsrfCredential,
  hashProof,
  isCanonicalProof,
  LOGIN_TRANSACTION_COOKIE_NAME,
  ONBOARDING_COOKIE_NAME,
} from "../../auth/google/crypto.ts";
import {
  RECOVERY_ACTION_DESCRIPTORS,
  RECOVERY_OPERATION_FAMILIES,
  resolveProvisioningActions,
  type ProvisioningPublicState,
  type RecoveryActionDescriptor,
  type RecoveryAuthority,
} from "../../auth/recovery-actions.ts";
import { WEB_SESSION_COOKIE_NAME } from "../../sessions/session-security.ts";
import { requestIdFromHeaders } from "../../http/problem.ts";
import { GOOGLE_WORKSPACE_SETUP_COOKIE_NAME } from "./crypto.ts";
import { createGoogleWorkspaceBootstrapRepository } from "./repository.ts";
import type { BootstrapStatusOutcome, GoogleWorkspaceBootstrapRepository } from "./types.ts";

const MAX_COOKIE_HEADER_BYTES = 16_384;
const MAX_COOKIE_VALUE_BYTES = 4_500;
const CANONICAL_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONTACT_ONLY = Object.freeze([RECOVERY_ACTION_DESCRIPTORS.CONTACT_UPTECH]);
const ACTIVE_OUTCOMES = new Set<BootstrapStatusOutcome>([
  "DIRECTORY_BOOTSTRAP_SYNC_PENDING",
  "DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE",
  "DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED",
  "READY",
]);
const FORBIDDEN_COOKIE_NAMES = Object.freeze([
  WEB_SESSION_COOKIE_NAME,
  LOGIN_TRANSACTION_COOKIE_NAME,
  GOOGLE_WORKSPACE_SETUP_COOKIE_NAME,
]);

export type ProvisioningPageModel =
  | Readonly<{
      kind: "RENDER";
      state: ProvisioningPublicState;
      actions: readonly RecoveryActionDescriptor[];
      csrfToken: string;
      requestId: string;
    }>
  | Readonly<{
      kind: "REDIRECT";
      destination: `/login?error=ONBOARDING_EXPIRED&request_id=${string}`;
    }>
  | Readonly<{
      kind: "UNAVAILABLE";
      actions: readonly RecoveryActionDescriptor[];
      requestId: string;
    }>;

export interface ProvisioningPageModelDependencies {
  loadConfig(): { readonly databaseUrl: string; readonly sessionPepper: Uint8Array };
  getPool(databaseUrl: string): Pick<DatabasePool, "query">;
  inspectAuthority(
    headers: Headers,
    pool: Pick<DatabasePool, "query">,
    options: Readonly<{ sessionPepper: Uint8Array }>,
  ): Promise<BrowserAuthorityInspection>;
  createRepository(
    pool: Pick<DatabasePool, "query">,
  ): Pick<GoogleWorkspaceBootstrapRepository, "readStatus">;
  requestId(headers: Headers): string;
}

const productionDependencies: ProvisioningPageModelDependencies = Object.freeze({
  loadConfig: loadWebSessionRuntimeConfig,
  getPool: getRuntimeDatabasePool,
  inspectAuthority: inspectBrowserAuthority,
  createRepository: createGoogleWorkspaceBootstrapRepository,
  requestId: requestIdFromHeaders,
});

interface NamedCookieOccurrence {
  readonly name: string;
  readonly value: string | null;
}

function namedCookies(headers: Headers): readonly NamedCookieOccurrence[] | null {
  const cookie = headers.get("cookie");
  if (cookie === null) return Object.freeze([]);
  if (Buffer.byteLength(cookie, "utf8") > MAX_COOKIE_HEADER_BYTES) return null;
  const interesting = new Set([ONBOARDING_COOKIE_NAME, ...FORBIDDEN_COOKIE_NAMES]);
  const occurrences: NamedCookieOccurrence[] = [];
  for (const part of cookie.split(";")) {
    const candidate = part.trim();
    const separator = candidate.indexOf("=");
    const name = (separator < 0 ? candidate : candidate.slice(0, separator)).trim();
    if (!interesting.has(name)) continue;
    const value = separator >= 0 && candidate.slice(0, separator) === name
      ? candidate.slice(separator + 1)
      : null;
    if (value !== null && Buffer.byteLength(value, "utf8") > MAX_COOKIE_VALUE_BYTES) return null;
    occurrences.push(Object.freeze({ name, value }));
  }
  return Object.freeze(occurrences);
}

function exactOnboardingCredential(headers: Headers): string | null {
  if (headers.has("authorization")) return null;
  const occurrences = namedCookies(headers);
  if (occurrences === null) return null;
  if (occurrences.some((cookie) => FORBIDDEN_COOKIE_NAMES.includes(cookie.name))) return null;
  const onboarding = occurrences.filter((cookie) => cookie.name === ONBOARDING_COOKIE_NAME);
  if (onboarding.length !== 1 || !isCanonicalProof(onboarding[0]?.value)) return null;
  return onboarding[0].value;
}

function exactStatusAuthority(inspection: BrowserAuthorityInspection): RecoveryAuthority | null {
  if (
    inspection === null || typeof inspection !== "object" ||
    inspection.active !== true || inspection.activeKind !== "ONBOARDING" ||
    !Array.isArray(inspection.staleCookieHeaders) || inspection.staleCookieHeaders.length !== 0
  ) return null;
  const authority = inspection.onboardingAuthority;
  if (authority === null || typeof authority !== "object") return null;
  if (Object.keys(authority).sort().join(",") !== "kind,operations") return null;
  if (authority.kind !== "AUTHENTICATED_ONBOARDING" || !Array.isArray(authority.operations)) return null;
  const expected = RECOVERY_OPERATION_FAMILIES.BOOTSTRAP_STATUS;
  if (authority.operations.length !== expected.length ||
      !authority.operations.every((operation, index) => operation === expected[index])) return null;
  return authority;
}

function redirect(requestId: string): ProvisioningPageModel {
  return Object.freeze({
    kind: "REDIRECT",
    destination: `/login?error=ONBOARDING_EXPIRED&request_id=${requestId}`,
  });
}

function unavailable(requestId: string): ProvisioningPageModel {
  return Object.freeze({ kind: "UNAVAILABLE", actions: CONTACT_ONLY, requestId });
}

function canonicalRequestId(headers: Headers, dependencies: ProvisioningPageModelDependencies): string {
  try {
    const requestId = dependencies.requestId(headers);
    return CANONICAL_UUID_V4.test(requestId) ? requestId : requestIdFromHeaders(new Headers());
  } catch {
    return requestIdFromHeaders(new Headers());
  }
}

function exactOutcome(value: unknown): BootstrapStatusOutcome | null {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1) return null;
  const outcome = (value as { readonly outcome?: unknown }).outcome;
  return typeof outcome === "string" && (
    ACTIVE_OUTCOMES.has(outcome as BootstrapStatusOutcome) ||
    outcome === "ONBOARDING_EXPIRED" || outcome === "DENIED"
  ) ? outcome as BootstrapStatusOutcome : null;
}

export async function resolveProvisioningPageModel(
  headers: Headers,
  dependencies: ProvisioningPageModelDependencies = productionDependencies,
): Promise<ProvisioningPageModel> {
  const requestId = canonicalRequestId(headers, dependencies);
  const rawCredential = exactOnboardingCredential(headers);
  if (rawCredential === null) return redirect(requestId);

  try {
    const config = dependencies.loadConfig();
    const pool = dependencies.getPool(config.databaseUrl);
    const inspection = await dependencies.inspectAuthority(headers, pool, {
      sessionPepper: config.sessionPepper,
    });
    const authority = exactStatusAuthority(inspection);
    if (authority === null) return redirect(requestId);

    const statusTokenHash = hashProof(rawCredential);
    if (statusTokenHash.byteLength !== 32) return unavailable(requestId);
    const result = await dependencies.createRepository(pool).readStatus({
      statusTokenHash,
      requestId,
    });
    const outcome = exactOutcome(result);
    if (outcome === null) return unavailable(requestId);
    if (outcome === "ONBOARDING_EXPIRED" || outcome === "DENIED") return redirect(requestId);

    const state = outcome as ProvisioningPublicState;
    const actions = resolveProvisioningActions({ state, authority });
    const csrfToken = deriveCsrfCredential(rawCredential, config.sessionPepper);
    return Object.freeze({ kind: "RENDER", state, actions, csrfToken, requestId });
  } catch {
    return unavailable(requestId);
  }
}
