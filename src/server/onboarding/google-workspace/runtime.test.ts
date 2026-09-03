import assert from "node:assert/strict";
import test from "node:test";

import { issueOpaqueProof } from "../../auth/google/crypto.ts";
import type { GoogleLoginRuntimeConfig } from "../../auth/google/config.ts";
import type { SecretReference } from "../../secrets/core.ts";
import { GOOGLE_DIRECTORY_READ_ONLY_SCOPES } from "../../people-data/google-directory-scopes.ts";
import { openGoogleWorkspaceSetupCookie } from "./crypto.ts";
import {
  createConfiguredGoogleWorkspaceBootstrapRuntime,
  GOOGLE_WORKSPACE_BOOTSTRAP_CALLBACK_PATH,
} from "./runtime.ts";

const NOW = new Date("2026-09-04T00:00:00.000Z");
const SOURCE = issueOpaqueProof();
const REQUEST_ID = "10000000-0000-4000-8000-000000000004";
const IDENTITY_ID = "10000000-0000-4000-8000-000000000003";
const KEY = new Uint8Array(32).fill(7);
const CONFIG = Object.freeze({
  appOrigin: "https://knowledge.uptech.example",
  redirectUri: "https://knowledge.uptech.example/api/v1/auth/google/callback",
  clientId: "directory-client.apps.googleusercontent.com",
  clientSecret: "directory-client-secret",
  environmentId: "test",
  databaseUrl: "postgresql://runtime@db.example/uptech",
  rateHmacKey: new Uint8Array(32).fill(1),
  pkceEncryptionKey: KEY,
  pkceKeyVersion: "v1",
  sessionPepper: new Uint8Array(32).fill(2),
}) satisfies GoogleLoginRuntimeConfig;

test("configured bootstrap runtime wires approved authorities and a zero-input worker without exposing configuration", async () => {
  const environment = Object.freeze({
    UPTECH_TENANT_ID: "caller-controlled-tenant",
    UPTECH_GOOGLE_CUSTOMER_ID: "caller-controlled-customer",
    UPTECH_CONNECTOR_ID: "caller-controlled-connector",
    UPTECH_JOB_ID: "caller-controlled-job",
  });
  const sql: string[] = [];
  const pool = {
    async query(text: string) {
      sql.push(text);
      if (text.includes("authenticate_google_workspace_bootstrap_source_v1")) {
        return { rows: [{
          identity_id: IDENTITY_ID,
          provider_subject: "google-sub",
          normalized_email: "owner@company.example",
          hosted_domain: "company.example",
          identity_active: true,
          user_active: true,
        }] };
      }
      if (text.includes("prepare_google_workspace_bootstrap_v1")) {
        return { rows: [{ outcome: "PREPARED" }] };
      }
      if (text.includes("complete_google_workspace_bootstrap_v1")) {
        return { rows: [{
          outcome: "PROVISIONING",
          status_expires_at: new Date("2026-09-05T00:00:00.000Z"),
        }] };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    },
  };
  let providerConfig: unknown;
  const refreshToken = new TextEncoder().encode("refresh-token");
  const provider = {
    async createAuthorization() {
      return {
        state: issueOpaqueProof(),
        nonce: issueOpaqueProof(),
        pkceVerifier: issueOpaqueProof(),
        authorizationUrl: new URL("https://accounts.google.com/o/oauth2/v2/auth"),
      };
    },
    async exchangeAndProbe() {
      return {
        customerId: "C0123",
        directoryUserCustomerId: "C0123",
        directoryUserActive: true as const,
        primaryDomain: "company.example",
        verifiedDomains: [{
          normalizedDomain: "company.example",
          kind: "PRIMARY" as const,
          providerParentDomain: null,
          verified: true as const,
        }],
        providerSubject: "google-sub",
        normalizedEmail: "owner@company.example",
        hostedDomain: "company.example",
        refreshToken,
        grantedScopes: GOOGLE_DIRECTORY_READ_ONLY_SCOPES,
        isAdmin: true,
        isDelegatedAdmin: false,
        readProbes: {
          customer: true as const,
          users: true as const,
          groups: true as const,
          groupMembers: true as const,
          orgUnits: true as const,
        },
      };
    },
  };
  const secretCreates: unknown[] = [];
  const registration = {
    providerId: "google-cloud-secret-manager",
    configurationPresent: true,
    createAdapter() {
      return {
        async create(value: Uint8Array, metadata: unknown) {
          secretCreates.push({ value: Uint8Array.from(value), metadata });
          return "gcp-sm:v1:uptech-10000000-0000-4000-8000-000000000001" as SecretReference;
        },
        async read() { throw new Error("unused"); },
        async replace() { throw new Error("unused"); },
        async destroy() { throw new Error("unused"); },
      };
    },
  };
  let workerRuns = 0;
  let workerCloses = 0;
  const runtime = createConfiguredGoogleWorkspaceBootstrapRuntime(environment, {
    loadConfig(input) {
      assert.equal(input, environment);
      return CONFIG;
    },
    getPool(databaseUrl) {
      assert.equal(databaseUrl, CONFIG.databaseUrl);
      return pool as never;
    },
    createSecretProviderRegistration(input) {
      assert.equal(input, environment);
      return registration;
    },
    createProvider(config) {
      providerConfig = config;
      return provider as never;
    },
    createDirectoryWorker(input) {
      assert.equal(input, environment);
      return {
        async runNext() { workerRuns += 1; return { kind: "idle" as const }; },
        async close() { workerCloses += 1; },
      };
    },
    now: () => new Date(NOW),
  });

  assert.deepEqual(providerConfig, {
    clientId: CONFIG.clientId,
    clientSecret: CONFIG.clientSecret,
    redirectUri: `${CONFIG.appOrigin}${GOOGLE_WORKSPACE_BOOTSTRAP_CALLBACK_PATH}`,
  });
  assert.deepEqual(Object.keys(runtime).sort(), ["runDirectoryWorker", "service"]);
  assert.equal(JSON.stringify(runtime).includes(Buffer.from(KEY).toString("base64url")), false);

  const initiated = await runtime.service.initiate({
    onboardingCredential: SOURCE,
    requestId: REQUEST_ID,
  });
  const transaction = openGoogleWorkspaceSetupCookie(initiated.transactionCookie, {
    environmentId: CONFIG.environmentId,
    keyVersion: CONFIG.pkceKeyVersion,
    key: KEY,
    now: NOW,
  });
  assert.ok(transaction);
  const completed = await runtime.service.callback({
    onboardingCredential: SOURCE,
    callbackSearch: `?code=provider-code&state=${transaction.state}`,
    transactionCookie: initiated.transactionCookie,
    requestId: REQUEST_ID,
  });

  assert.equal(completed.outcome, "PROVISIONING");
  assert.equal(sql.filter((text) => text.includes("authenticate_google_workspace_bootstrap_source_v1")).length, 2);
  assert.equal(sql.some((text) => text.includes("prepare_google_workspace_bootstrap_v1")), true);
  assert.equal(sql.some((text) => text.includes("complete_google_workspace_bootstrap_v1")), true);
  assert.equal(secretCreates.length, 1);
  assert.equal(refreshToken.every((byte) => byte === 0), true);

  assert.equal(runtime.runDirectoryWorker.length, 0);
  assert.deepEqual(await runtime.runDirectoryWorker(), { kind: "idle" });
  assert.equal(workerRuns, 1);
  assert.equal(workerCloses, 1);
});

test("configured bootstrap runtime closes the production worker when its zero-input run fails", async () => {
  let closed = 0;
  const runtime = createConfiguredGoogleWorkspaceBootstrapRuntime({}, {
    loadConfig: () => CONFIG,
    getPool: () => ({ query: async () => ({ rows: [] }) }) as never,
    createSecretProviderRegistration: () => ({
      providerId: "approved",
      configurationPresent: true,
      createAdapter: () => ({
        async create() { throw new Error("unused"); },
        async read() { throw new Error("unused"); },
        async replace() { throw new Error("unused"); },
        async destroy() { throw new Error("unused"); },
      }),
    }),
    createProvider: () => providerStub() as never,
    createDirectoryWorker: () => ({
      async runNext() { throw new Error("worker unavailable"); },
      async close() { closed += 1; },
    }),
    now: () => new Date(NOW),
  });

  await assert.rejects(runtime.runDirectoryWorker(), /worker unavailable/u);
  assert.equal(closed, 1);
});

function providerStub() {
  return {
    async createAuthorization() { throw new Error("unused"); },
    async exchangeAndProbe() { throw new Error("unused"); },
  };
}
