import assert from "node:assert/strict";
import { test } from "node:test";

import { MobileSessionServiceError } from "./session-service.ts";
import {
  createMobileGoogleCallbackGet,
  createMobileHandoffExchangePost,
  createMobileGoogleTransactionPost,
  createMobileRouteHandlers,
} from "./route-handlers.ts";

const requestId = "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21";
const proof = (byte: number) => Buffer.alloc(32, byte).toString("base64url");
const jsonRequest = (path: string, body: unknown) => new Request(`https://tenant-a.example${path}`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-uptech-request-id": requestId },
  body: JSON.stringify(body),
});

function handlers(overrides: Record<string, unknown> = {}) {
  return createMobileRouteHandlers({
    appReturnUri: (overrides.appReturnUri as string | undefined) ??
      "https://uptech-knowledge-sigma.vercel.app/auth/mobile/callback",
    clientIp() { return "203.0.113.1"; },
    googleService: {
      async rejectMalformedIngress() { return "RECORDED" as const; },
      async initiate() { return { outcome: "DENIED" as const }; },
      async callback() { return { outcome: "DENIED" as const }; },
      ...(overrides.googleService as object | undefined),
    },
    sessionService: {
      async exchangeHandoff() { return { outcome: "DENIED" as const }; },
      async listWorkspaces() { return []; },
      async authenticateBearer() { throw new MobileSessionServiceError("denied", "SESSION_REVOKED"); },
      async refresh() { return { outcome: "DENIED" as const }; },
      async switchWorkspace() { return { outcome: "DENIED" as const }; },
      ...(overrides.sessionService as object | undefined),
    },
  } as never);
}

test("transaction route converts runtime initialization failure to a redacted no-store 503 problem", async () => {
  const post = createMobileGoogleTransactionPost({
    createRuntime() {
      throw new Error("client-secret=sensitive-runtime-value");
    },
    clientIp() {
      return "203.0.113.1";
    },
  });
  const response = await post(new Request("https://tenant-a.example/transactions", {
    method: "POST",
    headers: { "x-uptech-request-id": requestId },
  }));
  const body = await response.text();

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("content-type"), "application/problem+json");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-request-id"), requestId);
  assert.deepEqual(JSON.parse(body), {
    type: "urn:uptech:problem:provider_unavailable",
    title: "Provider unavailable",
    status: 503,
    code: "PROVIDER_UNAVAILABLE",
    detail: "A required provider is unavailable.",
    request_id: requestId,
  });
  assert.equal(body.includes("sensitive-runtime-value"), false);
  assert.equal(body.includes("stack"), false);
});

test("callback runtime failure returns without an unauthenticated denial category", async () => {
  const get = createMobileGoogleCallbackGet({
    appReturnUri: "https://uptech-knowledge-sigma.vercel.app/auth/mobile/callback",
    createRuntime() {
      throw new Error("client-secret=sensitive-runtime-value");
    },
    clientIp() {
      return "203.0.113.1";
    },
  });
  const response = await get(new Request(
    `https://uptech-knowledge-sigma.vercel.app/api/v1/auth/mobile/google/callback?code=secret&state=${proof(9)}`,
    { headers: { "x-uptech-request-id": requestId } },
  ));
  const location = new URL(response.headers.get("location") ?? "");

  assert.equal(response.status, 303);
  assert.equal(location.pathname, "/auth/mobile/callback");
  assert.deepEqual([...location.searchParams.keys()], ["request_id"]);
  assert.equal(location.searchParams.get("request_id"), requestId);
  assert.equal(location.href.includes("secret"), false);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
});

test("handoff exchange runtime failure is a redacted no-store 503 with request ID", async () => {
  const post = createMobileHandoffExchangePost({
    createRuntime() {
      throw new Error("database-credential=sensitive-runtime-value");
    },
    clientIp() {
      return "203.0.113.1";
    },
  });
  const response = await post(new Request("https://tenant-a.example/handoffs/exchange", {
    method: "POST",
    headers: { "x-uptech-request-id": requestId },
  }));
  const body = await response.text();

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("content-type"), "application/problem+json");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-request-id"), requestId);
  assert.equal(response.headers.get("x-uptech-mobile-handoff-outcome"), null);
  assert.equal(JSON.parse(body).code, "PROVIDER_UNAVAILABLE");
  assert.equal(body.includes("sensitive-runtime-value"), false);
  assert.equal(body.includes("stack"), false);
});

test("malformed transaction is admitted and redacted exactly once while valid input is not double-counted", async () => {
  let rejected = 0;
  let initiated = 0;
  const route = handlers({ googleService: {
    async rejectMalformedIngress() { rejected += 1; return "RECORDED" as const; },
    async initiate() { initiated += 1; return { outcome: "REDIRECT", authorizationUrl: new URL("https://accounts.google.com/auth") } as const; },
  } });
  const malformed = await route.googleTransaction(jsonRequest("/transactions", { platform: "ANDROID" }));
  assert.equal(malformed.status, 400);
  assert.equal(rejected, 1);
  assert.equal(initiated, 0);

  const valid = await route.googleTransaction(jsonRequest("/transactions", {
    platform: "ANDROID", app_exchange_challenge: proof(1), installation_binding: proof(2), request_id: requestId,
  }));
  assert.equal(valid.status, 201);
  assert.equal(rejected, 1);
  assert.equal(initiated, 1);
});

test("malformed handoff admission maps shared limiter denial to an exact 429 problem", async () => {
  let exchanges = 0;
  const route = handlers({ googleService: {
    async rejectMalformedIngress() { return "RATE_LIMITED" as const; },
  }, sessionService: {
    async exchangeHandoff() { exchanges += 1; return { outcome: "ISSUED" } as never; },
  } });
  const response = await route.handoffExchange(jsonRequest("/handoffs/exchange", { handoff_code: "short" }));
  assert.equal(exchanges, 0);
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), {
    type: "urn:uptech:problem:rate_limited", title: "Rate limited", status: 429,
    code: "RATE_LIMITED", detail: "Too many requests.", request_id: requestId,
  });
});

test("handoff denial is 401 and never serializes candidate credentials", async () => {
  const response = await handlers().handoffExchange(jsonRequest("/handoffs/exchange", {
    handoff_code: proof(1), app_exchange_verifier: proof(2), installation_secret: proof(3),
  }));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("x-uptech-mobile-handoff-outcome"), null);
  const text = await response.text();
  assert.equal(text.includes("access_token"), false);
  assert.equal(text.includes("refresh_token"), false);
  assert.equal(JSON.parse(text).code, "UNAUTHENTICATED");
});

test("authenticated denial handoff returns its canonical safe problem and request ID", async () => {
  const response = await handlers({ sessionService: {
    async exchangeHandoff() {
      return { outcome: "ACCESS_DENIED", category: "UNKNOWN_WORKSPACE" } as const;
    },
  } }).handoffExchange(jsonRequest("/handoffs/exchange", {
    handoff_code: proof(1), app_exchange_verifier: proof(2), installation_secret: proof(3),
  }));

  assert.equal(response.status, 403);
  assert.equal(
    response.headers.get("x-uptech-mobile-handoff-outcome"),
    "ACCESS_DENIED",
  );
  assert.deepEqual(await response.json(), {
    type: "urn:uptech:problem:unknown_workspace",
    title: "Unknown workspace",
    status: 403,
    code: "UNKNOWN_WORKSPACE",
    detail: "The organization is not registered.",
    request_id: requestId,
    recovery_actions: [
      "OPEN_WORKSPACE_SETUP_IN_BROWSER",
      "SWITCH_GOOGLE_ACCOUNT",
    ],
    web_setup_url:
      "https://uptech-knowledge-sigma.vercel.app/login?intent=workspace_setup",
  });
});

test("mobile setup handoff ignores a hostile request origin and exposes no tenant or credential authority", async () => {
  const response = await handlers({ sessionService: {
    async exchangeHandoff() {
      return { outcome: "ACCESS_DENIED", category: "UNKNOWN_WORKSPACE" } as const;
    },
  } }).handoffExchange(jsonRequest("/handoffs/exchange?web_setup_url=https://attacker.example", {
    handoff_code: proof(1), app_exchange_verifier: proof(2), installation_secret: proof(3),
  }));
  const body = await response.json() as Record<string, unknown>;

  assert.equal(body.web_setup_url,
    "https://uptech-knowledge-sigma.vercel.app/login?intent=workspace_setup");
  assert.deepEqual(Object.keys(body).sort(), [
    "code", "detail", "recovery_actions", "request_id", "status", "title", "type", "web_setup_url",
  ]);
  for (const forbidden of [
    "workspace_id", "tenant_id", "customer_id", "role", "department", "domains",
    "access_token", "refresh_token", "handoff", "onboarding_credential", "secret_reference",
  ]) assert.equal(forbidden in body, false);
});

test("invalid configured setup origin and unknown category fail closed without recovery authority", async () => {
  for (const scenario of [
    { appReturnUri: "http://uptech-knowledge-sigma.vercel.app/auth/mobile/callback",
      category: "UNKNOWN_WORKSPACE" },
    { appReturnUri: "https://uptech-knowledge-sigma.vercel.app/auth/mobile/callback",
      category: "START_ORGANIZATION_SETUP" },
  ]) {
    const response = await handlers({ appReturnUri: scenario.appReturnUri, sessionService: {
      async exchangeHandoff() {
        return { outcome: "ACCESS_DENIED", category: scenario.category } as never;
      },
    } }).handoffExchange(jsonRequest("/handoffs/exchange", {
      handoff_code: proof(1), app_exchange_verifier: proof(2), installation_secret: proof(3),
    }));
    const body = await response.json() as Record<string, unknown>;
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("x-uptech-mobile-handoff-outcome"), null);
    assert.equal("recovery_actions" in body, false);
    assert.equal("web_setup_url" in body, false);
  }
});

for (const category of [
  "PERSONAL_GOOGLE_ACCOUNT", "USER_NOT_PROVISIONED", "USER_SUSPENDED",
  "WORKSPACE_SUSPENDED", "POLICY_OR_DEVICE_BLOCKED", "PROVIDER_UNAVAILABLE",
] as const) {
  test(`authenticated ${category} denial has closed mobile actions and no setup URL`, async () => {
    const response = await handlers({ sessionService: {
      async exchangeHandoff() { return { outcome: "ACCESS_DENIED", category } as const; },
    } }).handoffExchange(jsonRequest("/handoffs/exchange", {
      handoff_code: proof(1), app_exchange_verifier: proof(2), installation_secret: proof(3),
    }));
    const body = await response.json() as Record<string, unknown>;
    assert.equal("web_setup_url" in body, false);
    assert.ok(Array.isArray(body.recovery_actions));
    assert.equal((body.recovery_actions as string[]).includes("START_ORGANIZATION_SETUP"), false);
  });
}

test("consumed provider-unavailable denial is marked but an ordinary 503 is not", async () => {
  const authenticated = await handlers({ sessionService: {
    async exchangeHandoff() {
      return { outcome: "ACCESS_DENIED", category: "PROVIDER_UNAVAILABLE" } as const;
    },
  } }).handoffExchange(jsonRequest("/handoffs/exchange", {
    handoff_code: proof(1), app_exchange_verifier: proof(2), installation_secret: proof(3),
  }));
  const ordinary = await handlers({ sessionService: {
    async exchangeHandoff() {
      throw new Error("transient runtime failure");
    },
  } }).handoffExchange(jsonRequest("/handoffs/exchange", {
    handoff_code: proof(1), app_exchange_verifier: proof(2), installation_secret: proof(3),
  }));

  assert.equal(authenticated.status, 503);
  assert.equal(
    authenticated.headers.get("x-uptech-mobile-handoff-outcome"),
    "ACCESS_DENIED",
  );
  assert.equal((await authenticated.json()).code, "PROVIDER_UNAVAILABLE");
  assert.equal(ordinary.status, 503);
  assert.equal(ordinary.headers.get("x-uptech-mobile-handoff-outcome"), null);
  assert.equal((await ordinary.json()).code, "PROVIDER_UNAVAILABLE");
});

test("unbound callback denial never puts an authoritative category in the App Link", async () => {
  const response = await handlers({ googleService: {
    async callback() { return { outcome: "DENIED", category: "UNKNOWN_WORKSPACE" } as const; },
  } }).googleCallback(new Request(`https://tenant-a.example/callback?code=secret&state=${proof(4)}`, {
    headers: { "x-uptech-request-id": requestId },
  }));
  const location = new URL(response.headers.get("location") ?? "");
  assert.equal(response.status, 303);
  assert.deepEqual([...location.searchParams.keys()], ["request_id"]);
  assert.equal(location.href.includes("secret"), false);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
});

test("callback App Link exposes only a one-time handoff and safe request ID", async () => {
  const handoff = proof(7);
  const response = await handlers({ googleService: {
    async callback() { return { outcome: "HANDOFF", handoffCode: handoff } as const; },
  } }).googleCallback(new Request(`https://tenant-a.example/callback?code=secret&state=${proof(4)}`, {
    headers: { "x-uptech-request-id": requestId },
  }));
  const location = new URL(response.headers.get("location") ?? "");

  assert.deepEqual([...location.searchParams.keys()].sort(), ["handoff", "request_id"]);
  assert.equal(location.searchParams.get("handoff"), handoff);
  assert.equal(location.searchParams.get("request_id"), requestId);
  assert.equal(location.href.includes("secret"), false);
});

test("workspace denial returns the fixed top-level session-revoked problem document", async () => {
  const response = await handlers({ sessionService: {
    async listWorkspaces() { throw new MobileSessionServiceError("denied", "SESSION_REVOKED"); },
  } }).workspaces(new Request("https://tenant-a.example/workspaces", {
    headers: { authorization: `Bearer ${proof(5)}`, "x-uptech-request-id": requestId },
  }));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    type: "urn:uptech:problem:session_revoked", title: "Session revoked", status: 401,
    code: "SESSION_REVOKED", detail: "The session is no longer active.", request_id: requestId,
  });
});

test("workspace access expiry returns the refreshable fixed problem document", async () => {
  const response = await handlers({ sessionService: {
    async listWorkspaces() { throw new MobileSessionServiceError("expired", "ACCESS_TOKEN_EXPIRED"); },
  } }).workspaces(new Request("https://tenant-a.example/workspaces", {
    headers: { authorization: `Bearer ${proof(5)}`, "x-uptech-request-id": requestId },
  }));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    type: "urn:uptech:problem:access_token_expired", title: "Access token expired", status: 401,
    code: "ACCESS_TOKEN_EXPIRED", detail: "The access token must be refreshed.", request_id: requestId,
  });
});

test("workspace switch rejects a malformed target UUID as HTTP 400 before service or SQL", async () => {
  let calls = 0;
  const response = await handlers({ sessionService: {
    async switchWorkspace() { calls += 1; return { outcome: "ROTATED" } as never; },
  } }).switchWorkspace(new Request("https://tenant-a.example/switch-workspace", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${proof(5)}`,
      "idempotency-key": "switch-1", "x-uptech-request-id": requestId },
    body: JSON.stringify({ target_workspace_id: "not-a-uuid", installation_secret: proof(6) }),
  }));
  assert.equal(calls, 0);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "VALIDATION_FAILED");
});
