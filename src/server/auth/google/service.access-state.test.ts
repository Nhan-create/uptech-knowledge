import assert from "node:assert/strict";
import test from "node:test";

import {
  GOOGLE_LOGIN_CONFIGURATION_KEY,
  type GoogleLoginRuntimeConfig,
} from "./config.ts";
import { hashProof, pkceAssociatedData } from "./crypto.ts";
import type { GoogleOidcClient } from "./oidc.ts";
import type {
  BeginGoogleLoginInput,
  GoogleLoginAccessState,
  GoogleLoginRepository,
} from "./repository.ts";
import { createGoogleLoginService } from "./service.ts";

const REQUEST_ID = "00000000-0000-4000-8000-000000000012";
const CLIENT_IP = "203.0.113.18";
const state = Buffer.alloc(32, 1).toString("base64url");
const nonce = Buffer.alloc(32, 2).toString("base64url");
const pkceVerifier = Buffer.alloc(32, 3).toString("base64url");

const config: GoogleLoginRuntimeConfig = Object.freeze({
  appOrigin: "https://unknown.example",
  redirectUri: "https://unknown.example/api/v1/auth/google/callback",
  clientId: "unknown-workspace-client",
  clientSecret: "test-only-client-secret",
  environmentId: "test",
  databaseUrl: "postgresql://unknown.example/test",
  rateHmacKey: Uint8Array.from(Buffer.alloc(32, 4)),
  pkceEncryptionKey: Uint8Array.from(Buffer.alloc(32, 5)),
  pkceKeyVersion: "test-v1",
  sessionPepper: Uint8Array.from(Buffer.alloc(32, 6)),
});

const oidc: GoogleOidcClient = {
  async createAuthorizationTransaction() {
    return {
      state,
      nonce,
      pkceVerifier,
      pkceChallenge: Buffer.alloc(32, 7).toString("base64url"),
    };
  },
  async buildAuthorizationUrl() {
    return new URL("https://accounts.google.com/o/oauth2/v2/auth");
  },
  async exchangeAuthorizationCode() {
    const now = Math.floor(Date.now() / 1_000);
    return {
      iss: "https://accounts.google.com",
      sub: "subject-unknown-workspace",
      aud: config.clientId,
      iat: now - 1,
      exp: now + 3_600,
      nonce,
      email: "person@unknown.example",
      email_verified: true,
      hd: "unknown.example",
    };
  },
};

async function callbackFor(completion: unknown) {
  let transaction: BeginGoogleLoginInput | undefined;
  const repository: GoogleLoginRepository = {
    async begin(input) {
      transaction = input;
      return {
        outcome: "CREATED",
        expiresAt: new Date("2026-09-01T04:15:00.000Z"),
      };
    },
    async consume(input) {
      assert.ok(transaction !== undefined);
      assert.deepEqual(input.stateHash, hashProof(state));
      return {
        outcome: "RESERVED",
        configurationKey: GOOGLE_LOGIN_CONFIGURATION_KEY,
        expectedNonceHash: transaction.nonceHash,
        pkceEnvelope: transaction.pkceEnvelope,
        pkceKmsKeyVersion: config.pkceKeyVersion,
        pkceAssociatedData: pkceAssociatedData({
          environmentId: config.environmentId,
          locatorHash: transaction.stateHash,
        }),
        completionExpiresAt: new Date("2026-09-01T04:15:00.000Z"),
      };
    },
    async complete() {
      return completion as never;
    },
    async rejectUnbound() {
      return "RECORDED";
    },
    async rejectBound() {
      return "RECORDED";
    },
  };
  const service = createGoogleLoginService({ config, repository, oidc });
  const initiation = await service.initiate({
    canonicalClientIp: CLIENT_IP,
    requestId: REQUEST_ID,
  });
  assert.equal(initiation.outcome, "REDIRECT");
  if (initiation.outcome !== "REDIRECT") {
    assert.fail("expected a redirect transaction");
  }

  return service.callback({
    canonicalClientIp: CLIENT_IP,
    callbackSearch: `?code=provider-code&state=${state}`,
    loginCookie: initiation.loginCookie,
    requestId: REQUEST_ID,
  });
}

for (const completion of [
  {
    outcome: "ONBOARDING",
    accessState: "UNKNOWN_WORKSPACE",
    allowedOperations: [
      "FIRST_DOMAIN_CLAIM_READ",
      "FIRST_DOMAIN_CLAIM_RESERVE",
      "FIRST_DOMAIN_CLAIM_COMPLETE",
      "ACCESS_REQUEST_READ",
      "ACCESS_REQUEST_SUBMIT",
    ],
    expiresAt: new Date("2026-09-01T04:15:00.000Z"),
  },
  {
    outcome: "ONBOARDING",
    accessState: "USER_NOT_PROVISIONED",
    allowedOperations: ["ACCESS_REQUEST_READ", "ACCESS_REQUEST_SUBMIT"],
    expiresAt: new Date("2026-09-01T04:15:00.000Z"),
  },
  { outcome: "DENIED", accessState: "USER_SUSPENDED" },
  { outcome: "DENIED", accessState: "WORKSPACE_SUSPENDED" },
] as const) {
  test(`callback returns only fixed ${completion.accessState} access denial`, async () => {
    const result = await callbackFor(completion);
    const expectedAccessState: GoogleLoginAccessState = completion.accessState;

    assert.deepEqual(result, {
      outcome: "ACCESS_DENIED",
      accessState: expectedAccessState,
    });
    assert.deepEqual(Object.keys(result).sort(), ["accessState", "outcome"]);
  });
}
