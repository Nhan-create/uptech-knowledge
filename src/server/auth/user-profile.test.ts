import assert from "node:assert/strict";
import test from "node:test";

import {
  EMPTY_USER_PROFILE,
  formatWorkspaceRole,
  getProfileInitials,
} from "../../lib/user-profile.ts";
import { issueSessionCredential } from "../sessions/session-security.ts";
import { readCurrentUserProfile } from "./user-profile.ts";

const VALID_CONFIG = {
  databaseUrl: "postgresql://runtime@tenant-a.example/test",
  sessionPepper: new Uint8Array(32).fill(5),
};

test("returns empty non-fake profile when cookies are missing, malformed, or conflicting", async () => {
  const token = issueSessionCredential().raw_token;
  let queries = 0;
  const deps = {
    loadConfig: () => VALID_CONFIG,
    getPool: () => ({
      async query() {
        queries += 1;
        return { rows: [] };
      },
    }),
    authenticateWeb: async () => {
      throw new Error("should not authenticate");
    },
  };

  for (const cookie of [
    "",
    "__Host-uptech_session=not-canonical",
    `__Host-uptech_session=${token}; __Host-uptech_onboarding=${token}`,
    `__Host-uptech_session=${token}; __Host-uptech_session=${token}`,
  ]) {
    const profile = await readCurrentUserProfile(
      new Headers(cookie ? { cookie } : undefined),
      deps as never,
    );
    assert.deepEqual(profile, EMPTY_USER_PROFILE);
  }
  assert.equal(queries, 0);
});

test("reads Google identity and Directory profile fields for an active web session", async () => {
  const token = issueSessionCredential().raw_token;
  const profile = await readCurrentUserProfile(
    new Headers({ cookie: `__Host-uptech_session=${token}` }),
    {
      loadConfig: () => VALID_CONFIG,
      getPool: () => ({
        async query() {
          return {
            rows: [
              {
                auth_source: "WEB_SESSION",
                workspace_role: "ADMIN",
                full_name: "Minh Trần",
                email: "minh.tran@tenant-a.example",
                email_verified: true,
                hosted_domain: "tenant-a.example",
                picture_url: "https://lh3.googleusercontent.com/a/photo",
                department: "Engineering",
                org_unit_path: "/Engineering",
                google_is_admin: true,
                google_is_delegated_admin: false,
              },
            ],
          };
        },
      }),
      authenticateWeb: async () => {
        throw new Error("unused");
      },
    } as never,
  );

  assert.deepEqual(profile, {
    authenticated: true,
    authSource: "WEB_SESSION",
    fullName: "Minh Trần",
    email: "minh.tran@tenant-a.example",
    emailVerified: true,
    hostedDomain: "tenant-a.example",
    pictureUrl: "https://lh3.googleusercontent.com/a/photo",
    department: "Engineering",
    orgUnitPath: "/Engineering",
    workspaceRole: "ADMIN",
    googleIsAdmin: true,
    googleIsDelegatedAdmin: false,
  });
});

test("keeps missing Google fields null instead of inventing fake values and sanitizes untrusted picture URLs", async () => {
  const token = issueSessionCredential().raw_token;
  const profile = await readCurrentUserProfile(
    new Headers({ cookie: `__Host-uptech_onboarding=${token}` }),
    {
      loadConfig: () => VALID_CONFIG,
      getPool: () => ({
        async query() {
          return {
            rows: [
              {
                auth_source: "ONBOARDING",
                workspace_role: null,
                full_name: "   ",
                email: "user@tenant-a.example",
                email_verified: true,
                hosted_domain: "tenant-a.example",
                picture_url: "http://tenant-a.example/avatar.png",
                department: null,
                org_unit_path: null,
                google_is_admin: null,
                google_is_delegated_admin: null,
              },
            ],
          };
        },
      }),
      authenticateWeb: async () => {
        throw new Error("unused");
      },
    } as never,
  );

  assert.equal(profile.authenticated, true);
  assert.equal(profile.authSource, "ONBOARDING");
  assert.equal(profile.fullName, null);
  assert.equal(profile.email, "user@tenant-a.example");
  assert.equal(profile.pictureUrl, null);
  assert.equal(profile.department, null);
  assert.equal(profile.workspaceRole, null);
});

test("falls back safely to empty profile when database is unreachable", async () => {
  const token = issueSessionCredential().raw_token;
  const profile = await readCurrentUserProfile(
    new Headers({ cookie: `__Host-uptech_session=${token}` }),
    {
      loadConfig: () => VALID_CONFIG,
      getPool: () => ({
        async query() {
          throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
        },
      }),
      authenticateWeb: async () => {
        throw new Error("unavailable");
      },
    } as never,
  );

  assert.deepEqual(profile, EMPTY_USER_PROFILE);
});

test("falls back to authenticateWebSession role when migration 0011 routine is absent", async () => {
  const token = issueSessionCredential().raw_token;
  const profile = await readCurrentUserProfile(
    new Headers({ cookie: `__Host-uptech_session=${token}` }),
    {
      loadConfig: () => VALID_CONFIG,
      getPool: () => ({
        async query() {
          const error = new Error("function does not exist") as Error & { code: string };
          error.code = "42883";
          throw error;
        },
      }),
      authenticateWeb: async () => ({
        rawCredential: token,
        credentialHash: new Uint8Array(32),
        csrfCredential: token,
        context: {
          kind: "session",
          identityId: "id-1",
          workspaceId: "ws-1",
          actorId: "user-1",
          membershipId: "mem-1",
          sessionId: "sess-1",
          tokenId: "tok-1",
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
      }),
    } as never,
  );

  assert.equal(profile.authenticated, true);
  assert.equal(profile.authSource, "WEB_SESSION");
  assert.equal(profile.workspaceRole, "OWNER");
  assert.equal(profile.fullName, null);
  assert.equal(profile.email, null);
});

test("profile initials and workspace role formatting return empty string when absent", () => {
  assert.equal(getProfileInitials(null), "");
  assert.equal(getProfileInitials("   "), "");
  assert.equal(getProfileInitials("Minh Trần"), "MT");
  assert.equal(getProfileInitials("Alice"), "A");
  assert.equal(formatWorkspaceRole(null, "vi"), "");
  assert.equal(formatWorkspaceRole("OWNER", "vi"), "Chủ sở hữu (OWNER)");
  assert.equal(formatWorkspaceRole("MEMBER", "en"), "Member (MEMBER)");
});
