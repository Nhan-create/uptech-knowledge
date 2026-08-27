import assert from "node:assert/strict";
import { test } from "node:test";

import {
  hashMobileProof,
  issueMobileCredentialPair,
  parseHandoffExchangeBody,
  parseMobileTransactionBody,
  parseRefreshBody,
  parseWorkspaceSwitchBody,
} from "./protocol.ts";

const proof = (byte: number): string =>
  Buffer.alloc(32, byte).toString("base64url");

test("mobile transaction parser accepts only platform and bound 256-bit proofs", () => {
  assert.deepEqual(
    parseMobileTransactionBody({
      platform: "ANDROID",
      app_exchange_challenge: proof(1),
      installation_binding: proof(2),
      request_id: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21",
    }),
    {
      platform: "ANDROID",
      appExchangeChallenge: Uint8Array.from(Buffer.alloc(32, 1)),
      installationBinding: Uint8Array.from(Buffer.alloc(32, 2)),
      requestId: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21",
    },
  );

  for (const body of [
    {
      platform: "ANDROID",
      app_exchange_challenge: proof(1),
      installation_binding: proof(2),
      request_id: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21",
      workspace_id: "73e6f58c-3d17-42d8-9e94-610c912b5c6a",
    },
    {
      platform: "WEB",
      app_exchange_challenge: proof(1),
      installation_binding: proof(2),
      request_id: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21",
    },
    {
      platform: "IOS",
      app_exchange_challenge: "short",
      installation_binding: proof(2),
      request_id: "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21",
    },
  ]) {
    assert.throws(() => parseMobileTransactionBody(body), {
      name: "MobileProtocolError",
    });
  }
});

test("handoff and refresh parsers reject authority and require canonical proofs", () => {
  assert.deepEqual(
    parseHandoffExchangeBody({
      handoff_code: proof(3),
      app_exchange_verifier: proof(4),
      installation_secret: proof(5),
    }),
    {
      handoffCode: proof(3),
      appExchangeVerifier: proof(4),
      installationSecret: proof(5),
    },
  );
  assert.deepEqual(parseRefreshBody({ refresh_token: proof(6) }), {
    refreshToken: proof(6),
  });
  assert.throws(
    () =>
      parseHandoffExchangeBody({
        handoff_code: proof(3),
        app_exchange_verifier: proof(4),
        installation_secret: proof(5),
        role: "OWNER",
      }),
    { name: "MobileProtocolError" },
  );
  assert.throws(
    () => parseRefreshBody({ refresh_token: proof(6), workspace_id: "chosen" }),
    { name: "MobileProtocolError" },
  );
});

test("mobile credentials are independent opaque 256-bit values with hash-only persistence", () => {
  const pair = issueMobileCredentialPair();
  assert.match(pair.access.raw, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(pair.refresh.raw, /^[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(pair.access.raw, pair.refresh.raw);
  assert.equal(pair.access.hash.byteLength, 32);
  assert.equal(pair.refresh.hash.byteLength, 32);
  assert.deepEqual(pair.access.hash, hashMobileProof(pair.access.raw));
  assert.deepEqual(pair.refresh.hash, hashMobileProof(pair.refresh.raw));
  assert.equal(JSON.stringify(pair).includes(pair.access.raw), false);
  assert.equal(JSON.stringify(pair).includes(pair.refresh.raw), false);
});

test("workspace switch parser requires one canonical UUID and one installation proof", () => {
  assert.deepEqual(parseWorkspaceSwitchBody({
    target_workspace_id: "44f864e4-bbd5-470f-8878-a68c270ce849",
    installation_secret: proof(8),
  }), {
    targetWorkspaceId: "44f864e4-bbd5-470f-8878-a68c270ce849",
    installationSecret: proof(8),
  });
  assert.throws(() => parseWorkspaceSwitchBody({
    target_workspace_id: "not-a-uuid",
    installation_secret: proof(8),
  }), { name: "MobileProtocolError" });
});
