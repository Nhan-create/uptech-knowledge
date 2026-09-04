import assert from "node:assert/strict";
import test from "node:test";

import { resolveLoginPageModel, type LoginPageModelDependencies } from "./login-page-authority.ts";
import { RECOVERY_OPERATION_FAMILIES, RECOVERY_STATES, type RecoveryAuthority, type RecoveryState } from "./recovery-actions.ts";
import { deriveCsrfCredential, ONBOARDING_COOKIE_NAME } from "./google/crypto.ts";
import { WEB_SESSION_COOKIE_NAME } from "../sessions/session-security.ts";

const PEPPER = new Uint8Array(32).fill(0x41);
const RAW = "A".repeat(43);
const pool = { query: async () => ({ rows: [], rowCount: 0 }), connect: async () => ({}) } as never;
function inspection(authority: RecoveryAuthority | null = null) {
  return Object.freeze({ active: authority !== null, activeKind: authority === null ? null : "ONBOARDING" as const, onboardingAuthority: authority, staleCookieHeaders: Object.freeze([] as string[]) });
}
function authority(operations: readonly string[]): RecoveryAuthority {
  return { kind: "AUTHENTICATED_ONBOARDING", operations } as RecoveryAuthority;
}
function deps(overrides: Partial<LoginPageModelDependencies> = {}): LoginPageModelDependencies {
  return {
    loadConfig: () => ({ databaseUrl: "postgres://runtime@example.invalid/db", sessionPepper: PEPPER }),
    getPool: () => pool,
    inspectAuthority: async () => inspection(),
    resolveWebRoute: async () => "LOGIN",
    ...overrides,
  };
}
function actionIds(model: Awaited<ReturnType<typeof resolveLoginPageModel>>): string[] {
  assert.equal(model.kind, "RENDER");
  return model.actions.map((action) => action.id);
}

test("ordinary login is a closed render model with only normal login", async () => {
  const model = await resolveLoginPageModel(new Headers(), undefined, deps());
  assert.equal(model.kind, "RENDER");
  assert.equal(model.state, null);
  assert.deepEqual(actionIds(model), ["START_NORMAL_LOGIN"]);
  assert.equal(model.csrfToken, null);
  assert.deepEqual(model.staleCookieHeaders, []);
});

const legacyMappings: Readonly<Record<string, RecoveryState>> = {
  personal_gmail: "PERSONAL_GOOGLE_ACCOUNT", personal_account: "PERSONAL_GOOGLE_ACCOUNT",
  unknown_workspace: "UNKNOWN_WORKSPACE", workspace_not_found: "UNKNOWN_WORKSPACE",
  access_required: "USER_NOT_PROVISIONED", not_provisioned: "USER_NOT_PROVISIONED",
  access_mapping_conflict: "ACCESS_MAPPING_CONFLICT", user_suspended: "USER_SUSPENDED",
  suspended: "USER_SUSPENDED", user_removed: "USER_REMOVED", directory_sync_pending: "DIRECTORY_SYNC_PENDING",
  directory_stale: "DIRECTORY_STALE", directory_stale_access_request_available: "DIRECTORY_STALE_ACCESS_REQUEST_AVAILABLE",
  workspace_suspended: "WORKSPACE_SUSPENDED", session_expired: "SESSION_EXPIRED", rate_limited: "RATE_LIMITED",
  temporarily_unavailable: "PROVIDER_UNAVAILABLE", login_failed: "INTERNAL_ERROR",
  provider_rejected: "GOOGLE_CONSENT_CANCELLED", active_authority: "FORBIDDEN",
};

test("all uppercase states and legacy callback keys map through the closed registry", async () => {
  for (const state of RECOVERY_STATES) {
    const model = await resolveLoginPageModel(new Headers(), state, deps());
    assert.equal(model.kind, "RENDER");
    assert.equal(model.state, state);
    assert.ok(model.actions.length >= 1 && model.actions.length <= 2);
  }
  for (const [input, state] of Object.entries(legacyMappings)) {
    const model = await resolveLoginPageModel(new Headers(), input, deps());
    assert.equal(model.kind, "RENDER");
    assert.equal(model.state, state, input);
  }
  for (const input of ["unknown", ["UNKNOWN_WORKSPACE", "FORBIDDEN"], { action: "START_ORGANIZATION_SETUP" }]) {
    const model = await resolveLoginPageModel(new Headers(), input, deps());
    assert.equal(model.kind, "RENDER");
    assert.equal(model.state, null);
    assert.deepEqual(actionIds(model), ["START_NORMAL_LOGIN"]);
  }
});

test("current Web roles redirect only to fixed destinations and stale route authority renders login", async () => {
  for (const [route, destination] of [["ADMIN", "/admin"], ["ALLOW", "/home"]] as const) {
    const model = await resolveLoginPageModel(new Headers({ cookie: `${WEB_SESSION_COOKIE_NAME}=${RAW}` }), undefined, deps({
      inspectAuthority: async () => ({ ...inspection(), active: true, activeKind: "WEB_SESSION" }), resolveWebRoute: async () => route,
    }));
    assert.deepEqual(model, { kind: "REDIRECT", destination });
  }
  const stale = await resolveLoginPageModel(new Headers({ cookie: `${WEB_SESSION_COOKIE_NAME}=${RAW}` }), undefined, deps({
    inspectAuthority: async () => ({ ...inspection(), active: true, activeKind: "WEB_SESSION" }),
  }));
  assert.equal(stale.kind, "RENDER");
  assert.deepEqual(actionIds(stale), ["START_NORMAL_LOGIN"]);
});

test("each authenticated onboarding family derives CSRF and selects executable actions", async () => {
  const cases = [
    [RECOVERY_OPERATION_FAMILIES.FIRST_DOMAIN, "UNKNOWN_WORKSPACE", ["START_ORGANIZATION_SETUP", "SWITCH_GOOGLE_ACCOUNT"]],
    [RECOVERY_OPERATION_FAMILIES.ACCESS_REQUEST, "USER_NOT_PROVISIONED", ["SUBMIT_ACCESS_REQUEST", "SWITCH_GOOGLE_ACCOUNT"]],
    [RECOVERY_OPERATION_FAMILIES.BOOTSTRAP_STATUS, "DIRECTORY_BOOTSTRAP_SYNC_PENDING", ["CHECK_BOOTSTRAP_STATUS", "EXIT_ONBOARDING"]],
  ] as const;
  for (const [operations, state, actions] of cases) {
    const model = await resolveLoginPageModel(new Headers({ cookie: `${ONBOARDING_COOKIE_NAME}=${RAW}` }), undefined, deps({ inspectAuthority: async () => inspection(authority(operations)) }));
    assert.equal(model.kind, "RENDER");
    assert.equal(model.state, state);
    assert.deepEqual(actionIds(model), actions);
    assert.equal(model.csrfToken, deriveCsrfCredential(RAW, PEPPER));
  }
});

test("wrong-family state cannot unlock its capability action", async () => {
  const model = await resolveLoginPageModel(new Headers({ cookie: `${ONBOARDING_COOKIE_NAME}=${RAW}` }), "UNKNOWN_WORKSPACE", deps({
    inspectAuthority: async () => inspection(authority(RECOVERY_OPERATION_FAMILIES.ACCESS_REQUEST)),
  }));
  assert.equal(model.kind, "RENDER");
  assert.deepEqual(actionIds(model), ["SWITCH_GOOGLE_ACCOUNT"]);
});

test("malformed duplicate simultaneous expired revoked or failed authority never derives capability", async () => {
  for (const clears of [["malformed"], ["duplicate"], ["web", "onboarding"], ["expired"], ["revoked"]]) {
    const model = await resolveLoginPageModel(new Headers({ cookie: `${ONBOARDING_COOKIE_NAME}=${RAW}` }), "UNKNOWN_WORKSPACE", deps({
      inspectAuthority: async () => ({ ...inspection(), staleCookieHeaders: clears }),
    }));
    assert.equal(model.kind, "RENDER");
    assert.equal(model.csrfToken, null);
    assert.deepEqual(actionIds(model), ["SWITCH_GOOGLE_ACCOUNT"]);
  }
});

test("runtime or database uncertainty returns unavailable without capability", async () => {
  for (const failure of [
    deps({ loadConfig: () => { throw new Error("config secret"); } }),
    deps({ inspectAuthority: async () => { throw new Error("db credential"); } }),
  ]) {
    const model = await resolveLoginPageModel(new Headers({ cookie: `${ONBOARDING_COOKIE_NAME}=${RAW}` }), "UNKNOWN_WORKSPACE", failure);
    assert.equal(model.kind, "RENDER");
    assert.equal(model.state, "PROVIDER_UNAVAILABLE");
    assert.equal(model.csrfToken, null);
    assert.deepEqual(actionIds(model), ["START_NORMAL_LOGIN", "CONTACT_UPTECH"]);
  }
});

test("serialized result excludes raw credentials and every hostile query field", async () => {
  const hostile = "attacker@example.com/customer/tenant/javascript:alert(1)/OWNER/FIRST_DOMAIN_CLAIM_COMPLETE";
  const model = await resolveLoginPageModel(new Headers({ cookie: `${ONBOARDING_COOKIE_NAME}=${RAW}` }),
    { error: "UNKNOWN_WORKSPACE", action: hostile, returnUrl: hostile, tenant: hostile, domain: hostile, email: hostile, role: hostile, method: hostile },
    deps({ inspectAuthority: async () => inspection(authority(RECOVERY_OPERATION_FAMILIES.FIRST_DOMAIN)) }));
  const serialized = JSON.stringify(model);
  assert.equal(serialized.includes(RAW), false);
  assert.equal(serialized.includes(hostile), false);
  assert.equal(serialized.includes("FIRST_DOMAIN_CLAIM_COMPLETE"), false);
  assert.equal(model.kind, "RENDER");
  assert.equal(model.state, "UNKNOWN_WORKSPACE");
});
