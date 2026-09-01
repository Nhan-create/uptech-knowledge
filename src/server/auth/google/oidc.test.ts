import assert from "node:assert/strict";
import test from "node:test";

import * as openid from "openid-client";

import {
  GOOGLE_ISSUER,
  loadGoogleLoginRuntimeConfig,
  type GoogleLoginRuntimeConfig,
} from "./config.ts";
import {
  classifyGoogleOidcExchangeError,
  createGoogleOidcClient,
  GoogleOidcProviderRejectedError,
  GoogleOidcProviderUnavailableError,
  GoogleOidcVerificationError,
} from "./oidc.ts";

const CONFIG: GoogleLoginRuntimeConfig = Object.freeze({
  appOrigin: "https://unknown.example",
  redirectUri:
    "https://unknown.example/api/v1/auth/google/callback",
  clientId: "client.apps.googleusercontent.com",
  clientSecret: "provider-client-secret",
  environmentId: "production",
  databaseUrl: "postgresql://unknown.example/uptech",
  rateHmacKey: new Uint8Array(32).fill(1),
  pkceEncryptionKey: new Uint8Array(32).fill(2),
  pkceKeyVersion: "kms-v1",
  sessionPepper: new Uint8Array(32).fill(3),
});

async function offlineGoogleConfiguration(
  config: GoogleLoginRuntimeConfig,
): Promise<openid.Configuration> {
  const offlineFetch: openid.CustomFetch = async (url) => {
    assert.equal(
      String(url),
      `${GOOGLE_ISSUER}/.well-known/openid-configuration`,
    );
    return new Response(
      JSON.stringify({
        issuer: GOOGLE_ISSUER,
        authorization_endpoint: `${GOOGLE_ISSUER}/o/oauth2/v2/auth`,
        token_endpoint: `${GOOGLE_ISSUER}/token`,
        jwks_uri: `${GOOGLE_ISSUER}/oauth2/v3/certs`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      }),
      { headers: { "content-type": "application/json" } },
    );
  };

  return openid.discovery(
    new URL(GOOGLE_ISSUER),
    config.clientId,
    {
      client_secret: config.clientSecret,
      redirect_uris: [config.redirectUri],
      response_types: ["code"],
    },
    undefined,
    { [openid.customFetch]: offlineFetch },
  );
}

test("authorization remains domain-neutral when a legacy Workspace hint is configured", async () => {
  const key = Buffer.alloc(32, 0x44).toString("base64url");
  const config = loadGoogleLoginRuntimeConfig({
    NODE_ENV: "production",
    PRODUCTION_BASE_URL: "https://unknown.example",
    GOOGLE_REDIRECT_URI:
      "https://unknown.example/api/v1/auth/google/callback",
    GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "provider-client-secret",
    GOOGLE_WORKSPACE_DOMAIN: "tenant-a.example",
    UPTECH_ENVIRONMENT_ID: "production",
    DATABASE_URL: "postgresql://unknown.example/uptech",
    UPTECH_ENVIRONMENT_RATE_KEY: key,
    UPTECH_GOOGLE_LOGIN_PKCE_KEY: key,
    UPTECH_GOOGLE_LOGIN_PKCE_KEY_VERSION: "kms-v1",
    UPTECH_SESSION_PEPPER: key,
  });
  const configuration = await offlineGoogleConfiguration(config);
  const client = createGoogleOidcClient({
    async discover() {
      return configuration;
    },
  });

  const transaction = await client.createAuthorizationTransaction();
  const authorizationUrl = await client.buildAuthorizationUrl(
    config,
    transaction,
  );

  assert.equal(authorizationUrl.searchParams.has("hd"), false);
  assert.equal(authorizationUrl.searchParams.get("prompt"), "select_account");
  assert.deepEqual(
    new Set(authorizationUrl.searchParams.get("scope")?.split(" ")),
    new Set(["openid", "email", "profile"]),
  );
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

test("only Google's exact authorization access_denied response is a user cancellation", () => {
  const cancellation = new openid.AuthorizationResponseError(
    "provider detail must remain private",
    { cause: new URLSearchParams({
      error: "access_denied",
      error_description: "provider detail must remain private",
    }) },
  );
  const malformed = new openid.AuthorizationResponseError(
    "provider detail must remain private",
    { cause: new URLSearchParams({ error: "invalid_request" }) },
  );

  assert.ok(
    classifyGoogleOidcExchangeError(cancellation) instanceof
      GoogleOidcProviderRejectedError,
  );
  assert.ok(
    classifyGoogleOidcExchangeError(malformed) instanceof
      GoogleOidcVerificationError,
  );
  assert.doesNotMatch(
    classifyGoogleOidcExchangeError(cancellation).message,
    /provider detail/u,
  );
});

test("Google server errors are unavailable while other token or challenge errors are generic", () => {
  for (const providerError of ["temporarily_unavailable", "server_error"]) {
    const authorizationError = new openid.AuthorizationResponseError(
      "provider detail must remain private",
      { cause: new URLSearchParams({ error: providerError }) },
    );
    const tokenError = new openid.ResponseBodyError(
      "provider detail must remain private",
      {
        cause: { error: providerError },
        response: new Response(null, { status: 503 }),
      },
    );
    const challengeError = new openid.WWWAuthenticateChallengeError(
      "provider detail must remain private",
      {
        cause: [{
          scheme: "bearer",
          parameters: { error: providerError },
        }],
        response: new Response(null, { status: 503 }),
      },
    );

    assert.ok(
      classifyGoogleOidcExchangeError(authorizationError) instanceof
        GoogleOidcProviderUnavailableError,
    );
    assert.ok(
      classifyGoogleOidcExchangeError(tokenError) instanceof
        GoogleOidcProviderUnavailableError,
    );
    assert.ok(
      classifyGoogleOidcExchangeError(challengeError) instanceof
        GoogleOidcProviderUnavailableError,
    );
  }

  const tokenAccessDenied = new openid.ResponseBodyError(
    "provider detail must remain private",
    {
      cause: { error: "access_denied" },
      response: new Response(null, { status: 400 }),
    },
  );
  const invalidTokenChallenge = new openid.WWWAuthenticateChallengeError(
    "provider detail must remain private",
    {
      cause: [{
        scheme: "bearer",
        parameters: { error: "invalid_token" },
      }],
      response: new Response(null, { status: 401 }),
    },
  );

  assert.ok(
    classifyGoogleOidcExchangeError(tokenAccessDenied) instanceof
      GoogleOidcVerificationError,
  );
  assert.ok(
    classifyGoogleOidcExchangeError(invalidTokenChallenge) instanceof
      GoogleOidcVerificationError,
  );
});
