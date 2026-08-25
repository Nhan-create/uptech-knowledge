import assert from "node:assert/strict";
import test from "node:test";

import {
  DatabaseBoundaryError,
  DatabaseConfigurationError,
  authenticateSession,
  createDatabasePool,
  getDatabasePool,
  initializeDatabasePool,
  requestTransactionContextFromSession,
  withRequestTransaction,
  withWorkerTransaction,
} from "./core.ts";

const REQUEST_CONTEXT = Object.freeze({
  kind: "request" as const,
  workspaceId: "workspace-1",
  actorId: "actor-1",
  membershipId: "membership-1",
  sessionId: "session-1",
  tokenId: "token-1",
  clientType: "WEB" as const,
  tokenKind: "WEB_SESSION" as const,
  userSecurityVersion: "1",
  identitySecurityVersion: "2",
  workspaceSecurityVersion: "3",
  membershipAuthzVersion: "4",
  sessionSecurityVersion: "5",
  credentialHash: new Uint8Array(32).fill(7),
});

function queryResult(rows: readonly Record<string, unknown>[] = []) {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

function createTransactionFake(options?: {
  readonly failOn?: string;
  readonly failRollback?: boolean;
  readonly rejectRequestContext?: boolean;
}) {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const client = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      if (options?.failRollback === true && text === "ROLLBACK") {
        throw new Error("rollback unavailable");
      }
      if (options?.failOn === text) {
        throw new Error(`${text} unavailable`);
      }
      if (text.includes("AS matching_context_count")) {
        return queryResult([
          {
            matching_context_count:
              options?.rejectRequestContext === true ? 0 : 1,
          },
        ]);
      }
      return queryResult();
    },
    released: 0,
    releaseArguments: [] as Array<Error | boolean | undefined>,
    release(error?: Error | boolean) {
      this.released += 1;
      this.releaseArguments.push(error);
    },
  };
  const pool = {
    connects: 0,
    async connect() {
      this.connects += 1;
      return client;
    },
  };
  return { calls, client, pool };
}

test("database pool requires explicit complete configuration and has no implicit singleton", async () => {
  assert.throws(() => getDatabasePool(), DatabaseConfigurationError);
  assert.throws(() => createDatabasePool(undefined), DatabaseConfigurationError);
  assert.throws(
    () => createDatabasePool({ host: "db.internal" }),
    DatabaseConfigurationError,
  );

  const pool = createDatabasePool({
    connectionString: "postgresql://user:password@127.0.0.1/uptech",
  });
  await pool.end();

  const singleton = initializeDatabasePool({
    connectionString: "postgresql://user:password@127.0.0.1/uptech",
  });
  assert.equal(getDatabasePool(), singleton);
  assert.throws(
    () =>
      initializeDatabasePool({
        connectionString: "postgresql://other:password@127.0.0.1/other",
      }),
    DatabaseConfigurationError,
  );
  await singleton.end();
});

test("request transaction uses one checked-out client and transaction-local context", async () => {
  const fake = createTransactionFake();
  let callbackClient: unknown;

  const result = await withRequestTransaction(
    REQUEST_CONTEXT,
    async (client) => {
      callbackClient = client;
      await client.query("SELECT tenant_row");
      return "ok";
    },
    fake.pool as never,
  );

  assert.equal(result, "ok");
  assert.equal(fake.pool.connects, 1);
  assert.equal(callbackClient, fake.client);
  assert.deepEqual(
    fake.calls.map(({ text }) => text.trim()),
    [
      "BEGIN",
      fake.calls[1].text.trim(),
      fake.calls[2].text.trim(),
      "SELECT tenant_row",
      "COMMIT",
    ],
  );
  assert.match(fake.calls[1].text, /app\.workspace_id/);
  assert.match(fake.calls[1].text, /app\.actor_id/);
  assert.match(fake.calls[1].text, /app\.membership_id/);
  assert.match(fake.calls[1].text, /app\.session_id/);
  assert.match(fake.calls[1].text, /app\.job_id/);
  assert.deepEqual(fake.calls[1].values, [
    "workspace-1",
    "actor-1",
    "membership-1",
    "session-1",
    "",
    "",
    "",
    "",
  ]);
  assert.deepEqual(fake.calls[2].values, [
    Buffer.alloc(32, 7),
    "workspace-1",
    "actor-1",
    "membership-1",
    "session-1",
    "token-1",
    "WEB",
    "WEB_SESSION",
    "1",
    "2",
    "3",
    "4",
    "5",
  ]);
  assert.equal(fake.client.released, 1);
});

test("worker transaction clears member authority and sets service scope from the lease", async () => {
  const fake = createTransactionFake();

  await withWorkerTransaction(
    {
      kind: "worker",
      workspaceId: "workspace-2",
      jobId: "job-2",
      serviceActor: "drive-worker",
      connectorId: "connector-2",
      sourceId: "source-2",
      leaseFence: "123e4567-e89b-42d3-a456-426614174000",
    },
    async () => undefined,
    fake.pool as never,
  );

  assert.deepEqual(fake.calls[1].values, [
    "workspace-2",
    "drive-worker",
    "",
    "",
    "job-2",
    "connector-2",
    "source-2",
    "123e4567-e89b-42d3-a456-426614174000",
  ]);
  assert.equal(fake.client.released, 1);
  assert.deepEqual(fake.client.releaseArguments, [undefined]);
});

test("transaction failure rolls back and releases the checked-out client", async () => {
  const fake = createTransactionFake();
  const failure = new Error("work failed");

  await assert.rejects(
    withRequestTransaction(
      REQUEST_CONTEXT,
      async () => {
        throw failure;
      },
      fake.pool as never,
    ),
    (error: unknown) => error === failure,
  );

  assert.deepEqual(
    fake.calls.map(({ text }) => text.trim()),
    [
      "BEGIN",
      fake.calls[1].text.trim(),
      fake.calls[2].text.trim(),
      "ROLLBACK",
    ],
  );
  assert.equal(fake.client.released, 1);
  assert.deepEqual(fake.client.releaseArguments, [undefined]);
});

test("rollback failure remains fail-closed and still releases the client", async () => {
  const fake = createTransactionFake({ failRollback: true });

  await assert.rejects(
    withRequestTransaction(
      REQUEST_CONTEXT,
      async () => {
        throw new Error("work failed");
      },
      fake.pool as never,
    ),
    AggregateError,
  );

  assert.equal(fake.client.released, 1);
  assert.deepEqual(fake.client.releaseArguments, [true]);
});

test("BEGIN failure releases without issuing ROLLBACK", async () => {
  const fake = createTransactionFake({ failOn: "BEGIN" });

  await assert.rejects(
    withRequestTransaction(
      REQUEST_CONTEXT,
      async () => undefined,
      fake.pool as never,
    ),
    /BEGIN unavailable/,
  );

  assert.deepEqual(fake.calls.map(({ text }) => text), ["BEGIN"]);
  assert.equal(fake.client.released, 1);
  assert.deepEqual(fake.client.releaseArguments, [undefined]);
});

test("COMMIT failure attempts ROLLBACK and releases the client", async () => {
  const fake = createTransactionFake({ failOn: "COMMIT" });

  await assert.rejects(
    withRequestTransaction(
      REQUEST_CONTEXT,
      async () => undefined,
      fake.pool as never,
    ),
    /COMMIT unavailable/,
  );

  assert.deepEqual(
    fake.calls.map(({ text }) => text.trim()),
    [
      "BEGIN",
      fake.calls[1].text.trim(),
      fake.calls[2].text.trim(),
      "COMMIT",
      "ROLLBACK",
    ],
  );
  assert.equal(fake.client.released, 1);
  assert.deepEqual(fake.client.releaseArguments, [undefined]);
});

test("invalid transaction context is rejected before a connection is checked out", async () => {
  const fake = createTransactionFake();

  await assert.rejects(
    withRequestTransaction(
      { ...REQUEST_CONTEXT, workspaceId: "" },
      async () => undefined,
      fake.pool as never,
    ),
    DatabaseBoundaryError,
  );

  assert.equal(fake.pool.connects, 0);
  assert.equal(fake.client.released, 0);
});

test("request transaction revalidation fails closed before protected work", async () => {
  const fake = createTransactionFake({ rejectRequestContext: true });
  let workCalled = false;

  await assert.rejects(
    withRequestTransaction(
      REQUEST_CONTEXT,
      async () => {
        workCalled = true;
      },
      fake.pool as never,
    ),
    /request session context is no longer valid/u,
  );

  assert.equal(workCalled, false);
  assert.deepEqual(
    fake.calls.map(({ text }) => text.trim()),
    [
      "BEGIN",
      fake.calls[1].text.trim(),
      fake.calls[2].text.trim(),
      "ROLLBACK",
    ],
  );
});

test("worker lease fence is mandatory and validated before checkout", async () => {
  for (const leaseFence of [
    "",
    "123e4567-e89b-12d3-a456-426614174000",
    "123E4567-E89B-42D3-A456-426614174000",
  ]) {
    const fake = createTransactionFake();

    await assert.rejects(
      withWorkerTransaction(
        {
          kind: "worker",
          workspaceId: "workspace-2",
          jobId: "job-2",
          serviceActor: "drive-worker",
          connectorId: "connector-2",
          sourceId: null,
          leaseFence,
        },
        async () => undefined,
        fake.pool as never,
      ),
      DatabaseBoundaryError,
    );

    assert.equal(fake.pool.connects, 0);
  }
});

test("authenticateSession calls only the approved routine with a 32-byte digest", async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const pool = {
    async query(text: string, values: unknown[]) {
      calls.push({ text, values });
      return queryResult([
        {
          context_kind: "SESSION",
          identity_id: "identity-1",
          workspace_id: "workspace-1",
          user_id: "actor-1",
          membership_id: "membership-1",
          session_id: "session-1",
          token_id: "token-1",
          client_type: "WEB",
          token_kind: "WEB_SESSION",
          workspace_role: "MEMBER",
          user_security_version: "11",
          identity_security_version: "12",
          workspace_security_version: "13",
          membership_authz_version: "14",
          session_security_version: "15",
          csrf_token_hash: Buffer.alloc(32, 0xab),
          context_expires_at: new Date("2026-08-25T00:00:00Z"),
        },
      ]);
    },
  };
  const digest = new Uint8Array(32).fill(7);

  const context = await authenticateSession(digest, pool as never);

  assert.deepEqual(context, {
    kind: "session",
    identityId: "identity-1",
    workspaceId: "workspace-1",
    actorId: "actor-1",
    membershipId: "membership-1",
    sessionId: "session-1",
    tokenId: "token-1",
    clientType: "WEB",
    tokenKind: "WEB_SESSION",
    workspaceRole: "MEMBER",
    userSecurityVersion: "11",
    identitySecurityVersion: "12",
    workspaceSecurityVersion: "13",
    membershipAuthzVersion: "14",
    sessionSecurityVersion: "15",
    csrfTokenHash: "ab".repeat(32),
    contextExpiresAt: new Date("2026-08-25T00:00:00Z"),
  });
  if (context === null || context.kind !== "session") {
    assert.fail("expected a normal session context");
  }
  const requestContext = requestTransactionContextFromSession(context, digest);
  assert.deepEqual(
    {
      workspaceId: requestContext.workspaceId,
      actorId: requestContext.actorId,
      membershipId: requestContext.membershipId,
      sessionId: requestContext.sessionId,
      tokenId: requestContext.tokenId,
      clientType: requestContext.clientType,
      tokenKind: requestContext.tokenKind,
      sessionSecurityVersion: requestContext.sessionSecurityVersion,
    },
    {
      workspaceId: "workspace-1",
      actorId: "actor-1",
      membershipId: "membership-1",
      sessionId: "session-1",
      tokenId: "token-1",
      clientType: "WEB",
      tokenKind: "WEB_SESSION",
      sessionSecurityVersion: "15",
    },
  );
  assert.notEqual(requestContext.credentialHash, digest);
  assert.deepEqual(requestContext.credentialHash, Buffer.from(digest));
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].text,
    "SELECT * FROM uptech.authenticate_session($1::bytea)",
  );
  assert.equal(calls[0].values.length, 1);
  assert.equal(Buffer.isBuffer(calls[0].values[0]), true);
  assert.equal((calls[0].values[0] as Buffer).byteLength, 32);
});

test("authenticateSession keeps native sessions free of CSRF authority", async () => {
  const context = await authenticateSession(new Uint8Array(32), {
    query: async () =>
      queryResult([
        {
          context_kind: "SESSION",
          identity_id: "identity-1",
          workspace_id: "workspace-1",
          user_id: "actor-1",
          membership_id: "membership-1",
          session_id: "session-1",
          token_id: "token-1",
          client_type: "NATIVE",
          token_kind: "NATIVE_ACCESS",
          workspace_role: "MEMBER",
          user_security_version: BigInt(1),
          identity_security_version: 2,
          workspace_security_version: "3",
          membership_authz_version: "4",
          session_security_version: "5",
          csrf_token_hash: null,
          context_expires_at: new Date("2026-08-25T00:00:00Z"),
        },
      ]),
  } as never);

  assert.equal(context?.kind, "session");
  if (context?.kind !== "session") {
    assert.fail("expected a native session context");
  }
  assert.equal(context.clientType, "NATIVE");
  assert.equal(context.tokenKind, "NATIVE_ACCESS");
  assert.equal(context.csrfTokenHash, null);
  assert.deepEqual(
    [
      context.userSecurityVersion,
      context.identitySecurityVersion,
      context.workspaceSecurityVersion,
      context.membershipAuthzVersion,
      context.sessionSecurityVersion,
    ],
    ["1", "2", "3", "4", "5"],
  );
});

test("authenticateSession rejects raw-sized input and malformed authority", async () => {
  const neverCalled = {
    async query() {
      throw new Error("must not query");
    },
  };
  await assert.rejects(
    authenticateSession(new Uint8Array(31), neverCalled as never),
    DatabaseBoundaryError,
  );

  const malformed = {
    async query() {
      return queryResult([
        {
          context_kind: "ONBOARDING",
          workspace_id: "must-not-exist",
          identity_id: "identity-1",
          user_id: "actor-1",
          allowed_operations: ["submit_access_request"],
          context_expires_at: new Date("2026-08-25T00:00:00Z"),
        },
      ]);
    },
  };
  await assert.rejects(
    authenticateSession(new Uint8Array(32), malformed as never),
    DatabaseBoundaryError,
  );
});

test("authenticateSession maps onboarding actor and expiry without workspace authority", async () => {
  const expiresAt = new Date("2026-08-25T00:00:00Z");
  const context = await authenticateSession(new Uint8Array(32), {
    query: async () =>
      queryResult([
        {
          context_kind: "ONBOARDING",
          identity_id: "identity-1",
          user_id: "actor-1",
          workspace_id: null,
          membership_id: null,
          session_id: null,
          client_type: null,
          workspace_role: null,
          workspace_security_version: null,
          membership_authz_version: null,
          session_security_version: null,
          csrf_token_hash: null,
          allowed_operations: ["submit_or_read_access_request"],
          context_expires_at: expiresAt,
        },
      ]),
  } as never);

  assert.deepEqual(context, {
    kind: "onboarding",
    identityId: "identity-1",
    actorId: "actor-1",
    allowedOperations: ["submit_or_read_access_request"],
    contextExpiresAt: expiresAt,
  });
});

test("authenticateSession rejects inconsistent CSRF or version authority", async () => {
  const sessionRow = {
    context_kind: "SESSION",
    identity_id: "identity-1",
    workspace_id: "workspace-1",
    user_id: "actor-1",
    membership_id: "membership-1",
    session_id: "session-1",
    token_id: "token-1",
    client_type: "WEB",
    token_kind: "WEB_SESSION",
    workspace_role: "MEMBER",
    user_security_version: "1",
    identity_security_version: "1",
    workspace_security_version: "1",
    membership_authz_version: "1",
    session_security_version: "1",
    csrf_token_hash: Buffer.alloc(32, 1),
    context_expires_at: new Date("2026-08-25T00:00:00Z"),
  };

  await assert.rejects(
    authenticateSession(new Uint8Array(32), {
      query: async () =>
        queryResult([
          {
            ...sessionRow,
            csrf_token_hash: null,
          },
        ]),
    } as never),
    DatabaseBoundaryError,
  );

  await assert.rejects(
    authenticateSession(new Uint8Array(32), {
      query: async () =>
        queryResult([{ ...sessionRow, user_security_version: "0" }]),
    } as never),
    DatabaseBoundaryError,
  );
});

test("authenticateSession preserves a masked miss and rejects multiple rows", async () => {
  assert.equal(
    await authenticateSession(new Uint8Array(32), {
      query: async () => queryResult([]),
    } as never),
    null,
  );

  await assert.rejects(
    authenticateSession(new Uint8Array(32), {
      query: async () =>
        queryResult([
          {
            context_kind: "SESSION",
            workspace_id: "workspace-1",
            user_id: "actor-1",
            membership_id: "membership-1",
            context_expires_at: new Date("2026-08-25T00:00:00Z"),
          },
          {
            context_kind: "SESSION",
            workspace_id: "workspace-2",
            user_id: "actor-2",
            membership_id: "membership-2",
            context_expires_at: new Date("2026-08-25T00:00:00Z"),
          },
        ]),
    } as never),
    DatabaseBoundaryError,
  );
});
