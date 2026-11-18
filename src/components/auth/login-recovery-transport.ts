import {
  RECOVERY_ACTION_DESCRIPTORS,
  RECOVERY_ACTION_IDS,
  type RecoveryActionDescriptor,
  type RecoveryActionId,
} from "../../server/auth/recovery-actions.ts";

type NativeField = Readonly<{ name: "intent" | "csrf_token"; value: string }>;

export type LoginRecoveryTransport =
  | Readonly<{
      kind: "NATIVE_FORM";
      method: "POST";
      action: string;
      fields: readonly NativeField[];
      cooldownSeconds: number | null;
    }>
  | Readonly<{
      kind: "FETCH";
      method: "GET" | "POST";
      path: string;
      credentials: "include";
      cache: "no-store";
      headers: Readonly<Record<string, string>>;
    }>
  | Readonly<{ kind: "LINK"; href: string }>
  | Readonly<{ kind: "COPY"; template: "SUPER_ADMIN_SETUP_V1" | "WORKSPACE_ACCESS_V1" | "REQUEST_ID_V1"; value: string | null }>
  | Readonly<{ kind: "CONTACT"; recipient: "contact@uptech.vn"; template: "CONTACT_UPTECH_PUBLIC_STATE_V1" }>;

export type BootstrapPublicState =
  | "DIRECTORY_BOOTSTRAP_SYNC_PENDING"
  | "READY"
  | "DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE"
  | "DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED"
  | "ONBOARDING_EXPIRED";

export type LoginRecoveryFetchResult =
  | Readonly<{ kind: "NAVIGATE"; destination: "/setup/provisioning"; state: BootstrapPublicState }>
  | Readonly<{ kind: "ACCESS_REQUEST_RECEIPT"; requestId: string; status: "PENDING" }>
  | Readonly<{ kind: "FAILURE"; requestId: string | null }>;

const ACTION_IDS = new Set<string>(RECOVERY_ACTION_IDS);
const BOOTSTRAP_PUBLIC_STATES = new Set<string>([
  "DIRECTORY_BOOTSTRAP_SYNC_PENDING",
  "READY",
  "DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE",
  "DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED",
  "ONBOARDING_EXPIRED",
]);
const CANONICAL_PROOF = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u;
const CANONICAL_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_COOLDOWN_SECONDS_EXCLUSIVE = 300;

function frozen<T extends object>(value: T): Readonly<T> {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === "object" && !Object.isFrozen(child)) frozen(child);
  }
  return Object.freeze(value);
}

function canonicalProof(value: unknown): string | null {
  return typeof value === "string" && CANONICAL_PROOF.test(value) ? value : null;
}

function canonicalRequestId(value: unknown): string | null {
  return typeof value === "string" && CANONICAL_UUID_V4.test(value) ? value : null;
}

function fields(values: readonly NativeField[]): readonly NativeField[] {
  return frozen(values.map((value) => ({ ...value })));
}

function nativeForm(
  action: string,
  values: readonly NativeField[],
  cooldownSeconds: number | null = null,
): LoginRecoveryTransport {
  return frozen({ kind: "NATIVE_FORM", method: "POST", action, fields: fields(values), cooldownSeconds });
}

function fetchTransport(method: "GET" | "POST", path: string, csrfToken: string | null): LoginRecoveryTransport {
  const headers: Readonly<Record<string, string>> = csrfToken === null
    ? {}
    : { "X-CSRF-Token": csrfToken };
  return frozen({
    kind: "FETCH" as const,
    method,
    path,
    credentials: "include" as const,
    cache: "no-store" as const,
    headers,
  });
}

export function resolveLoginRecoveryTransport(input: Readonly<{
  descriptor: RecoveryActionDescriptor;
  csrfToken: unknown;
  requestId: unknown;
  retryAfterSeconds: unknown;
}>): LoginRecoveryTransport | null {
  let id: string;
  try {
    id = input.descriptor.id;
  } catch {
    return null;
  }
  if (!ACTION_IDS.has(id)) return null;
  const actionId = id as RecoveryActionId;
  const canonical = RECOVERY_ACTION_DESCRIPTORS[actionId];
  const csrfToken = canonicalProof(input.csrfToken);

  switch (actionId) {
    case "START_NORMAL_LOGIN": {
      if (canonical.kind !== "REQUEST") return null;
      return nativeForm(canonical.path, [
        { name: "intent", value: "LOGIN" },
        ...(csrfToken === null ? [] : [{ name: "csrf_token" as const, value: csrfToken }]),
      ]);
    }
    case "START_NORMAL_LOGIN_AFTER_COOLDOWN": {
      if (canonical.kind !== "REQUEST") return null;
      const seconds = input.retryAfterSeconds;
      if (!Number.isInteger(seconds) || typeof seconds !== "number" || seconds <= 0 || seconds >= MAX_COOLDOWN_SECONDS_EXCLUSIVE) return null;
      return nativeForm(canonical.path, [
        { name: "intent", value: "LOGIN" },
        ...(csrfToken === null ? [] : [{ name: "csrf_token" as const, value: csrfToken }]),
      ], seconds);
    }
    case "SWITCH_GOOGLE_ACCOUNT":
      if (canonical.kind !== "REQUEST") return null;
      return nativeForm(canonical.path, [
        { name: "intent", value: "SWITCH_ACCOUNT" },
        ...(csrfToken === null ? [] : [{ name: "csrf_token" as const, value: csrfToken }]),
      ]);
    case "REGISTER_ORGANIZATION":
      if (canonical.kind !== "REQUEST") return null;
      return nativeForm(canonical.path, [{ name: "intent", value: "REGISTER_ORGANIZATION" }]);
    case "START_ORGANIZATION_SETUP":
    case "RESTART_DIRECTORY_CONSENT":
    case "FINISH_BOOTSTRAP":
    case "EXIT_ONBOARDING":
      if (canonical.kind !== "REQUEST") return null;
      return csrfToken === null ? null : nativeForm(canonical.path, [{ name: "csrf_token", value: csrfToken }]);
    case "CHECK_BOOTSTRAP_STATUS":
      if (canonical.kind !== "REQUEST") return null;
      return fetchTransport("GET", canonical.path, null);
    case "RETRY_DIRECTORY_SYNC":
    case "SUBMIT_ACCESS_REQUEST":
      if (canonical.kind !== "REQUEST") return null;
      return csrfToken === null ? null : fetchTransport("POST", canonical.path, csrfToken);
    case "OPEN_ENTERPRISE_LOGIN_HELP":
    case "OPEN_DOMAIN_VERIFICATION_HELP":
      if (canonical.kind !== "REQUEST") return null;
      return frozen({ kind: "LINK", href: canonical.path });
    case "COPY_SUPER_ADMIN_INSTRUCTIONS":
    case "COPY_WORKSPACE_ADMIN_INSTRUCTIONS":
      if (canonical.kind !== "COPY") return null;
      return frozen({ kind: "COPY", template: canonical.template, value: null });
    case "COPY_REQUEST_ID": {
      if (canonical.kind !== "COPY") return null;
      const requestId = canonicalRequestId(input.requestId);
      return requestId === null ? null : frozen({ kind: "COPY", template: canonical.template, value: requestId });
    }
    case "CONTACT_UPTECH":
      if (canonical.kind !== "CONTACT") return null;
      return frozen({ kind: "CONTACT", recipient: canonical.recipient, template: canonical.template });
  }
}

function recordWithExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function failure(payload: unknown): LoginRecoveryFetchResult {
  let requestId: string | null = null;
  try {
    if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
      requestId = canonicalRequestId((payload as Record<string, unknown>).request_id);
    }
  } catch {
    requestId = null;
  }
  return frozen({ kind: "FAILURE", requestId });
}

export function parseLoginRecoveryFetchSuccess(input: Readonly<{
  actionId: RecoveryActionId;
  status: number;
  payload: unknown;
}>): LoginRecoveryFetchResult {
  try {
    if (input.status !== 200) return failure(input.payload);
    if (input.actionId === "CHECK_BOOTSTRAP_STATUS" || input.actionId === "RETRY_DIRECTORY_SYNC") {
      if (!recordWithExactKeys(input.payload, ["state"]) || !BOOTSTRAP_PUBLIC_STATES.has(input.payload.state as string)) {
        return failure(input.payload);
      }
      return frozen({
        kind: "NAVIGATE",
        destination: "/setup/provisioning",
        state: input.payload.state as BootstrapPublicState,
      });
    }
    if (input.actionId === "SUBMIT_ACCESS_REQUEST" && recordWithExactKeys(input.payload, ["request_id", "status"])) {
      const requestId = canonicalRequestId(input.payload.request_id);
      if (requestId !== null && input.payload.status === "PENDING") {
        return frozen({ kind: "ACCESS_REQUEST_RECEIPT" as const, requestId, status: "PENDING" as const });
      }
    }
    return failure(input.payload);
  } catch {
    return frozen({ kind: "FAILURE", requestId: null });
  }
}
