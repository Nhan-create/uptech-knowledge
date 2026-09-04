import assert from "node:assert/strict";
import test from "node:test";

import type { DatabasePool } from "../db/core.ts";
import {
  resolveWebRouteAuthority,
  resolveWebRouteAuthorityDetailed,
  type WebRouteAuthorityDependencies,
} from "./web-route-authority.ts";
import { WebSessionAuthenticationError } from "./web-session.ts";

type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER";

function authenticatedSession(workspaceRole: WorkspaceRole) {
  return {
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
      workspaceRole,
      userSecurityVersion: "1",
      identitySecurityVersion: "1",
      workspaceSecurityVersion: "1",
      membershipAuthzVersion: "1",
      sessionSecurityVersion: "1",
      csrfTokenHash: "0".repeat(64),
      contextExpiresAt: new Date("2030-01-01T00:00:00.000Z"),
    },
  };
}

function directoryPool(
  rows: readonly unknown[],
  calls: string[],
): Pick<DatabasePool, "connect" | "query"> {
  const client = {
    async query(sql: string) {
      calls.push(sql);
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [] };
      }
      if (sql.includes("set_config('app.workspace_id'")) {
        return { rows: [] };
      }
      if (sql.includes("matching_context_count")) {
        return { rows: [{ matching_context_count: 1 }] };
      }
      if (sql === "SELECT * FROM uptech.load_people_permission_context_v1()") {
        return { rows };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {},
  };
  return {
    query: client.query,
    connect: async () => client,
  } as unknown as Pick<DatabasePool, "connect" | "query">;
}

function validDirectoryRows(workspaceRole: WorkspaceRole): readonly unknown[] {
  if (workspaceRole === "OWNER") {
    return [{
      workspace_id: "workspace-a",
      membership_role: "OWNER",
      department_key: null,
      direct_group_ids: [],
    }];
  }
  if (workspaceRole === "ADMIN") {
    return [{
      workspace_id: "workspace-a",
      membership_role: "ADMIN",
      department_key: null,
      direct_group_ids: ["admin-group"],
    }];
  }
  if (workspaceRole === "MEMBER") {
    return [{
      workspace_id: "workspace-a",
      membership_role: "MEMBER",
      department_key: "SALES",
      direct_group_ids: [],
    }];
  }
  return [];
}

const dependencies = (
  workspaceRole: WorkspaceRole,
  rows: readonly unknown[] = validDirectoryRows(workspaceRole),
) =>
  ({
    loadConfig: () => ({
      databaseUrl: "postgresql://runtime@tenant-a.example/test",
      sessionPepper: new Uint8Array(32),
    }),
    getPool: () => directoryPool(rows, []),
    authenticate: async () => authenticatedSession(workspaceRole),
  }) satisfies WebRouteAuthorityDependencies;

test("MEMBER is allowed at /home", async () => {
  assert.equal(
    await resolveWebRouteAuthority(
      new Headers({ cookie: "__Host-uptech_session=member" }),
      "HOME",
      dependencies("MEMBER"),
    ),
    "ALLOW",
  );
});

test("OWNER and ADMIN are allowed at /admin", async () => {
  assert.equal(
    await resolveWebRouteAuthority(
      new Headers({ cookie: "__Host-uptech_session=owner" }),
      "ADMIN",
      dependencies("OWNER"),
    ),
    "ALLOW",
  );
});

test("OWNER is denied when the configured Directory authority is no longer current", async () => {
  const calls: string[] = [];
  const ownerDependencies: WebRouteAuthorityDependencies = {
    ...dependencies("OWNER"),
    getPool: () => directoryPool([], calls),
  };

  assert.equal(
    await resolveWebRouteAuthority(new Headers(), "HOME", ownerDependencies),
    "LOGIN",
  );
  assert.equal(
    calls.filter((sql) => sql === "SELECT * FROM uptech.load_people_permission_context_v1()").length,
    1,
  );
});

test("ADMIN must have one matching Directory authority before routing", async () => {
  const calls: string[] = [];
  const adminDependencies: WebRouteAuthorityDependencies = {
    ...dependencies("ADMIN"),
    getPool: () => directoryPool([{
      workspace_id: "workspace-a",
      membership_role: "ADMIN",
      department_key: null,
      direct_group_ids: ["admin-group"],
    }], calls),
  };

  assert.equal(
    await resolveWebRouteAuthority(new Headers(), "ADMIN", adminDependencies),
    "ALLOW",
  );
  assert.equal(
    calls.filter((sql) => sql === "SELECT * FROM uptech.load_people_permission_context_v1()").length,
    1,
  );
});

test("an authorized ADMIN is directed to admin from home", async () => {
  assert.equal(
    await resolveWebRouteAuthority(
      new Headers(),
      "HOME",
      {
        ...dependencies("ADMIN"),
        getPool: () => directoryPool([{
          workspace_id: "workspace-a",
          membership_role: "ADMIN",
          department_key: null,
          direct_group_ids: ["admin-group"],
        }], []),
      },
    ),
    "ADMIN",
  );
});

test("MEMBER must have one matching Directory authority before routing", async () => {
  const memberDependencies: WebRouteAuthorityDependencies = {
    ...dependencies("MEMBER"),
    getPool: () => directoryPool([{
      workspace_id: "workspace-a",
      membership_role: "MEMBER",
      department_key: "SALES",
      direct_group_ids: [],
    }], []),
  };

  assert.equal(
    await resolveWebRouteAuthority(new Headers(), "HOME", memberDependencies),
    "ALLOW",
  );
  assert.equal(
    await resolveWebRouteAuthority(new Headers(), "ADMIN", memberDependencies),
    "HOME",
  );
});

test("a FINANCE Directory member is allowed into the employee data plane", async () => {
  assert.equal(
    await resolveWebRouteAuthority(
      new Headers(),
      "HOME",
      {
        ...dependencies("MEMBER"),
        getPool: () => directoryPool([{
          workspace_id: "workspace-a",
          membership_role: "MEMBER",
          department_key: "FINANCE",
          direct_group_ids: ["finance-group"],
        }], []),
      },
    ),
    "ALLOW",
  );
});

for (const [label, rows] of [
  ["missing", []],
  ["multiple", [
    { workspace_id: "workspace-a", membership_role: "ADMIN", department_key: null, direct_group_ids: [] },
    { workspace_id: "workspace-a", membership_role: "ADMIN", department_key: null, direct_group_ids: [] },
  ]],
  ["cross-tenant", [{ workspace_id: "workspace-b", membership_role: "ADMIN", department_key: null, direct_group_ids: [] }]],
  ["role-mismatch", [{ workspace_id: "workspace-a", membership_role: "MEMBER", department_key: "SALES", direct_group_ids: [] }]],
  ["malformed", [{ workspace_id: "workspace-a", membership_role: "ADMIN", department_key: 42, direct_group_ids: "admin-group" }]],
] as const) {
  test(`${label} Directory authority fails closed`, async () => {
    assert.equal(
      await resolveWebRouteAuthority(
        new Headers(),
        "ADMIN",
        {
          ...dependencies("ADMIN"),
          getPool: () => directoryPool(rows, []),
        },
      ),
      "LOGIN",
    );
  });
}

test("MEMBER is redirected from /admin to /home", async () => {
  assert.equal(
    await resolveWebRouteAuthority(
      new Headers({ cookie: "__Host-uptech_session=member" }),
      "ADMIN",
      dependencies("MEMBER"),
    ),
    "HOME",
  );
});

test("an invalid web session is denied to login", async () => {
  const invalidSessionDependencies: WebRouteAuthorityDependencies = {
    ...dependencies("MEMBER"),
    authenticate: async () => {
      throw new WebSessionAuthenticationError("invalid");
    },
  };

  assert.equal(
    await resolveWebRouteAuthority(
      new Headers({ cookie: "__Host-uptech_session=invalid" }),
      "HOME",
      invalidSessionDependencies,
    ),
    "LOGIN",
  );
});

test("unrecognized session roles fail closed to login", async () => {
  const malformedSessionDependencies: WebRouteAuthorityDependencies = {
    ...dependencies("MEMBER"),
    authenticate: async () =>
      ({ context: { workspaceRole: "PLATFORM_ADMIN" } }) as never,
  };

  assert.equal(
    await resolveWebRouteAuthority(
      new Headers({ cookie: "__Host-uptech_session=invalid-role" }),
      "ADMIN",
      malformedSessionDependencies,
    ),
    "LOGIN",
  );
});

test("detailed Web route authority keeps non-current separate from unavailable", async () => {
  assert.deepEqual(
    await resolveWebRouteAuthorityDetailed(new Headers(), "HOME", {
      ...dependencies("OWNER"), getPool: () => directoryPool([], []),
    }),
    { kind: "NOT_CURRENT" },
  );
  assert.deepEqual(
    await resolveWebRouteAuthorityDetailed(new Headers(), "HOME", {
      ...dependencies("OWNER"), getPool: () => ({
        query: async () => { throw new Error("database unavailable"); },
        connect: async () => { throw new Error("database unavailable"); },
      }) as never,
    }),
    { kind: "UNAVAILABLE" },
  );
});
