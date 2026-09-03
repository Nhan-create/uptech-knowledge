import assert from "node:assert/strict";
import test from "node:test";

import { hashProof, issueOpaqueProof } from "../../auth/google/crypto.ts";
import type { SecretReference } from "../../secrets/core.ts";
import { GOOGLE_DIRECTORY_READ_ONLY_SCOPES } from "../../people-data/google-directory-scopes.ts";
import { openGoogleWorkspaceSetupCookie } from "./crypto.ts";
import {
  BootstrapServiceError,
  createGoogleWorkspaceBootstrapService,
} from "./service.ts";

const IDS = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
] as const;
const IDENTITY_ID = "10000000-0000-4000-8000-000000000003";
const REQUEST_ID = "10000000-0000-4000-8000-000000000004";
const NOW = new Date("2026-09-04T00:00:00.000Z");
const COOKIE_KEY = { environmentId: "test", keyVersion: "v1", key: new Uint8Array(32).fill(7) };
const SOURCE = issueOpaqueProof();
const STATUS = issueOpaqueProof();
const SECRET = "gcp-sm:v1:candidate" as SecretReference;

function fixture(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  let id = 0;
  const refreshToken = new TextEncoder().encode("refresh-token");
  const statusBytes = Uint8Array.from(Buffer.from(STATUS, "base64url"));
  const evidence = {
    customerId: "C0123",
    directoryUserCustomerId: "C0123",
    directoryUserActive: true as const,
    primaryDomain: "company.example",
    verifiedDomains: [{ normalizedDomain: "company.example", kind: "PRIMARY" as const, providerParentDomain: null, verified: true as const }],
    providerSubject: "google-sub",
    normalizedEmail: "owner@company.example",
    hostedDomain: "company.example",
    refreshToken,
    grantedScopes: [...GOOGLE_DIRECTORY_READ_ONLY_SCOPES],
    isAdmin: true,
    isDelegatedAdmin: false,
    readProbes: { customer: true, users: true, groups: true, groupMembers: true, orgUnits: true },
  };
  const sourceAuthority = {
    calls: [] as unknown[],
    async authenticate(input: unknown) {
      this.calls.push(input);
      calls.push("authenticate");
      return { identityId: IDENTITY_ID, providerSubject: "google-sub", normalizedEmail: "owner@company.example", hostedDomain: "company.example", identityActive: true, userActive: true };
    },
  };
  const provider = {
    exchanges: 0,
    async createAuthorization() {
      calls.push("authorization");
      return { state: issueOpaqueProof(), nonce: issueOpaqueProof(), pkceVerifier: issueOpaqueProof(), authorizationUrl: new URL("https://accounts.google.com/o/oauth2/v2/auth") };
    },
    async exchangeAndProbe() { this.exchanges += 1; calls.push("exchange"); return evidence; },
  };
  const repository = {
    prepareCalls: [] as unknown[], completeCalls: [] as unknown[], reconcileCalls: [] as unknown[], abortCalls: [] as unknown[],
    async prepare(input: unknown) { this.prepareCalls.push(input); calls.push("prepare"); return { outcome: "PREPARED" as const }; },
    async complete(input: unknown) { this.completeCalls.push(input); calls.push("complete"); return { outcome: "PROVISIONING" as const, statusExpiresAt: new Date("2026-09-05T00:00:00.000Z") }; },
    async reconcile(input: unknown): Promise<{ outcome: "COMMITTED" | "NOT_COMMITTED" | "UNKNOWN" }> { this.reconcileCalls.push(input); calls.push("reconcile"); return { outcome: "UNKNOWN" }; },
    async abort(input: unknown) { this.abortCalls.push(input); calls.push("abort"); return { outcome: "ABORTED" as const }; },
  };
  const secretAdapter = {
    createCalls: [] as any[], destroyCalls: [] as any[],
    async create(value: Uint8Array, metadata: unknown) { this.createCalls.push({ value: Uint8Array.from(value), metadata }); calls.push("secret.create"); return SECRET; },
    async read() { throw new Error("unused"); }, async replace() { throw new Error("unused"); },
    async destroy(reference: SecretReference, metadata: unknown) { this.destroyCalls.push({ reference, metadata }); calls.push("secret.destroy"); },
  };
  const service = createGoogleWorkspaceBootstrapService({
    now: () => new Date(NOW), nextId: () => IDS[id++]!, issueCredentialBytes: () => statusBytes,
    cookieKey: COOKIE_KEY, sourceAuthority, provider, repository, secretAdapter,
    ...overrides,
  } as never);
  return { service, calls, sourceAuthority, provider, repository, secretAdapter, evidence, refreshToken, statusBytes };
}

async function initiated(f = fixture()) {
  const result = await f.service.initiate({ onboardingCredential: SOURCE, requestId: REQUEST_ID });
  return { f, result, transaction: openGoogleWorkspaceSetupCookie(result.transactionCookie, { ...COOKIE_KEY, now: NOW })! };
}

test("initiate authenticates only reserve authority and seals fresh attempt, workspace, and identity binding", async () => {
  const { f, result, transaction } = await initiated();
  assert.deepEqual(f.sourceAuthority.calls[0], { credentialHash: hashProof(SOURCE), requiredOperation: "FIRST_DOMAIN_CLAIM_RESERVE" });
  assert.equal(result.authorizationUrl.origin, "https://accounts.google.com");
  assert.equal(transaction.attemptId, IDS[0]);
  assert.equal(transaction.candidateWorkspaceId, IDS[1]);
  assert.equal(transaction.identityId, IDENTITY_ID);
  assert.equal(transaction.providerSubject, "google-sub");
});

test("callback prepares before secret creation, completes, returns status authority, and zeroes raw bytes", async () => {
  const { f, result, transaction } = await initiated();
  const output = await f.service.callback({ onboardingCredential: SOURCE, callbackSearch: `?code=ok&state=${transaction.state}`, transactionCookie: result.transactionCookie, requestId: REQUEST_ID });
  assert.equal(f.provider.exchanges, 1);
  assert.deepEqual(f.calls.slice(-5), ["authenticate", "exchange", "prepare", "secret.create", "complete"]);
  assert.equal(output.outcome, "PROVISIONING");
  assert.equal(output.statusCredential, STATUS);
  assert.equal(f.refreshToken.every((byte) => byte === 0), true);
  assert.equal(f.statusBytes.every((byte) => byte === 0), true);
  assert.equal((f.secretAdapter.createCalls[0].metadata as any).bootstrapAttemptId, transaction.attemptId);
  assert.equal((f.secretAdapter.createCalls[0].metadata as any).workspaceId, transaction.candidateWorkspaceId);
  assert.deepEqual(f.secretAdapter.destroyCalls, []);
});

test("every invalid provider proof is denied before prepare, secret creation, or completion", async () => {
  const invalid = [
    ["CONSENT_ACCOUNT_MISMATCH", { providerSubject: "other" }],
    ["CONSENT_ACCOUNT_MISMATCH", { normalizedEmail: "other@company.example" }],
    ["CONSENT_ACCOUNT_MISMATCH", { hostedDomain: "other.example" }],
    ["SUPER_ADMIN_REQUIRED", { isAdmin: false, isDelegatedAdmin: false }],
    ["DELEGATED_ADMIN_UNSUPPORTED", { isAdmin: false, isDelegatedAdmin: true }],
    ["GOOGLE_ORGANIZATION_MISMATCH", { directoryUserCustomerId: "other" }],
    ["GOOGLE_ORGANIZATION_MISMATCH", { directoryUserActive: false }],
    ["DOMAIN_NOT_VERIFIED", { verifiedDomains: [] }],
    ["DIRECTORY_SCOPE_REQUIRED", { grantedScopes: GOOGLE_DIRECTORY_READ_ONLY_SCOPES.slice(0, -1) }],
    ["PROVIDER_UNAVAILABLE", { refreshToken: new Uint8Array() }],
    ["PROVIDER_UNAVAILABLE", { readProbes: { customer: true, users: true, groups: true, groupMembers: false, orgUnits: true } }],
  ] as const;
  for (const [code, patch] of invalid) {
    const f = fixture(); Object.assign(f.evidence, patch);
    const started = await initiated(f);
    await assert.rejects(f.service.callback({ onboardingCredential: SOURCE, callbackSearch: `?code=ok&state=${started.transaction.state}`, transactionCookie: started.result.transactionCookie, requestId: REQUEST_ID }), (error: unknown) => error instanceof BootstrapServiceError && error.code === code);
    assert.equal(f.secretAdapter.createCalls.length, 0, code);
    assert.equal(f.repository.completeCalls.length, 0, code);
  }
});

test("ambiguous completion reconciles without unsafe cleanup", async () => {
  for (const outcome of ["COMMITTED", "NOT_COMMITTED", "UNKNOWN"] as const) {
    const f = fixture();
    f.repository.complete = async () => { throw new Error(`leak ${SECRET}`); };
    f.repository.reconcile = async (input: unknown) => { f.repository.reconcileCalls.push(input); return { outcome }; };
    const started = await initiated(f);
    const callback = f.service.callback({ onboardingCredential: SOURCE, callbackSearch: `?code=ok&state=${started.transaction.state}`, transactionCookie: started.result.transactionCookie, requestId: REQUEST_ID });
    if (outcome === "COMMITTED") await assert.rejects(callback, (error: unknown) => error instanceof BootstrapServiceError && error.code === "PROVIDER_UNAVAILABLE");
    else await assert.rejects(callback, (error: unknown) => error instanceof BootstrapServiceError && !String(error).includes(SECRET));
    assert.equal(f.secretAdapter.destroyCalls.length, outcome === "NOT_COMMITTED" ? 1 : 0);
  }
});

test("secret creation failure aborts PREPARED and remains redacted", async () => {
  const f = fixture();
  f.secretAdapter.create = async () => { throw new Error(`leak ${SECRET}`); };
  const started = await initiated(f);
  await assert.rejects(f.service.callback({ onboardingCredential: SOURCE, callbackSearch: `?code=ok&state=${started.transaction.state}`, transactionCookie: started.result.transactionCookie, requestId: REQUEST_ID }), (error: unknown) => error instanceof BootstrapServiceError && error.code === "PROVIDER_UNAVAILABLE" && !String(error).includes(SECRET));
  assert.equal(f.repository.abortCalls.length, 1);
  assert.equal(f.repository.completeCalls.length, 0);
});

test("inactive source identity is rejected before exchanging or storing provider credentials", async () => {
  const started = await initiated();
  started.f.sourceAuthority.authenticate = async () => ({
    identityId: IDENTITY_ID, providerSubject: "google-sub", normalizedEmail: "owner@company.example",
    hostedDomain: "company.example", identityActive: false, userActive: true,
  });
  await assert.rejects(started.f.service.callback({
    onboardingCredential: SOURCE, callbackSearch: `?code=ok&state=${started.transaction.state}`,
    transactionCookie: started.result.transactionCookie, requestId: REQUEST_ID,
  }), (error: unknown) => error instanceof BootstrapServiceError && error.code === "ONBOARDING_EXPIRED");
  assert.equal(started.f.provider.exchanges, 0);
  assert.equal(started.f.secretAdapter.createCalls.length, 0);
});

test("candidate destroy failures never expose provider details or issue status authority", async () => {
  const f = fixture();
  f.repository.complete = async () => { throw new Error("ambiguous"); };
  f.repository.reconcile = async () => ({ outcome: "NOT_COMMITTED" });
  f.secretAdapter.destroy = async () => { throw new Error(`provider leaked ${SECRET}`); };
  const started = await initiated(f);
  await assert.rejects(f.service.callback({
    onboardingCredential: SOURCE, callbackSearch: `?code=ok&state=${started.transaction.state}`,
    transactionCookie: started.result.transactionCookie, requestId: REQUEST_ID,
  }), (error: unknown) => error instanceof BootstrapServiceError && error.code === "PROVIDER_UNAVAILABLE" && !String(error).includes(SECRET));
});
