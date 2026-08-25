import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import { Pool } from "pg";

import {
  DatabaseBoundaryError,
  authenticateSession,
  requestTransactionContextFromSession,
  withRequestTransaction,
  withWorkerTransaction,
} from "../../src/server/db/core.ts";
import { leaseNextJobFromPool } from "../../src/server/jobs/core.ts";
import { consumeTenantRateLimit } from "../../src/server/rate-limit/core.ts";

const TEST_DATABASE_NAME_PREFIX = "uptech_phase1_test";
const API_TEST_LOGIN = `uptech_phase1_api_login_${process.pid}`;
const WORKER_TEST_LOGIN = `uptech_phase1_worker_login_${process.pid}`;
const TEST_LOGIN_PASSWORD = "phase1-integration-only";

function requiredTestDatabaseUrl(): string {
  const value = process.env.UPTECH_TEST_DATABASE_URL;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      "UPTECH_TEST_DATABASE_URL is required; PostgreSQL integration tests never skip",
    );
  }

  const parsed = new URL(value);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (!databaseName.startsWith(TEST_DATABASE_NAME_PREFIX)) {
    throw new Error(
      `refusing non-disposable database: name must start with ${TEST_DATABASE_NAME_PREFIX}`,
    );
  }

  return value;
}

function testLoginUrl(
  role: "uptech_api_runtime" | "uptech_worker_runtime",
): string {
  const connectionUrl = new URL(requiredTestDatabaseUrl());
  connectionUrl.username =
    role === "uptech_api_runtime" ? API_TEST_LOGIN : WORKER_TEST_LOGIN;
  connectionUrl.password = TEST_LOGIN_PASSWORD;
  return connectionUrl.toString();
}

function rolePool(
  role: "uptech_api_runtime" | "uptech_worker_runtime",
  max = 1,
): Pool {
  return new Pool({
    connectionString: testLoginUrl(role),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 1_000,
    max,
    options: `-c role=${role}`,
  });
}

function loginOnlyPool(
  role: "uptech_api_runtime" | "uptech_worker_runtime",
): Pool {
  return new Pool({
    connectionString: testLoginUrl(role),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 1_000,
    max: 1,
  });
}

function adminPool(): Pool {
  return new Pool({
    connectionString: requiredTestDatabaseUrl(),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 1_000,
    max: 1,
  });
}

before(async () => {
  const pool = adminPool();
  try {
    await pool.query(`
      CREATE ROLE ${API_TEST_LOGIN}
        LOGIN PASSWORD '${TEST_LOGIN_PASSWORD}'
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
      CREATE ROLE ${WORKER_TEST_LOGIN}
        LOGIN PASSWORD '${TEST_LOGIN_PASSWORD}'
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
      GRANT uptech_api_runtime TO ${API_TEST_LOGIN}
        WITH INHERIT FALSE, SET TRUE;
      GRANT uptech_worker_runtime TO ${WORKER_TEST_LOGIN}
        WITH INHERIT FALSE, SET TRUE;
    `);
  } finally {
    await pool.end();
  }
});

after(async () => {
  const pool = adminPool();
  try {
    await pool.query(`
      DROP ROLE IF EXISTS ${API_TEST_LOGIN};
      DROP ROLE IF EXISTS ${WORKER_TEST_LOGIN};
    `);
  } finally {
    await pool.end();
  }
});

async function removeLeaseFixture(
  pool: Pool,
  fixture: {
    workspaceId: string;
    actorId: string;
    connectorId: string;
    jobId: string;
  },
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE uptech_migration_owner");
    await client.query(
      "DELETE FROM uptech.sync_jobs WHERE workspace_id = $1 AND id = $2",
      [fixture.workspaceId, fixture.jobId],
    );
    await client.query(
      "DELETE FROM uptech.connectors WHERE workspace_id = $1 AND id = $2",
      [fixture.workspaceId, fixture.connectorId],
    );
    await client.query(
      "DELETE FROM uptech.service_actors WHERE workspace_id = $1 AND id = $2",
      [fixture.workspaceId, fixture.actorId],
    );
    await client.query(
      "DELETE FROM uptech.workspaces WHERE workspace_id = $1",
      [fixture.workspaceId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function removeSessionFixture(
  pool: Pool,
  fixture: {
    userId: string;
    identityId: string;
    workspaceId: string;
    membershipId: string;
    sessionId: string;
    tokenId: string;
  },
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE uptech_migration_owner");
    await client.query(
      "DELETE FROM uptech.session_tokens WHERE workspace_id = $1 AND id = $2",
      [fixture.workspaceId, fixture.tokenId],
    );
    await client.query(
      "DELETE FROM uptech.sessions WHERE workspace_id = $1 AND id = $2",
      [fixture.workspaceId, fixture.sessionId],
    );
    await client.query(
      "DELETE FROM uptech.workspace_memberships WHERE workspace_id = $1 AND id = $2",
      [fixture.workspaceId, fixture.membershipId],
    );
    await client.query(
      "DELETE FROM uptech.workspaces WHERE workspace_id = $1",
      [fixture.workspaceId],
    );
    await client.query("DELETE FROM uptech.identities WHERE id = $1", [
      fixture.identityId,
    ]);
    await client.query("DELETE FROM uptech.users WHERE id = $1", [
      fixture.userId,
    ]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

interface RateLimitMemberFixture {
  readonly userId: string;
  readonly identityId: string;
  readonly membershipId: string;
  readonly sessionId: string;
  readonly tokenId: string;
  readonly credentialHash: Buffer;
  readonly csrfHash: Buffer;
}

async function seedRateLimitWorkspace(
  pool: Pool,
  workspaceId: string,
  members: readonly RateLimitMemberFixture[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE uptech_migration_owner");
    await client.query(
      "INSERT INTO uptech.workspaces (workspace_id, status) VALUES ($1, 'ACTIVE')",
      [workspaceId],
    );

    for (const member of members) {
      await client.query(
        "INSERT INTO uptech.users (id, status) VALUES ($1, 'ACTIVE')",
        [member.userId],
      );
      await client.query(
        `INSERT INTO uptech.identities
           (id, user_id, provider, issuer, provider_subject, status,
            email_verified, hosted_domain_claim, claims_observed_at)
         VALUES ($1, $2, 'GOOGLE', 'https://accounts.google.com', $3,
                 'ACTIVE', true, 'example.test', pg_catalog.statement_timestamp())`,
        [member.identityId, member.userId, `sub-${member.identityId}`],
      );
      await client.query(
        `INSERT INTO uptech.workspace_memberships
           (workspace_id, id, user_id, role, status)
         VALUES ($1, $2, $3, 'MEMBER', 'ACTIVE')`,
        [workspaceId, member.membershipId, member.userId],
      );
      await client.query(
        `INSERT INTO uptech.sessions
           (workspace_id, id, identity_id, user_id, membership_id, client_type,
            status, user_security_version, identity_security_version,
            workspace_security_version, membership_authz_version,
            idle_expires_at, absolute_expires_at)
         VALUES ($1, $2, $3, $4, $5, 'WEB', 'ACTIVE', 1, 1, 1, 1,
                 pg_catalog.statement_timestamp() + interval '8 hours',
                 pg_catalog.statement_timestamp() + interval '7 days')`,
        [
          workspaceId,
          member.sessionId,
          member.identityId,
          member.userId,
          member.membershipId,
        ],
      );
      await client.query(
        `INSERT INTO uptech.session_tokens
           (workspace_id, id, session_id, client_type, token_kind,
            token_status, token_hash, csrf_token_hash,
            session_security_version, rotation_version, expires_at)
         VALUES ($1, $2, $3, 'WEB', 'WEB_SESSION', 'CURRENT', $4, $5,
                 1, 1, pg_catalog.statement_timestamp() + interval '1 hour')`,
        [
          workspaceId,
          member.tokenId,
          member.sessionId,
          member.credentialHash,
          member.csrfHash,
        ],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function removeRateLimitWorkspace(
  pool: Pool,
  workspaceId: string,
  members: readonly RateLimitMemberFixture[],
): Promise<void> {
  const client = await pool.connect();
  const userIds = members.map(({ userId }) => userId);
  const identityIds = members.map(({ identityId }) => identityId);
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE uptech_migration_owner");
    await client.query(
      "DELETE FROM uptech.rate_limit_buckets WHERE workspace_id = $1",
      [workspaceId],
    );
    await client.query(
      "DELETE FROM uptech.session_tokens WHERE workspace_id = $1",
      [workspaceId],
    );
    await client.query("DELETE FROM uptech.sessions WHERE workspace_id = $1", [
      workspaceId,
    ]);
    await client.query(
      "DELETE FROM uptech.workspace_memberships WHERE workspace_id = $1",
      [workspaceId],
    );
    await client.query("DELETE FROM uptech.workspaces WHERE workspace_id = $1", [
      workspaceId,
    ]);
    await client.query("DELETE FROM uptech.identities WHERE id = ANY($1::uuid[])", [
      identityIds,
    ]);
    await client.query("DELETE FROM uptech.users WHERE id = ANY($1::uuid[])", [
      userIds,
    ]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

test("real PostgreSQL API role uses only session bootstrap and transaction-local tenant context", async () => {
  const pool = rolePool("uptech_api_runtime");
  try {
    const role = await pool.query<{
      current_user: string;
      session_user: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      session_super: boolean;
      session_bypassrls: boolean;
      session_createrole: boolean;
    }>(`
      SELECT
        current_user,
        session_user,
        effective_role.rolsuper,
        effective_role.rolbypassrls,
        login_role.rolsuper AS session_super,
        login_role.rolbypassrls AS session_bypassrls,
        login_role.rolcreaterole AS session_createrole
      FROM pg_catalog.pg_roles AS effective_role
      JOIN pg_catalog.pg_roles AS login_role
        ON login_role.rolname = session_user
      WHERE effective_role.rolname = current_user
    `);
    assert.deepEqual(role.rows, [
      {
        current_user: "uptech_api_runtime",
        session_user: API_TEST_LOGIN,
        rolsuper: false,
        rolbypassrls: false,
        session_super: false,
        session_bypassrls: false,
        session_createrole: false,
      },
    ]);

    await assert.rejects(
      pool.query("SET ROLE uptech_migration_owner"),
      /permission denied/u,
    );
    const unprivilegedLogin = loginOnlyPool("uptech_api_runtime");
    try {
      const loginIdentity = await unprivilegedLogin.query<{
        current_user: string;
        session_user: string;
      }>("SELECT current_user, session_user");
      assert.deepEqual(loginIdentity.rows, [
        {
          current_user: API_TEST_LOGIN,
          session_user: API_TEST_LOGIN,
        },
      ]);
      await assert.rejects(
        unprivilegedLogin.query("SELECT * FROM uptech.workspaces"),
        /permission denied/u,
      );
      await assert.rejects(
        unprivilegedLogin.query("SET ROLE uptech_migration_owner"),
        /permission denied/u,
      );
    } finally {
      await unprivilegedLogin.end();
    }

    assert.equal(
      await authenticateSession(new Uint8Array(32).fill(0xff), pool),
      null,
    );
    await assert.rejects(
      pool.query("SELECT * FROM uptech.lease_next_job()"),
      /permission denied/u,
    );

    await assert.rejects(
      withRequestTransaction(
        {
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
          credentialHash: new Uint8Array(32).fill(0xff),
        },
        async () => assert.fail("forged request context reached protected work"),
        pool,
      ),
      DatabaseBoundaryError,
    );

    const afterCommit = await pool.query<{ workspace_id: string }>(`
      SELECT current_setting('app.workspace_id', true) AS workspace_id
    `);
    assert.equal(afterCommit.rows[0].workspace_id, "");
    assert.equal(
      (await pool.query("SELECT * FROM uptech.workspaces")).rowCount,
      0,
    );
  } finally {
    await pool.end();
  }
});

test("real PostgreSQL worker role derives an isolated job context and cannot authenticate sessions", async () => {
  const pool = rolePool("uptech_worker_runtime");
  try {
    const identity = await pool.query<{
      current_user: string;
      session_user: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(`
      SELECT
        current_user,
        session_user,
        login_role.rolsuper,
        login_role.rolbypassrls
      FROM pg_catalog.pg_roles AS login_role
      WHERE login_role.rolname = session_user
    `);
    assert.deepEqual(identity.rows, [
      {
        current_user: "uptech_worker_runtime",
        session_user: WORKER_TEST_LOGIN,
        rolsuper: false,
        rolbypassrls: false,
      },
    ]);
    await assert.rejects(
      pool.query("SET ROLE uptech_migration_owner"),
      /permission denied/u,
    );

    assert.equal(await leaseNextJobFromPool(pool), null);
    await assert.rejects(
      pool.query(
        "SELECT * FROM uptech.authenticate_session($1::bytea)",
        [Buffer.alloc(32)],
      ),
      /permission denied/u,
    );

    const observed = await withWorkerTransaction(
      {
        kind: "worker",
        workspaceId: "a1000000-0000-0000-0000-000000000001",
        jobId: "41000000-0000-0000-0000-000000000001",
        serviceActor: "e1000000-0000-0000-0000-000000000001",
        connectorId: "f1000000-0000-0000-0000-000000000001",
        sourceId: null,
        leaseFence: "71000000-0000-4000-8000-000000000001",
      },
      async (client) => {
        const result = await client.query<{
          workspace_id: string;
          actor_id: string;
          membership_id: string;
          job_id: string;
          connector_id: string;
          source_id: string;
          lease_fence: string;
        }>(`
          SELECT
            current_setting('app.workspace_id', true) AS workspace_id,
            current_setting('app.actor_id', true) AS actor_id,
            current_setting('app.membership_id', true) AS membership_id,
            current_setting('app.job_id', true) AS job_id,
            current_setting('app.connector_id', true) AS connector_id,
            current_setting('app.source_id', true) AS source_id,
            current_setting('app.lease_fence', true) AS lease_fence
        `);
        return result.rows[0];
      },
      pool,
    );

    assert.deepEqual(observed, {
      workspace_id: "a1000000-0000-0000-0000-000000000001",
      actor_id: "e1000000-0000-0000-0000-000000000001",
      membership_id: "",
      job_id: "41000000-0000-0000-0000-000000000001",
      connector_id: "f1000000-0000-0000-0000-000000000001",
      source_id: "",
      lease_fence: "71000000-0000-4000-8000-000000000001",
    });

    const afterCommit = await pool.query<{ job_id: string }>(`
      SELECT current_setting('app.job_id', true) AS job_id
    `);
    assert.equal(afterCommit.rows[0].job_id, "");
  } finally {
    await pool.end();
  }
});

test("real PostgreSQL maps a valid WEB session and denies it immediately after revocation", async () => {
  const fixture = {
    userId: randomUUID(),
    identityId: randomUUID(),
    workspaceId: randomUUID(),
    membershipId: randomUUID(),
    sessionId: randomUUID(),
    tokenId: randomUUID(),
  };
  const credentialHash = randomBytes(32);
  const csrfHash = randomBytes(32);
  const version = "9007199254740993";
  const admin = adminPool();
  const api = rolePool("uptech_api_runtime");

  try {
    const seedClient = await admin.connect();
    try {
      await seedClient.query("BEGIN");
      await seedClient.query("SET LOCAL ROLE uptech_migration_owner");
      await seedClient.query(
        `INSERT INTO uptech.users (id, status, security_version)
         VALUES ($1, 'ACTIVE', $2)`,
        [fixture.userId, version],
      );
      await seedClient.query(
        `INSERT INTO uptech.identities
           (id, user_id, provider, issuer, provider_subject, status,
            security_version, email_verified, hosted_domain_claim,
            claims_observed_at)
         VALUES ($1, $2, 'GOOGLE', 'https://accounts.google.com', $3,
                 'ACTIVE', $4, true, 'example.test', transaction_timestamp())`,
        [fixture.identityId, fixture.userId, `sub-${fixture.identityId}`, version],
      );
      await seedClient.query(
        `INSERT INTO uptech.workspaces
           (workspace_id, status, security_version)
         VALUES ($1, 'ACTIVE', $2)`,
        [fixture.workspaceId, version],
      );
      await seedClient.query(
        `INSERT INTO uptech.workspace_memberships
           (workspace_id, id, user_id, role, status, authz_version)
         VALUES ($1, $2, $3, 'ADMIN', 'ACTIVE', $4)`,
        [fixture.workspaceId, fixture.membershipId, fixture.userId, version],
      );
      await seedClient.query(
        `INSERT INTO uptech.sessions
           (workspace_id, id, identity_id, user_id, membership_id, client_type,
            status, user_security_version, identity_security_version,
            workspace_security_version, membership_authz_version,
            security_version, current_rotation_version, idle_expires_at,
            absolute_expires_at)
         VALUES ($1, $2, $3, $4, $5, 'WEB', 'ACTIVE', $6, $6, $6, $6,
                 $6, 1, transaction_timestamp() + interval '8 hours',
                 transaction_timestamp() + interval '7 days')`,
        [
          fixture.workspaceId,
          fixture.sessionId,
          fixture.identityId,
          fixture.userId,
          fixture.membershipId,
          version,
        ],
      );
      await seedClient.query(
        `INSERT INTO uptech.session_tokens
           (workspace_id, id, session_id, client_type, token_kind,
            token_status, token_hash, csrf_token_hash,
            session_security_version, rotation_version, expires_at)
         VALUES ($1, $2, $3, 'WEB', 'WEB_SESSION', 'CURRENT', $4, $5,
                 $6, 1, transaction_timestamp() + interval '1 hour')`,
        [
          fixture.workspaceId,
          fixture.tokenId,
          fixture.sessionId,
          credentialHash,
          csrfHash,
          version,
        ],
      );
      await seedClient.query("COMMIT");
    } catch (error) {
      await seedClient.query("ROLLBACK");
      throw error;
    } finally {
      seedClient.release();
    }

    const context = await authenticateSession(credentialHash, api);
    assert.ok(context !== null && context.kind === "session");
    assert.deepEqual(
      {
        identityId: context.identityId,
        workspaceId: context.workspaceId,
        actorId: context.actorId,
        membershipId: context.membershipId,
        sessionId: context.sessionId,
        tokenId: context.tokenId,
        clientType: context.clientType,
        tokenKind: context.tokenKind,
        workspaceRole: context.workspaceRole,
        userSecurityVersion: context.userSecurityVersion,
        identitySecurityVersion: context.identitySecurityVersion,
        workspaceSecurityVersion: context.workspaceSecurityVersion,
        membershipAuthzVersion: context.membershipAuthzVersion,
        sessionSecurityVersion: context.sessionSecurityVersion,
        csrfTokenHash: context.csrfTokenHash,
      },
      {
        identityId: fixture.identityId,
        workspaceId: fixture.workspaceId,
        actorId: fixture.userId,
        membershipId: fixture.membershipId,
        sessionId: fixture.sessionId,
        tokenId: fixture.tokenId,
        clientType: "WEB",
        tokenKind: "WEB_SESSION",
        workspaceRole: "ADMIN",
        userSecurityVersion: version,
        identitySecurityVersion: version,
        workspaceSecurityVersion: version,
        membershipAuthzVersion: version,
        sessionSecurityVersion: version,
        csrfTokenHash: csrfHash.toString("hex"),
      },
    );
    assert.ok(context.contextExpiresAt.getTime() > Date.now());

    const requestContext = requestTransactionContextFromSession(
      context,
      credentialHash,
    );
    const observed = await withRequestTransaction(
      requestContext,
      async (client) => {
        const result = await client.query<{
          workspace_id: string;
          actor_id: string;
          membership_id: string;
          session_id: string;
          job_id: string;
        }>(`
          SELECT
            current_setting('app.workspace_id', true) AS workspace_id,
            current_setting('app.actor_id', true) AS actor_id,
            current_setting('app.membership_id', true) AS membership_id,
            current_setting('app.session_id', true) AS session_id,
            current_setting('app.job_id', true) AS job_id
        `);
        return result.rows[0];
      },
      api,
    );
    assert.deepEqual(observed, {
      workspace_id: fixture.workspaceId,
      actor_id: fixture.userId,
      membership_id: fixture.membershipId,
      session_id: fixture.sessionId,
      job_id: "",
    });

    const revokeClient = await admin.connect();
    try {
      await revokeClient.query("BEGIN");
      await revokeClient.query("SET LOCAL ROLE uptech_migration_owner");
      await revokeClient.query(
        `UPDATE uptech.sessions
         SET status = 'REVOKED',
             revoked_at = transaction_timestamp(),
             revocation_reason = 'INTEGRATION_TEST'
         WHERE workspace_id = $1 AND id = $2`,
        [fixture.workspaceId, fixture.sessionId],
      );
      await revokeClient.query("COMMIT");
    } catch (error) {
      await revokeClient.query("ROLLBACK");
      throw error;
    } finally {
      revokeClient.release();
    }

    await assert.rejects(
      withRequestTransaction(
        requestContext,
        async () => assert.fail("revoked session reached protected work"),
        api,
      ),
      DatabaseBoundaryError,
    );
    assert.equal(await authenticateSession(credentialHash, api), null);
  } finally {
    await removeSessionFixture(admin, fixture);
    await Promise.all([api.end(), admin.end()]);
  }
});

test("concurrent workers skip a locked lease candidate without double-leasing it", async () => {
  const fixture = {
    workspaceId: randomUUID(),
    actorId: randomUUID(),
    connectorId: randomUUID(),
    jobId: randomUUID(),
  };
  const admin = adminPool();
  const firstWorker = rolePool("uptech_worker_runtime");
  const secondWorker = rolePool("uptech_worker_runtime");
  const firstClient = await firstWorker.connect();

  try {
    const seedClient = await admin.connect();
    try {
      await seedClient.query("BEGIN");
      await seedClient.query("SET LOCAL ROLE uptech_migration_owner");
      await seedClient.query(
        `INSERT INTO uptech.workspaces (workspace_id, status)
         VALUES ($1, 'ACTIVE')`,
        [fixture.workspaceId],
      );
      await seedClient.query(
        `INSERT INTO uptech.service_actors
           (workspace_id, id, actor_kind, status)
         VALUES ($1, $2, 'SYNC_WORKER', 'ACTIVE')`,
        [fixture.workspaceId, fixture.actorId],
      );
      await seedClient.query(
        `INSERT INTO uptech.connectors
           (workspace_id, id, purpose, status)
         VALUES ($1, $2, 'DIRECTORY', 'ACTIVE')`,
        [fixture.workspaceId, fixture.connectorId],
      );
      await seedClient.query(
        `INSERT INTO uptech.sync_jobs
           (workspace_id, id, service_actor_id, connector_id, job_kind,
            status, dedupe_key)
         VALUES ($1, $2, $3, $4, 'DIRECTORY_SYNC', 'QUEUED', $5)`,
        [
          fixture.workspaceId,
          fixture.jobId,
          fixture.actorId,
          fixture.connectorId,
          `concurrency-${fixture.jobId}`,
        ],
      );
      await seedClient.query("COMMIT");
    } catch (error) {
      await seedClient.query("ROLLBACK");
      throw error;
    } finally {
      seedClient.release();
    }

    await firstClient.query("BEGIN");
    const firstLease = await firstClient.query<{ job_id: string }>(
      "SELECT job_id FROM uptech.lease_next_job()",
    );
    assert.equal(firstLease.rows[0]?.job_id, fixture.jobId);

    const startedAt = performance.now();
    const skippedLease = await secondWorker.query<{ job_id: string }>(
      "SELECT job_id FROM uptech.lease_next_job()",
    );
    const elapsedMilliseconds = performance.now() - startedAt;
    assert.equal(skippedLease.rowCount, 0);
    assert.ok(
      elapsedMilliseconds < 2_000,
      `locked candidate was not skipped promptly (${elapsedMilliseconds}ms)`,
    );

    await firstClient.query("ROLLBACK");
    const leaseAfterUnlock = await secondWorker.query<{ job_id: string }>(
      "SELECT job_id FROM uptech.lease_next_job()",
    );
    assert.equal(leaseAfterUnlock.rows[0]?.job_id, fixture.jobId);
  } finally {
    try {
      await firstClient.query("ROLLBACK");
    } catch {
      // The transaction may already be closed; cleanup still runs through admin.
    }
    firstClient.release();
    await removeLeaseFixture(admin, fixture);
    await Promise.all([
      firstWorker.end(),
      secondWorker.end(),
      admin.end(),
    ]);
  }
});

test("a stale fence cannot regain a job after the same worker login re-leases it", async () => {
  const fixture = {
    workspaceId: randomUUID(),
    actorId: randomUUID(),
    connectorId: randomUUID(),
    jobId: randomUUID(),
  };
  const admin = adminPool();
  const firstWorker = rolePool("uptech_worker_runtime");
  const secondWorker = rolePool("uptech_worker_runtime");

  try {
    const seedClient = await admin.connect();
    try {
      await seedClient.query("BEGIN");
      await seedClient.query("SET LOCAL ROLE uptech_migration_owner");
      await seedClient.query(
        `INSERT INTO uptech.workspaces (workspace_id, status)
         VALUES ($1, 'ACTIVE')`,
        [fixture.workspaceId],
      );
      await seedClient.query(
        `INSERT INTO uptech.service_actors
           (workspace_id, id, actor_kind, status)
         VALUES ($1, $2, 'SYNC_WORKER', 'ACTIVE')`,
        [fixture.workspaceId, fixture.actorId],
      );
      await seedClient.query(
        `INSERT INTO uptech.connectors
           (workspace_id, id, purpose, status)
         VALUES ($1, $2, 'DIRECTORY', 'ACTIVE')`,
        [fixture.workspaceId, fixture.connectorId],
      );
      await seedClient.query(
        `INSERT INTO uptech.sync_jobs
           (workspace_id, id, service_actor_id, connector_id, job_kind,
            status, dedupe_key)
         VALUES ($1, $2, $3, $4, 'DIRECTORY_SYNC', 'QUEUED', $5)`,
        [
          fixture.workspaceId,
          fixture.jobId,
          fixture.actorId,
          fixture.connectorId,
          `fence-${fixture.jobId}`,
        ],
      );
      await seedClient.query("COMMIT");
    } catch (error) {
      await seedClient.query("ROLLBACK");
      throw error;
    } finally {
      seedClient.release();
    }

    const firstLease = await leaseNextJobFromPool(firstWorker);
    assert.ok(firstLease !== null);
    assert.equal(firstLease.jobId, fixture.jobId);
    assert.equal(firstLease.jobKind, "DIRECTORY_SYNC");

    const expireClient = await admin.connect();
    try {
      await expireClient.query("BEGIN");
      await expireClient.query("SET LOCAL ROLE uptech_migration_owner");
      await expireClient.query(
        `UPDATE uptech.sync_jobs
         SET leased_at = statement_timestamp() - interval '10 minutes',
             lease_expires_at = statement_timestamp() - interval '5 minutes'
         WHERE workspace_id = $1 AND id = $2`,
        [fixture.workspaceId, fixture.jobId],
      );
      await expireClient.query("COMMIT");
    } catch (error) {
      await expireClient.query("ROLLBACK");
      throw error;
    } finally {
      expireClient.release();
    }

    const secondLease = await leaseNextJobFromPool(secondWorker);
    assert.ok(secondLease !== null);
    assert.equal(secondLease.jobId, firstLease.jobId);
    assert.notEqual(secondLease.leaseFence, firstLease.leaseFence);

    const staleVisibleRows = await withWorkerTransaction(
      {
        kind: "worker",
        workspaceId: firstLease.workspaceId,
        jobId: firstLease.jobId,
        serviceActor: firstLease.serviceActor,
        connectorId: firstLease.connectorId,
        sourceId: firstLease.sourceId,
        leaseFence: firstLease.leaseFence,
      },
      async (client) =>
        (await client.query("SELECT id FROM uptech.sync_jobs")).rowCount,
      firstWorker,
    );
    assert.equal(staleVisibleRows, 0);

    const currentVisibleRows = await withWorkerTransaction(
      {
        kind: "worker",
        workspaceId: secondLease.workspaceId,
        jobId: secondLease.jobId,
        serviceActor: secondLease.serviceActor,
        connectorId: secondLease.connectorId,
        sourceId: secondLease.sourceId,
        leaseFence: secondLease.leaseFence,
      },
      async (client) =>
        (await client.query("SELECT id FROM uptech.sync_jobs")).rowCount,
      secondWorker,
    );
    assert.equal(currentVisibleRows, 1);
  } finally {
    await removeLeaseFixture(admin, fixture);
    await Promise.all([
      firstWorker.end(),
      secondWorker.end(),
      admin.end(),
    ]);
  }
});

test("committed tenant limiter admission survives downstream failure and enforces connector, Search, and member RAG maxima", async () => {
  const workspaceId = randomUUID();
  const member: RateLimitMemberFixture = {
    userId: randomUUID(),
    identityId: randomUUID(),
    membershipId: randomUUID(),
    sessionId: randomUUID(),
    tokenId: randomUUID(),
    credentialHash: randomBytes(32),
    csrfHash: randomBytes(32),
  };
  const admin = adminPool();
  const api = rolePool("uptech_api_runtime", 20);

  try {
    await seedRateLimitWorkspace(admin, workspaceId, [member]);
    const session = await authenticateSession(member.credentialHash, api);
    assert.ok(session !== null && session.kind === "session");
    const requestContext = requestTransactionContextFromSession(
      session,
      member.credentialHash,
    );

    assert.deepEqual(
      await consumeTenantRateLimit(
        requestContext,
        "CONNECTOR_MUTATION",
        api,
      ),
      { outcome: "ALLOW", policy: "CONNECTOR_MUTATION" },
    );
    await assert.rejects(
      withRequestTransaction(
        requestContext,
        async () => {
          throw new Error("downstream test failure");
        },
        api,
      ),
      /downstream test failure/u,
    );
    assert.equal(
      (
        await admin.query<{ request_count: number }>(
          `SELECT request_count
           FROM uptech.rate_limit_buckets
           WHERE workspace_id = $1
             AND route_class = 'CONNECTOR_MUTATION'`,
          [workspaceId],
        )
      ).rows[0].request_count,
      1,
    );

    const connectorDecisions = await Promise.all(
      Array.from({ length: 39 }, () =>
        consumeTenantRateLimit(
          requestContext,
          "CONNECTOR_MUTATION",
          api,
        ),
      ),
    );
    assert.equal(
      connectorDecisions.filter((decision) => decision.outcome === "ALLOW")
        .length,
      9,
    );
    assert.equal(
      connectorDecisions.filter((decision) => decision.outcome === "DENY")
        .length,
      30,
    );

    const searchDecisions = await Promise.all(
      Array.from({ length: 100 }, () =>
        consumeTenantRateLimit(requestContext, "SEARCH", api),
      ),
    );
    assert.equal(
      searchDecisions.filter((decision) => decision.outcome === "ALLOW").length,
      60,
    );
    assert.equal(
      searchDecisions.filter((decision) => decision.outcome === "DENY").length,
      40,
    );

    const ragDecisions = await Promise.all(
      Array.from({ length: 20 }, () =>
        consumeTenantRateLimit(requestContext, "RAG", api),
      ),
    );
    assert.equal(
      ragDecisions.filter((decision) => decision.outcome === "ALLOW").length,
      10,
    );
    assert.equal(
      ragDecisions.filter((decision) => decision.outcome === "DENY").length,
      10,
    );

    const stored = await admin.query<{
      route_class: string;
      scope_kind: string;
      request_count: number;
    }>(
      `SELECT
         route_class,
         scope_kind,
         request_count
       FROM uptech.rate_limit_buckets
       WHERE workspace_id = $1
       ORDER BY route_class, scope_kind`,
      [workspaceId],
    );
    assert.deepEqual(stored.rows, [
      {
        route_class: "CONNECTOR_MUTATION",
        scope_kind: "MEMBERSHIP",
        request_count: 10,
      },
      { route_class: "RAG", scope_kind: "MEMBERSHIP", request_count: 10 },
      { route_class: "RAG", scope_kind: "WORKSPACE", request_count: 10 },
      { route_class: "SEARCH", scope_kind: "MEMBERSHIP", request_count: 60 },
    ]);
  } finally {
    await removeRateLimitWorkspace(admin, workspaceId, [member]);
    await Promise.all([api.end(), admin.end()]);
  }
});

test("concurrent RAG admission enforces the shared 100-per-workspace maximum", async () => {
  const workspaceId = randomUUID();
  const members: RateLimitMemberFixture[] = Array.from(
    { length: 11 },
    () => ({
      userId: randomUUID(),
      identityId: randomUUID(),
      membershipId: randomUUID(),
      sessionId: randomUUID(),
      tokenId: randomUUID(),
      credentialHash: randomBytes(32),
      csrfHash: randomBytes(32),
    }),
  );
  const admin = adminPool();
  const api = rolePool("uptech_api_runtime", 30);

  try {
    await seedRateLimitWorkspace(admin, workspaceId, members);
    const contexts = await Promise.all(
      members.map(async (member) => {
        const session = await authenticateSession(member.credentialHash, api);
        assert.ok(session !== null && session.kind === "session");
        return requestTransactionContextFromSession(
          session,
          member.credentialHash,
        );
      }),
    );

    const decisions = await Promise.all(
      contexts.flatMap((context) =>
        Array.from({ length: 10 }, () =>
          consumeTenantRateLimit(context, "RAG", api),
        ),
      ),
    );
    assert.equal(
      decisions.filter((decision) => decision.outcome === "ALLOW").length,
      100,
    );
    assert.equal(
      decisions.filter((decision) => decision.outcome === "DENY").length,
      10,
    );

    const stored = await admin.query<{
      membership_total: number;
      membership_maximum: number;
      workspace_count: number;
    }>(
      `SELECT
         COALESCE(sum(request_count) FILTER (
           WHERE scope_kind = 'MEMBERSHIP'
         ), 0)::integer AS membership_total,
         COALESCE(max(request_count) FILTER (
           WHERE scope_kind = 'MEMBERSHIP'
         ), 0)::integer AS membership_maximum,
         COALESCE(max(request_count) FILTER (
           WHERE scope_kind = 'WORKSPACE'
         ), 0)::integer AS workspace_count
       FROM uptech.rate_limit_buckets
       WHERE workspace_id = $1 AND route_class = 'RAG'`,
      [workspaceId],
    );
    assert.deepEqual(stored.rows, [
      {
        membership_total: 100,
        membership_maximum: 10,
        workspace_count: 100,
      },
    ]);
  } finally {
    await removeRateLimitWorkspace(admin, workspaceId, members);
    await Promise.all([api.end(), admin.end()]);
  }
});
