import assert from "node:assert/strict";
import test from "node:test";

import type { RequestTransactionContext } from "../db/core.ts";
import {
  TenantRateLimitUnavailableError,
  consumeTenantRateLimit,
} from "./core.ts";

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[] | undefined;
}

const REQUEST_CONTEXT: RequestTransactionContext = Object.freeze({
  kind: "request",
  workspaceId: "a1000000-0000-0000-0000-000000000001",
  actorId: "b1000000-0000-0000-0000-000000000001",
  membershipId: "d1000000-0000-0000-0000-000000000001",
  sessionId: "11000000-0000-0000-0000-000000000001",
  tokenId: "21000000-0000-0000-0000-000000000001",
  clientType: "WEB",
  tokenKind: "WEB_SESSION",
  userSecurityVersion: "1",
  identitySecurityVersion: "1",
  workspaceSecurityVersion: "1",
  membershipAuthzVersion: "1",
  sessionSecurityVersion: "1",
  credentialHash: new Uint8Array(32).fill(7),
});

function result(rows: readonly Record<string, unknown>[]) {
  return { command: "SELECT", rowCount: rows.length, oid: 0, fields: [], rows };
}

function admission(expected: number, admitted: number) {
  return result([
    {
      expected_count: expected,
      context_count: 1,
      admitted_count: admitted,
    },
  ]);
}

function createRatePool(
  onAdmission: (
    policy: unknown,
  ) => ReturnType<typeof result> | Promise<ReturnType<typeof result>>,
) {
  const calls: QueryCall[] = [];
  const client = {
    async query(text: string, values?: readonly unknown[]) {
      calls.push({ text, values });
      if (text.includes("AS matching_context_count")) {
        return result([{ matching_context_count: 1 }]);
      }
      if (values?.length === 1) {
        return onAdmission(values[0]);
      }
      return result([]);
    },
    release() {},
  };
  const pool = {
    connects: 0,
    async connect() {
      this.connects += 1;
      return client;
    },
  };
  return { calls, pool };
}

function admissionCall(calls: readonly QueryCall[]): QueryCall {
  const call = calls.find(({ values }) => values?.length === 1);
  assert.ok(call !== undefined, "expected one limiter admission query");
  return call;
}

test("connector mutation commits a fixed database-derived membership policy", async () => {
  const fake = createRatePool(() => admission(1, 1));

  const decision = await consumeTenantRateLimit(
    REQUEST_CONTEXT,
    "CONNECTOR_MUTATION",
    fake.pool as never,
  );

  assert.deepEqual(decision, {
    outcome: "ALLOW",
    policy: "CONNECTOR_MUTATION",
  });
  assert.equal(Object.isFrozen(decision), true);
  assert.equal(fake.calls[0].text, "BEGIN");
  assert.equal(fake.calls.at(-1)?.text, "COMMIT");
  const call = admissionCall(fake.calls);
  assert.deepEqual(call.values, ["CONNECTOR_MUTATION"]);

  const sql = call.text;
  assert.match(
    sql,
    /'CONNECTOR_MUTATION'::text, 'MEMBERSHIP'::text, 10::integer, 600::integer/u,
  );
  assert.match(sql, /current_setting\('app\.workspace_id'\)::uuid/u);
  assert.match(sql, /current_setting\('app\.membership_id'\)::uuid/u);
  assert.match(sql, /current_setting\('app\.actor_id'\)::uuid/u);
  assert.match(sql, /pg_catalog\.sha256\(/u);
  assert.match(sql, /ON CONFLICT \(/u);
  assert.match(sql, /uptech\.rate_limit_buckets\.request_count < CASE/u);
  assert.doesNotMatch(sql, /\$2/u);
});

test("search denial is committed as a stable decision", async () => {
  const fake = createRatePool(() => admission(1, 0));

  const decision = await consumeTenantRateLimit(
    REQUEST_CONTEXT,
    "SEARCH",
    fake.pool as never,
  );

  assert.deepEqual(decision, { outcome: "DENY", policy: "SEARCH" });
  assert.equal(Object.isFrozen(decision), true);
  assert.equal(fake.calls.at(-1)?.text, "COMMIT");
});

test("RAG commits membership and workspace buckets in one admission transaction", async () => {
  const fake = createRatePool(() => admission(2, 2));

  const decision = await consumeTenantRateLimit(
    REQUEST_CONTEXT,
    "RAG",
    fake.pool as never,
  );

  assert.deepEqual(decision, { outcome: "ALLOW", policy: "RAG" });
  const call = admissionCall(fake.calls);
  assert.deepEqual(call.values, ["RAG"]);
  assert.match(
    call.text,
    /'RAG'::text, 'MEMBERSHIP'::text, 10::integer, 60::integer/u,
  );
  assert.match(
    call.text,
    /'RAG'::text, 'WORKSPACE'::text, 100::integer, 60::integer/u,
  );
  assert.deepEqual(
    fake.calls
      .map(({ text }) => text)
      .filter((text) => /SAVEPOINT|ROLLBACK TO|RELEASE SAVEPOINT/u.test(text)),
    [
      "SAVEPOINT uptech_tenant_rag_rate_limit",
      "RELEASE SAVEPOINT uptech_tenant_rag_rate_limit",
    ],
  );
  assert.equal(fake.calls.at(-1)?.text, "COMMIT");
});

test("partial RAG admission rolls both buckets back before committing DENY", async () => {
  const fake = createRatePool(() => admission(2, 1));

  const decision = await consumeTenantRateLimit(
    REQUEST_CONTEXT,
    "RAG",
    fake.pool as never,
  );

  assert.deepEqual(decision, { outcome: "DENY", policy: "RAG" });
  assert.deepEqual(
    fake.calls
      .map(({ text }) => text)
      .filter((text) => /SAVEPOINT|ROLLBACK TO|RELEASE SAVEPOINT/u.test(text)),
    [
      "SAVEPOINT uptech_tenant_rag_rate_limit",
      "ROLLBACK TO SAVEPOINT uptech_tenant_rag_rate_limit",
      "RELEASE SAVEPOINT uptech_tenant_rag_rate_limit",
    ],
  );
  assert.equal(fake.calls.at(-1)?.text, "COMMIT");
});

test("database failures and malformed results become one non-leaking typed error", async () => {
  const secret = "postgresql://operator:password@internal/rate-limit";
  const failing = createRatePool(() => {
    throw new Error(secret);
  });

  await assert.rejects(
    consumeTenantRateLimit(
      REQUEST_CONTEXT,
      "SEARCH",
      failing.pool as never,
    ),
    (error: unknown) => {
      assert.ok(error instanceof TenantRateLimitUnavailableError);
      assert.equal(error.code, "RATE_LIMIT_UNAVAILABLE");
      assert.equal(error.message, "Tenant rate-limit decision is unavailable");
      assert.doesNotMatch(String(error), /operator|password|internal/u);
      return true;
    },
  );
  assert.equal(failing.calls.at(-1)?.text, "ROLLBACK");

  for (const rows of [
    [],
    [{ expected_count: 1, context_count: 0, admitted_count: 0 }],
    [{ expected_count: 1, context_count: 1, admitted_count: "1" }],
    [{ expected_count: 1, context_count: 1, admitted_count: 2 }],
  ]) {
    const malformed = createRatePool(() => result(rows));
    await assert.rejects(
      consumeTenantRateLimit(
        REQUEST_CONTEXT,
        "SEARCH",
        malformed.pool as never,
      ),
      TenantRateLimitUnavailableError,
    );
    assert.equal(malformed.calls.at(-1)?.text, "ROLLBACK");
  }
});

test("RAG cleans up its savepoint before masking malformed database output", async () => {
  const fake = createRatePool(() => admission(2, 3));

  await assert.rejects(
    consumeTenantRateLimit(REQUEST_CONTEXT, "RAG", fake.pool as never),
    TenantRateLimitUnavailableError,
  );
  assert.deepEqual(
    fake.calls
      .map(({ text }) => text)
      .filter((text) => /SAVEPOINT|ROLLBACK TO|RELEASE SAVEPOINT/u.test(text)),
    [
      "SAVEPOINT uptech_tenant_rag_rate_limit",
      "ROLLBACK TO SAVEPOINT uptech_tenant_rag_rate_limit",
      "RELEASE SAVEPOINT uptech_tenant_rag_rate_limit",
    ],
  );
  assert.equal(fake.calls.at(-1)?.text, "ROLLBACK");
});

test("unknown runtime policy is rejected before checking out PostgreSQL", async () => {
  const fake = createRatePool(() => admission(1, 1));

  await assert.rejects(
    consumeTenantRateLimit(
      REQUEST_CONTEXT,
      "CUSTOM" as never,
      fake.pool as never,
    ),
    TenantRateLimitUnavailableError,
  );
  assert.equal(fake.pool.connects, 0);
  assert.equal(fake.calls.length, 0);
});
