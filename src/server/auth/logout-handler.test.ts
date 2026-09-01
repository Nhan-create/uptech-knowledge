import assert from "node:assert/strict";
import test from "node:test";

import { createLogoutHandler } from "./logout-handler.ts";
import {
  WebSessionAuthenticationError,
  WebSessionCsrfError,
} from "./web-session.ts";
import { WEB_SESSION_COOKIE_NAME } from "../sessions/session-security.ts";

const APP_ORIGIN = "https://tenant-a.example";
const SESSION = Object.freeze({ marker: "authenticated-session" });

function handlerWith(input: {
  readonly authenticationError?: Error;
  readonly csrfError?: Error;
  readonly revokeError?: Error;
  readonly calls: string[];
}) {
  return createLogoutHandler({
    loadConfig() {
      input.calls.push("config");
      return {
        appOrigin: APP_ORIGIN,
        databaseUrl: "postgresql://unknown.example/uptech",
        sessionPepper: new Uint8Array(32),
      };
    },
    getPool() {
      input.calls.push("pool");
      return {} as never;
    },
    async authenticate() {
      input.calls.push("authenticate");
      if (input.authenticationError) throw input.authenticationError;
      return SESSION as never;
    },
    requireCsrf() {
      input.calls.push("csrf");
      if (input.csrfError) throw input.csrfError;
    },
    async revoke() {
      input.calls.push("revoke");
      if (input.revokeError) throw input.revokeError;
    },
    requestId() {
      input.calls.push("request-id");
      return "00000000-0000-4000-8000-000000000001";
    },
  });
}

function request(): Request {
  return new Request(`${APP_ORIGIN}/api/v1/auth/logout`, { method: "POST" });
}

test("successful logout revokes server authority before clearing the cookie", async () => {
  const calls: string[] = [];
  const response = await handlerWith({ calls })(request());

  assert.equal(response.status, 204);
  assert.deepEqual(calls, [
    "request-id",
    "config",
    "pool",
    "authenticate",
    "csrf",
    "revoke",
  ]);
  assert.match(
    response.headers.get("set-cookie") ?? "",
    new RegExp(`^${WEB_SESSION_COOKIE_NAME}=;`),
  );
});

test("bad CSRF denies without revoking or clearing a still-valid session", async () => {
  const calls: string[] = [];
  const response = await handlerWith({
    calls,
    csrfError: new WebSessionCsrfError("bad csrf"),
  })(request());

  assert.equal(response.status, 403);
  assert.deepEqual(calls, [
    "request-id",
    "config",
    "pool",
    "authenticate",
    "csrf",
  ]);
  assert.equal(response.headers.has("set-cookie"), false);
});

test("an invalid or already-dead session cookie is cleared", async () => {
  const calls: string[] = [];
  const response = await handlerWith({
    calls,
    authenticationError: new WebSessionAuthenticationError("invalid"),
  })(request());

  assert.equal(response.status, 401);
  assert.equal(response.headers.has("set-cookie"), true);
  assert.deepEqual(calls, ["request-id", "config", "pool", "authenticate"]);
});

test("database uncertainty preserves client authority and fails closed", async () => {
  const calls: string[] = [];
  const response = await handlerWith({
    calls,
    revokeError: new Error("database unavailable"),
  })(request());

  assert.equal(response.status, 503);
  assert.equal(response.headers.has("set-cookie"), false);
  assert.deepEqual(calls, [
    "request-id",
    "config",
    "pool",
    "authenticate",
    "csrf",
    "revoke",
  ]);
});
