import assert from "node:assert/strict";
import test from "node:test";

import {
  GOOGLE_WORKSPACE_SETUP_COOKIE_NAME,
  openGoogleWorkspaceSetupCookie,
  sealGoogleWorkspaceSetupCookie,
} from "./crypto.ts";

const key = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const now = new Date("2026-09-03T01:00:00.000Z");
const payload = Object.freeze({
  attemptId: "10000000-0000-4000-8000-000000000001",
  candidateWorkspaceId: "10000000-0000-4000-8000-000000000002",
  identityId: "10000000-0000-4000-8000-000000000003",
  providerSubject: "google-sub-1",
  normalizedEmail: "admin@company-a.com",
  hostedDomain: "company-a.com",
  state: "A".repeat(43),
  nonce: "B".repeat(43),
  pkceVerifier: "C".repeat(43),
  expiresAt: new Date("2026-09-03T01:10:00.000Z"),
});
const sealKey = { environmentId: "production", keyVersion: "setup-v1", key };

test("setup cookie authenticates the complete pre-tenant transaction", () => {
  const sealed = sealGoogleWorkspaceSetupCookie(payload, sealKey);
  assert.equal(GOOGLE_WORKSPACE_SETUP_COOKIE_NAME, "__Host-uptech_workspace_setup_tx");
  assert.deepEqual(openGoogleWorkspaceSetupCookie(sealed, { ...sealKey, now }), payload);
  assert.notEqual(sealGoogleWorkspaceSetupCookie(payload, sealKey).split(".")[1], sealed.split(".")[1]);
  const parts = sealed.split(".");
  const bytes = Buffer.from(parts[2]!, "base64url");
  bytes[0] ^= 1;
  parts[2] = bytes.toString("base64url");
  assert.equal(openGoogleWorkspaceSetupCookie(parts.join("."), { ...sealKey, now }), null);
});

test("setup cookie rejects cross-environment, malformed, duplicate, expired, and overlong transactions", () => {
  const sealed = sealGoogleWorkspaceSetupCookie(payload, sealKey);
  const contexts = [
    { ...sealKey, environmentId: "preview", now },
    { ...sealKey, keyVersion: "setup-v2", now },
    { ...sealKey, now: payload.expiresAt },
  ];
  for (const context of contexts) assert.equal(openGoogleWorkspaceSetupCookie(sealed, context), null);
  for (const value of [undefined, "", `${sealed};${sealed}`, `${sealed}.${sealed}`]) {
    assert.equal(openGoogleWorkspaceSetupCookie(value, { ...sealKey, now }), null);
  }
  const tooLate = { ...payload, expiresAt: new Date(now.getTime() + 600_001) };
  assert.equal(openGoogleWorkspaceSetupCookie(sealGoogleWorkspaceSetupCookie(tooLate, sealKey), { ...sealKey, now }), null);
});

test("setup cookie sealing rejects invalid identity and proof fields", () => {
  for (const patch of [
    { attemptId: "not-a-uuid" },
    { candidateWorkspaceId: "10000000-0000-3000-8000-000000000002" },
    { identityId: "10000000-0000-4000-7000-000000000003" },
    { providerSubject: "" },
    { normalizedEmail: "Admin@company-a.com" },
    { normalizedEmail: "not-an-email" },
    { normalizedEmail: "admin@company-b.com" },
    { hostedDomain: "Company-A.com" },
    { hostedDomain: "localhost" },
    { state: "!".repeat(43) },
    { nonce: "short" },
    { pkceVerifier: "short" },
  ]) {
    assert.throws(() => sealGoogleWorkspaceSetupCookie({ ...payload, ...patch }, sealKey), TypeError);
  }
});
