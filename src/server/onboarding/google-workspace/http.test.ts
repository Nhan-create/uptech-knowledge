import assert from "node:assert/strict";
import test from "node:test";

import { deriveCsrfCredential, issueOpaqueProof } from "../../auth/google/crypto.ts";
import { GOOGLE_WORKSPACE_SETUP_COOKIE_NAME } from "./crypto.ts";
import {
  createGoogleWorkspaceBootstrapCallbackGet,
  createGoogleWorkspaceBootstrapPost,
  type BootstrapHttpDependencies,
} from "./http.ts";

const APP_ORIGIN = "https://knowledge.uptech.example";
const REQUEST_ID = "10000000-0000-4000-8000-000000000005";
const ONBOARDING = issueOpaqueProof();
const STATUS = issueOpaqueProof();
const SETUP = "1.AAAAAAAAAAAAAAAA.ciphertext.BBBBBBBBBBBBBBBBBBBBBB";
const PEPPER = new Uint8Array(32).fill(9);
const AUTHORIZATION = new URL("https://accounts.google.com/o/oauth2/v2/auth?client_id=approved");

function fixture() {
  const calls: unknown[] = [];
  const service = {
    async initiate(input: { readonly onboardingCredential: string; readonly requestId: string }) {
      calls.push(input);
      return { authorizationUrl: AUTHORIZATION, transactionCookie: SETUP };
    },
    async callback(input: { readonly onboardingCredential: string; readonly callbackSearch: string; readonly transactionCookie: string; readonly requestId: string }) {
      calls.push(input);
      return {
        outcome: "PROVISIONING" as const,
        statusCredential: STATUS,
        statusExpiresAt: new Date(Date.now() + 60_000),
      };
    },
  };
  const dependencies: BootstrapHttpDependencies = {
    requestId: () => REQUEST_ID,
    loadRuntime: () => ({
      appOrigin: APP_ORIGIN,
      sessionPepper: PEPPER,
      service,
    }),
  };
  return { calls, dependencies, service };
}

function startRequest(cookie = `__Host-uptech_onboarding=${ONBOARDING}`, headers: Record<string, string> = {}) {
  return new Request(`${APP_ORIGIN}/api/v1/onboarding/google-workspace/transactions`, {
    method: "POST",
    headers: {
      cookie,
      origin: APP_ORIGIN,
      "sec-fetch-site": "same-origin",
      "x-csrf-token": deriveCsrfCredential(ONBOARDING, PEPPER),
      ...headers,
    },
  });
}

function callbackRequest(query = "?code=provider-code&state=" + issueOpaqueProof(), cookie = `__Host-uptech_onboarding=${ONBOARDING}; ${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=${SETUP}`) {
  return new Request(`${APP_ORIGIN}/api/v1/onboarding/google-workspace/callback${query}`, {
    headers: { cookie },
  });
}

function assertSafe(response: Response) {
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}

test("setup POST accepts only the derived same-origin authority and redirects to Google", async () => {
  const fixtureValue = fixture();
  const response = await createGoogleWorkspaceBootstrapPost(fixtureValue.dependencies)(startRequest());

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), AUTHORIZATION.href);
  assert.match(response.headers.get("set-cookie") ?? "", new RegExp(`^${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=`));
  assert.match(response.headers.get("set-cookie") ?? "", /Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=600/u);
  assert.deepEqual(fixtureValue.calls, [{ onboardingCredential: ONBOARDING, requestId: REQUEST_ID }]);
  assertSafe(response);
});

test("setup POST rejects missing or duplicate authority, setup/session coexistence, body authority, and bad CSRF metadata", async () => {
  for (const request of [
    startRequest("other=cookie"),
    startRequest(`__Host-uptech_onboarding=${ONBOARDING}; __Host-uptech_onboarding=${ONBOARDING}`),
    startRequest(`__Host-uptech_onboarding=${ONBOARDING}; ${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=${SETUP}`),
    startRequest(`__Host-uptech_onboarding=${ONBOARDING}; __Host-uptech_session=${issueOpaqueProof()}`),
    startRequest(undefined, { origin: "https://evil.example" }),
    startRequest(undefined, { "sec-fetch-site": "same-site" }),
    startRequest(undefined, { "x-csrf-token": issueOpaqueProof() }),
    new Request(`${APP_ORIGIN}/api/v1/onboarding/google-workspace/transactions`, {
      method: "POST",
      headers: {
        cookie: `__Host-uptech_onboarding=${ONBOARDING}`,
        origin: APP_ORIGIN,
        "sec-fetch-site": "same-origin",
        "x-csrf-token": deriveCsrfCredential(ONBOARDING, PEPPER),
      },
      body: JSON.stringify({ workspace_id: "caller-controlled" }),
    }),
  ]) {
    const f = fixture();
    const response = await createGoogleWorkspaceBootstrapPost(f.dependencies)(request);
    assert.ok([400, 401, 403].includes(response.status));
    assert.equal(f.calls.length, 0);
    assertSafe(response);
  }
});

test("setup POST refuses non-exact Google authorization destinations", async () => {
  for (const authorizationUrl of [
    new URL("http://accounts.google.com/o/oauth2/v2/auth"),
    new URL("https://accounts.google.com.evil.example/o/oauth2/v2/auth"),
    new URL("https://accounts.google.com/o/oauth2/v2/auth/extra"),
  ]) {
    const f = fixture();
    f.service.initiate = async () => ({ authorizationUrl, transactionCookie: SETUP });
    const response = await createGoogleWorkspaceBootstrapPost(f.dependencies)(startRequest());
    assert.equal(response.status, 503);
    assert.equal(response.headers.has("location"), false);
    assertSafe(response);
  }
});

test("callback success clears setup, replaces onboarding with status authority, and never creates a session", async () => {
  const f = fixture();
  const response = await createGoogleWorkspaceBootstrapCallbackGet(f.dependencies)(callbackRequest());

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), `${APP_ORIGIN}/setup/provisioning`);
  const cookies = response.headers.getSetCookie();
  assert.ok(cookies.some((cookie) => cookie.startsWith(`${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=;`) && cookie.includes("Max-Age=0")));
  assert.ok(cookies.some((cookie) => cookie.startsWith(`__Host-uptech_onboarding=${STATUS};`)));
  assert.equal(cookies.some((cookie) => cookie.includes("uptech_session")), false);
  assert.equal(f.calls.length, 1);
  assertSafe(response);
});

test("callback rejects malformed cookies and arbitrary or overlong Google query input while always clearing setup", async () => {
  for (const request of [
    callbackRequest("?code=ok&state=" + issueOpaqueProof() + "&tenant_id=caller-controlled"),
    callbackRequest("?code=ok&code=duplicate&state=" + issueOpaqueProof()),
    callbackRequest("?code=" + "x".repeat(4_097) + "&state=" + issueOpaqueProof()),
    callbackRequest(undefined, `__Host-uptech_onboarding=${ONBOARDING}`),
    callbackRequest(undefined, `__Host-uptech_onboarding=${ONBOARDING}; __Host-uptech_onboarding=${ONBOARDING}; ${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=${SETUP}`),
    callbackRequest(undefined, `__Host-uptech_onboarding=${ONBOARDING}; ${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=${SETUP}; __Host-uptech_session=${issueOpaqueProof()}`),
  ]) {
    const f = fixture();
    const response = await createGoogleWorkspaceBootstrapCallbackGet(f.dependencies)(request);
    assert.equal(response.status, 303);
    const location = new URL(response.headers.get("location")!);
    assert.equal(location.origin, APP_ORIGIN);
    assert.equal(location.pathname, "/login");
    assert.deepEqual([...location.searchParams.keys()].sort(), ["error", "request_id"]);
    assert.equal(f.calls.length, 0);
    assert.ok(response.headers.getSetCookie().some((cookie) => cookie.startsWith(`${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=;`)));
    assertSafe(response);
  }
});

test("callback failures expose only an allowlisted code and server request UUID", async () => {
  const f = fixture();
  f.service.callback = async () => {
    throw Object.assign(new Error("provider said secret-domain.example token=leak"), { code: "SUPER_ADMIN_REQUIRED" });
  };
  const response = await createGoogleWorkspaceBootstrapCallbackGet(f.dependencies)(callbackRequest());
  const location = new URL(response.headers.get("location")!);
  assert.equal(location.href, `${APP_ORIGIN}/login?error=SUPER_ADMIN_REQUIRED&request_id=${REQUEST_ID}`);
  assert.equal(JSON.stringify([...response.headers]).includes("secret-domain"), false);
  assert.ok(response.headers.getSetCookie().some((cookie) => cookie.startsWith(`${GOOGLE_WORKSPACE_SETUP_COOKIE_NAME}=;`)));
  assertSafe(response);
});
