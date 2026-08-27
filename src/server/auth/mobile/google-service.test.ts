import assert from "node:assert/strict";
import { test } from "node:test";

import { createMobileGoogleService } from "./google-service.ts";
import { clientNetworkHmac } from "../google/crypto.ts";

test("mobile Google initiation binds platform proofs and returns only a server URL", async () => {
  let beginInput: Record<string, unknown> | null = null;
  const service = createMobileGoogleService({
    config: {
      callbackUri: "https://uptech-knowledge-sigma.vercel.app/api/v1/auth/mobile/google/callback",
      appReturnUri: "https://uptech-knowledge-sigma.vercel.app/auth/mobile/callback",
      databaseUrl: "postgres://unused/test", environmentId: "test",
      clientId: "client", clientSecret: "secret",
      rateHmacKey: Uint8Array.from(Buffer.alloc(32, 1)),
      pkceEncryptionKey: Uint8Array.from(Buffer.alloc(32, 2)), pkceKeyVersion: "v1",
      sessionPepper: Uint8Array.from(Buffer.alloc(32, 3)),
      refreshReplayKey: Uint8Array.from(Buffer.alloc(32, 4)),
    },
    repository: {
      async begin(input) { beginInput = input as unknown as Record<string, unknown>; return { outcome: "CREATED" } as const; },
      async consume() { throw new Error("unused"); }, async complete() { throw new Error("unused"); },
      async reject() { return "RECORDED" as const; },
    },
    oidc: {
      async createAuthorizationTransaction() {
        return { state: Buffer.alloc(32, 10).toString("base64url"),
          nonce: Buffer.alloc(32, 11).toString("base64url"),
          pkceVerifier: Buffer.alloc(32, 12).toString("base64url"),
          pkceChallenge: Buffer.alloc(32, 13).toString("base64url") };
      },
      async buildAuthorizationUrl() { return new URL("https://accounts.google.com/o/oauth2/v2/auth?state=safe"); },
      async exchangeAuthorizationCode() { throw new Error("unused"); },
    },
  });
  const result = await service.initiate({ platform: "ANDROID",
    appExchangeChallenge: Uint8Array.from(Buffer.alloc(32, 5)),
    installationBinding: Uint8Array.from(Buffer.alloc(32, 6)),
    canonicalClientIp: "203.0.113.1", requestId: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21" });
  assert.equal(result.outcome, "REDIRECT");
  assert.ok(beginInput !== null);
  const captured = beginInput as unknown as Record<string, unknown>;
  assert.equal(captured.platform, "ANDROID");
  assert.equal(JSON.stringify(result).includes("pkce"), false);
  assert.equal(JSON.stringify(result).includes("nonce"), false);
});

test("callback opens the transaction with the database canonical platform configuration AAD", async () => {
  const state = Buffer.alloc(32, 20).toString("base64url");
  const nonce = Buffer.alloc(32, 21).toString("base64url");
  let began: Parameters<NonNullable<Parameters<typeof createMobileGoogleService>[0]["repository"]>["begin"]>[0] | null = null;
  const config = {
    callbackUri: "https://uptech-knowledge-sigma.vercel.app/api/v1/auth/mobile/google/callback" as const,
    appReturnUri: "https://uptech-knowledge-sigma.vercel.app/auth/mobile/callback" as const,
    databaseUrl: "postgres://unused/test", environmentId: "test",
    clientId: "client", clientSecret: "secret",
    rateHmacKey: Uint8Array.from(Buffer.alloc(32, 1)),
    pkceEncryptionKey: Uint8Array.from(Buffer.alloc(32, 2)), pkceKeyVersion: "v1",
    sessionPepper: Uint8Array.from(Buffer.alloc(32, 3)),
    refreshReplayKey: Uint8Array.from(Buffer.alloc(32, 4)),
  };
  const service = createMobileGoogleService({
    config,
    repository: {
      async begin(input) { began = input; return { outcome: "CREATED" } as const; },
      async consume() {
        assert.ok(began !== null);
        return {
          outcome: "RESERVED", platform: "ANDROID",
          configurationKey: "GOOGLE_MOBILE_ANDROID_V1",
          expectedNonceHash: began.nonceHash,
          envelope: began.envelope,
          pkceKeyVersion: "v1",
          associatedData: Uint8Array.from(Buffer.from(
            `test\x1fANDROID\x1fGOOGLE_MOBILE_ANDROID_V1\x1f${Buffer.from(began.stateHash).toString("hex")}`,
            "utf8",
          )),
        } as const;
      },
      async complete() {
        return { outcome: "NORMAL", appReturnUri: config.appReturnUri } as const;
      },
      async reject() { return "RECORDED" as const; },
    },
    oidc: {
      async createAuthorizationTransaction() {
        return { state, nonce, pkceVerifier: Buffer.alloc(32, 22).toString("base64url"),
          pkceChallenge: Buffer.alloc(32, 23).toString("base64url") };
      },
      async buildAuthorizationUrl() {
        return new URL(`https://accounts.google.com/o/oauth2/v2/auth?state=${state}`);
      },
      async exchangeAuthorizationCode() {
        const now = Math.floor(Date.now() / 1000);
        return { iss: "https://accounts.google.com", sub: "subject-1", aud: "client",
          iat: now - 1, exp: now + 3600, nonce, email: "member@example.com",
          email_verified: true, hd: "example.com" };
      },
    },
  });

  assert.equal((await service.initiate({ platform: "ANDROID",
    appExchangeChallenge: Uint8Array.from(Buffer.alloc(32, 5)),
    installationBinding: Uint8Array.from(Buffer.alloc(32, 6)),
    canonicalClientIp: "203.0.113.1", requestId: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21" })).outcome, "REDIRECT");

  const result = await service.callback({ callbackSearch: `?code=provider-code&state=${state}`,
    canonicalClientIp: "203.0.113.1", requestId: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21" });
  assert.equal(result.outcome, "HANDOFF");
});

test("malformed callback records one unbound rejection through the shared ingress bucket", async () => {
  const rejections: unknown[] = [];
  const service = createMobileGoogleService({
    config: {
      callbackUri: "https://uptech-knowledge-sigma.vercel.app/api/v1/auth/mobile/google/callback",
      appReturnUri: "https://uptech-knowledge-sigma.vercel.app/auth/mobile/callback",
      databaseUrl: "postgres://unused/test", environmentId: "test",
      clientId: "client", clientSecret: "secret",
      rateHmacKey: Uint8Array.from(Buffer.alloc(32, 1)),
      pkceEncryptionKey: Uint8Array.from(Buffer.alloc(32, 2)), pkceKeyVersion: "v1",
      sessionPepper: Uint8Array.from(Buffer.alloc(32, 3)),
      refreshReplayKey: Uint8Array.from(Buffer.alloc(32, 4)),
    },
    repository: {
      async begin() { throw new Error("unused"); },
      async consume() { throw new Error("consume must not run"); },
      async complete() { throw new Error("unused"); },
      async reject(input) { rejections.push(input); return "RECORDED" as const; },
    },
  });
  assert.deepEqual(await service.callback({ callbackSearch: "?state=short",
    canonicalClientIp: "203.0.113.1",
    requestId: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21" }), { outcome: "DENIED" });
  assert.equal(rejections.length, 1);
  assert.deepEqual(rejections[0], {
    platform: null,
    networkHmac: clientNetworkHmac("203.0.113.1", Uint8Array.from(Buffer.alloc(32, 1))),
    completionHandleHash: null,
    rejectionClass: "PROTOCOL_INVALID",
    requestId: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21",
  });
});

test("malformed mobile ingress records exactly one unbound redacted rejection", async () => {
  const rejections: unknown[] = [];
  const rateHmacKey = Uint8Array.from(Buffer.alloc(32, 1));
  const service = createMobileGoogleService({
    config: {
      callbackUri: "https://uptech-knowledge-sigma.vercel.app/api/v1/auth/mobile/google/callback",
      appReturnUri: "https://uptech-knowledge-sigma.vercel.app/auth/mobile/callback",
      databaseUrl: "postgres://unused/test", environmentId: "test",
      clientId: "client", clientSecret: "secret", rateHmacKey,
      pkceEncryptionKey: Uint8Array.from(Buffer.alloc(32, 2)), pkceKeyVersion: "v1",
      sessionPepper: Uint8Array.from(Buffer.alloc(32, 3)),
      refreshReplayKey: Uint8Array.from(Buffer.alloc(32, 4)),
    },
    repository: {
      async begin() { throw new Error("valid begin must not run"); },
      async consume() { throw new Error("valid callback must not run"); },
      async complete() { throw new Error("valid completion must not run"); },
      async reject(input) {
        rejections.push(input);
        return "RATE_LIMITED" as const;
      },
    },
  });

  assert.equal(await service.rejectMalformedIngress({
    canonicalClientIp: "203.0.113.1",
    requestId: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21",
  }), "RATE_LIMITED");
  assert.deepEqual(rejections, [{
    platform: null,
    networkHmac: clientNetworkHmac("203.0.113.1", rateHmacKey),
    completionHandleHash: null,
    rejectionClass: "PROTOCOL_INVALID",
    requestId: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21",
  }]);
});

test("callback returns the fixed personal-account category without a handoff", async () => {
  const state = Buffer.alloc(32, 40).toString("base64url");
  const nonce = Buffer.alloc(32, 41).toString("base64url");
  let began: Parameters<NonNullable<Parameters<typeof createMobileGoogleService>[0]["repository"]>["begin"]>[0] | null = null;
  let completions = 0;
  const config = {
    callbackUri: "https://uptech-knowledge-sigma.vercel.app/api/v1/auth/mobile/google/callback" as const,
    appReturnUri: "https://uptech-knowledge-sigma.vercel.app/auth/mobile/callback" as const,
    databaseUrl: "postgres://unused/test", environmentId: "test",
    clientId: "client", clientSecret: "secret",
    rateHmacKey: Uint8Array.from(Buffer.alloc(32, 1)),
    pkceEncryptionKey: Uint8Array.from(Buffer.alloc(32, 2)), pkceKeyVersion: "v1",
    sessionPepper: Uint8Array.from(Buffer.alloc(32, 3)),
    refreshReplayKey: Uint8Array.from(Buffer.alloc(32, 4)),
  };
  const service = createMobileGoogleService({
    config,
    repository: {
      async begin(input) { began = input; return { outcome: "CREATED" } as const; },
      async consume() {
        assert.ok(began !== null);
        return {
          outcome: "RESERVED", platform: "ANDROID",
          configurationKey: "GOOGLE_MOBILE_ANDROID_V1",
          expectedNonceHash: began.nonceHash, envelope: began.envelope,
          pkceKeyVersion: "v1",
          associatedData: Uint8Array.from(Buffer.from(
            `test\x1fANDROID\x1fGOOGLE_MOBILE_ANDROID_V1\x1f${Buffer.from(began.stateHash).toString("hex")}`,
            "utf8",
          )),
        } as const;
      },
      async complete() { completions += 1; return { outcome: "DENIED" } as never; },
      async reject() { return "RECORDED" as const; },
    },
    oidc: {
      async createAuthorizationTransaction() {
        return { state, nonce, pkceVerifier: proofForGoogleTest(42), pkceChallenge: proofForGoogleTest(43) };
      },
      async buildAuthorizationUrl() { return new URL(`https://accounts.google.com/o/oauth2/v2/auth?state=${state}`); },
      async exchangeAuthorizationCode() {
        const now = Math.floor(Date.now() / 1000);
        return { iss: "https://accounts.google.com", sub: "personal-subject", aud: "client",
          iat: now - 1, exp: now + 3600, nonce, email: "person@gmail.com", email_verified: true };
      },
    },
  });
  await service.initiate({ platform: "ANDROID", appExchangeChallenge: Uint8Array.from(Buffer.alloc(32, 5)),
    installationBinding: Uint8Array.from(Buffer.alloc(32, 6)), canonicalClientIp: "203.0.113.1",
    requestId: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21" });

  assert.deepEqual(await service.callback({ callbackSearch: `?code=x&state=${state}`,
    canonicalClientIp: "203.0.113.1", requestId: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21" }),
    { outcome: "DENIED", category: "PERSONAL_GOOGLE_ACCOUNT" });
  assert.equal(completions, 0);
});

test("callback preserves a fixed database-derived eligibility denial category", async () => {
  const service = await callbackServiceWithCompletion({ outcome: "DENIED", category: "UNKNOWN_WORKSPACE" });
  assert.deepEqual(await service.callback({ callbackSearch: `?code=x&state=${callbackState}`,
    canonicalClientIp: "203.0.113.1", requestId: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21" }),
    { outcome: "DENIED", category: "UNKNOWN_WORKSPACE" });
});

const callbackState = Buffer.alloc(32, 50).toString("base64url");
const callbackNonce = Buffer.alloc(32, 51).toString("base64url");
const proofForGoogleTest = (byte: number) => Buffer.alloc(32, byte).toString("base64url");

async function callbackServiceWithCompletion(completion: { readonly outcome: "DENIED"; readonly category: "UNKNOWN_WORKSPACE" }) {
  let began: Parameters<NonNullable<Parameters<typeof createMobileGoogleService>[0]["repository"]>["begin"]>[0] | null = null;
  const config = {
    callbackUri: "https://uptech-knowledge-sigma.vercel.app/api/v1/auth/mobile/google/callback" as const,
    appReturnUri: "https://uptech-knowledge-sigma.vercel.app/auth/mobile/callback" as const,
    databaseUrl: "postgres://unused/test", environmentId: "test", clientId: "client", clientSecret: "secret",
    rateHmacKey: Uint8Array.from(Buffer.alloc(32, 1)), pkceEncryptionKey: Uint8Array.from(Buffer.alloc(32, 2)),
    pkceKeyVersion: "v1", sessionPepper: Uint8Array.from(Buffer.alloc(32, 3)),
    refreshReplayKey: Uint8Array.from(Buffer.alloc(32, 4)),
  };
  const service = createMobileGoogleService({ config, repository: {
    async begin(input) { began = input; return { outcome: "CREATED" } as const; },
    async consume() { assert.ok(began !== null); return { outcome: "RESERVED", platform: "ANDROID",
      configurationKey: "GOOGLE_MOBILE_ANDROID_V1", expectedNonceHash: began.nonceHash, envelope: began.envelope,
      pkceKeyVersion: "v1", associatedData: Uint8Array.from(Buffer.from(
        `test\x1fANDROID\x1fGOOGLE_MOBILE_ANDROID_V1\x1f${Buffer.from(began.stateHash).toString("hex")}`, "utf8")) } as const; },
    async complete() { return completion as never; }, async reject() { return "RECORDED" as const; },
  }, oidc: {
    async createAuthorizationTransaction() { return { state: callbackState, nonce: callbackNonce,
      pkceVerifier: proofForGoogleTest(52), pkceChallenge: proofForGoogleTest(53) }; },
    async buildAuthorizationUrl() { return new URL(`https://accounts.google.com/o/oauth2/v2/auth?state=${callbackState}`); },
    async exchangeAuthorizationCode() { const now=Math.floor(Date.now()/1000); return {
      iss:"https://accounts.google.com",sub:"subject",aud:"client",iat:now-1,exp:now+3600,nonce:callbackNonce,
      email:"member@example.com",email_verified:true,hd:"example.com" }; },
  } });
  await service.initiate({ platform:"ANDROID",appExchangeChallenge:Uint8Array.from(Buffer.alloc(32,5)),
    installationBinding:Uint8Array.from(Buffer.alloc(32,6)),canonicalClientIp:"203.0.113.1",
    requestId:"4d6e25c6-e7cb-45ad-9147-e93b1a2fca21" });
  return service;
}
