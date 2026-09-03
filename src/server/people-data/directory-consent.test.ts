import assert from "node:assert/strict";
import test from "node:test";

import type { AuthenticatedWebSession } from "../auth/web-session.ts";
import {
  createGoogleDirectoryConsentService,
  DirectoryConsentDeniedError,
} from "./directory-consent.ts";

const session = {
  rawCredential: "S".repeat(43),
  credentialHash: new Uint8Array(32),
  csrfCredential: "C".repeat(43),
  context: {
    kind: "session",
    identityId: "10000000-0000-4000-8000-000000000002",
    workspaceId: "10000000-0000-4000-8000-000000000001",
    actorId: "10000000-0000-4000-8000-000000000005",
    membershipId: "10000000-0000-4000-8000-000000000006",
    sessionId: "10000000-0000-4000-8000-000000000003",
    tokenId: "10000000-0000-4000-8000-000000000007",
    clientType: "WEB",
    tokenKind: "WEB_SESSION",
    workspaceRole: "OWNER",
    userSecurityVersion: "1",
    identitySecurityVersion: "1",
    workspaceSecurityVersion: "1",
    membershipAuthzVersion: "1",
    sessionSecurityVersion: "1",
    csrfTokenHash: "0".repeat(64),
    contextExpiresAt: new Date("2030-01-01T00:00:00.000Z"),
  },
} satisfies AuthenticatedWebSession;

const expectedIdentity = Object.freeze({
  connectorId: "10000000-0000-4000-8000-000000000004",
  providerSubject: "google-subject-a",
  normalizedEmail: "admin@tenant-a.example",
  hostedDomain: "tenant-a.example",
});

function dependencies(overrides: Record<string, unknown> = {}) {
  let connected = 0;
  const base = {
    now: () => new Date("2026-09-03T06:00:00.000Z"),
    consentCookie: {
      seal: () => "sealed-directory-cookie",
      open: () => ({
        ...expectedIdentity,
        workspaceId: session.context.workspaceId,
        identityId: session.context.identityId,
        sessionId: session.context.sessionId,
        state: "A".repeat(43),
        nonce: "B".repeat(43),
        pkceVerifier: "C".repeat(43),
        expiresAt: new Date("2026-09-03T06:10:00.000Z"),
      }),
    },
    repository: {
      prepare: async () => expectedIdentity,
    },
    provider: {
      createAuthorization: async () => ({
        state: "A".repeat(43),
        nonce: "B".repeat(43),
        pkceVerifier: "C".repeat(43),
        authorizationUrl: new URL("https://accounts.google.com/o/oauth2/v2/auth?fixed=1"),
      }),
      exchangeAndProbe: async () => ({
        providerSubject: expectedIdentity.providerSubject,
        normalizedEmail: expectedIdentity.normalizedEmail,
        hostedDomain: expectedIdentity.hostedDomain,
        customerId: "customer-a",
        primaryDomain: "tenant-a.example",
        verifiedDomains: [{ normalizedDomain: "tenant-a.example", kind: "PRIMARY", providerParentDomain: null, verified: true }],
        refreshToken: Buffer.from("refresh-token"),
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
      }),
    },
    connection: {
      async connect() {
        connected += 1;
        return { kind: "connected" as const };
      },
    },
    sealGrant: (value: unknown) => value,
    ...overrides,
  };
  return { base, connected: () => connected };
}

test("Directory consent binds initiation and callback to the same authenticated tenant session", async () => {
  const fixture = dependencies();
  const service = createGoogleDirectoryConsentService(fixture.base as never);

  const initiated = await service.initiate({
    session,
    requestId: "10000000-0000-4000-8000-000000000008",
  });
  assert.equal(initiated.authorizationUrl.origin, "https://accounts.google.com");
  assert.equal(initiated.cookie, "sealed-directory-cookie");

  const result = await service.callback({
    session,
    callbackSearch: `?code=provider-code&state=${"A".repeat(43)}`,
    cookie: initiated.cookie,
    requestId: "10000000-0000-4000-8000-000000000009",
  });
  assert.deepEqual(result, {
    kind: "connected",
    connectorId: expectedIdentity.connectorId,
  });
  assert.equal(fixture.connected(), 1);
});

test("Directory consent fails closed before connection on session or Google identity mismatch", async () => {
  for (const mismatch of [
    { sessionId: "20000000-0000-4000-8000-000000000003" },
    { providerSubject: "different-google-subject" },
    { hostedDomain: "tenant-b.example" },
  ]) {
    const fixture = dependencies({
      consentCookie: {
        seal: () => "sealed-directory-cookie",
        open: () => ({
          ...expectedIdentity,
          workspaceId: session.context.workspaceId,
          identityId: session.context.identityId,
          sessionId: session.context.sessionId,
          state: "A".repeat(43),
          nonce: "B".repeat(43),
          pkceVerifier: "C".repeat(43),
          expiresAt: new Date("2026-09-03T06:10:00.000Z"),
          ...mismatch,
        }),
      },
    });
    const service = createGoogleDirectoryConsentService(fixture.base as never);
    await assert.rejects(service.callback({
      session,
      callbackSearch: `?code=provider-code&state=${"A".repeat(43)}`,
      cookie: "sealed-directory-cookie",
      requestId: "10000000-0000-4000-8000-000000000009",
    }), DirectoryConsentDeniedError);
    assert.equal(fixture.connected(), 0);
  }
});

test("Directory consent requires Google admin eligibility and every read probe", async () => {
  const fixture = dependencies();
  const originalExchange = fixture.base.provider.exchangeAndProbe;
  fixture.base.provider.exchangeAndProbe = async () => ({
    ...(await originalExchange()),
    isAdmin: false,
    isDelegatedAdmin: false,
    readProbes: {
      customer: true,
      users: true,
      groups: true,
      groupMembers: false,
      orgUnits: true,
    },
  });
  const service = createGoogleDirectoryConsentService(fixture.base as never);

  await assert.rejects(service.callback({
    session,
    callbackSearch: `?code=provider-code&state=${"A".repeat(43)}`,
    cookie: "sealed-directory-cookie",
    requestId: "10000000-0000-4000-8000-000000000009",
  }), DirectoryConsentDeniedError);
  assert.equal(fixture.connected(), 0);
});
