import assert from "node:assert/strict";
import { test } from "node:test";

import { loadMobileAuthConfig } from "./config.ts";

const secret = (n: number) => Buffer.alloc(32, n).toString("base64url");

test("mobile auth config fixes the approved callback and app return URLs", () => {
  const config = loadMobileAuthConfig({
    NODE_ENV: "production",
    DATABASE_URL: "postgres://runtime@example.test/uptech",
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
    DATABASE_URL: "postgres://runtime@example.test/uptech",
    UPTECH_ENVIRONMENT_ID: "production",
    UPTECH_ENVIRONMENT_RATE_KEY: secret(1),
    UPTECH_GOOGLE_LOGIN_PKCE_KEY: secret(2),
    UPTECH_GOOGLE_LOGIN_PKCE_KEY_VERSION: "kms-v1",
    UPTECH_SESSION_PEPPER: secret(3),
    UPTECH_MOBILE_REFRESH_REPLAY_KEY: secret(4),
    GOOGLE_MOBILE_CLIENT_ID: "mobile-web.apps.googleusercontent.com",
    GOOGLE_MOBILE_CLIENT_SECRET: "server-only-secret",
    UPTECH_MOBILE_APP_RETURN_URI: "https://evil.test/callback",
  }), { name: "MobileAuthConfigurationError" });
});
