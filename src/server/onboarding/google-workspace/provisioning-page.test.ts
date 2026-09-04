import assert from "node:assert/strict";
import test from "node:test";

import { deriveCsrfCredential, hashProof, issueOpaqueProof, LOGIN_TRANSACTION_COOKIE_NAME, ONBOARDING_COOKIE_NAME } from "../../auth/google/crypto.ts";
import { RECOVERY_ACTION_DESCRIPTORS, RECOVERY_OPERATION_FAMILIES } from "../../auth/recovery-actions.ts";
import type { BrowserAuthorityInspection } from "../../auth/browser-authority.ts";
import { WEB_SESSION_COOKIE_NAME } from "../../sessions/session-security.ts";
import { GOOGLE_WORKSPACE_SETUP_COOKIE_NAME } from "./crypto.ts";
import {
  resolveProvisioningPageModel,
  type ProvisioningPageModelDependencies,
} from "./provisioning-page.ts";

const RAW = issueOpaqueProof();
const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";
const PEPPER = Buffer.alloc(32, 0x51);

function activeInspection(operations: unknown = RECOVERY_OPERATION_FAMILIES.BOOTSTRAP_STATUS): BrowserAuthorityInspection {
  return {
    active: true,
    activeKind: "ONBOARDING",
    onboardingAuthority: { kind: "AUTHENTICATED_ONBOARDING", operations },
    staleCookieHeaders: [],
  } as BrowserAuthorityInspection;
}

function fixture(outcome: unknown = "DIRECTORY_BOOTSTRAP_SYNC_PENDING") {
  const calls: unknown[] = [];
  const dependencies: ProvisioningPageModelDependencies = {
    loadConfig: () => ({ databaseUrl: "postgresql://tenant-a.example/uptech", sessionPepper: PEPPER }),
    getPool: () => ({ query: async () => ({ rows: [] }) } as never),
    inspectAuthority: async () => activeInspection(),
    createRepository: () => ({
      async readStatus(input) {
        calls.push(input);
        return outcome as never;
      },
    }),
    requestId: () => REQUEST_ID,
  };
  return { calls, dependencies };
}

function headers(cookie = `${ONBOARDING_COOKIE_NAME}=${RAW}`, extra: Record<string, string> = {}) {
  return new Headers({ cookie, ...extra });
}

const activeCases = [
  ["DIRECTORY_BOOTSTRAP_SYNC_PENDING", ["CHECK_BOOTSTRAP_STATUS", "EXIT_ONBOARDING"]],
  ["DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE", ["RETRY_DIRECTORY_SYNC", "CONTACT_UPTECH"]],
  ["DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED", ["CONTACT_UPTECH", "EXIT_ONBOARDING"]],
  ["READY", ["FINISH_BOOTSTRAP", "EXIT_ONBOARDING"]],
] as const;

test("four exact active outcomes render frozen public models with canonical actions and CSRF", async () => {
  for (const [outcome, expectedActions] of activeCases) {
    const f = fixture({ outcome });
    const model = await resolveProvisioningPageModel(headers(), f.dependencies);
    assert.equal(model.kind, "RENDER");
    if (model.kind !== "RENDER") continue;
    assert.equal(model.state, outcome);
    assert.deepEqual(model.actions.map((action) => action.id), expectedActions);
    assert.equal(model.csrfToken, deriveCsrfCredential(RAW, PEPPER));
    assert.equal(model.requestId, REQUEST_ID);
    assert.equal(Object.isFrozen(model), true);
    assert.equal(Object.isFrozen(model.actions), true);
    assert.doesNotThrow(() => JSON.stringify(model));
    assert.equal(f.calls.length, 1);
    const input = f.calls[0] as { statusTokenHash: Uint8Array; requestId: string };
    assert.deepEqual(input.statusTokenHash, hashProof(RAW));
    assert.equal(input.statusTokenHash.byteLength, 32);
    assert.equal(input.requestId, REQUEST_ID);
    assert.deepEqual(Object.keys(input).sort(), ["requestId", "statusTokenHash"]);
  }
});

test("READY exposes exactly finish and exit without any product or normal-login destination", async () => {
  const f = fixture({ outcome: "READY" });
  const model = await resolveProvisioningPageModel(headers(), f.dependencies);
  assert.equal(model.kind, "RENDER");
  if (model.kind !== "RENDER") return;
  assert.deepEqual(model.actions, [RECOVERY_ACTION_DESCRIPTORS.FINISH_BOOTSTRAP, RECOVERY_ACTION_DESCRIPTORS.EXIT_ONBOARDING]);
  assert.doesNotMatch(JSON.stringify(model), /START_NORMAL_LOGIN|\/admin|\/home/u);
});

test("expired and denied statuses redirect only to the fixed login recovery destination", async () => {
  for (const outcome of ["ONBOARDING_EXPIRED", "DENIED"] as const) {
    const f = fixture({ outcome });
    assert.deepEqual(await resolveProvisioningPageModel(headers(), f.dependencies), {
      kind: "REDIRECT",
      destination: `/login?error=ONBOARDING_EXPIRED&request_id=${REQUEST_ID}`,
    });
  }
});

test("missing, duplicate, malformed, overlong, coexisting, or authorized browser credentials never read status", async () => {
  const invalid = [
    new Headers(),
    headers(`${ONBOARDING_COOKIE_NAME}=${RAW}; ${ONBOARDING_COOKIE_NAME}=${RAW}`),
    headers(`${ONBOARDING_COOKIE_NAME}`),
    headers(`${ONBOARDING_COOKIE_NAME}=not-a-proof`),
    headers(`${ONBOARDING_COOKIE_NAME}=${"A".repeat(4_501)}`),
    headers(`${ONBOARDING_COOKIE_NAME}=${RAW}; ${WEB_SESSION_COOKIE_NAME}`),
    headers(`${ONBOARDING_COOKIE_NAME}=${RAW}; ${LOGIN_TRANSACTION_COOKIE_NAME}=bad`),
    headers(`${ONBOARDING_COOKIE_NAME}=${RAW}; ${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=bad`),
    headers(`${ONBOARDING_COOKIE_NAME}=${RAW}`, { authorization: "Bearer anything" }),
    headers(`${ONBOARDING_COOKIE_NAME}=${RAW}; x=${"a".repeat(16_384)}`),
  ];
  for (const input of invalid) {
    const f = fixture();
    const model = await resolveProvisioningPageModel(input, f.dependencies);
    assert.equal(model.kind, "REDIRECT");
    assert.equal(f.calls.length, 0);
  }
});

test("every non-exact onboarding operation family and uncertain inspection fails before status read", async () => {
  const expected = RECOVERY_OPERATION_FAMILIES.BOOTSTRAP_STATUS;
  const invalid = [
    null,
    [],
    expected.slice(0, 1),
    [...expected].reverse(),
    [expected[0], expected[0]],
    [...expected, "ACCESS_REQUEST_READ"],
    RECOVERY_OPERATION_FAMILIES.FIRST_DOMAIN,
    RECOVERY_OPERATION_FAMILIES.ACCESS_REQUEST,
    ["UNKNOWN_OPERATION"],
  ];
  for (const operations of invalid) {
    const f = fixture();
    f.dependencies.inspectAuthority = async () => activeInspection(operations) as never;
    const model = await resolveProvisioningPageModel(headers(), f.dependencies);
    assert.equal(model.kind, "REDIRECT");
    assert.equal(f.calls.length, 0);
  }
  for (const inspection of [
    { active: false, activeKind: null, onboardingAuthority: null, staleCookieHeaders: [] },
    { active: true, activeKind: "WEB_SESSION", onboardingAuthority: null, staleCookieHeaders: [] },
    { ...activeInspection(), staleCookieHeaders: ["clear"] },
  ]) {
    const f = fixture();
    f.dependencies.inspectAuthority = async () => inspection as never;
    assert.equal((await resolveProvisioningPageModel(headers(), f.dependencies)).kind, "REDIRECT");
    assert.equal(f.calls.length, 0);
  }
});

test("configuration, pool, inspection, repository failures and malformed results expose Contact only", async () => {
  const failures: Array<(dependencies: ProvisioningPageModelDependencies) => void> = [
    (d) => { d.loadConfig = () => { throw new Error("secret config"); }; },
    (d) => { d.loadConfig = () => ({ databaseUrl: "postgresql://tenant-a.example/uptech", sessionPepper: Buffer.alloc(31) }); },
    (d) => { d.getPool = () => { throw new Error("secret database"); }; },
    (d) => { d.inspectAuthority = async () => { throw new Error("secret inspection"); }; },
    (d) => { d.createRepository = () => ({ readStatus: async () => { throw new Error("secret row"); } }); },
  ];
  for (const mutate of failures) {
    const f = fixture();
    mutate(f.dependencies);
    assert.deepEqual(await resolveProvisioningPageModel(headers(), f.dependencies), {
      kind: "UNAVAILABLE",
      actions: [RECOVERY_ACTION_DESCRIPTORS.CONTACT_UPTECH],
      requestId: REQUEST_ID,
    });
  }
  for (const malformed of [null, {}, { outcome: "READY", workspaceId: "leak" }, { outcome: "UNKNOWN" }]) {
    const f = fixture(malformed);
    const model = await resolveProvisioningPageModel(headers(), f.dependencies);
    assert.equal(model.kind, "UNAVAILABLE");
    assert.deepEqual(model.actions, [RECOVERY_ACTION_DESCRIPTORS.CONTACT_UPTECH]);
  }
});

test("serialized public models contain no raw authority, credential, infrastructure, or arbitrary destination", async () => {
  const f = fixture({ outcome: "READY" });
  const model = await resolveProvisioningPageModel(headers(), f.dependencies);
  const serialized = JSON.stringify(model);
  for (const forbidden of [RAW, "postgresql://", "tenant-b.example", "secret config", "secret row"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  const keys = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      visit(child);
    }
  };
  visit(model);
  for (const forbiddenKey of ["statusTokenHash", "credential", "workspaceId", "tenantId", "customerId", "identityId", "providerSubject", "connectorId", "jobId", "staleCookieHeaders", "destination"]) {
    assert.equal(keys.has(forbiddenKey), false, forbiddenKey);
  }
});
