import assert from "node:assert/strict";
import test from "node:test";

import { createWebSessionBootstrapGet } from "../src/app/api/v1/auth/session/route.ts";

const session = {
  rawCredential: "A".repeat(43),
  credentialHash: new Uint8Array(32),
  csrfCredential: "B".repeat(43),
  context: {
    kind: "session" as const,
    identityId: "identity-a",
    workspaceId: "workspace-a",
    actorId: "user-a",
    membershipId: "membership-a",
    sessionId: "session-a",
    tokenId: "token-a",
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
};

test("session bootstrap denies a stale ADMIN before exposing role or CSRF", async () => {
  const GET = createWebSessionBootstrapGet({
    loadConfig: () => ({ appOrigin: "https://app.example", databaseUrl: "postgresql://runtime@tenant-a.example/test", sessionPepper: new Uint8Array(32) }),
    getPool: () => ({}) as never,
    authenticate: async () => session,
    requireDirectoryAuthority: async () => false,
    requestId: () => "00000000-0000-4000-8000-000000000001",
    log: () => {},
  });

  const response = await GET(new Request("https://app.example/api/v1/auth/session", {
    headers: { cookie: "__Host-uptech_session=value" },
  }));

  assert.equal(response.status, 401);
  const body = await response.json() as Record<string, unknown>;
  assert.equal("csrf_token" in body, false);
  assert.equal("user" in body, false);
});

test("session bootstrap preserves OWNER access only with current Directory bootstrap authority", async () => {
  const GET = createWebSessionBootstrapGet({
    loadConfig: () => ({ appOrigin: "https://app.example", databaseUrl: "postgresql://runtime@tenant-a.example/test", sessionPepper: new Uint8Array(32) }),
    getPool: () => ({}) as never,
    authenticate: async () => ({ ...session, context: { ...session.context, workspaceRole: "OWNER" as const } }),
    requireDirectoryAuthority: async () => true,
    requestId: () => "00000000-0000-4000-8000-000000000002",
    log: () => {},
  });

  const response = await GET(new Request("https://app.example/api/v1/auth/session", {
    headers: { cookie: "__Host-uptech_session=value" },
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    authenticated: true,
    user: { id: "user-a", workspace_id: "workspace-a", role: "OWNER" },
    csrf_token: "B".repeat(43),
  });
});
