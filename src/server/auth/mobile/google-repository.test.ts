import assert from "node:assert/strict";
import { test } from "node:test";

import { createMobileGoogleRepository } from "./google-repository.ts";

const claims = {
  issuer: "https://accounts.google.com" as const,
  providerSubject: "subject-1",
  normalizedEmail: "member@tenant-a.example",
  emailVerified: true as const,
  hostedDomain: "tenant-a.example",
  issuedAtEpochSeconds: 1_787_900_000,
  expiresAtEpochSeconds: 1_787_903_600,
  audienceConfigurationKey: "GOOGLE_WEB_LOGIN_V1" as const,
  authorizedPartyConfigurationKey: null,
  nonceHash: Uint8Array.from(Buffer.alloc(32, 1)),
  displayName: null,
  pictureUrl: null,
};

test("mobile Google repository preserves only an approved callback denial category", async () => {
  let sql = "";
  const repository = createMobileGoogleRepository({
    async query(text: string) {
      sql = text;
      return { rows: [{
        outcome: "DENIED",
        app_return_uri: "https://uptech-knowledge-sigma.vercel.app/auth/mobile/callback",
        denial_category: "USER_NOT_PROVISIONED",
      }] } as never;
    },
  } as never);

  assert.deepEqual(await repository.complete({
    completionHandleHash: Uint8Array.from(Buffer.alloc(32, 2)),
    claims,
    handoffHash: Uint8Array.from(Buffer.alloc(32, 3)),
    requestId: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21",
  }), {
    outcome: "DENIAL_HANDOFF",
    appReturnUri: "https://uptech-knowledge-sigma.vercel.app/auth/mobile/callback",
    category: "USER_NOT_PROVISIONED",
  });
  assert.match(sql, /complete_mobile_google_callback_directory_v2/u);
  assert.doesNotMatch(sql, /complete_mobile_google_callback_directory_v1/u);
  assert.doesNotMatch(sql, /FROM uptech\.complete_mobile_google_callback_v1\(/u);
});

test("mobile Google repository preserves the distinct suspended-workspace callback category", async () => {
  const repository = createMobileGoogleRepository({
    async query() {
      return { rows: [{
        outcome: "DENIED",
        app_return_uri: "https://uptech-knowledge-sigma.vercel.app/auth/mobile/callback",
        denial_category: "WORKSPACE_SUSPENDED",
      }] } as never;
    },
  } as never);

  assert.deepEqual(await repository.complete({
    completionHandleHash: Uint8Array.from(Buffer.alloc(32, 2)),
    claims,
    handoffHash: Uint8Array.from(Buffer.alloc(32, 3)),
    requestId: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21",
  }), {
    outcome: "DENIAL_HANDOFF",
    appReturnUri: "https://uptech-knowledge-sigma.vercel.app/auth/mobile/callback",
    category: "WORKSPACE_SUSPENDED",
  });
});

test("mobile Google repository creates bound provider denial handoffs through one routine", async () => {
  let sql = "";
  const repository = createMobileGoogleRepository({
    async query(text: string) {
      sql = text;
      return { rows: [{
        outcome: "DENIED",
        app_return_uri: "https://uptech-knowledge-sigma.vercel.app/auth/mobile/callback",
        denial_category: "GOOGLE_CANCELLED",
      }] } as never;
    },
  } as never);

  assert.deepEqual(await repository.completeDenial({
    completionHandleHash: Uint8Array.from(Buffer.alloc(32, 2)),
    handoffHash: Uint8Array.from(Buffer.alloc(32, 3)),
    rejectionClass: "PROVIDER_REJECTED",
    category: "GOOGLE_CANCELLED",
    requestId: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21",
  }), {
    outcome: "DENIAL_HANDOFF",
    appReturnUri: "https://uptech-knowledge-sigma.vercel.app/auth/mobile/callback",
    category: "GOOGLE_CANCELLED",
  });
  assert.match(sql, /complete_mobile_google_denial_v1/u);
});

test("mobile Google repository never treats an unbound denial as a handoff", async () => {
  const repository = createMobileGoogleRepository({
    async query() {
      return { rows: [{ outcome: "DENIED", app_return_uri: null, denial_category: "AUTH_ERROR" }] } as never;
    },
  } as never);

  assert.deepEqual(await repository.completeDenial({
    completionHandleHash: Uint8Array.from(Buffer.alloc(32, 2)),
    handoffHash: Uint8Array.from(Buffer.alloc(32, 3)),
    rejectionClass: "PROTOCOL_INVALID",
    category: "AUTH_ERROR",
    requestId: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21",
  }), { outcome: "DENIED" });
});

test("mobile Google repository rejects an arbitrary callback denial category", async () => {
  const repository = createMobileGoogleRepository({
    async query() {
      return { rows: [{
        outcome: "DENIED",
        app_return_uri: "https://uptech-knowledge-sigma.vercel.app/auth/mobile/callback",
        denial_category: "member@tenant-a.example",
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
