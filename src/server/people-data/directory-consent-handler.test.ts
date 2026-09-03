import assert from "node:assert/strict";
import test from "node:test";

import type { AuthenticatedWebSession } from "../auth/web-session.ts";
import type { DatabasePool } from "../db/core.ts";
import {
  createDirectoryConsentCallbackGet,
  createDirectoryConsentPost,
  type DirectoryConsentHandlerDependencies,
} from "./directory-consent-handler.ts";

const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";
const COOKIE_VALUE = "sealed-directory-consent";
const SESSION = {
  rawCredential: "A".repeat(43),
  credentialHash: new Uint8Array(32),
  csrfCredential: "B".repeat(43),
  context: {
    kind: "session" as const,
    identityId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
    actorId: "00000000-0000-4000-8000-000000000003",
    membershipId: "00000000-0000-4000-8000-000000000004",
    sessionId: "00000000-0000-4000-8000-000000000005",
    tokenId: "00000000-0000-4000-8000-000000000006",
    clientType: "WEB" as const,
    tokenKind: "WEB_SESSION" as const,
    workspaceRole: "ADMIN" as const,
    userSecurityVersion: "1",
    identitySecurityVersion: "1",
    workspaceSecurityVersion: "1",
    membershipAuthzVersion: "1",
    sessionSecurityVersion: "1",
    csrfTokenHash: "0".repeat(64),
    contextExpiresAt: new Date("2030-01-01T00:00:00.000Z"),
  },
} satisfies AuthenticatedWebSession;

function dependencies(overrides: Partial<DirectoryConsentHandlerDependencies> = {}) {
  return {
    loadRuntime: () => ({
      config: {
        appOrigin: "https://knowledge.example",
        sessionPepper: new Uint8Array(32),
      },
      pool: {} as Pick<DatabasePool, "query">,
      service: {
        initiate: async () => ({
          authorizationUrl: new URL("https://accounts.google.com/o/oauth2/v2/auth?state=safe"),
          cookie: COOKIE_VALUE,
        }),
        callback: async () => ({
          kind: "connected" as const,
          connectorId: "00000000-0000-4000-8000-000000000007",
        }),
      },
    }),
    authenticate: async () => SESSION,
    requireCsrf: () => undefined,
    requestId: () => REQUEST_ID,
    log: () => undefined,
    ...overrides,
  } satisfies DirectoryConsentHandlerDependencies;
}

test("consent initiation authenticates and enforces CSRF before setting an encrypted transaction cookie", async () => {
  let authenticated = 0;
  let csrfChecked = 0;
  let initiated = 0;
  const POST = createDirectoryConsentPost(dependencies({
    authenticate: async () => {
      authenticated += 1;
      return SESSION;
    },
    requireCsrf: () => {
      csrfChecked += 1;
    },
    loadRuntime: () => ({
      ...dependencies().loadRuntime(),
      service: {
        ...dependencies().loadRuntime().service,
        initiate: async (input) => {
          initiated += 1;
          assert.equal(input.session, SESSION);
          assert.equal(input.requestId, REQUEST_ID);
          return {
            authorizationUrl: new URL("https://accounts.google.com/o/oauth2/v2/auth?state=safe"),
            cookie: COOKIE_VALUE,
          };
        },
      },
    }),
  }));

  const response = await POST(new Request(
    "https://knowledge.example/api/v1/admin/connectors/google-directory/transactions",
    {
      method: "POST",
      headers: {
        cookie: "__Host-uptech_session=session",
        origin: "https://knowledge.example",
        "x-uptech-csrf": "csrf",
      },
    },
  ));

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "https://accounts.google.com/o/oauth2/v2/auth?state=safe");
  assert.match(response.headers.get("set-cookie") ?? "", /^__Host-uptech_directory_tx=sealed-directory-consent;/u);
  assert.match(response.headers.get("set-cookie") ?? "", /Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=600/u);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(authenticated, 1);
  assert.equal(csrfChecked, 1);
  assert.equal(initiated, 1);
});

test("consent initiation rejects an untrusted provider redirect and emits no cookie", async () => {
  const POST = createDirectoryConsentPost(dependencies({
    loadRuntime: () => ({
      ...dependencies().loadRuntime(),
      service: {
        ...dependencies().loadRuntime().service,
        initiate: async () => ({
          authorizationUrl: new URL("https://attacker.example/steal"),
          cookie: COOKIE_VALUE,
        }),
      },
    }),
  }));
  const response = await POST(new Request(
    "https://knowledge.example/api/v1/admin/connectors/google-directory/transactions",
    { method: "POST" },
  ));
  assert.equal(response.status, 503);
  assert.equal(response.headers.has("set-cookie"), false);
  assert.equal(JSON.stringify(await response.json()).includes("attacker"), false);
});

test("callback requires one consent cookie, keeps the same active session, clears cookie, and redirects only locally", async () => {
  let callbackInput: Record<string, unknown> | undefined;
  const GET = createDirectoryConsentCallbackGet(dependencies({
    loadRuntime: () => ({
      ...dependencies().loadRuntime(),
      service: {
        ...dependencies().loadRuntime().service,
        callback: async (input) => {
          callbackInput = input as unknown as Record<string, unknown>;
          return {
            kind: "connected" as const,
            connectorId: "00000000-0000-4000-8000-000000000007",
          };
        },
      },
    }),
  }));
  const response = await GET(new Request(
    "https://knowledge.example/api/v1/admin/connectors/google-directory/callback?code=secret-code&state=state-value",
    { headers: { cookie: `__Host-uptech_session=session; __Host-uptech_directory_tx=${COOKIE_VALUE}` } },
  ));

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "https://knowledge.example/admin/connectors?directory=connected");
  assert.match(response.headers.get("set-cookie") ?? "", /^__Host-uptech_directory_tx=;/u);
  assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/u);
  assert.equal(callbackInput?.session, SESSION);
  assert.equal(callbackInput?.cookie, COOKIE_VALUE);
  assert.equal(callbackInput?.callbackSearch, "?code=secret-code&state=state-value");
  assert.equal(callbackInput?.requestId, REQUEST_ID);
});

test("callback rejects duplicate cookies and masks provider or token details", async () => {
  let called = 0;
  const events: unknown[] = [];
  const GET = createDirectoryConsentCallbackGet(dependencies({
    log: (event) => events.push(event),
    loadRuntime: () => ({
      ...dependencies().loadRuntime(),
      service: {
        ...dependencies().loadRuntime().service,
        callback: async () => {
          called += 1;
          throw new Error("refresh-token-secret customer-123");
        },
      },
    }),
  }));

  const duplicate = await GET(new Request(
    "https://knowledge.example/api/v1/admin/connectors/google-directory/callback?code=code&state=state",
    { headers: { cookie: `__Host-uptech_directory_tx=${COOKIE_VALUE}; __Host-uptech_directory_tx=duplicate` } },
  ));
  assert.equal(duplicate.status, 303);
  assert.equal(duplicate.headers.get("location"), "https://knowledge.example/admin/connectors?directory=failed");
  assert.equal(called, 0);

  const failed = await GET(new Request(
    "https://knowledge.example/api/v1/admin/connectors/google-directory/callback?code=code&state=state",
    { headers: { cookie: `__Host-uptech_directory_tx=${COOKIE_VALUE}` } },
  ));
  assert.equal(failed.status, 303);
  assert.equal(failed.headers.get("location"), "https://knowledge.example/admin/connectors?directory=failed");
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes("refresh-token-secret"), false);
  assert.equal(serialized.includes("customer-123"), false);
});
