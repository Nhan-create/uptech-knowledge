import assert from "node:assert/strict";
import test from "node:test";

import {
  RECOVERY_ACTION_DESCRIPTORS,
  RECOVERY_OPERATION_FAMILIES,
  RECOVERY_STATES,
  resolveRecoveryActions,
  type RecoveryAuthority,
  type RecoveryOperation,
  type RecoveryState,
} from "./recovery-actions.ts";

const FIRST_DOMAIN = authority("FIRST_DOMAIN");
const ACCESS_REQUEST = authority("ACCESS_REQUEST");
const BOOTSTRAP_STATUS = authority("BOOTSTRAP_STATUS");

function authority(family: keyof typeof RECOVERY_OPERATION_FAMILIES): RecoveryAuthority {
  return Object.freeze({
    kind: "AUTHENTICATED_ONBOARDING",
    operations: RECOVERY_OPERATION_FAMILIES[family],
  });
}

function resolve(state: RecoveryState, authenticatedAuthority: RecoveryAuthority | null) {
  return resolveRecoveryActions({ state, authority: authenticatedAuthority });
}

const CASES = [
  ["PERSONAL_GOOGLE_ACCOUNT", ["SWITCH_GOOGLE_ACCOUNT", "OPEN_ENTERPRISE_LOGIN_HELP"], null],
  ["UNKNOWN_WORKSPACE", ["START_ORGANIZATION_SETUP", "SWITCH_GOOGLE_ACCOUNT"], FIRST_DOMAIN],
  ["SUPER_ADMIN_REQUIRED", ["SWITCH_GOOGLE_ACCOUNT", "COPY_SUPER_ADMIN_INSTRUCTIONS"], null],
  ["DELEGATED_ADMIN_UNSUPPORTED", ["SWITCH_GOOGLE_ACCOUNT", "COPY_SUPER_ADMIN_INSTRUCTIONS"], null],
  ["GOOGLE_CONSENT_CANCELLED", ["RESTART_DIRECTORY_CONSENT", "SWITCH_GOOGLE_ACCOUNT"], FIRST_DOMAIN],
  ["DIRECTORY_SCOPE_REQUIRED", ["RESTART_DIRECTORY_CONSENT", "SWITCH_GOOGLE_ACCOUNT"], FIRST_DOMAIN],
  ["CONSENT_ACCOUNT_MISMATCH", ["RESTART_DIRECTORY_CONSENT", "SWITCH_GOOGLE_ACCOUNT"], FIRST_DOMAIN],
  ["DOMAIN_NOT_VERIFIED", ["OPEN_DOMAIN_VERIFICATION_HELP", "SWITCH_GOOGLE_ACCOUNT"], null],
  ["GOOGLE_ORGANIZATION_MISMATCH", ["SWITCH_GOOGLE_ACCOUNT", "CONTACT_UPTECH"], null],
  ["ORGANIZATION_ALREADY_REGISTERED", ["START_NORMAL_LOGIN", "CONTACT_UPTECH"], null],
  ["ORGANIZATION_ALREADY_REGISTERED_ACCESS_REQUEST_AVAILABLE", ["SUBMIT_ACCESS_REQUEST", "SWITCH_GOOGLE_ACCOUNT"], ACCESS_REQUEST],
  ["DIRECTORY_BOOTSTRAP_SYNC_PENDING", ["CHECK_BOOTSTRAP_STATUS", "EXIT_ONBOARDING"], BOOTSTRAP_STATUS],
  ["DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE", ["RETRY_DIRECTORY_SYNC", "CONTACT_UPTECH"], BOOTSTRAP_STATUS],
  ["DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED", ["CONTACT_UPTECH", "EXIT_ONBOARDING"], BOOTSTRAP_STATUS],
  ["USER_NOT_PROVISIONED", ["SUBMIT_ACCESS_REQUEST", "SWITCH_GOOGLE_ACCOUNT"], ACCESS_REQUEST],
  ["ACCESS_MAPPING_CONFLICT", ["SUBMIT_ACCESS_REQUEST", "EXIT_ONBOARDING"], ACCESS_REQUEST],
  ["USER_SUSPENDED", ["SWITCH_GOOGLE_ACCOUNT", "COPY_WORKSPACE_ADMIN_INSTRUCTIONS"], null],
  ["USER_REMOVED", ["SWITCH_GOOGLE_ACCOUNT", "COPY_WORKSPACE_ADMIN_INSTRUCTIONS"], null],
  ["DIRECTORY_SYNC_PENDING", ["COPY_WORKSPACE_ADMIN_INSTRUCTIONS", "START_NORMAL_LOGIN"], null],
  ["DIRECTORY_STALE", ["CONTACT_UPTECH", "START_NORMAL_LOGIN"], ACCESS_REQUEST],
  ["DIRECTORY_STALE_ACCESS_REQUEST_AVAILABLE", ["SUBMIT_ACCESS_REQUEST", "START_NORMAL_LOGIN"], ACCESS_REQUEST],
  ["WORKSPACE_SUSPENDED", ["CONTACT_UPTECH", "SWITCH_GOOGLE_ACCOUNT"], null],
  ["SESSION_REVOKED", ["START_NORMAL_LOGIN", "SWITCH_GOOGLE_ACCOUNT"], null],
  ["SESSION_EXPIRED", ["START_NORMAL_LOGIN", "SWITCH_GOOGLE_ACCOUNT"], null],
  ["ONBOARDING_EXPIRED", ["START_NORMAL_LOGIN", "CONTACT_UPTECH"], null],
  ["PROVIDER_UNAVAILABLE", ["START_NORMAL_LOGIN", "CONTACT_UPTECH"], null],
  ["RATE_LIMITED", ["START_NORMAL_LOGIN_AFTER_COOLDOWN", "CONTACT_UPTECH"], null],
  ["FORBIDDEN", ["SWITCH_GOOGLE_ACCOUNT", "CONTACT_UPTECH"], null],
  ["INTERNAL_ERROR", ["START_NORMAL_LOGIN", "COPY_REQUEST_ID"], null],
] as const satisfies readonly (readonly [RecoveryState, readonly string[], RecoveryAuthority | null])[];

test("every public state has its exact ordered action mapping with matching authority", () => {
  assert.deepEqual(RECOVERY_STATES, CASES.map(([state]) => state));
  for (const [state, expected, authenticatedAuthority] of CASES) {
    const actions = resolve(state, authenticatedAuthority);
    assert.deepEqual(actions.map((action) => action.id), expected, state);
    assert.ok(actions.length >= 1 && actions.length <= 2, state);
    assert.ok(Object.isFrozen(actions), state);
  }
});

test("each privileged family rejects every non-exact authority shape", () => {
  const cases = [
    ["FIRST_DOMAIN", "UNKNOWN_WORKSPACE", "START_ORGANIZATION_SETUP", "SWITCH_GOOGLE_ACCOUNT"],
    ["ACCESS_REQUEST", "USER_NOT_PROVISIONED", "SUBMIT_ACCESS_REQUEST", "SWITCH_GOOGLE_ACCOUNT"],
    ["BOOTSTRAP_STATUS", "DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE", "RETRY_DIRECTORY_SYNC", "CONTACT_UPTECH"],
  ] as const satisfies readonly (readonly [keyof typeof RECOVERY_OPERATION_FAMILIES, RecoveryState, string, string])[];
  for (const [family, state, privilegedAction, safeAction] of cases) {
    const expected = RECOVERY_OPERATION_FAMILIES[family];
    const otherFamily = family === "FIRST_DOMAIN" ? RECOVERY_OPERATION_FAMILIES.ACCESS_REQUEST : RECOVERY_OPERATION_FAMILIES.FIRST_DOMAIN;
    const invalidAuthorities: readonly unknown[] = [
      null,
      Object.freeze({}),
      Object.freeze({ kind: "AUTHENTICATED_ONBOARDING" }),
      Object.freeze({ kind: "OTHER", operations: expected }),
      Object.freeze({ kind: "AUTHENTICATED_ONBOARDING", operations: null }),
      Object.freeze({ kind: "AUTHENTICATED_ONBOARDING", operations: {} }),
      Object.freeze({ kind: "AUTHENTICATED_ONBOARDING", operations: expected.slice(0, -1) }),
      Object.freeze({ kind: "AUTHENTICATED_ONBOARDING", operations: [...expected.slice(0, -1), expected[0]] }),
      Object.freeze({ kind: "AUTHENTICATED_ONBOARDING", operations: [...expected].reverse() }),
      Object.freeze({ kind: "AUTHENTICATED_ONBOARDING", operations: [...expected, "ACCESS_REQUEST_READ"] as readonly RecoveryOperation[] }),
      Object.freeze({ kind: "AUTHENTICATED_ONBOARDING", operations: otherFamily }),
      Object.freeze({ kind: "AUTHENTICATED_ONBOARDING", operations: ["UNKNOWN_OPERATION"] }),
    ];
    for (const invalid of invalidAuthorities) {
      const actions = resolve(state, invalid as RecoveryAuthority | null).map((action) => action.id);
      assert.equal(actions.includes(privilegedAction), false, `${family}: ${JSON.stringify(invalid)}`);
      assert.deepEqual(actions, [safeAction], family);
    }
  }
});

test("exit onboarding requires a recognized exact authenticated onboarding family", () => {
  for (const authority of [FIRST_DOMAIN, ACCESS_REQUEST, BOOTSTRAP_STATUS]) {
    assert.deepEqual(resolve("DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED", authority).map((action) => action.id), ["CONTACT_UPTECH", "EXIT_ONBOARDING"]);
  }
  for (const invalid of [
    null,
    Object.freeze({ kind: "AUTHENTICATED_ONBOARDING", operations: [] }),
    Object.freeze({ kind: "AUTHENTICATED_ONBOARDING", operations: ["UNKNOWN_OPERATION"] }),
    Object.freeze({ kind: "UNAUTHENTICATED_ONBOARDING", operations: RECOVERY_OPERATION_FAMILIES.ACCESS_REQUEST }),
    Object.freeze({ authenticated: true, operations: RECOVERY_OPERATION_FAMILIES.ACCESS_REQUEST }),
  ]) {
    assert.deepEqual(resolve("DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED", invalid as RecoveryAuthority | null).map((action) => action.id), ["CONTACT_UPTECH"]);
  }
});

test("only state-specific capabilities unlock their fixed action", () => {
  assert.deepEqual(resolve("DIRECTORY_STALE", ACCESS_REQUEST).map((action) => action.id), ["CONTACT_UPTECH", "START_NORMAL_LOGIN"]);
  assert.deepEqual(resolve("DIRECTORY_STALE_ACCESS_REQUEST_AVAILABLE", ACCESS_REQUEST).map((action) => action.id), ["SUBMIT_ACCESS_REQUEST", "START_NORMAL_LOGIN"]);
  assert.deepEqual(resolve("DIRECTORY_SYNC_PENDING", BOOTSTRAP_STATUS).map((action) => action.id), ["COPY_WORKSPACE_ADMIN_INSTRUCTIONS", "START_NORMAL_LOGIN"]);
});

test("descriptors have fixed exact transport values and are deeply immutable", () => {
  const requests = {
    START_NORMAL_LOGIN: ["POST", "/api/v1/auth/google/transactions"],
    START_NORMAL_LOGIN_AFTER_COOLDOWN: ["POST", "/api/v1/auth/google/transactions"],
    SWITCH_GOOGLE_ACCOUNT: ["POST", "/api/v1/auth/google/transactions"],
    START_ORGANIZATION_SETUP: ["POST", "/api/v1/onboarding/google-workspace/transactions"],
    RESTART_DIRECTORY_CONSENT: ["POST", "/api/v1/onboarding/google-workspace/transactions"],
    CHECK_BOOTSTRAP_STATUS: ["GET", "/api/v1/onboarding/google-workspace/status"],
    RETRY_DIRECTORY_SYNC: ["POST", "/api/v1/onboarding/google-workspace/sync-retry"],
    FINISH_BOOTSTRAP: ["POST", "/api/v1/onboarding/google-workspace/finish"],
    EXIT_ONBOARDING: ["POST", "/api/v1/onboarding/logout"],
    SUBMIT_ACCESS_REQUEST: ["POST", "/api/v1/onboarding/access-requests"],
    OPEN_ENTERPRISE_LOGIN_HELP: ["GET", "/help/enterprise-login"],
    OPEN_DOMAIN_VERIFICATION_HELP: ["GET", "/help/google-workspace/domain-verification"],
  } as const;
  for (const [id, [method, path]] of Object.entries(requests)) {
    const descriptor = RECOVERY_ACTION_DESCRIPTORS[id as keyof typeof RECOVERY_ACTION_DESCRIPTORS];
    assert.equal(descriptor.kind, "REQUEST");
    if (descriptor.kind === "REQUEST") assert.deepEqual([descriptor.method, descriptor.path], [method, path]);
  }
  assert.deepEqual(RECOVERY_ACTION_DESCRIPTORS.START_NORMAL_LOGIN, {
    id: "START_NORMAL_LOGIN", kind: "REQUEST", method: "POST", path: "/api/v1/auth/google/transactions", label: { vi: "Đăng nhập bằng Google", en: "Sign in with Google" },
  });
  assert.deepEqual(RECOVERY_ACTION_DESCRIPTORS.CONTACT_UPTECH, {
    id: "CONTACT_UPTECH", kind: "CONTACT", recipient: "contact@uptech.vn", template: "CONTACT_UPTECH_PUBLIC_STATE_V1", label: { vi: "Liên hệ Uptech", en: "Contact Uptech" },
  });
  assert.deepEqual(RECOVERY_ACTION_DESCRIPTORS.COPY_SUPER_ADMIN_INSTRUCTIONS, {
    id: "COPY_SUPER_ADMIN_INSTRUCTIONS", kind: "COPY", template: "SUPER_ADMIN_SETUP_V1", label: { vi: "Sao chép hướng dẫn Super Admin", en: "Copy Super Admin instructions" },
  });
  assert.deepEqual(RECOVERY_ACTION_DESCRIPTORS.COPY_REQUEST_ID, {
    id: "COPY_REQUEST_ID", kind: "COPY", template: "REQUEST_ID_V1", label: { vi: "Sao chép mã yêu cầu", en: "Copy request ID" },
  });
  assert.equal(RECOVERY_ACTION_DESCRIPTORS.COPY_WORKSPACE_ADMIN_INSTRUCTIONS.template, "WORKSPACE_ACCESS_V1");
  assert.ok(Object.isFrozen(RECOVERY_ACTION_DESCRIPTORS));
  for (const descriptor of Object.values(RECOVERY_ACTION_DESCRIPTORS)) {
    assert.ok(Object.isFrozen(descriptor));
    assert.ok(Object.isFrozen(descriptor.label));
  }
});
