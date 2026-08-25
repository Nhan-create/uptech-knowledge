import assert from "node:assert/strict";
import test from "node:test";

import {
  GOOGLE_LOGIN_CALLBACK_PATH,
  GOOGLE_LOGIN_SCOPE,
  GoogleLoginConfigurationError,
  loadGoogleLoginRuntimeConfig,
} from "./config.ts";

const RATE_KEY = Buffer.alloc(32, 0x11).toString("base64url");
const PKCE_KEY = Buffer.alloc(32, 0x22).toString("base64url");
const SESSION_PEPPER = Buffer.alloc(32, 0x33).toString("base64url");
function validEnvironment(
  overrides: Readonly<Record<string, string | undefined>> = {},
): Record<string, string | undefined> {
  return {
    NODE_ENV: "production",
    PRODUCTION_BASE_URL: "https://knowledge.uptech.example",
    GOOGLE_REDIRECT_URI:
      "https://knowledge.uptech.example/api/v1/auth/google/callback",
    GOOGLE_CLIENT_ID: "google-web-client-id.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    GOOGLE_WORKSPACE_DOMAIN: "UPTECH.VN",
    UPTECH_ENVIRONMENT_ID: "production_v1",
    DATABASE_URL: "postgresql://app@example.invalid/uptech",
    UPTECH_ENVIRONMENT_RATE_KEY: RATE_KEY,
    UPTECH_GOOGLE_LOGIN_PKCE_KEY: PKCE_KEY,
    UPTECH_GOOGLE_LOGIN_PKCE_KEY_VERSION: "kms-2026-08",
    UPTECH_SESSION_PEPPER: SESSION_PEPPER,
    ...overrides,
  };
}

test("loads and freezes the exact production Google login configuration", () => {
  const config = loadGoogleLoginRuntimeConfig(validEnvironment());

  assert.equal(config.appOrigin, "https://knowledge.uptech.example");
  assert.equal(
    config.redirectUri,
    `https://knowledge.uptech.example${GOOGLE_LOGIN_CALLBACK_PATH}`,
  );
  assert.equal(config.workspaceDomainHint, "uptech.vn");
  assert.equal(config.environmentId, "production_v1");
  assert.deepEqual(config.rateHmacKey, Uint8Array.from(Buffer.alloc(32, 0x11)));
  assert.deepEqual(
    config.pkceEncryptionKey,
    Uint8Array.from(Buffer.alloc(32, 0x22)),
  );
  assert.deepEqual(
    config.sessionPepper,
    Uint8Array.from(Buffer.alloc(32, 0x33)),
  );
  assert.equal(Object.isFrozen(config), true);
  assert.equal(GOOGLE_LOGIN_SCOPE, "openid email profile");
});

test("requires HTTPS for both production origin and callback", () => {
  assert.throws(
    () =>
      loadGoogleLoginRuntimeConfig(
        validEnvironment({
          PRODUCTION_BASE_URL: "http://knowledge.uptech.example",
          GOOGLE_REDIRECT_URI:
            "http://knowledge.uptech.example/api/v1/auth/google/callback",
        }),
      ),
    GoogleLoginConfigurationError,
  );

  assert.throws(
    () =>
      loadGoogleLoginRuntimeConfig(
        validEnvironment({
          GOOGLE_REDIRECT_URI:
            "http://knowledge.uptech.example/api/v1/auth/google/callback",
        }),
      ),
    GoogleLoginConfigurationError,
  );
});

test("permits HTTP only for an exact local development origin", () => {
  const local = loadGoogleLoginRuntimeConfig(
    validEnvironment({
      NODE_ENV: "development",
      PRODUCTION_BASE_URL: "http://localhost:3000/",
      GOOGLE_REDIRECT_URI:
        "http://localhost:3000/api/v1/auth/google/callback",
    }),
  );
  assert.equal(local.appOrigin, "http://localhost:3000");

  assert.throws(
    () =>
      loadGoogleLoginRuntimeConfig(
        validEnvironment({
          NODE_ENV: "development",
          PRODUCTION_BASE_URL: "http://dev.uptech.example",
          GOOGLE_REDIRECT_URI:
            "http://dev.uptech.example/api/v1/auth/google/callback",
        }),
      ),
    GoogleLoginConfigurationError,
  );
});

test("binds the redirect URI to the exact approved origin and callback path", () => {
  const invalidRedirects = [
    "https://evil.example/api/v1/auth/google/callback",
    "https://knowledge.uptech.example/auth/google/callback",
    "https://knowledge.uptech.example/api/v1/auth/google/callback/",
    "https://knowledge.uptech.example/api/v1/auth/google/callback?next=/home",
    "https://knowledge.uptech.example/api/v1/auth/google/callback#fragment",
    "https://user@knowledge.uptech.example/api/v1/auth/google/callback",
  ];

  for (const redirectUri of invalidRedirects) {
    assert.throws(
      () =>
        loadGoogleLoginRuntimeConfig(
          validEnvironment({ GOOGLE_REDIRECT_URI: redirectUri }),
        ),
      GoogleLoginConfigurationError,
      redirectUri,
    );
  }
});

test("rejects malformed origins and missing required deployment values", () => {
  for (const appOrigin of [
    "not-a-url",
    "https://user@knowledge.uptech.example",
    "https://knowledge.uptech.example?mode=unsafe",
    "ftp://knowledge.uptech.example",
  ]) {
    assert.throws(
      () =>
        loadGoogleLoginRuntimeConfig(
          validEnvironment({ PRODUCTION_BASE_URL: appOrigin }),
        ),
      GoogleLoginConfigurationError,
      appOrigin,
    );
  }

  assert.throws(
    () =>
      loadGoogleLoginRuntimeConfig(
        validEnvironment({ GOOGLE_CLIENT_SECRET: "   " }),
      ),
    GoogleLoginConfigurationError,
  );
  assert.throws(
    () =>
      loadGoogleLoginRuntimeConfig(validEnvironment({ DATABASE_URL: undefined })),
    GoogleLoginConfigurationError,
  );
});

test("accepts only canonical 256-bit base64url secrets", () => {
  const keyVariables = [
    "UPTECH_ENVIRONMENT_RATE_KEY",
    "UPTECH_GOOGLE_LOGIN_PKCE_KEY",
    "UPTECH_SESSION_PEPPER",
  ] as const;
  const malformedKeys = [
    Buffer.alloc(31, 0x44).toString("base64url"),
    `${Buffer.alloc(32, 0x44).toString("base64url")}=`,
    Buffer.alloc(33, 0x44).toString("base64url"),
    "!".repeat(43),
  ];

  for (const variable of keyVariables) {
    for (const malformed of malformedKeys) {
      assert.throws(
        () =>
          loadGoogleLoginRuntimeConfig(
            validEnvironment({ [variable]: malformed }),
          ),
        GoogleLoginConfigurationError,
        `${variable}: ${malformed.length}`,
      );
    }
  }
});

test("validates environment identifiers, key versions, and Workspace hints", () => {
  for (const environmentId of ["", "bad space", "prod!", "a".repeat(65)]) {
    assert.throws(
      () =>
        loadGoogleLoginRuntimeConfig(
          validEnvironment({ UPTECH_ENVIRONMENT_ID: environmentId }),
        ),
      GoogleLoginConfigurationError,
    );
  }

  for (const keyVersion of ["", "line\nbreak", "a".repeat(129)]) {
    assert.throws(
      () =>
        loadGoogleLoginRuntimeConfig(
          validEnvironment({
            UPTECH_GOOGLE_LOGIN_PKCE_KEY_VERSION: keyVersion,
          }),
        ),
      GoogleLoginConfigurationError,
    );
  }

  for (const domain of [".uptech.vn", "uptech.vn.", "bad_label.vn", "a..vn"]) {
    assert.throws(
      () =>
        loadGoogleLoginRuntimeConfig(
          validEnvironment({ GOOGLE_WORKSPACE_DOMAIN: domain }),
        ),
      GoogleLoginConfigurationError,
    );
  }
});
