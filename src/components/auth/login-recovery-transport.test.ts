import assert from "node:assert/strict";
import test from "node:test";

import {
  parseLoginRecoveryFetchSuccess,
  resolveLoginRecoveryTransport,
} from "./login-recovery-transport.ts";
import {
  RECOVERY_ACTION_DESCRIPTORS,
  RECOVERY_ACTION_IDS,
  type RecoveryActionDescriptor,
  type RecoveryActionId,
} from "../../server/auth/recovery-actions.ts";

const CSRF = "A".repeat(43);
const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";

const EXPECTED: Readonly<Record<RecoveryActionId, readonly [string, string]>> = {
  START_NORMAL_LOGIN: ["NATIVE_FORM", "/api/v1/auth/google/transactions"],
  START_NORMAL_LOGIN_AFTER_COOLDOWN: ["NATIVE_FORM", "/api/v1/auth/google/transactions"],
  SWITCH_GOOGLE_ACCOUNT: ["NATIVE_FORM", "/api/v1/auth/google/transactions"],
  START_ORGANIZATION_SETUP: ["NATIVE_FORM", "/api/v1/onboarding/google-workspace/transactions"],
  RESTART_DIRECTORY_CONSENT: ["NATIVE_FORM", "/api/v1/onboarding/google-workspace/transactions"],
  CHECK_BOOTSTRAP_STATUS: ["FETCH", "/api/v1/onboarding/google-workspace/status"],
  RETRY_DIRECTORY_SYNC: ["FETCH", "/api/v1/onboarding/google-workspace/sync-retry"],
  FINISH_BOOTSTRAP: ["NATIVE_FORM", "/api/v1/onboarding/google-workspace/finish"],
  EXIT_ONBOARDING: ["NATIVE_FORM", "/api/v1/onboarding/logout"],
  SUBMIT_ACCESS_REQUEST: ["FETCH", "/api/v1/onboarding/access-requests"],
  OPEN_ENTERPRISE_LOGIN_HELP: ["LINK", "/help/enterprise-login"],
  OPEN_DOMAIN_VERIFICATION_HELP: ["LINK", "/help/google-workspace/domain-verification"],
  COPY_SUPER_ADMIN_INSTRUCTIONS: ["COPY", "SUPER_ADMIN_SETUP_V1"],
  COPY_WORKSPACE_ADMIN_INSTRUCTIONS: ["COPY", "WORKSPACE_ACCESS_V1"],
  CONTACT_UPTECH: ["CONTACT", "CONTACT_UPTECH_PUBLIC_STATE_V1"],
  COPY_REQUEST_ID: ["COPY", "REQUEST_ID_V1"],
};

function resolve(id: RecoveryActionId, overrides: Readonly<{ csrfToken?: unknown; requestId?: unknown; retryAfterSeconds?: unknown }> = {}) {
  return resolveLoginRecoveryTransport({
    descriptor: RECOVERY_ACTION_DESCRIPTORS[id],
    csrfToken: overrides.csrfToken === undefined ? CSRF : overrides.csrfToken,
    requestId: overrides.requestId === undefined ? REQUEST_ID : overrides.requestId,
    retryAfterSeconds: overrides.retryAfterSeconds === undefined ? 30 : overrides.retryAfterSeconds,
  });
}

test("every recovery ID resolves to its fixed transport family and canonical target", () => {
  assert.equal(RECOVERY_ACTION_IDS.length, Object.keys(EXPECTED).length);
  for (const id of RECOVERY_ACTION_IDS) {
    const transport = resolve(id);
    assert.ok(transport, id);
    const target = transport.kind === "NATIVE_FORM" ? transport.action
      : transport.kind === "FETCH" ? transport.path
      : transport.kind === "LINK" ? transport.href
      : transport.template;
    assert.deepEqual([transport.kind, target], EXPECTED[id], id);
    assert.ok(Object.isFrozen(transport), id);
  }
});

test("native login forms keep exact field order while privileged forms require canonical CSRF", () => {
  assert.deepEqual(resolve("START_NORMAL_LOGIN", { csrfToken: null }), {
    kind: "NATIVE_FORM", method: "POST", action: "/api/v1/auth/google/transactions",
    fields: [{ name: "intent", value: "LOGIN" }], cooldownSeconds: null,
  });
  assert.deepEqual(resolve("SWITCH_GOOGLE_ACCOUNT"), {
    kind: "NATIVE_FORM", method: "POST", action: "/api/v1/auth/google/transactions",
    fields: [{ name: "intent", value: "SWITCH_ACCOUNT" }, { name: "csrf_token", value: CSRF }], cooldownSeconds: null,
  });
  assert.deepEqual(resolve("FINISH_BOOTSTRAP"), {
    kind: "NATIVE_FORM", method: "POST", action: "/api/v1/onboarding/google-workspace/finish",
    fields: [{ name: "csrf_token", value: CSRF }], cooldownSeconds: null,
  });
  assert.equal(resolve("FINISH_BOOTSTRAP", { csrfToken: null }), null);
  assert.equal(resolve("EXIT_ONBOARDING", { csrfToken: "x" }), null);
});

test("fetch transports are bodyless credentialed requests with no selectors", () => {
  assert.deepEqual(resolve("CHECK_BOOTSTRAP_STATUS"), {
    kind: "FETCH", method: "GET", path: "/api/v1/onboarding/google-workspace/status",
    credentials: "include", cache: "no-store", headers: {},
  });
  assert.deepEqual(resolve("RETRY_DIRECTORY_SYNC"), {
    kind: "FETCH", method: "POST", path: "/api/v1/onboarding/google-workspace/sync-retry",
    credentials: "include", cache: "no-store", headers: { "X-CSRF-Token": CSRF },
  });
  assert.equal(resolve("SUBMIT_ACCESS_REQUEST", { csrfToken: null }), null);
  const serialized = JSON.stringify(resolve("SUBMIT_ACCESS_REQUEST"));
  for (const forbidden of ["body", "Content-Type", "Authorization", "workspace", "domain", "return_url", REQUEST_ID]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("cooldown login requires a positive bounded integer", () => {
  assert.equal(resolve("START_NORMAL_LOGIN_AFTER_COOLDOWN", { retryAfterSeconds: null }), null);
  assert.equal(resolve("START_NORMAL_LOGIN_AFTER_COOLDOWN", { retryAfterSeconds: 0 }), null);
  assert.equal(resolve("START_NORMAL_LOGIN_AFTER_COOLDOWN", { retryAfterSeconds: 300 }), null);
  assert.equal(resolve("START_NORMAL_LOGIN_AFTER_COOLDOWN", { retryAfterSeconds: 1.5 }), null);
  const transport = resolve("START_NORMAL_LOGIN_AFTER_COOLDOWN", { retryAfterSeconds: 299 });
  assert.ok(transport?.kind === "NATIVE_FORM");
  assert.equal(transport.cooldownSeconds, 299);
});

test("hostile descriptor fields and unknown IDs cannot select browser destinations", () => {
  const descriptor = {
    ...RECOVERY_ACTION_DESCRIPTORS.START_NORMAL_LOGIN,
    method: "GET", path: "https://evil.example/steal", recipient: "evil@example.com",
    template: "EVIL", label: { vi: "evil", en: "evil" },
  } as unknown as RecoveryActionDescriptor;
  assert.deepEqual(resolveLoginRecoveryTransport({ descriptor, csrfToken: null, requestId: null, retryAfterSeconds: null }), {
    kind: "NATIVE_FORM", method: "POST", action: "/api/v1/auth/google/transactions",
    fields: [{ name: "intent", value: "LOGIN" }], cooldownSeconds: null,
  });
  assert.equal(resolveLoginRecoveryTransport({ descriptor: { id: "EVIL" } as unknown as RecoveryActionDescriptor, csrfToken: CSRF, requestId: REQUEST_ID, retryAfterSeconds: 30 }), null);
});

test("closed status and retry success payloads navigate only to provisioning", () => {
  for (const actionId of ["CHECK_BOOTSTRAP_STATUS", "RETRY_DIRECTORY_SYNC"] as const) {
    for (const state of ["DIRECTORY_BOOTSTRAP_SYNC_PENDING", "READY", "DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE", "DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED", "ONBOARDING_EXPIRED"] as const) {
      assert.deepEqual(parseLoginRecoveryFetchSuccess({ actionId, status: 200, payload: { state } }), {
        kind: "NAVIGATE", destination: "/setup/provisioning", state,
      });
    }
  }
});

test("access-request success accepts only the exact pending receipt", () => {
  assert.deepEqual(parseLoginRecoveryFetchSuccess({
    actionId: "SUBMIT_ACCESS_REQUEST", status: 200,
    payload: { request_id: REQUEST_ID, status: "PENDING" },
  }), { kind: "ACCESS_REQUEST_RECEIPT", requestId: REQUEST_ID, status: "PENDING" });
});

test("near-miss and hostile success payloads fail locally and retain at most a canonical request UUID", () => {
  const failures = [
    { actionId: "CHECK_BOOTSTRAP_STATUS" as const, status: 201, payload: { state: "READY" } },
    { actionId: "CHECK_BOOTSTRAP_STATUS" as const, status: 200, payload: { state: "READY", destination: "https://evil.example" } },
    { actionId: "RETRY_DIRECTORY_SYNC" as const, status: 200, payload: { state: "DENIED" } },
    { actionId: "SUBMIT_ACCESS_REQUEST" as const, status: 200, payload: { request_id: REQUEST_ID, status: "PENDING", actions: ["ADMIN"] } },
    { actionId: "SUBMIT_ACCESS_REQUEST" as const, status: 200, payload: { request_id: "not-a-uuid", status: "PENDING" } },
    { actionId: "START_NORMAL_LOGIN" as const, status: 200, payload: { request_id: REQUEST_ID, detail: "provider secret" } },
  ];
  for (const input of failures) {
    const result = parseLoginRecoveryFetchSuccess(input);
    assert.equal(result.kind, "FAILURE");
    assert.deepEqual(Object.keys(result).sort(), ["kind", "requestId"]);
    assert.equal(JSON.stringify(result).includes("evil.example"), false);
    assert.equal(JSON.stringify(result).includes("provider secret"), false);
  }
  assert.deepEqual(parseLoginRecoveryFetchSuccess(failures[3]), { kind: "FAILURE", requestId: REQUEST_ID });
});

test("all resolved transports are deeply immutable and JSON serializable", () => {
  for (const id of RECOVERY_ACTION_IDS) {
    const value = resolve(id);
    if (value === null) continue;
    JSON.parse(JSON.stringify(value));
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") assert.ok(Object.isFrozen(child), id);
    }
  }
});
