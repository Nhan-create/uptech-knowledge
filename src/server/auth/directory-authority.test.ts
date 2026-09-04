import assert from "node:assert/strict";
import test from "node:test";

import type { DatabasePool, NormalSessionContext } from "../db/core.ts";
import {
  inspectCurrentDirectoryAuthority,
  requireCurrentDirectoryAuthority,
} from "./directory-authority.ts";

function context(workspaceRole: NormalSessionContext["workspaceRole"]): NormalSessionContext {
  return {
    kind: "session",
    identityId: "identity-a",
    workspaceId: "workspace-a",
    actorId: "user-a",
    membershipId: "membership-a",
    sessionId: "session-a",
    tokenId: "token-a",
    clientType: "WEB",
    tokenKind: "WEB_SESSION",
    workspaceRole,
    userSecurityVersion: "1",
    identitySecurityVersion: "1",
    workspaceSecurityVersion: "1",
    membershipAuthzVersion: "1",
    sessionSecurityVersion: "1",
    csrfTokenHash: "0".repeat(64),
    contextExpiresAt: new Date("2030-01-01T00:00:00.000Z"),
  };
}

function pool(rows: readonly unknown[], calls: string[]): Pick<DatabasePool, "connect"> {
  const client = {
    async query(sql: string) {
      calls.push(sql);
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("set_config('app.workspace_id'")) return { rows: [] };
      if (sql.includes("matching_context_count")) return { rows: [{ matching_context_count: 1 }] };
      if (sql === "SELECT * FROM uptech.load_people_permission_context_v1()") return { rows };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {},
  };
  return { connect: async () => client } as unknown as Pick<DatabasePool, "connect">;
}

test("OWNER authority is also decided by the current tenant Directory contract", async () => {
  const calls: string[] = [];
  assert.equal(
    await requireCurrentDirectoryAuthority(
      { context: context("OWNER"), credentialHash: new Uint8Array(32) },
      pool([{
        workspace_id: "workspace-a",
        membership_role: "OWNER",
        department_key: null,
        direct_group_ids: [],
      }], calls),
    ),
    true,
  );
  assert.equal(
    calls.filter((sql) =>
      sql === "SELECT * FROM uptech.load_people_permission_context_v1()"
    ).length,
    1,
  );

  assert.equal(
    await requireCurrentDirectoryAuthority(
      { context: context("OWNER"), credentialHash: new Uint8Array(32) },
      pool([], []),
    ),
    false,
  );
});

test("a FINANCE MEMBER needs one current matching Directory context", async () => {
  const calls: string[] = [];
  assert.equal(
    await requireCurrentDirectoryAuthority(
      { context: context("MEMBER"), credentialHash: new Uint8Array(32) },
      pool([{
        workspace_id: "workspace-a",
        membership_role: "MEMBER",
        department_key: "FINANCE",
        direct_group_ids: ["finance-group"],
      }], calls),
    ),
    true,
  );
  assert.equal(calls.filter((sql) => sql === "SELECT * FROM uptech.load_people_permission_context_v1()").length, 1);
});

test("a malformed or cross-tenant Directory context fails closed", async () => {
  for (const rows of [
    [{ workspace_id: "workspace-a", membership_role: "MEMBER", department_key: "FINANCE", direct_group_ids: "finance-group" }],
    [{ workspace_id: "workspace-b", membership_role: "MEMBER", department_key: "FINANCE", direct_group_ids: [] }],
  ]) {
    assert.equal(
      await requireCurrentDirectoryAuthority(
        { context: context("MEMBER"), credentialHash: new Uint8Array(32) },
        pool(rows, []),
      ),
      false,
    );
  }
});

test("detailed Directory authority separates definite denial from infrastructure uncertainty", async () => {
  const session = { context: context("OWNER"), credentialHash: new Uint8Array(32) };
  assert.equal(await inspectCurrentDirectoryAuthority(session, pool([], [])), "NOT_CURRENT");
  const unavailable = { connect: async () => { throw new Error("database unavailable"); } } as never;
  assert.equal(await inspectCurrentDirectoryAuthority(session, unavailable), "UNAVAILABLE");
});
