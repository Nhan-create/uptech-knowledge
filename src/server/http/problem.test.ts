import assert from "node:assert/strict";
import test from "node:test";

import {
  PROBLEM_CONTENT_TYPE,
  createSafeProblem,
  problemResponse,
  requestIdFromHeaders,
  safeProblemFromUnknown,
  type ProblemCode,
} from "./problem.ts";
import {
  RECOVERY_ACTION_IDS,
  RECOVERY_OPERATION_FAMILIES,
  RECOVERY_STATES,
  type RecoveryActionId,
  type RecoveryAuthority,
  type RecoveryOperation,
  type RecoveryState,
} from "../auth/recovery-actions.ts";

const REQUEST_ID = "00000000-0000-4000-8000-000000000123";

function authority(
  family: keyof typeof RECOVERY_OPERATION_FAMILIES,
): RecoveryAuthority {
  return Object.freeze({
    kind: "AUTHENTICATED_ONBOARDING",
    operations: RECOVERY_OPERATION_FAMILIES[family],
  });
}

const PROBLEM_CASES = [
  ["VALIDATION_FAILED", 400, "Validation failed", "The request is invalid."],
  ["UNAUTHENTICATED", 401, "Unauthenticated", "Authentication is required."],
  ["ACCESS_TOKEN_EXPIRED", 401, "Access token expired", "The access token must be refreshed."],
  ["SESSION_REVOKED", 401, "Session revoked", "The session is no longer active."],
  ["SESSION_EXPIRED", 401, "Session expired", "The session has expired."],
  ["FORBIDDEN", 403, "Forbidden", "The requested action is not allowed."],
  ["PERSONAL_GOOGLE_ACCOUNT", 403, "Google Workspace account required", "Use the Google Workspace account provided by your organization."],
  ["UNKNOWN_WORKSPACE", 403, "Unknown workspace", "The organization is not registered."],
  ["USER_NOT_PROVISIONED", 403, "Access not granted", "Access has not been granted for this account."],
  ["USER_SUSPENDED", 403, "Account suspended", "The account is suspended."],
  ["WORKSPACE_SUSPENDED", 403, "Workspace suspended", "The organization workspace is suspended."],
  ["POLICY_OR_DEVICE_BLOCKED", 403, "Access blocked", "The organization policy does not allow this sign-in."],
  ["GOOGLE_CANCELLED", 400, "Google sign-in cancelled", "Google sign-in was not completed."],
  ["AUTH_ERROR", 401, "Authentication error", "The sign-in request could not be verified."],
  ["NOT_FOUND", 404, "Not found", "The requested resource was not found."],
  ["CONFLICT", 409, "Conflict", "The request conflicts with the current state."],
  ["RATE_LIMITED", 429, "Rate limited", "Too many requests."],
  ["INTERNAL_ERROR", 500, "Internal error", "The request could not be completed."],
  ["PROVIDER_UNAVAILABLE", 503, "Provider unavailable", "A required provider is unavailable."],
  ["SYNC_DEGRADED", 503, "Sync degraded", "Required synchronized data is unavailable or stale."],
  ["SUPER_ADMIN_REQUIRED", 403, "Super administrator required", "A Google Workspace super administrator must complete this step."],
  ["DELEGATED_ADMIN_UNSUPPORTED", 403, "Super administrator required", "A Google Workspace super administrator must complete this step."],
  ["GOOGLE_CONSENT_CANCELLED", 400, "Google consent cancelled", "Google Workspace consent was not completed."],
  ["DIRECTORY_SCOPE_REQUIRED", 403, "Directory permission required", "Additional Google Workspace permission is required."],
  ["CONSENT_ACCOUNT_MISMATCH", 403, "Google account mismatch", "Use the Google Workspace account for this organization."],
  ["DOMAIN_NOT_VERIFIED", 403, "Domain verification required", "Google Workspace domain verification is required."],
  ["GOOGLE_ORGANIZATION_MISMATCH", 403, "Google organization mismatch", "The Google Workspace organization does not match."],
  ["ORGANIZATION_ALREADY_REGISTERED", 409, "Organization already registered", "This organization has already been registered."],
  ["ORGANIZATION_ALREADY_REGISTERED_ACCESS_REQUEST_AVAILABLE", 409, "Organization already registered", "This organization has already been registered."],
  ["DIRECTORY_BOOTSTRAP_SYNC_PENDING", 409, "Directory setup in progress", "Google Workspace directory setup is still in progress."],
  ["DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE", 503, "Directory setup retry required", "Google Workspace directory setup can be retried."],
  ["DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED", 503, "Directory setup needs support", "Google Workspace directory setup needs support."],
  ["ACCESS_MAPPING_CONFLICT", 409, "Access mapping conflict", "Access cannot be determined for this account."],
  ["USER_REMOVED", 403, "Account removed", "This account no longer has access."],
  ["DIRECTORY_SYNC_PENDING", 503, "Directory synchronization pending", "Google Workspace directory synchronization is pending."],
  ["DIRECTORY_STALE", 503, "Directory data stale", "Google Workspace directory data is unavailable or stale."],
  ["DIRECTORY_STALE_ACCESS_REQUEST_AVAILABLE", 503, "Directory data stale", "Google Workspace directory data is unavailable or stale."],
  ["ONBOARDING_EXPIRED", 401, "Onboarding expired", "The organization setup session has expired."],
] as const satisfies readonly (readonly [ProblemCode, number, string, string])[];

const RECOVERY_STATE_CASES = [
  ["PERSONAL_GOOGLE_ACCOUNT", ["SWITCH_GOOGLE_ACCOUNT", "OPEN_ENTERPRISE_LOGIN_HELP"], null],
  ["UNKNOWN_WORKSPACE", ["START_ORGANIZATION_SETUP", "SWITCH_GOOGLE_ACCOUNT"], "FIRST_DOMAIN"],
  ["SUPER_ADMIN_REQUIRED", ["SWITCH_GOOGLE_ACCOUNT", "COPY_SUPER_ADMIN_INSTRUCTIONS"], null],
  ["DELEGATED_ADMIN_UNSUPPORTED", ["SWITCH_GOOGLE_ACCOUNT", "COPY_SUPER_ADMIN_INSTRUCTIONS"], null],
  ["GOOGLE_CONSENT_CANCELLED", ["RESTART_DIRECTORY_CONSENT", "SWITCH_GOOGLE_ACCOUNT"], "FIRST_DOMAIN"],
  ["DIRECTORY_SCOPE_REQUIRED", ["RESTART_DIRECTORY_CONSENT", "SWITCH_GOOGLE_ACCOUNT"], "FIRST_DOMAIN"],
  ["CONSENT_ACCOUNT_MISMATCH", ["RESTART_DIRECTORY_CONSENT", "SWITCH_GOOGLE_ACCOUNT"], "FIRST_DOMAIN"],
  ["DOMAIN_NOT_VERIFIED", ["OPEN_DOMAIN_VERIFICATION_HELP", "SWITCH_GOOGLE_ACCOUNT"], null],
  ["GOOGLE_ORGANIZATION_MISMATCH", ["SWITCH_GOOGLE_ACCOUNT", "CONTACT_UPTECH"], null],
  ["ORGANIZATION_ALREADY_REGISTERED", ["START_NORMAL_LOGIN", "CONTACT_UPTECH"], null],
  ["ORGANIZATION_ALREADY_REGISTERED_ACCESS_REQUEST_AVAILABLE", ["SUBMIT_ACCESS_REQUEST", "SWITCH_GOOGLE_ACCOUNT"], "ACCESS_REQUEST"],
  ["DIRECTORY_BOOTSTRAP_SYNC_PENDING", ["CHECK_BOOTSTRAP_STATUS", "EXIT_ONBOARDING"], "BOOTSTRAP_STATUS"],
  ["DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE", ["RETRY_DIRECTORY_SYNC", "CONTACT_UPTECH"], "BOOTSTRAP_STATUS"],
  ["DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED", ["CONTACT_UPTECH", "EXIT_ONBOARDING"], "FIRST_DOMAIN"],
  ["USER_NOT_PROVISIONED", ["SUBMIT_ACCESS_REQUEST", "SWITCH_GOOGLE_ACCOUNT"], "ACCESS_REQUEST"],
  ["ACCESS_MAPPING_CONFLICT", ["SUBMIT_ACCESS_REQUEST", "EXIT_ONBOARDING"], "ACCESS_REQUEST"],
  ["USER_SUSPENDED", ["SWITCH_GOOGLE_ACCOUNT", "COPY_WORKSPACE_ADMIN_INSTRUCTIONS"], null],
  ["USER_REMOVED", ["SWITCH_GOOGLE_ACCOUNT", "COPY_WORKSPACE_ADMIN_INSTRUCTIONS"], null],
  ["DIRECTORY_SYNC_PENDING", ["COPY_WORKSPACE_ADMIN_INSTRUCTIONS", "START_NORMAL_LOGIN"], null],
  ["DIRECTORY_STALE", ["CONTACT_UPTECH", "START_NORMAL_LOGIN"], null],
  ["DIRECTORY_STALE_ACCESS_REQUEST_AVAILABLE", ["SUBMIT_ACCESS_REQUEST", "START_NORMAL_LOGIN"], "ACCESS_REQUEST"],
  ["WORKSPACE_SUSPENDED", ["CONTACT_UPTECH", "SWITCH_GOOGLE_ACCOUNT"], null],
  ["SESSION_REVOKED", ["START_NORMAL_LOGIN", "SWITCH_GOOGLE_ACCOUNT"], null],
  ["SESSION_EXPIRED", ["START_NORMAL_LOGIN", "SWITCH_GOOGLE_ACCOUNT"], null],
  ["ONBOARDING_EXPIRED", ["START_NORMAL_LOGIN", "CONTACT_UPTECH"], null],
  ["PROVIDER_UNAVAILABLE", ["START_NORMAL_LOGIN", "CONTACT_UPTECH"], null],
  ["RATE_LIMITED", ["START_NORMAL_LOGIN_AFTER_COOLDOWN", "CONTACT_UPTECH"], null],
  ["FORBIDDEN", ["SWITCH_GOOGLE_ACCOUNT", "CONTACT_UPTECH"], null],
  ["INTERNAL_ERROR", ["START_NORMAL_LOGIN", "COPY_REQUEST_ID"], null],
] as const satisfies readonly (readonly [RecoveryState, readonly RecoveryActionId[], keyof typeof RECOVERY_OPERATION_FAMILIES | null])[];

if (false) {
  // @ts-expect-error Recovery actions are selected by the problem code, never supplied by callers.
  createSafeProblem("NOT_FOUND", REQUEST_ID, ["CONTACT_UPTECH"]);
  const callerDirectedInput = {
    action_ids: ["CONTACT_UPTECH"],
    url: "https://tenant-b.example",
    method: "POST",
    return_to: "https://tenant-b.example/return",
  };
  // @ts-expect-error Caller-controlled transport and return data cannot stand in for authority.
  createSafeProblem("NOT_FOUND", REQUEST_ID, callerDirectedInput);
  // @ts-expect-error A caller cannot select an arbitrary recovery state.
  createSafeProblem("NOT_FOUND", REQUEST_ID, null, "FORBIDDEN");
}

test("creates safe snake_case problem documents with request IDs", () => {
  const problem = createSafeProblem("NOT_FOUND");

  assert.deepEqual(Object.keys(problem), [
    "type",
    "title",
    "status",
    "code",
    "detail",
    "request_id",
    "recovery_actions",
  ]);
  assert.equal(problem.status, 404);
  assert.equal(problem.code, "NOT_FOUND");
  assert.match(problem.request_id, /^[0-9a-f-]{36}$/u);
  assert.equal("requestId" in problem, false);
  assert.deepEqual(problem.recovery_actions, [
    "START_NORMAL_LOGIN",
    "COPY_REQUEST_ID",
  ]);
});

test("preserves a validated operation request ID for audit correlation", () => {
  const requestId = REQUEST_ID;
  const problem = createSafeProblem("FORBIDDEN", requestId);
  assert.equal(problem.request_id, requestId);
  assert.throws(
    () => createSafeProblem("FORBIDDEN", "caller-controlled-text"),
    TypeError,
  );
});

test("uses only a boundary-injected UUID for request correlation", () => {
  const trusted = REQUEST_ID;
  assert.equal(
    requestIdFromHeaders(new Headers({ "x-uptech-request-id": trusted })),
    trusted,
  );
  assert.notEqual(
    requestIdFromHeaders(
      new Headers({ "x-uptech-request-id": "caller-controlled" }),
    ),
    "caller-controlled",
  );
});

test("maps unknown errors to a fixed non-leaking problem", () => {
  const secret = "database-password-that-must-not-leak";
  const problem = safeProblemFromUnknown(new Error(secret));
  const serialized = JSON.stringify(problem);

  assert.equal(problem.code, "INTERNAL_ERROR");
  assert.equal(problem.status, 500);
  assert.doesNotMatch(serialized, new RegExp(secret, "u"));
});

test("emits application/problem+json, no-store, and the matching request ID", async () => {
  const problem = createSafeProblem("UNAUTHENTICATED");
  const response = problemResponse(problem);

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("content-type"), PROBLEM_CONTENT_TYPE);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-request-id"), problem.request_id);
  assert.deepEqual(await response.json(), problem);
});

test("every problem code has one or two known actions and its fixed safe definition", () => {
  for (const [code, status, title, detail] of PROBLEM_CASES) {
    const problem = createSafeProblem(code, REQUEST_ID);
    assert.deepEqual([problem.status, problem.title, problem.detail], [status, title, detail], code);
    assert.ok(problem.recovery_actions.length >= 1 && problem.recovery_actions.length <= 2, code);
    for (const action of problem.recovery_actions) assert.ok(RECOVERY_ACTION_IDS.includes(action), `${code}: ${action}`);
  }
});

test("maps legacy codes to their fixed recovery states", () => {
  const expected = {
    UNAUTHENTICATED: ["START_NORMAL_LOGIN", "SWITCH_GOOGLE_ACCOUNT"],
    ACCESS_TOKEN_EXPIRED: ["START_NORMAL_LOGIN", "SWITCH_GOOGLE_ACCOUNT"],
    POLICY_OR_DEVICE_BLOCKED: ["SWITCH_GOOGLE_ACCOUNT", "CONTACT_UPTECH"],
    SYNC_DEGRADED: ["CONTACT_UPTECH", "START_NORMAL_LOGIN"],
    GOOGLE_CANCELLED: ["START_NORMAL_LOGIN", "CONTACT_UPTECH"],
    VALIDATION_FAILED: ["START_NORMAL_LOGIN", "COPY_REQUEST_ID"],
    AUTH_ERROR: ["START_NORMAL_LOGIN", "COPY_REQUEST_ID"],
    NOT_FOUND: ["START_NORMAL_LOGIN", "COPY_REQUEST_ID"],
    CONFLICT: ["START_NORMAL_LOGIN", "COPY_REQUEST_ID"],
  } as const;
  for (const [code, actionIds] of Object.entries(expected) as readonly [ProblemCode, readonly string[]][]) {
    assert.deepEqual(createSafeProblem(code, REQUEST_ID).recovery_actions, actionIds, code);
  }
});

test("maps every direct recovery-state problem code to its exact public actions", () => {
  assert.deepEqual(RECOVERY_STATES, RECOVERY_STATE_CASES.map(([state]) => state));
  for (const [state, expectedActionIds, family] of RECOVERY_STATE_CASES) {
    assert.deepEqual(
      createSafeProblem(state, REQUEST_ID, family === null ? null : authority(family)).recovery_actions,
      expectedActionIds,
      state,
    );
  }
});

test("only an exact authority family exposes privileged recovery actions", () => {
  const privilegedCases = [
    ["UNKNOWN_WORKSPACE", "FIRST_DOMAIN", "START_ORGANIZATION_SETUP"],
    ["GOOGLE_CONSENT_CANCELLED", "FIRST_DOMAIN", "RESTART_DIRECTORY_CONSENT"],
    ["DIRECTORY_SCOPE_REQUIRED", "FIRST_DOMAIN", "RESTART_DIRECTORY_CONSENT"],
    ["CONSENT_ACCOUNT_MISMATCH", "FIRST_DOMAIN", "RESTART_DIRECTORY_CONSENT"],
    ["ORGANIZATION_ALREADY_REGISTERED_ACCESS_REQUEST_AVAILABLE", "ACCESS_REQUEST", "SUBMIT_ACCESS_REQUEST"],
    ["USER_NOT_PROVISIONED", "ACCESS_REQUEST", "SUBMIT_ACCESS_REQUEST"],
    ["ACCESS_MAPPING_CONFLICT", "ACCESS_REQUEST", "SUBMIT_ACCESS_REQUEST"],
    ["DIRECTORY_STALE_ACCESS_REQUEST_AVAILABLE", "ACCESS_REQUEST", "SUBMIT_ACCESS_REQUEST"],
    ["DIRECTORY_BOOTSTRAP_SYNC_PENDING", "BOOTSTRAP_STATUS", "CHECK_BOOTSTRAP_STATUS"],
    ["DIRECTORY_BOOTSTRAP_SYNC_PENDING", "BOOTSTRAP_STATUS", "EXIT_ONBOARDING"],
    ["DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE", "BOOTSTRAP_STATUS", "RETRY_DIRECTORY_SYNC"],
    ["DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED", "BOOTSTRAP_STATUS", "EXIT_ONBOARDING"],
    ["ACCESS_MAPPING_CONFLICT", "ACCESS_REQUEST", "EXIT_ONBOARDING"],
  ] as const satisfies readonly (readonly [ProblemCode, keyof typeof RECOVERY_OPERATION_FAMILIES, string])[];
  for (const [code, family, privilegedAction] of privilegedCases) {
    assert.ok(createSafeProblem(code, REQUEST_ID, authority(family)).recovery_actions.includes(privilegedAction), code);
    const expected = RECOVERY_OPERATION_FAMILIES[family];
    const hostileAuthorities = [
      null,
      { kind: "AUTHENTICATED_ONBOARDING", operations: [] },
      { kind: "OTHER", operations: expected },
      { kind: "AUTHENTICATED_ONBOARDING", operations: expected.slice(0, 1) },
      { kind: "AUTHENTICATED_ONBOARDING", operations: [...expected, "ACCESS_REQUEST_READ"] as readonly RecoveryOperation[] },
      { kind: "AUTHENTICATED_ONBOARDING", operations: [...expected].reverse() },
      { kind: "AUTHENTICATED_ONBOARDING", operations: [expected[0], expected[0], ...expected.slice(2)] },
    ];
    for (const hostile of hostileAuthorities) {
      assert.equal(
        createSafeProblem(code, REQUEST_ID, hostile as RecoveryAuthority).recovery_actions.includes(privilegedAction),
        false,
        `${code}: ${JSON.stringify(hostile)}`,
      );
    }

    for (const otherFamily of Object.keys(RECOVERY_OPERATION_FAMILIES) as (keyof typeof RECOVERY_OPERATION_FAMILIES)[]) {
      const actionIds = createSafeProblem(code, REQUEST_ID, authority(otherFamily)).recovery_actions;
      if (privilegedAction === "EXIT_ONBOARDING") {
        assert.ok(actionIds.includes(privilegedAction), `${code}: ${otherFamily}`);
      } else if (otherFamily !== family) {
        assert.equal(actionIds.includes(privilegedAction), false, `${code}: ${otherFamily}`);
      }
    }
  }
});

test("serializes IDs only and returns deeply immutable problem actions", () => {
  const secret = "provider-error token=top-secret database-password";
  const problem = createSafeProblem("UNKNOWN_WORKSPACE", REQUEST_ID, {
    kind: "AUTHENTICATED_ONBOARDING",
    operations: RECOVERY_OPERATION_FAMILIES.FIRST_DOMAIN,
    secret,
  } as RecoveryAuthority);
  const serialized = JSON.stringify(problem);

  assert.ok(Object.isFrozen(problem));
  assert.ok(Object.isFrozen(problem.recovery_actions));
  assert.doesNotMatch(serialized, /path|method|url|operation|authority|token|database-password|top-secret/u);
  assert.doesNotMatch(serialized, new RegExp(secret, "u"));
  assert.throws(() => (problem.recovery_actions as string[]).push("CONTACT_UPTECH"), TypeError);
});
