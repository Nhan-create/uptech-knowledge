import assert from "node:assert/strict";
import test from "node:test";

import {
  GOOGLE_LOGIN_CONFIGURATION_KEY,
  GOOGLE_ISSUER,
} from "./config.ts";
import {
  GoogleClaimsValidationError,
  verifyGoogleWorkspaceClaims,
} from "./claims.ts";

const NOW = 2_000_000_000;
const CLIENT_ID = "google-web-client-id.apps.googleusercontent.com";
const NONCE = Buffer.alloc(32, 0x31).toString("base64url");
const MANAGED_DOMAIN = "tenant-a.example";

type Claims = Parameters<typeof verifyGoogleWorkspaceClaims>[0]["claims"];

function validClaims(overrides: Readonly<Record<string, unknown>> = {}): Claims {
  return {
    iss: GOOGLE_ISSUER,
    aud: CLIENT_ID,
    sub: "google-subject-123456789",
    iat: NOW - 30,
    exp: NOW + 300,
    nonce: NONCE,
    email: "alice@tenant-a.example",
    email_verified: true,
    hd: "tenant-a.example",
    name: "Alice Uptech",
    picture: "https://lh3.googleusercontent.com/a/profile-photo",
    ...overrides,
  } as Claims;
}

function verify(overrides: Readonly<Record<string, unknown>> = {}) {
  return verifyGoogleWorkspaceClaims({
    claims: validClaims(overrides),
    expectedClientId: CLIENT_ID,
    expectedNonce: NONCE,
    nowEpochSeconds: NOW,
  });
}

function assertInvalid(overrides: Readonly<Record<string, unknown>>): void {
  assert.throws(() => verify(overrides), GoogleClaimsValidationError);
}

test("accepts verified Workspace claims and emits only normalized typed data", () => {
  const claims = verify();

  assert.deepEqual(
    {
      ...claims,
      nonceHash: Buffer.from(claims.nonceHash).toString("hex"),
    },
    {
      issuer: GOOGLE_ISSUER,
      providerSubject: "google-subject-123456789",
      normalizedEmail: "alice@tenant-a.example",
      emailVerified: true,
      hostedDomain: "tenant-a.example",
      issuedAtEpochSeconds: NOW - 30,
      expiresAtEpochSeconds: NOW + 300,
      audienceConfigurationKey: GOOGLE_LOGIN_CONFIGURATION_KEY,
      authorizedPartyConfigurationKey: null,
      nonceHash:
        "3a397971ec1a9c130aa8465cc7ea8917d9ea346a31d029d4e5941e164e77c323",
      displayName: "Alice Uptech",
      pictureUrl: "https://lh3.googleusercontent.com/a/profile-photo",
    },
  );
  assert.equal(Object.isFrozen(claims), true);
});

test("canonicalizes Google's legacy issuer and binds multi-audience tokens with azp", () => {
  const claims = verify({
    iss: "accounts.google.com",
    aud: ["another-audience", CLIENT_ID],
    azp: CLIENT_ID,
  });

  assert.equal(claims.issuer, GOOGLE_ISSUER);
  assert.equal(
    claims.authorizedPartyConfigurationKey,
    GOOGLE_LOGIN_CONFIGURATION_KEY,
  );
});

test("normalizes hosted-domain case and optional profile fields", () => {
  const claims = verify({
    email: "user@UNKNOWN.EXAMPLE",
    hd: "UNKNOWN.EXAMPLE",
    name: undefined,
    picture: undefined,
  });

  assert.equal(claims.hostedDomain, "unknown.example");
  assert.equal(claims.displayName, null);
  assert.equal(claims.pictureUrl, null);
});

test("rejects wrong issuer, audience, authorized party, and nonce", () => {
  assertInvalid({ iss: "https://unknown.example" });
  assertInvalid({ aud: "wrong-client.apps.googleusercontent.com" });
  assertInvalid({ aud: ["wrong-one", "wrong-two"] });
  assertInvalid({ aud: [] });
  assertInvalid({ aud: [CLIENT_ID, 42] });
  assertInvalid({ azp: "wrong-client.apps.googleusercontent.com" });
  assertInvalid({ nonce: Buffer.alloc(32, 0x32).toString("base64url") });
  assertInvalid({ nonce: undefined });
});

test("rejects expired, stale, future-issued, and inverted token times", () => {
  assertInvalid({ exp: NOW - 121 });
  assertInvalid({ iat: NOW - 421 });
  assertInvalid({ iat: NOW + 121 });
  assertInvalid({ iat: NOW + 100, exp: NOW + 99 });
  assertInvalid({ iat: 0 });
  assertInvalid({ exp: "not-a-timestamp" });
});

test("requires Google's exact boolean email_verified claim", () => {
  for (const value of [false, "true", 1, null, undefined]) {
    assertInvalid({ email_verified: value });
  }
});

test("rejects personal Gmail identities without a verified hosted domain", () => {
  assertInvalid({ email: "person@unknown.example", hd: undefined });
  assertInvalid({ email: "person@unknown.example", hd: "" });
});

test("rejects missing or syntactically invalid hosted domains", () => {
  for (const hostedDomain of [
    undefined,
    null,
    "",
    `.${MANAGED_DOMAIN}`,
    `${MANAGED_DOMAIN}.`,
    `bad_${MANAGED_DOMAIN}`,
    MANAGED_DOMAIN.replace(".", ".."),
    `-${MANAGED_DOMAIN}`,
    `${MANAGED_DOMAIN}-`,
  ]) {
    assertInvalid({ hd: hostedDomain });
  }
});

test("rejects malformed identity, email, name, and picture claims", () => {
  assertInvalid({ sub: "" });
  assertInvalid({ sub: `subject\0injection` });
  assertInvalid({ email: "not-an-email" });
  assertInvalid({ email: " alice@tenant-a.example" });
  assertInvalid({ email: "alice@@tenant-a.example" });
  assertInvalid({ name: "name\nwith-control" });
  assertInvalid({ picture: "http://unknown.example/avatar.png" });
  assertInvalid({ picture: "https://user@unknown.example/avatar.png" });
  assertInvalid({ picture: "not-a-url" });
});

test("fails closed when verification time itself is invalid", () => {
  for (const nowEpochSeconds of [0, -1, 1.5, Number.NaN]) {
    assert.throws(
      () =>
        verifyGoogleWorkspaceClaims({
          claims: validClaims(),
          expectedClientId: CLIENT_ID,
          expectedNonce: NONCE,
          nowEpochSeconds,
        }),
      TypeError,
    );
  }
});
