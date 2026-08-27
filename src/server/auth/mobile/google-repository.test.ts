import assert from "node:assert/strict";
import { test } from "node:test";

import { createMobileGoogleRepository } from "./google-repository.ts";

const claims = {
  issuer: "https://accounts.google.com" as const,
  providerSubject: "subject-1",
  normalizedEmail: "member@example.com",
  emailVerified: true as const,
  hostedDomain: "example.com",
  issuedAtEpochSeconds: 1_787_900_000,
  expiresAtEpochSeconds: 1_787_903_600,
  audienceConfigurationKey: "GOOGLE_WEB_LOGIN_V1" as const,
  authorizedPartyConfigurationKey: null,
  nonceHash: Uint8Array.from(Buffer.alloc(32, 1)),
  displayName: null,
  pictureUrl: null,
};

test("mobile Google repository preserves only an approved callback denial category", async () => {
  const repository = createMobileGoogleRepository({
    async query() {
      return { rows: [{
        outcome: "DENIED",
        app_return_uri: null,
        denial_category: "USER_NOT_PROVISIONED",
      }] } as never;
    },
  } as never);

  assert.deepEqual(await repository.complete({
    completionHandleHash: Uint8Array.from(Buffer.alloc(32, 2)),
    claims,
    handoffHash: Uint8Array.from(Buffer.alloc(32, 3)),
    requestId: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21",
  }), { outcome: "DENIED", category: "USER_NOT_PROVISIONED" });
});

test("mobile Google repository rejects an arbitrary callback denial category", async () => {
  const repository = createMobileGoogleRepository({
    async query() {
      return { rows: [{
        outcome: "DENIED",
        app_return_uri: null,
        denial_category: "member@example.com",
      }] } as never;
    },
  } as never);

  await assert.rejects(repository.complete({
    completionHandleHash: Uint8Array.from(Buffer.alloc(32, 2)),
    claims,
    handoffHash: Uint8Array.from(Buffer.alloc(32, 3)),
    requestId: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21",
  }));
});
