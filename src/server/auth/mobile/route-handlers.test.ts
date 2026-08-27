import assert from "node:assert/strict";
import { test } from "node:test";

import { MobileSessionServiceError } from "./session-service.ts";
import { createMobileRouteHandlers } from "./route-handlers.ts";

const requestId = "4d6e25c6-e7cb-45ad-9147-e93b1a2fca21";
const proof = (byte: number) => Buffer.alloc(32, byte).toString("base64url");
const jsonRequest = (path: string, body: unknown) => new Request(`https://api.example.test${path}`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-uptech-request-id": requestId },
  body: JSON.stringify(body),
});

function handlers(overrides: Record<string, unknown> = {}) {
  return createMobileRouteHandlers({
    appReturnUri: "https://uptech-knowledge-sigma.vercel.app/auth/mobile/callback",
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
  const text = await response.text();
  assert.equal(text.includes("access_token"), false);
  assert.equal(text.includes("refresh_token"), false);
  assert.equal(JSON.parse(text).code, "UNAUTHENTICATED");
});

test("masked callback redirect contains only its safe category and required hardening headers", async () => {
  const response = await handlers({ googleService: {
    async callback() { return { outcome: "DENIED", category: "UNKNOWN_WORKSPACE" } as const; },
  } }).googleCallback(new Request(`https://api.example.test/callback?code=secret&state=${proof(4)}`, {
    headers: { "x-uptech-request-id": requestId },
  }));
  const location = new URL(response.headers.get("location") ?? "");
  assert.equal(response.status, 303);
  assert.deepEqual([...location.searchParams.keys()].sort(), ["error", "request_id"]);
  assert.equal(location.searchParams.get("error"), "UNKNOWN_WORKSPACE");
  assert.equal(location.href.includes("secret"), false);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
});

test("workspace denial returns the fixed top-level session-revoked problem document", async () => {
  const response = await handlers({ sessionService: {
    async listWorkspaces() { throw new MobileSessionServiceError("denied", "SESSION_REVOKED"); },
  } }).workspaces(new Request("https://api.example.test/workspaces", {
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
  } }).workspaces(new Request("https://api.example.test/workspaces", {
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
  } }).switchWorkspace(new Request("https://api.example.test/switch-workspace", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${proof(5)}`,
      "idempotency-key": "switch-1", "x-uptech-request-id": requestId },
    body: JSON.stringify({ target_workspace_id: "not-a-uuid", installation_secret: proof(6) }),
  }));
  assert.equal(calls, 0);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "VALIDATION_FAILED");
});
