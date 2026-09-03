import assert from "node:assert/strict";
import test from "node:test";

import {
  openDirectoryConsentCookie,
  sealDirectoryConsentCookie,
} from "./directory-consent-crypto.ts";

const key = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const now = new Date("2026-09-03T06:00:00.000Z");
const transaction = Object.freeze({
  workspaceId: "10000000-0000-4000-8000-000000000001",
  identityId: "10000000-0000-4000-8000-000000000002",
  sessionId: "10000000-0000-4000-8000-000000000003",
  connectorId: "10000000-0000-4000-8000-000000000004",
  providerSubject: "google-subject-a",
  normalizedEmail: "admin@tenant-a.example",
  hostedDomain: "tenant-a.example",
  state: "A".repeat(43),
  nonce: "B".repeat(43),
  pkceVerifier: "C".repeat(43),
  expiresAt: new Date("2026-09-03T06:10:00.000Z"),
});

test("Directory consent cookie authenticates every tenant, session, and PKCE field", () => {
  const sealed = sealDirectoryConsentCookie(transaction, {
    environmentId: "production",
    keyVersion: "directory-v1",
    key,
  });

  assert.deepEqual(
    openDirectoryConsentCookie(sealed, {
      environmentId: "production",
      keyVersion: "directory-v1",
      key,
      now,
    }),
    transaction,
  );

  const parts = sealed.split(".");
  const ciphertext = Buffer.from(parts[2]!, "base64url");
  ciphertext[0] ^= 1;
  parts[2] = ciphertext.toString("base64url");
  assert.equal(openDirectoryConsentCookie(parts.join("."), {
    environmentId: "production",
    keyVersion: "directory-v1",
    key,
    now,
  }), null);
});

test("Directory consent cookie rejects expiry, wrong environment, and wrong key version", () => {
  const sealed = sealDirectoryConsentCookie(transaction, {
    environmentId: "production",
    keyVersion: "directory-v1",
    key,
  });

  for (const context of [
    { environmentId: "preview", keyVersion: "directory-v1", key, now },
    { environmentId: "production", keyVersion: "directory-v2", key, now },
    {
      environmentId: "production",
      keyVersion: "directory-v1",
      key,
      now: new Date("2026-09-03T06:10:00.000Z"),
    },
  ]) {
    assert.equal(openDirectoryConsentCookie(sealed, context), null);
  }
});
