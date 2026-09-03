import assert from "node:assert/strict";
import test from "node:test";

import type { DatabasePool } from "../db/core.ts";
import type { AuthenticatedWebSession } from "../auth/web-session.ts";
import type { ConnectGoogleDirectoryInput } from "./directory-connection.ts";
import {
  createAuthenticatedGoogleDirectoryConnection,
  sealServerVerifiedGoogleDirectoryGrant,
  type ServerVerifiedGoogleDirectoryGrant,
} from "./directory-production.ts";

const SESSION = {
  rawCredential: "web-session-credential",
  credentialHash: Uint8Array.from(Buffer.alloc(32, 7)),
  csrfCredential: "csrf-credential",
  context: {
    kind: "session",
    identityId: "identity-from-session",
    workspaceId: "workspace-from-session",
    actorId: "actor-from-session",
    membershipId: "membership-from-session",
    sessionId: "session-from-session",
    tokenId: "token-from-session",
    clientType: "WEB",
    tokenKind: "WEB_SESSION",
    workspaceRole: "ADMIN",
    userSecurityVersion: "1",
    identitySecurityVersion: "1",
    workspaceSecurityVersion: "1",
    membershipAuthzVersion: "1",
    sessionSecurityVersion: "1",
    csrfTokenHash: "00".repeat(32),
    contextExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
  },
} satisfies AuthenticatedWebSession;

const GOOGLE_EVIDENCE = {
  customerId: "C0123abc",
  providerSubject: "google-subject-from-session",
  hostedDomain: "tenant-a.example",
  verifiedDomains: [{ normalizedDomain: "tenant-a.example", kind: "PRIMARY" as const, providerParentDomain: null, verified: true as const }],
  refreshToken: Uint8Array.from(Buffer.from("refresh-token", "utf8")),
  grantedScopes: [
    "https://www.googleapis.com/auth/admin.directory.customer.readonly",
    "https://www.googleapis.com/auth/admin.directory.group.readonly",
    "https://www.googleapis.com/auth/admin.directory.orgunit.readonly",
    "https://www.googleapis.com/auth/admin.directory.user.readonly",
    "https://www.googleapis.com/auth/admin.directory.domain.readonly",
  ],
  isAdmin: true,
  isDelegatedAdmin: false,
  readProbes: {
    customer: true,
    users: true,
    groups: true,
    groupMembers: true,
    orgUnits: true,
  },
} satisfies ConnectGoogleDirectoryInput["google"];

const EXPECTED_GOOGLE_EVIDENCE = {
  ...GOOGLE_EVIDENCE,
  refreshToken: Uint8Array.from(GOOGLE_EVIDENCE.refreshToken),
};
function googleGrant(): ServerVerifiedGoogleDirectoryGrant {
  return sealServerVerifiedGoogleDirectoryGrant({
    ...GOOGLE_EVIDENCE,
    refreshToken: Uint8Array.from(Buffer.from("refresh-token", "utf8")),
  });
}

test("sealed provider grant is non-serializable and takes ownership of refresh-token bytes", () => {
  const evidence = {
    ...GOOGLE_EVIDENCE,
    refreshToken: Uint8Array.from([9, 8, 7, 6]),
  };
  const grant = sealServerVerifiedGoogleDirectoryGrant(evidence);

  assert.equal(JSON.stringify(grant), "{}");
  assert.deepEqual(evidence.refreshToken, Uint8Array.from([0, 0, 0, 0]));
});

test("authenticated Directory connection derives tenant authority from the web session", async () => {
  let received: Omit<ConnectGoogleDirectoryInput, "secretAdapter"> | undefined;
  const connection = createAuthenticatedGoogleDirectoryConnection({
    runtime: {
      async connect(input) {
        received = input;
        return {
          kind: "connected" as const,
          workspaceId: input.setup.workspaceId,
          connectorId: input.setup.connectorId,
          customerId: input.google.customerId,
        };
      },
    },
    pool: {} as Pick<DatabasePool, "connect">,
    nextId: () => "00000000-0000-4000-8000-000000000001",
  });

  const result = await connection.connect({
    session: SESSION,
    connectorId: "connector-selected-within-session-tenant",
    providerGrant: googleGrant(),
  });

  assert.deepEqual(result, {
    kind: "connected",
    workspaceId: "workspace-from-session",
    connectorId: "connector-selected-within-session-tenant",
    customerId: "C0123abc",
  });
  assert.deepEqual(received?.setup, {
    workspaceId: "workspace-from-session",
    connectorId: "connector-selected-within-session-tenant",
    identityId: "identity-from-session",
    role: "ADMIN",
    requestId: "00000000-0000-4000-8000-000000000001",
    serviceIdentity: "uptech-api",
  });
  assert.deepEqual(received?.google, {
    ...EXPECTED_GOOGLE_EVIDENCE,
    refreshToken: Uint8Array.from(
      Buffer.alloc(EXPECTED_GOOGLE_EVIDENCE.refreshToken.length),
    ),
  });
});

test("authenticated Directory connection does not let a caller override session authority", async () => {
  let received: Omit<ConnectGoogleDirectoryInput, "secretAdapter"> | undefined;
  const connection = createAuthenticatedGoogleDirectoryConnection({
    runtime: {
      async connect(input) {
        received = input;
        throw new Error("stop after observing authority");
      },
    },
    pool: {} as Pick<DatabasePool, "connect">,
    nextId: () => "00000000-0000-4000-8000-000000000002",
  });

  await assert.rejects(
    connection.connect({
      session: SESSION,
      connectorId: "tenant-b-connector",
      providerGrant: googleGrant(),
    }),
    /stop after observing authority/,
  );
  assert.equal(received?.setup.workspaceId, "workspace-from-session");
  assert.equal(received?.setup.identityId, "identity-from-session");
  assert.equal(received?.setup.role, "ADMIN");
});

test("authenticated Directory connection consumes a grant once and clears its credential", async () => {
  let runtimeRefreshToken: Uint8Array | undefined;
  const connection = createAuthenticatedGoogleDirectoryConnection({
    runtime: {
      async connect(input) {
        runtimeRefreshToken = input.google.refreshToken;
        return {
          kind: "connected" as const,
          workspaceId: input.setup.workspaceId,
          connectorId: input.setup.connectorId,
          customerId: input.google.customerId,
        };
      },
    },
    pool: {} as Pick<DatabasePool, "connect">,
    nextId: () => "00000000-0000-4000-8000-000000000003",
  });
  const grant = googleGrant();

  await connection.connect({
    session: SESSION,
    connectorId: "connector-a",
    providerGrant: grant,
  });
  assert.deepEqual(
    runtimeRefreshToken,
    Uint8Array.from(Buffer.alloc("refresh-token".length)),
  );
  await assert.rejects(
    connection.connect({
      session: SESSION,
      connectorId: "connector-a",
      providerGrant: grant,
    }),
    /server-verified Google Directory grant is required/i,
  );
});

test("authenticated Directory connection rejects an unsealed browser-shaped grant", async () => {
  let runtimeAttempts = 0;
  const connection = createAuthenticatedGoogleDirectoryConnection({
    runtime: {
      async connect() {
        runtimeAttempts += 1;
        throw new Error("must not run");
      },
    },
    pool: {} as Pick<DatabasePool, "connect">,
    nextId: () => "00000000-0000-4000-8000-000000000004",
  });

  await assert.rejects(
    connection.connect({
      session: SESSION,
      connectorId: "connector-a",
      providerGrant: GOOGLE_EVIDENCE as unknown as ServerVerifiedGoogleDirectoryGrant,
    }),
    /server-verified Google Directory grant is required/i,
  );
  assert.equal(runtimeAttempts, 0);
});
