import assert from "node:assert/strict";
import { test } from "node:test";

import { loadMobileAuthConfig } from "./config.ts";

const secret = (n: number) => Buffer.alloc(32, n).toString("base64url");

test("mobile auth config fixes the approved callback and app return URLs", () => {
  const config = loadMobileAuthConfig({
    NODE_ENV: "production",
    DATABASE_URL: "postgres://runtime@unknown.example/uptech",
    UPTECH_ENVIRONMENT_ID: "production",
    UPTECH_ENVIRONMENT_RATE_KEY: secret(1),
    UPTECH_GOOGLE_LOGIN_PKCE_KEY: secret(2),
    UPTECH_GOOGLE_LOGIN_PKCE_KEY_VERSION: "kms-v1",
    UPTECH_SESSION_PEPPER: secret(3),
    UPTECH_MOBILE_REFRESH_REPLAY_KEY: secret(4),
    GOOGLE_MOBILE_CLIENT_ID: "mobile-web.apps.googleusercontent.com",
    GOOGLE_MOBILE_CLIENT_SECRET: "server-only-secret",
  });
  assert.equal(config.callbackUri,
    "https://uptech-knowledge-sigma.vercel.app/api/v1/auth/mobile/google/callback");
  assert.equal(config.appReturnUri,
    "https://uptech-knowledge-sigma.vercel.app/auth/mobile/callback");
});

test("mobile auth config rejects caller-style URL overrides", () => {
  assert.throws(() => loadMobileAuthConfig({
    NODE_ENV: "production",
    DATABASE_URL: "postgres://runtime@unknown.example/uptech",
    UPTECH_ENVIRONMENT_ID: "production",
    UPTECH_ENVIRONMENT_RATE_KEY: secret(1),
    UPTECH_GOOGLE_LOGIN_PKCE_KEY: secret(2),
    UPTECH_GOOGLE_LOGIN_PKCE_KEY_VERSION: "kms-v1",
    UPTECH_SESSION_PEPPER: secret(3),
    UPTECH_MOBILE_REFRESH_REPLAY_KEY: secret(4),
    GOOGLE_MOBILE_CLIENT_ID: "mobile-web.apps.googleusercontent.com",
    GOOGLE_MOBILE_CLIENT_SECRET: "server-only-secret",
    UPTECH_MOBILE_APP_RETURN_URI: "https://unknown.example/callback",
  }), { name: "MobileAuthConfigurationError" });
});

test("mobile auth reuses the server-side Web OAuth client when no mobile override is configured", () => {
  const config = loadMobileAuthConfig({
    NODE_ENV: "production",
    DATABASE_URL: "postgres://runtime@unknown.example/uptech",
    UPTECH_ENVIRONMENT_ID: "production",
    UPTECH_ENVIRONMENT_RATE_KEY: secret(1),
    UPTECH_GOOGLE_LOGIN_PKCE_KEY: secret(2),
    UPTECH_GOOGLE_LOGIN_PKCE_KEY_VERSION: "kms-v1",
    UPTECH_SESSION_PEPPER: secret(3),
    UPTECH_MOBILE_REFRESH_REPLAY_KEY: secret(4),
    GOOGLE_CLIENT_ID: "shared-web.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "shared-server-only-secret",
  });

  assert.equal(config.clientId, "shared-web.apps.googleusercontent.com");
  assert.equal(config.clientSecret, "shared-server-only-secret");
});

test("mobile OAuth overrides require an exact client ID and secret pair", () => {
  const baseEnvironment = {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://runtime@unknown.example/uptech",
    UPTECH_ENVIRONMENT_ID: "production",
    UPTECH_ENVIRONMENT_RATE_KEY: secret(1),
    UPTECH_GOOGLE_LOGIN_PKCE_KEY: secret(2),
    UPTECH_GOOGLE_LOGIN_PKCE_KEY_VERSION: "kms-v1",
    UPTECH_SESSION_PEPPER: secret(3),
    UPTECH_MOBILE_REFRESH_REPLAY_KEY: secret(4),
    GOOGLE_CLIENT_ID: "shared-web.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "shared-server-only-secret",
  };

  for (const partialOverride of [
    { GOOGLE_MOBILE_CLIENT_ID: "mobile-web.apps.googleusercontent.com" },
    { GOOGLE_MOBILE_CLIENT_SECRET: "mobile-server-only-secret" },
  ]) {
    assert.throws(() => loadMobileAuthConfig({
      ...baseEnvironment,
      ...partialOverride,
    }), { name: "MobileAuthConfigurationError" });
  }
});

test("mobile auth uses the same bounded environment identifier as Web auth", () => {
  const baseEnvironment = {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://runtime@unknown.example/uptech",
    UPTECH_ENVIRONMENT_RATE_KEY: secret(1),
    UPTECH_GOOGLE_LOGIN_PKCE_KEY: secret(2),
    UPTECH_GOOGLE_LOGIN_PKCE_KEY_VERSION: "kms-v1",
    UPTECH_SESSION_PEPPER: secret(3),
    UPTECH_MOBILE_REFRESH_REPLAY_KEY: secret(4),
    GOOGLE_CLIENT_ID: "shared-web.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "shared-server-only-secret",
  };

  assert.doesNotThrow(() => loadMobileAuthConfig({
    ...baseEnvironment,
    UPTECH_ENVIRONMENT_ID: `p${"a".repeat(63)}`,
  }));
  for (const environmentId of [
    `p${"a".repeat(64)}`,
    ".production",
    "production.blue",
    "production:blue",
  ]) {
    assert.throws(() => loadMobileAuthConfig({
      ...baseEnvironment,
      UPTECH_ENVIRONMENT_ID: environmentId,
    }), { name: "MobileAuthConfigurationError" });
  }
});
