import assert from "node:assert/strict";
import test from "node:test";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import * as openid from "openid-client";

const ISSUER = "https://accounts.google.com";
const AUTHORIZATION_ENDPOINT = `${ISSUER}/o/oauth2/v2/auth`;
const TOKEN_ENDPOINT = `${ISSUER}/token`;
const JWKS_ENDPOINT = `${ISSUER}/oauth2/v3/certs`;
const CLIENT_ID = "offline-google-client.apps.googleusercontent.com";
const CLIENT_SECRET = "offline-client-secret";
const REDIRECT_URI =
  "https://tenant-a.example/api/v1/auth/google/callback";
const STATE = "nZ8jMQPMJ5N7tTmuYKuKXWQ8V7zBnoW1qODge0RB5N8";
const NONCE = "dyiqiGoT2xr5Vmz9rKBjvQeDFw1Vyaj6hnm6MTw0MyA";
const PKCE_VERIFIER =
  "YmF0dGxlLXRlc3RlZC1vaWRjLWNvZGUtY2hhbGxlbmdlLXZlcmlmaWVyLTE";
const AUTHORIZATION_CODE = "offline-authorization-code";
const SIGNING_KEY_ID = "offline-google-rs256-key";

interface IdTokenVariation {
  readonly audience?: string;
  readonly expiresAt?: number;
  readonly nonce?: string;
  readonly tamperSignature?: boolean;
}

interface OfflineCalls {
  discovery: number;
  token: number;
  jwks: number;
  readonly tokenBodies: URLSearchParams[];
}

interface OfflineProvider {
  readonly configuration: openid.Configuration;
  readonly calls: OfflineCalls;
}

const signingMaterial = generateKeyPair("RS256", {
  extractable: true,
}).then(async ({ privateKey, publicKey }) => {
  const publicJwk = await exportJWK(publicKey);
  return {
    privateKey,
    publicJwk: {
      ...publicJwk,
      alg: "RS256",
      kid: SIGNING_KEY_ID,
      use: "sig",
    },
  };
});

function jsonResponse(
  body: Readonly<Record<string, unknown>>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function tamperCompactSignature(jwt: string): string {
  const parts = jwt.split(".");
  assert.equal(parts.length, 3);
  assert.ok(parts[2].length > 1);
  parts[2] = `${parts[2][0] === "A" ? "B" : "A"}${parts[2].slice(1)}`;
  return parts.join(".");
}

async function issueGoogleShapedIdToken(
  variation: IdTokenVariation,
): Promise<string> {
  const now = Math.floor(Date.now() / 1_000);
  const audience = variation.audience ?? CLIENT_ID;
  const material = await signingMaterial;
  const signed = await new SignJWT({
    azp: audience,
    email: "member@tenant-a.example",
    email_verified: true,
    hd: "tenant-a.example",
    name: "UPTECH Member",
    nonce: variation.nonce ?? NONCE,
    picture: "https://lh3.googleusercontent.com/offline-test-member",
  })
    .setProtectedHeader({
      alg: "RS256",
      kid: SIGNING_KEY_ID,
      typ: "JWT",
    })
    .setIssuer(ISSUER)
    .setAudience(audience)
    .setSubject("google-subject-offline-test")
    .setIssuedAt(now - 5)
    .setExpirationTime(variation.expiresAt ?? now + 300)
    .setJti("offline-id-token-jti")
    .sign(material.privateKey);

  return variation.tamperSignature
    ? tamperCompactSignature(signed)
    : signed;
}

function discoveryDocument(): Readonly<Record<string, unknown>> {
  return {
    issuer: ISSUER,
    authorization_endpoint: AUTHORIZATION_ENDPOINT,
    token_endpoint: TOKEN_ENDPOINT,
    jwks_uri: JWKS_ENDPOINT,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    token_endpoint_auth_methods_supported: ["client_secret_post"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["openid", "email", "profile"],
  };
}

async function createOfflineProvider(
  variation: IdTokenVariation = {},
): Promise<OfflineProvider> {
  const calls: OfflineCalls = {
    discovery: 0,
    token: 0,
    jwks: 0,
    tokenBodies: [],
  };

  const offlineFetch: openid.CustomFetch = async (url, options) => {
    if (url === `${ISSUER}/.well-known/openid-configuration`) {
      calls.discovery += 1;
      assert.equal(options.method, "GET");
      return jsonResponse(discoveryDocument());
    }

    if (url === TOKEN_ENDPOINT) {
      calls.token += 1;
      assert.equal(options.method, "POST");
      assert.ok(options.body instanceof URLSearchParams);
      const body = new URLSearchParams(options.body);
      calls.tokenBodies.push(body);

      if (body.get("code_verifier") !== PKCE_VERIFIER) {
        return jsonResponse(
          {
            error: "invalid_grant",
            error_description: "PKCE verifier does not match",
          },
          400,
        );
      }

      assert.equal(body.get("grant_type"), "authorization_code");
      assert.equal(body.get("code"), AUTHORIZATION_CODE);
      assert.equal(body.get("redirect_uri"), REDIRECT_URI);
      assert.equal(body.get("client_id"), CLIENT_ID);
      assert.equal(body.get("client_secret"), CLIENT_SECRET);
      return jsonResponse({
        access_token: "offline-opaque-access-token",
        expires_in: 300,
        id_token: await issueGoogleShapedIdToken(variation),
        token_type: "Bearer",
      });
    }

    if (url === JWKS_ENDPOINT) {
      calls.jwks += 1;
      assert.equal(options.method, "GET");
      const { publicJwk } = await signingMaterial;
      return jsonResponse({ keys: [publicJwk] });
    }

    throw new Error(`offline OIDC test attempted unexpected network URL: ${url}`);
  };

  // This is the production oidc.ts configuration pattern. The only addition is
  // a custom Fetch boundary so discovery, token exchange, and JWKS remain
  // hermetic and observable in this test.
  const configuration = await openid.discovery(
    new URL(ISSUER),
    CLIENT_ID,
    {
      client_secret: CLIENT_SECRET,
      redirect_uris: [REDIRECT_URI],
      response_types: ["code"],
    },
    undefined,
    { [openid.customFetch]: offlineFetch },
  );
  openid.enableNonRepudiationChecks(configuration);

  return { configuration, calls };
}

function callbackUrl(state = STATE): URL {
  const callback = new URL(REDIRECT_URI);
  callback.searchParams.set("code", AUTHORIZATION_CODE);
  callback.searchParams.set("state", state);
  return callback;
}

async function exchange(
  configuration: openid.Configuration,
  overrides: {
    readonly expectedState?: string;
    readonly expectedNonce?: string;
    readonly pkceCodeVerifier?: string;
  } = {},
): Promise<Awaited<ReturnType<typeof openid.authorizationCodeGrant>>> {
  return openid.authorizationCodeGrant(configuration, callbackUrl(), {
    expectedState: overrides.expectedState ?? STATE,
    expectedNonce: overrides.expectedNonce ?? NONCE,
    pkceCodeVerifier: overrides.pkceCodeVerifier ?? PKCE_VERIFIER,
    idTokenExpected: true,
  });
}

async function assertGrantDenied(
  operation: () => Promise<unknown>,
): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.equal(
      error instanceof openid.ClientError ||
        error instanceof openid.ResponseBodyError ||
        error instanceof openid.AuthorizationResponseError,
      true,
    );
    return true;
  });
}

test("openid-client accepts a correctly signed Google-shaped ID token with state, nonce, and PKCE", async () => {
  const { configuration, calls } = await createOfflineProvider();
  const pkceChallenge =
    await openid.calculatePKCECodeChallenge(PKCE_VERIFIER);
  const authorizationUrl = openid.buildAuthorizationUrl(configuration, {
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    state: STATE,
    nonce: NONCE,
    code_challenge: pkceChallenge,
    code_challenge_method: "S256",
  });

  assert.equal(authorizationUrl.origin, ISSUER);
  assert.equal(authorizationUrl.pathname, "/o/oauth2/v2/auth");
  assert.equal(authorizationUrl.searchParams.get("state"), STATE);
  assert.equal(authorizationUrl.searchParams.get("nonce"), NONCE);
  assert.equal(
    authorizationUrl.searchParams.get("code_challenge"),
    pkceChallenge,
  );
  assert.equal(
    authorizationUrl.searchParams.get("code_challenge_method"),
    "S256",
  );

  const tokens = await exchange(configuration);
  const claims = tokens.claims();
  assert.notEqual(claims, undefined);
  assert.equal(claims?.iss, ISSUER);
  assert.equal(claims?.aud, CLIENT_ID);
  assert.equal(claims?.sub, "google-subject-offline-test");
  assert.equal(claims?.nonce, NONCE);
  assert.equal(claims?.email_verified, true);
  assert.equal(claims?.hd, "tenant-a.example");
  assert.equal(calls.discovery, 1);
  assert.equal(calls.token, 1);
  assert.equal(calls.jwks, 1);
  assert.equal(calls.tokenBodies[0].get("code_verifier"), PKCE_VERIFIER);
});

test("openid-client denies a tampered ID-token signature after fetching the issuer JWKS", async () => {
  const { configuration, calls } = await createOfflineProvider({
    tamperSignature: true,
  });

  await assertGrantDenied(() => exchange(configuration));

  assert.equal(calls.token, 1);
  assert.equal(calls.jwks, 1);
});

const signedInvalidClaimScenarios: ReadonlyArray<{
  readonly name: string;
  readonly variation: () => IdTokenVariation;
}> = [
  {
    name: "wrong audience",
    variation: () => ({ audience: "another-client.apps.googleusercontent.com" }),
  },
  {
    name: "expired token",
    variation: () => ({
      expiresAt: Math.floor(Date.now() / 1_000) - 300,
    }),
  },
  {
    name: "nonce mismatch",
    variation: () => ({
      nonce: "uMeoKDyQwIfV_L9hYa8cvzTAUUF4HcGuWURBUJH-a-Q",
    }),
  },
];

for (const scenario of signedInvalidClaimScenarios) {
  test(`openid-client denies a validly signed ID token with ${scenario.name}`, async () => {
    const { configuration, calls } = await createOfflineProvider(
      scenario.variation(),
    );

    await assertGrantDenied(() => exchange(configuration));

    assert.equal(calls.token, 1);
  });
}

test("openid-client rejects a state mismatch before the token endpoint", async () => {
  const { configuration, calls } = await createOfflineProvider();
  const wrongStateCallback = callbackUrl(
    "VReEfHLmwtfLPyDQjhEgKdJ0h6baqNLQtTCZrI3i-2Q",
  );

  await assertGrantDenied(() =>
    openid.authorizationCodeGrant(configuration, wrongStateCallback, {
      expectedState: STATE,
      expectedNonce: NONCE,
      pkceCodeVerifier: PKCE_VERIFIER,
      idTokenExpected: true,
    }),
  );

  assert.equal(calls.token, 0);
  assert.equal(calls.jwks, 0);
});

test("the authorization server rejects a mismatched PKCE verifier", async () => {
  const { configuration, calls } = await createOfflineProvider();

  await assertGrantDenied(() =>
    exchange(configuration, {
      pkceCodeVerifier:
        "PbkeKekXLKlmudnXNCCYJlM77tJkM9qoZNn09uc7ZUJ5h51KeCTdwqejF2z4ntr",
    }),
  );

  assert.equal(calls.token, 1);
  assert.equal(calls.jwks, 0);
});
