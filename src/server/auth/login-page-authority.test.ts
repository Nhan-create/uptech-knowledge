import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveLoginPageError,
  resolveLoginPageModel,
  resolveLoginPageViewModel,
  type LoginPageModelDependencies,
} from "./login-page-authority.ts";
import { RECOVERY_OPERATION_FAMILIES, RECOVERY_STATES, type RecoveryAuthority, type RecoveryState } from "./recovery-actions.ts";
import { deriveCsrfCredential, ONBOARDING_COOKIE_NAME } from "./google/crypto.ts";
import { WEB_SESSION_COOKIE_NAME } from "../sessions/session-security.ts";
import { inspectBrowserAuthority } from "./browser-authority.ts";

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
    resolveWebRoute: async () => ({ kind: "NOT_CURRENT" }),
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
  assert.equal(model.requestId, null);
  assert.equal(model.retryAfterSeconds, null);
  assert.equal("staleCookieHeaders" in model, false);
});

test("page-facing input returns only one canonical UUID v4", async () => {
  const valid = "772f7828-5e72-40d5-a6ba-096d7e09a3ce";
  for (const [request_id, expected] of [
    [valid, valid],
    ["772f7828-5e72-10d5-a6ba-096d7e09a3ce", null],
    ["772F7828-5E72-40D5-A6BA-096D7E09A3CE", null],
    [[valid, "00000000-0000-4000-8000-000000000001"], null],
    [{ value: valid }, null],
  ] as const) {
    const model = await resolveLoginPageViewModel(new Headers(), { request_id }, deps());
    assert.equal(model.kind, "RENDER");
    assert.equal(model.requestId, expected);
  }
});

test("internal error exposes copy only when a validated request ID exists", async () => {
  const requestId = "772f7828-5e72-40d5-a6ba-096d7e09a3ce";
  const withId = await resolveLoginPageViewModel(new Headers(), {
    error: "INTERNAL_ERROR",
    request_id: requestId,
  }, deps());
  assert.deepEqual(actionIds(withId), ["START_NORMAL_LOGIN", "COPY_REQUEST_ID"]);

  const withoutId = await resolveLoginPageViewModel(new Headers(), {
    error: "INTERNAL_ERROR",
  }, deps());
  assert.deepEqual(actionIds(withoutId), ["START_NORMAL_LOGIN"]);
});

test("only rate limiting receives a fixed server-owned positive cooldown", async () => {
  const rateLimited = await resolveLoginPageViewModel(new Headers(), {
    error: "RATE_LIMITED",
    retry_after_seconds: 999_999,
  } as never, deps());
  assert.equal(rateLimited.kind, "RENDER");
  assert.equal(typeof rateLimited.retryAfterSeconds, "number");
  assert.ok((rateLimited.retryAfterSeconds ?? 0) > 0);
  assert.ok((rateLimited.retryAfterSeconds ?? Infinity) < 300);

  const internal = await resolveLoginPageViewModel(new Headers(), {
    error: "INTERNAL_ERROR",
    retry_after_seconds: 999_999,
  } as never, deps());
  assert.equal(internal.kind, "RENDER");
  assert.equal(internal.retryAfterSeconds, null);
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
  provider_rejected: "INTERNAL_ERROR", active_authority: "SESSION_REVOKED",
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

test("current Web roles redirect only to fixed destinations and stale authority exposes no cookie header", async () => {
  for (const [route, destination] of [["ADMIN", "/admin"], ["ALLOW", "/home"]] as const) {
    const model = await resolveLoginPageModel(new Headers({ cookie: `${WEB_SESSION_COOKIE_NAME}=${RAW}` }), undefined, deps({
      inspectAuthority: async () => ({ ...inspection(), active: true, activeKind: "WEB_SESSION" }),
      resolveWebRoute: async () => ({ kind: "ROUTE", decision: route }),
    }));
    assert.deepEqual(model, { kind: "REDIRECT", destination });
  }
  const stale = await resolveLoginPageModel(new Headers({ cookie: `${WEB_SESSION_COOKIE_NAME}=${RAW}` }), undefined, deps({
    inspectAuthority: async () => ({ ...inspection(), active: true, activeKind: "WEB_SESSION" }),
  }));
  assert.equal(stale.kind, "RENDER");
  assert.equal(stale.state, "SESSION_REVOKED");
  assert.equal("staleCookieHeaders" in stale, false);
  assert.deepEqual(actionIds(stale), ["START_NORMAL_LOGIN", "SWITCH_GOOGLE_ACCOUNT"]);
  const afterClear = await resolveLoginPageModel(new Headers(), undefined, deps());
  assert.equal(afterClear.kind, "RENDER");
  assert.deepEqual(actionIds(afterClear), ["START_NORMAL_LOGIN"]);
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

test("unrecognized onboarding family removes authority and CSRF", async () => {
  const invalid = authority(["FUTURE_OPERATION"]);
  const model = await resolveLoginPageModel(new Headers({ cookie: `${ONBOARDING_COOKIE_NAME}=${RAW}` }), undefined, deps({
    inspectAuthority: async () => inspection(invalid),
  }));
  assert.equal(model.kind, "RENDER");
  assert.equal(model.state, null);
  assert.equal(model.csrfToken, null);
  assert.deepEqual(actionIds(model), ["START_NORMAL_LOGIN"]);
});

test("real duplicate values and canonical authenticator failure never derive capability", async () => {
  for (const [cookie, authenticatedContext] of [
    [`${ONBOARDING_COOKIE_NAME}=${RAW}; ${ONBOARDING_COOKIE_NAME}=${"B".repeat(43)}`, null],
    [`${ONBOARDING_COOKIE_NAME}=${RAW}`, null],
    [`${ONBOARDING_COOKIE_NAME}=${RAW}`, {
      kind: "onboarding", contextExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
      allowedOperations: ["FUTURE_OPERATION"],
    }],
  ] as const) {
    const model = await resolveLoginPageModel(new Headers({ cookie }), "UNKNOWN_WORKSPACE", deps({
      inspectAuthority: (headers, actualPool, options) => inspectBrowserAuthority(headers, actualPool, {
        ...options,
        authenticateSession: async () => authenticatedContext as never,
      }),
    }));
    assert.equal(model.kind, "RENDER");
    assert.equal(model.csrfToken, null);
    assert.equal("staleCookieHeaders" in model, false);
    assert.deepEqual(actionIds(model), ["SWITCH_GOOGLE_ACCOUNT"]);
  }
});

test("runtime or database uncertainty returns unavailable without capability", async () => {
  for (const failure of [
    deps({ loadConfig: () => { throw new Error("config secret"); } }),
    deps({ inspectAuthority: async () => { throw new Error("db credential"); } }),
    deps({
      inspectAuthority: async () => ({ ...inspection(), active: true, activeKind: "WEB_SESSION" }),
      resolveWebRoute: async () => ({ kind: "UNAVAILABLE" }),
    }),
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
  const model = await resolveLoginPageViewModel(new Headers({ cookie: `${ONBOARDING_COOKIE_NAME}=${RAW}` }),
    { error: "UNKNOWN_WORKSPACE", request_id: hostile, action: hostile, returnUrl: hostile, tenant: hostile, domain: hostile, email: hostile, role: hostile, method: hostile } as never,
    deps({ inspectAuthority: async () => inspection(authority(RECOVERY_OPERATION_FAMILIES.FIRST_DOMAIN)) }));
  const serialized = JSON.stringify(model);
  assert.equal(serialized.includes(RAW), false);
  assert.equal(serialized.includes(hostile), false);
  assert.equal(serialized.includes("FIRST_DOMAIN_CLAIM_COMPLETE"), false);
  assert.equal(model.kind, "RENDER");
  assert.equal(model.state, "UNKNOWN_WORKSPACE");
  assert.equal(model.requestId, null);
  assert.deepEqual(JSON.parse(serialized), model);
  const keys = new Set<string>();
  JSON.parse(serialized, (key, value) => {
    keys.add(key);
    return value;
  });
  for (const forbidden of ["cookie", "headers", "staleCookieHeaders", "authority", "operations", "workspaceId", "customerId", "tenantId", "destination"]) {
    assert.equal(keys.has(forbidden), false, forbidden);
  }
});

test("legacy login error compatibility returns only accepted public keys unchanged", () => {
  assert.equal(resolveLoginPageError("unknown_workspace", "LOGIN"), "unknown_workspace");
  assert.equal(resolveLoginPageError("UNKNOWN_WORKSPACE", "LOGIN"), "UNKNOWN_WORKSPACE");
  assert.equal(resolveLoginPageError("provider_rejected", "HOME"), "provider_rejected");
  assert.equal(resolveLoginPageError(undefined, "LOGIN"), undefined);
});

test("legacy login error compatibility rejects provider detail and structured hostile input", () => {
  for (const input of [
    "access_denied: admin@example.com",
    "https://attacker.example/callback",
    "javascript:alert(1)",
    ["UNKNOWN_WORKSPACE", "INTERNAL_ERROR"],
    { error: "UNKNOWN_WORKSPACE" },
    401,
    null,
  ]) {
    assert.equal(resolveLoginPageError(input as never, "LOGIN"), undefined);
  }
  assert.equal(resolveLoginPageError("https://attacker.example", "UNAVAILABLE"), "temporarily_unavailable");
});
