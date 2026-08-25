import assert from "node:assert/strict";
import test from "node:test";

import type { GoogleLoginRuntimeConfig } from "./config.ts";
import {
  createGoogleOidcClient,
  GoogleOidcProviderUnavailableError,
} from "./oidc.ts";

const CONFIG: GoogleLoginRuntimeConfig = Object.freeze({
  appOrigin: "https://knowledge.example.com",
  redirectUri:
    "https://knowledge.example.com/api/v1/auth/google/callback",
  clientId: "client.apps.googleusercontent.com",
  clientSecret: "provider-client-secret",
  workspaceDomainHint: null,
  environmentId: "production",
  databaseUrl: "postgresql://runtime.invalid/uptech",
  rateHmacKey: new Uint8Array(32).fill(1),
  pkceEncryptionKey: new Uint8Array(32).fill(2),
  pkceKeyVersion: "kms-v1",
  sessionPepper: new Uint8Array(32).fill(3),
});

test("discovery transport failure is classified as provider unavailable", async () => {
  let discoveryCalls = 0;
  const client = createGoogleOidcClient({
    async discover() {
      discoveryCalls += 1;
      throw new TypeError("network unavailable");
    },
  });
  const transaction = await client.createAuthorizationTransaction();

  await assert.rejects(
    client.exchangeAuthorizationCode({
      config: CONFIG,
      callbackSearch: `?code=authorization-code&state=${transaction.state}`,
      state: transaction.state,
      nonce: transaction.nonce,
      pkceVerifier: transaction.pkceVerifier,
    }),
    GoogleOidcProviderUnavailableError,
  );
  assert.equal(discoveryCalls, 1);
});
