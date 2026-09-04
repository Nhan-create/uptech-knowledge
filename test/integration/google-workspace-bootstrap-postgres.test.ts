import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test, { before, after } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Pool, type PoolClient } from "pg";

import {
  createGoogleWorkspaceBootstrapRepository,
  createGoogleWorkspaceBootstrapStartAdmission,
} from "../../src/server/onboarding/google-workspace/repository.ts";
import { createGoogleWorkspaceBootstrapSourceAuthority } from "../../src/server/onboarding/google-workspace/source-authority.ts";

const PREFIX = "uptech_phase1_test";
let pool: Pool;

const CURRENT_DIRECTORY_SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.customer.readonly",
  "https://www.googleapis.com/auth/admin.directory.user.readonly",
  "https://www.googleapis.com/auth/admin.directory.group.readonly",
  "https://www.googleapis.com/auth/admin.directory.orgunit.readonly",
  "https://www.googleapis.com/auth/admin.directory.domain.readonly",
] as const;

const bootstrapFixtures = {
  abort: {
    userId: "92000000-0000-0000-0000-000000000001",
    identityId: "92000000-0000-0000-0000-000000000002",
    sourceId: "92000000-0000-0000-0000-000000000003",
    sourceByte: 0x21,
    subject: "bootstrap-abort-sub",
    domain: "abort.example",
  },
  commit: {
    userId: "92000000-0000-0000-0000-000000000011",
    identityId: "92000000-0000-0000-0000-000000000012",
    sourceId: "92000000-0000-0000-0000-000000000013",
    sourceByte: 0x31,
    subject: "bootstrap-commit-sub",
    domain: "commit.example",
  },
  deny: {
    userId: "92000000-0000-0000-0000-000000000021",
    identityId: "92000000-0000-0000-0000-000000000022",
    sourceId: "92000000-0000-0000-0000-000000000023",
    sourceByte: 0x41,
    subject: "bootstrap-deny-sub",
    domain: "deny.example",
  },
} as const;

function hash32(byte: number): Buffer { return Buffer.alloc(32, byte); }

async function ensureActiveGoogleEnvironment(): Promise<string> {
  return asMigrationOwner(async (client) => {
    const active = await client.query<{ environment_name: string }>(
      "SELECT environment_name::text FROM uptech.google_auth_environment_registry WHERE is_active",
    );
    if (active.rows[0]) return active.rows[0].environment_name;
    const environmentName = "postgres-integration";
    await client.query(`INSERT INTO uptech.google_auth_environment_registry(
      environment_name,rate_limit_audit_hmac_key,is_active
    ) VALUES ($1,$2,true)`, [environmentName, hash32(0xa0)]);
    return environmentName;
  });
}

async function asApi<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE uptech_api_runtime");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function asMigrationOwner<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE uptech_migration_owner");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function databaseUrl(): string {
  const value = process.env.UPTECH_TEST_DATABASE_URL;
  if (!value) throw new Error("UPTECH_TEST_DATABASE_URL is required; PostgreSQL integration tests never skip");
  const name = decodeURIComponent(new URL(value).pathname.slice(1));
  if (!name.startsWith(PREFIX)) throw new Error(`refusing non-disposable database: name must start with ${PREFIX}`);
  return value;
}

async function sql(path: string): Promise<string> {
  return (await readFile(path, "utf8")).replace(/^\\(?:set|echo) .*$/gm, "");
}

before(async () => {
  pool = new Pool({ connectionString: databaseUrl(), max: 8 });
  await pool.query("SET ROLE uptech_migration_owner; DROP SCHEMA IF EXISTS uptech CASCADE; RESET ROLE; CREATE SCHEMA uptech AUTHORIZATION uptech_migration_owner; SET ROLE uptech_migration_owner; GRANT USAGE ON SCHEMA uptech TO uptech_api_runtime,uptech_worker_runtime; RESET ROLE");
  for (let number = 1; number <= 9; number += 1) {
    const names = [
      "phase1_foundation", "google_auth_a1", "initial_owner_bootstrap_a2",
      "mobile_public_client_auth_a3", "mobile_session_direct_access_boundary_a3",
      "safe_google_access_states_a4", "enterprise_login", "google_directory_production",
      "google_workspace_tenant_bootstrap",
    ];
    if (number === 9) {
      await pool.query(`SET ROLE uptech_migration_owner;
        INSERT INTO uptech.workspaces(workspace_id,status,google_customer_id)
          VALUES ('90000000-0000-0000-0000-000000000001','ACTIVE','legacy-customer');
        INSERT INTO uptech.users(id) VALUES ('90000000-0000-0000-0000-000000000002'),('90000000-0000-0000-0000-000000000012');
        INSERT INTO uptech.identities(id,user_id,provider,issuer,provider_subject,email_claim,email_verified,hosted_domain_claim,claims_observed_at)
          VALUES ('90000000-0000-0000-0000-000000000003','90000000-0000-0000-0000-000000000002','GOOGLE','https://accounts.google.com','legacy-sub','owner@legacy.example',true,'legacy.example',statement_timestamp());
        INSERT INTO uptech.identities(id,user_id,provider,issuer,provider_subject,email_claim,email_verified,hosted_domain_claim,claims_observed_at)
          VALUES ('90000000-0000-0000-0000-000000000013','90000000-0000-0000-0000-000000000012','GOOGLE','https://accounts.google.com','unmatched-sub','owner@unmatched.example',true,'unmatched.example',statement_timestamp());
        INSERT INTO uptech.workspace_domain_locators(normalized_domain,workspace_id,status,verified_at)
          VALUES ('legacy.example','90000000-0000-0000-0000-000000000001','VERIFIED',statement_timestamp());
        INSERT INTO uptech.onboarding_sessions(id,identity_id,token_hash,allowed_operations,expires_at)
          VALUES ('90000000-0000-0000-0000-000000000004','90000000-0000-0000-0000-000000000003',decode(repeat('09',32),'hex'),ARRAY['ACCESS_REQUEST_READ','ACCESS_REQUEST_SUBMIT'],statement_timestamp()+interval '20 minutes');
        INSERT INTO uptech.onboarding_sessions(id,identity_id,token_hash,allowed_operations,expires_at) VALUES
          ('90000000-0000-0000-0000-000000000014','90000000-0000-0000-0000-000000000013',decode(repeat('14',32),'hex'),ARRAY['ACCESS_REQUEST_READ','ACCESS_REQUEST_READ'],statement_timestamp()+interval '20 minutes'),
          ('90000000-0000-0000-0000-000000000015','90000000-0000-0000-0000-000000000013',decode(repeat('15',32),'hex'),ARRAY['FIRST_DOMAIN_CLAIM_READ','FIRST_DOMAIN_CLAIM_READ','ACCESS_REQUEST_READ'],statement_timestamp()+interval '20 minutes'),
          ('90000000-0000-0000-0000-000000000016','90000000-0000-0000-0000-000000000003',decode(repeat('16',32),'hex'),ARRAY['ACCESS_REQUEST_SUBMIT','ACCESS_REQUEST_SUBMIT'],statement_timestamp()+interval '20 minutes');
        RESET ROLE`);
    }
    await pool.query(await sql(`db/migrations/${String(number).padStart(4, "0")}_${names[number - 1]}.sql`));
  }
  await pool.query(`SET ROLE uptech_migration_owner;
    INSERT INTO uptech.users(id) VALUES
      ('92000000-0000-0000-0000-000000000001'),
      ('92000000-0000-0000-0000-000000000011'),
      ('92000000-0000-0000-0000-000000000021');
    INSERT INTO uptech.identities(
      id,user_id,provider,issuer,provider_subject,email_claim,email_verified,
      hosted_domain_claim,claims_observed_at
    ) VALUES
      ('92000000-0000-0000-0000-000000000002','92000000-0000-0000-0000-000000000001','GOOGLE','https://accounts.google.com','bootstrap-abort-sub','owner@abort.example',true,'abort.example',statement_timestamp()),
      ('92000000-0000-0000-0000-000000000012','92000000-0000-0000-0000-000000000011','GOOGLE','https://accounts.google.com','bootstrap-commit-sub','owner@commit.example',true,'commit.example',statement_timestamp()),
      ('92000000-0000-0000-0000-000000000022','92000000-0000-0000-0000-000000000021','GOOGLE','https://accounts.google.com','bootstrap-deny-sub','owner@deny.example',true,'deny.example',statement_timestamp());
    INSERT INTO uptech.onboarding_sessions(id,identity_id,token_hash,allowed_operations,expires_at) VALUES
      ('92000000-0000-0000-0000-000000000003','92000000-0000-0000-0000-000000000002',decode(repeat('21',32),'hex'),ARRAY['FIRST_DOMAIN_CLAIM_READ','FIRST_DOMAIN_CLAIM_RESERVE','FIRST_DOMAIN_CLAIM_COMPLETE'],statement_timestamp()+interval '20 minutes'),
      ('92000000-0000-0000-0000-000000000013','92000000-0000-0000-0000-000000000012',decode(repeat('31',32),'hex'),ARRAY['FIRST_DOMAIN_CLAIM_READ','FIRST_DOMAIN_CLAIM_RESERVE','FIRST_DOMAIN_CLAIM_COMPLETE'],statement_timestamp()+interval '20 minutes'),
      ('92000000-0000-0000-0000-000000000023','92000000-0000-0000-0000-000000000022',decode(repeat('41',32),'hex'),ARRAY['FIRST_DOMAIN_CLAIM_READ','FIRST_DOMAIN_CLAIM_RESERVE','FIRST_DOMAIN_CLAIM_COMPLETE'],statement_timestamp()+interval '20 minutes');
    INSERT INTO uptech.onboarding_sessions(
      id,identity_id,token_hash,allowed_operations,expires_at,
      resource_workspace_id,access_request_reason_class
    ) VALUES (
      '90000000-0000-0000-0000-000000000005','90000000-0000-0000-0000-000000000003',
      decode(repeat('09',32),'hex'),ARRAY['ACCESS_REQUEST_READ','ACCESS_REQUEST_SUBMIT'],
      statement_timestamp()+interval '20 minutes','90000000-0000-0000-0000-000000000001',
      'USER_NOT_PROVISIONED'
    );
    RESET ROLE`);
});

after(async () => { await pool?.end(); });

test("V2 web completion persists one unknown-domain capability and consumes the reservation once", async () => {
  const environment = await asMigrationOwner(async (client) => {
    const active = await client.query<{ environment_name: string }>(
      "SELECT environment_name::text FROM uptech.google_auth_environment_registry WHERE is_active",
    );
    const environmentName = active.rows[0]?.environment_name ?? "web-v2-test";
    if (active.rowCount === 0) {
      await client.query(`INSERT INTO uptech.google_auth_environment_registry(
        environment_name,rate_limit_audit_hmac_key,is_active
      ) VALUES ($1,$2,true)`, [environmentName, hash32(0xa0)]);
    }
    await client.query(`INSERT INTO uptech.google_auth_configuration_registry(
      configuration_key,environment_name,purpose,google_client_id,google_audience,
      audience_configuration_key,callback_uri,scopes,allowed_azp_configuration_keys,
      web_pkce_kms_key_version,is_enabled
    ) VALUES ('GOOGLE_WEB_LOGIN_V1',$1,'WEB_LOGIN','web-v2.apps.googleusercontent.com',
      'web-v2.apps.googleusercontent.com','GOOGLE_WEB_LOGIN_V1',
      'https://unknown.example/api/v1/auth/google/callback',ARRAY['openid','email','profile'],
      ARRAY['GOOGLE_WEB_LOGIN_V1'::uptech.google_auth_configuration_key_v1],
      'test-key-v1',true) ON CONFLICT (configuration_key) DO NOTHING`, [environmentName]);
    return environmentName;
  });

  const reserve = (id: string, completionByte: number, nonceByte: number,
    consumedAgoSeconds = 5) => asMigrationOwner((client) => client.query(`WITH timing AS (
      SELECT statement_timestamp()-make_interval(secs=>$7) AS consumed_at,
        statement_timestamp()-make_interval(secs=>greatest($7+1,60)) AS created_at
    ) INSERT INTO uptech.oauth_transactions(
      id,environment_name,purpose,configuration_key,locator_hash,web_state_hash,
      web_nonce_hash,web_browser_binding_hash,web_pkce_envelope_version,
      web_pkce_algorithm,web_pkce_nonce,web_pkce_ciphertext,web_pkce_tag,
      web_pkce_kms_key_version,web_pkce_associated_data,status,
      completion_handle_hash,request_id,created_at,expires_at,consumed_at,completion_expires_at
    ) SELECT $1,$2,'WEB_LOGIN','GOOGLE_WEB_LOGIN_V1',$3,$3,$4,$5,1,
      'AES-256-GCM',decode(repeat('ab',12),'hex'),decode(repeat('bc',40),'hex'),
      decode(repeat('cd',16),'hex'),'test-key-v1',decode(repeat('de',32),'hex'),
      'EXCHANGE_RESERVED',$6,$1,timing.created_at,timing.created_at+interval '10 minutes',
      timing.consumed_at,timing.consumed_at+interval '2 minutes' FROM timing
      RETURNING completion_expires_at`,
    [id, environment, hash32(completionByte + 20), hash32(nonceByte),
      hash32(completionByte + 40), hash32(completionByte), consumedAgoSeconds]));

  const complete = (completionByte: number, nonceByte: number, tokenByte: number,
    subject: string, email: string, domain: string | null, requestId: string,
    claimExpiresAt: Date | null = null, claimIssuedAt: Date | null = null) => asApi((client) => client.query(`
      SELECT outcome::text,access_state::text,allowed_operations,expires_at,route
      FROM uptech.complete_web_google_login_directory_v2(
        $1,ROW('accounts.google.com',$2,$3,true,$4,
          coalesce($11::timestamptz,statement_timestamp()-interval '5 seconds'),
          coalesce($10::timestamptz,statement_timestamp()+interval '1 hour'),
          'GOOGLE_WEB_LOGIN_V1',NULL,$5)::uptech.google_verified_claims_assertion_v1,
        $6,$7,$8,$9)`, [hash32(completionByte), subject, email, domain,
      hash32(nonceByte), hash32(tokenByte + 1), hash32(tokenByte + 2), hash32(tokenByte),
      requestId, claimExpiresAt, claimIssuedAt]));

  await reserve("97300000-0000-4000-8000-000000000001", 0xa1, 0xa2);
  const first = await complete(0xa1, 0xa2, 0xa3,
    "web-v2-unknown-sub", "owner@unknown.example", "unknown.example",
    "97300000-0000-4000-8000-000000000001");
  assert.deepEqual(first.rows[0].outcome, "ONBOARDING");
  assert.deepEqual(first.rows[0].access_state, "UNKNOWN_WORKSPACE");
  assert.deepEqual(first.rows[0].allowed_operations, [
    "FIRST_DOMAIN_CLAIM_READ", "FIRST_DOMAIN_CLAIM_RESERVE", "FIRST_DOMAIN_CLAIM_COMPLETE",
  ]);
  assert.equal(first.rows[0].route, null);

  const replay = await complete(0xa1, 0xa2, 0xa4,
    "web-v2-unknown-sub", "changed@unknown.example", "unknown.example",
    "97300000-0000-4000-8000-000000000001");
  assert.equal(replay.rows[0].outcome, "DENIED");
  assert.deepEqual((await pool.query(`SELECT
    (SELECT count(*)::int FROM uptech.users u JOIN uptech.identities i ON i.user_id=u.id
      WHERE i.provider='GOOGLE' AND i.issuer='https://accounts.google.com'
        AND i.provider_subject='web-v2-unknown-sub') AS users,
    (SELECT count(*)::int FROM uptech.onboarding_sessions o JOIN uptech.identities i ON i.id=o.identity_id
      WHERE i.provider_subject='web-v2-unknown-sub' AND o.status='ACTIVE'
        AND o.resource_workspace_id IS NULL) AS capabilities,
    (SELECT count(*)::int FROM uptech.sessions s JOIN uptech.identities i ON i.id=s.identity_id
      WHERE i.provider_subject='web-v2-unknown-sub') AS sessions,
    (SELECT status FROM uptech.oauth_transactions WHERE id='97300000-0000-4000-8000-000000000001') AS transaction_status`)).rows[0], {
    users: 1, capabilities: 1, sessions: 0, transaction_status: "COMPLETED",
  });

  await reserve("97300000-0000-4000-8000-000000000003", 0xc1, 0xc2);
  const metadataRefresh = await complete(0xc1, 0xc2, 0xc3,
    "web-v2-unknown-sub", "renamed@unknown-two.example", "unknown-two.example",
    "97300000-0000-4000-8000-000000000003");
  assert.equal(metadataRefresh.rows[0].outcome, "ONBOARDING");
  assert.deepEqual((await pool.query(`SELECT count(*)::int AS identities,
    min(email_claim) AS email_claim,min(hosted_domain_claim) AS hosted_domain_claim
    FROM uptech.identities WHERE provider='GOOGLE'
      AND issuer='https://accounts.google.com' AND provider_subject='web-v2-unknown-sub'`)).rows[0], {
    identities: 1, email_claim: "renamed@unknown-two.example",
    hosted_domain_claim: "unknown-two.example",
  });
  assert.deepEqual((await pool.query(`SELECT
    count(*) FILTER (WHERE o.status='ACTIVE')::int AS active,
    count(*) FILTER (WHERE o.status='REVOKED')::int AS revoked
    FROM uptech.onboarding_sessions o JOIN uptech.identities i ON i.id=o.identity_id
    WHERE i.provider_subject='web-v2-unknown-sub'
      AND o.resource_workspace_id IS NULL`)).rows[0], { active: 1, revoked: 1 });

  await reserve("97300000-0000-4000-8000-000000000004", 0xd1, 0xd2);
  const requestMismatch = await complete(0xd1, 0xd2, 0xd3,
    "web-v2-mismatch-sub", "owner@mismatch.example", "mismatch.example",
    "97300000-0000-4000-8000-000000000099");
  assert.equal(requestMismatch.rows[0].outcome, "DENIED");
  assert.deepEqual((await pool.query(`SELECT
    (SELECT status FROM uptech.oauth_transactions
      WHERE id='97300000-0000-4000-8000-000000000004') AS transaction_status,
    (SELECT count(*)::int FROM uptech.identities
      WHERE provider_subject='web-v2-mismatch-sub') AS identities,
    (SELECT count(*)::int FROM uptech.onboarding_sessions o JOIN uptech.identities i
      ON i.id=o.identity_id WHERE i.provider_subject='web-v2-mismatch-sub') AS capabilities,
    (SELECT request_id::text FROM uptech.platform_audit_events
      WHERE metadata->>'correlation_id'='97300000-0000-4000-8000-000000000004'
      ORDER BY occurred_at DESC LIMIT 1) AS audit_request_id`)).rows[0], {
    transaction_status: "REJECTED", identities: 0, capabilities: 0,
    audit_request_id: "97300000-0000-4000-8000-000000000004",
  });

  await reserve("97300000-0000-4000-8000-000000000002", 0xb1, 0xb2);
  const personal = await complete(0xb1, 0xb2, 0xb3,
    "web-v2-personal-sub", "person@gmail.com", null,
    "97300000-0000-4000-8000-000000000002");
  assert.equal(personal.rows[0].outcome, "DENIED");
  assert.equal((await pool.query(`SELECT count(*)::int AS count
    FROM uptech.onboarding_sessions o JOIN uptech.identities i ON i.id=o.identity_id
    WHERE i.provider_subject='web-v2-personal-sub'`)).rows[0].count, 0);

  const oauthBlocker = await pool.connect();
  await reserve("97300000-0000-4000-8000-000000000005", 0xe1, 0xe2, 119);
  try {
    await oauthBlocker.query("BEGIN; SET LOCAL ROLE uptech_migration_owner");
    await oauthBlocker.query(`SELECT id FROM uptech.oauth_transactions
      WHERE id='97300000-0000-4000-8000-000000000005' FOR UPDATE`);
    const blockedCompletion = complete(0xe1, 0xe2, 0xe3,
      "web-v2-post-lock-time-sub", "owner@post-lock.example", "post-lock.example",
      "97300000-0000-4000-8000-000000000005", new Date(Date.now() + 400));
    await delay(1200);
    await oauthBlocker.query("COMMIT");
    assert.equal((await blockedCompletion).rows[0].outcome, "DENIED");
  } finally {
    await oauthBlocker.query("ROLLBACK").catch(() => undefined);
    oauthBlocker.release();
  }
  assert.deepEqual((await pool.query(`SELECT
    (SELECT count(*)::int FROM uptech.identities
      WHERE provider_subject='web-v2-post-lock-time-sub') AS identities,
    (SELECT count(*)::int FROM uptech.onboarding_sessions o JOIN uptech.identities i
      ON i.id=o.identity_id WHERE i.provider_subject='web-v2-post-lock-time-sub') AS capabilities`)).rows[0], {
    identities: 0, capabilities: 0,
  });

  await asMigrationOwner((client) => client.query(`
    INSERT INTO uptech.users(id) VALUES ('97300000-0000-4000-8000-000000000010');
    INSERT INTO uptech.identities(id,user_id,provider,issuer,provider_subject,
      email_claim,email_verified,hosted_domain_claim,claims_observed_at)
    VALUES ('97300000-0000-4000-8000-000000000011',
      '97300000-0000-4000-8000-000000000010','GOOGLE','https://accounts.google.com',
      'web-v2-rollback-sub','old@rollback.example',true,'rollback.example',statement_timestamp());
    INSERT INTO uptech.onboarding_sessions(id,identity_id,token_hash,allowed_operations,expires_at)
    VALUES ('97300000-0000-4000-8000-000000000012',
      '97300000-0000-4000-8000-000000000011',decode(repeat('ef',32),'hex'),
      ARRAY['FIRST_DOMAIN_CLAIM_READ','FIRST_DOMAIN_CLAIM_RESERVE','FIRST_DOMAIN_CLAIM_COMPLETE'],
      statement_timestamp()+interval '20 minutes')`));
  const expiring = await reserve("97300000-0000-4000-8000-000000000006", 0xf1, 0xf2, 118);
  const reservationExpiry = new Date(expiring.rows[0].completion_expires_at).getTime();
  const identityBlocker = await pool.connect();
  try {
    await identityBlocker.query("BEGIN; SET LOCAL ROLE uptech_migration_owner");
    await identityBlocker.query(`SELECT id FROM uptech.identities
      WHERE id='97300000-0000-4000-8000-000000000011' FOR UPDATE`);
    const rollbackCompletion = complete(0xf1, 0xf2, 0xf3,
      "web-v2-rollback-sub", "new@rollback.example", "rollback-new.example",
      "97300000-0000-4000-8000-000000000006");

    let completionOwnsOauthLock = false;
    for (let attempt = 0; attempt < 50 && !completionOwnsOauthLock; attempt += 1) {
      const probe = await pool.connect();
      try {
        await probe.query("BEGIN; SET LOCAL ROLE uptech_migration_owner");
        await probe.query(`SELECT id FROM uptech.oauth_transactions
          WHERE id='97300000-0000-4000-8000-000000000006' FOR UPDATE NOWAIT`);
        await probe.query("ROLLBACK");
        await delay(20);
      } catch (error) {
        await probe.query("ROLLBACK").catch(() => undefined);
        if ((error as { code?: string }).code !== "55P03") throw error;
        completionOwnsOauthLock = true;
      } finally {
        probe.release();
      }
    }
    assert.equal(completionOwnsOauthLock, true);
    await delay(Math.max(0, reservationExpiry - Date.now() + 100));
    await identityBlocker.query("COMMIT");
    assert.equal((await rollbackCompletion).rows[0].outcome, "DENIED");
  } finally {
    await identityBlocker.query("ROLLBACK").catch(() => undefined);
    identityBlocker.release();
  }
  assert.deepEqual((await pool.query(`SELECT
    i.email_claim,i.hosted_domain_claim,
    count(*) FILTER (WHERE o.status='ACTIVE')::int AS active,
    count(*) FILTER (WHERE o.token_hash=decode(repeat('f3',32),'hex'))::int AS new_capabilities
    FROM uptech.identities i LEFT JOIN uptech.onboarding_sessions o ON o.identity_id=i.id
    WHERE i.id='97300000-0000-4000-8000-000000000011'
    GROUP BY i.id`)).rows[0], {
    email_claim: "old@rollback.example", hosted_domain_claim: "rollback.example",
    active: 1, new_capabilities: 0,
  });
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM uptech.audit_events
    WHERE request_id='97300000-0000-4000-8000-000000000006'`)).rows[0].count, 0);

  const claimIssuedAt = new Date(Date.now() - 5 * 60 * 1000 + 1_000);
  const claimBoundary = claimIssuedAt.getTime() + 5 * 60 * 1000;
  const claimTimeReservation = await reserve(
    "97300000-0000-4000-8000-000000000007", 0x61, 0x62,
  );
  assert.equal(
    new Date(claimTimeReservation.rows[0].completion_expires_at).getTime() > claimBoundary + 30_000,
    true,
  );
  const claimTimeIdentityBlocker = await pool.connect();
  try {
    await claimTimeIdentityBlocker.query("BEGIN; SET LOCAL ROLE uptech_migration_owner");
    await claimTimeIdentityBlocker.query(`SELECT id FROM uptech.identities
      WHERE id='97300000-0000-4000-8000-000000000011' FOR UPDATE`);
    const claimTimeCompletion = complete(0x61, 0x62, 0x63,
      "web-v2-rollback-sub", "claim-time@rollback.example", "claim-time.example",
      "97300000-0000-4000-8000-000000000007", null, claimIssuedAt);

    let completionOwnsOauthLock = false;
    for (let attempt = 0; attempt < 50 && !completionOwnsOauthLock; attempt += 1) {
      const probe = await pool.connect();
      try {
        await probe.query("BEGIN; SET LOCAL ROLE uptech_migration_owner");
        await probe.query(`SELECT id FROM uptech.oauth_transactions
          WHERE id='97300000-0000-4000-8000-000000000007' FOR UPDATE NOWAIT`);
        await probe.query("ROLLBACK");
        await delay(20);
      } catch (error) {
        await probe.query("ROLLBACK").catch(() => undefined);
        if ((error as { code?: string }).code !== "55P03") throw error;
        completionOwnsOauthLock = true;
      } finally {
        probe.release();
      }
    }
    assert.equal(completionOwnsOauthLock, true);
    await delay(Math.max(0, claimBoundary - Date.now() + 150));
    await claimTimeIdentityBlocker.query("COMMIT");
    assert.equal((await claimTimeCompletion).rows[0].outcome, "DENIED");
  } finally {
    await claimTimeIdentityBlocker.query("ROLLBACK").catch(() => undefined);
    claimTimeIdentityBlocker.release();
  }
  assert.deepEqual((await pool.query(`SELECT
    i.email_claim,i.hosted_domain_claim,
    count(*) FILTER (WHERE o.status='ACTIVE')::int AS active,
    count(*) FILTER (WHERE o.token_hash=decode(repeat('63',32),'hex'))::int AS new_capabilities,
    (SELECT status FROM uptech.oauth_transactions
      WHERE id='97300000-0000-4000-8000-000000000007') AS transaction_status
    FROM uptech.identities i LEFT JOIN uptech.onboarding_sessions o ON o.identity_id=i.id
    WHERE i.id='97300000-0000-4000-8000-000000000011'
    GROUP BY i.id`)).rows[0], {
    email_claim: "old@rollback.example", hosted_domain_claim: "rollback.example",
    active: 1, new_capabilities: 0, transaction_status: "EXCHANGE_RESERVED",
  });
});

async function seedBootstrapSource(input: {
  userId: string;
  identityId: string;
  sourceId: string;
  sourceByte: number;
  subject: string;
  domain: string;
}): Promise<void> {
  await asMigrationOwner(async (client) => {
    await client.query("INSERT INTO uptech.users(id) VALUES ($1)", [input.userId]);
    await client.query(`INSERT INTO uptech.identities(
      id,user_id,provider,issuer,provider_subject,email_claim,email_verified,
      hosted_domain_claim,claims_observed_at
    ) VALUES ($1,$2,'GOOGLE','https://accounts.google.com',$3,'owner@' || $4,true,$4,statement_timestamp())`,
    [input.identityId, input.userId, input.subject, input.domain]);
    await client.query(`INSERT INTO uptech.onboarding_sessions(id,identity_id,token_hash,allowed_operations,expires_at)
      VALUES ($1,$2,$3,ARRAY['FIRST_DOMAIN_CLAIM_READ','FIRST_DOMAIN_CLAIM_RESERVE','FIRST_DOMAIN_CLAIM_COMPLETE'],statement_timestamp()+interval '20 minutes')`,
    [input.sourceId, input.identityId, hash32(input.sourceByte)]);
  });
}

test("0009 adds bootstrap state without widening runtime table access", async () => {
  const result = await pool.query(`
    SELECT
      (SELECT relforcerowsecurity FROM pg_class WHERE oid='uptech.workspace_access_requests'::regclass) AS forced_rls,
      has_table_privilege('uptech_api_runtime','uptech.google_workspace_bootstrap_attempts','SELECT') AS api_attempt_read,
      has_table_privilege('uptech_worker_runtime','uptech.google_workspace_bootstrap_receipts','SELECT') AS worker_receipt_read,
      has_table_privilege('uptech_api_runtime','uptech.workspace_access_requests','INSERT') AS api_request_insert,
      has_table_privilege('uptech_worker_runtime','uptech.workspace_access_requests','SELECT') AS worker_request_read,
      to_regtype('uptech.google_login_access_state_v2') IS NOT NULL AS access_state_v2,
      to_regtype('uptech.google_workspace_verified_domain_v1') IS NOT NULL AS verified_domain_type,
      EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='uptech' AND indexname='google_workspace_bootstrap_attempts_one_live_source') AS live_attempt_index,
      EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='uptech' AND indexname='service_actors_one_active_sync_worker') AS sync_worker_index,
      EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='uptech' AND indexname='workspace_domain_locators_one_primary_customer') AS primary_domain_index,
      EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='uptech' AND indexname='workspace_access_requests_one_pending_identity_reason') AS pending_request_index,
      EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname='uptech' AND tablename='workspace_access_requests'
          AND policyname='workspace_access_requests_migration_owner'
          AND roles = ARRAY['uptech_migration_owner']::name[]
      ) AS request_owner_policy,
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid='uptech.connectors'::regclass
          AND conname='connectors_directory_authorized_identity_fk'
          AND contype='f' AND convalidated
      ) AS connector_identity_fk,
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid='uptech.onboarding_sessions'::regclass
          AND conname IN ('onboarding_sessions_operations_check','onboarding_sessions_expiry_check','onboarding_sessions_resource_workspace_fk','onboarding_sessions_access_reason_check')
        GROUP BY conrelid HAVING count(*)=4 AND bool_and(convalidated)
      ) AS onboarding_constraints
  `);
  assert.deepEqual(result.rows[0], {
    forced_rls: true, api_attempt_read: false, worker_receipt_read: false,
    api_request_insert: false, worker_request_read: false,
    access_state_v2: true, verified_domain_type: true,
    live_attempt_index: true, sync_worker_index: true, primary_domain_index: true,
    pending_request_index: true, request_owner_policy: true,
    connector_identity_fk: true, onboarding_constraints: true,
  });
});

test("bootstrap start admission atomically shares the GOOGLE_AUTH ten-per-minute bucket", async () => {
  const networkHmac = new Uint8Array(32).fill(0x99);
  const outcomes = await Promise.all(Array.from({ length: 11 }, (_, index) =>
    asApi(async (client) => createGoogleWorkspaceBootstrapStartAdmission(client)({
      networkHmac,
      requestId: `99000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    }))));
  assert.equal(outcomes.filter(({ outcome }) => outcome === "ADMITTED").length, 10);
  assert.equal(outcomes.filter(({ outcome }) => outcome === "RATE_LIMITED").length, 1);
  const evidence = await asMigrationOwner((client) => client.query(`
    SELECT bucket_scope,request_count,over_limit_observed,
      (SELECT count(*)::int FROM uptech.platform_audit_events
       WHERE action='GOOGLE_AUTH_RATE_LIMITED' AND target_type='GOOGLE_AUTH'
         AND metadata=pg_catalog.jsonb_build_object('bucket_scope','GOOGLE_AUTH')) AS audits
    FROM uptech.google_auth_rate_limit_buckets WHERE network_hmac=$1`, [Buffer.from(networkHmac)]));
  assert.deepEqual(evidence.rows, [{
    bucket_scope: "GOOGLE_AUTH", request_count: 10,
    over_limit_observed: true, audits: 1,
  }]);
});

test("API runtime alone authenticates a strictly bound active first-domain source without table access", async () => {
  const source = bootstrapFixtures.abort;
  const authority = await asApi((client) =>
    createGoogleWorkspaceBootstrapSourceAuthority(client as never).authenticate({
      credentialHash: hash32(source.sourceByte),
      requiredOperation: "FIRST_DOMAIN_CLAIM_RESERVE",
    }));
  assert.deepEqual(authority, {
    identityId: source.identityId,
    providerSubject: source.subject,
    normalizedEmail: `owner@${source.domain}`,
    hostedDomain: source.domain,
    identityActive: true,
    userActive: true,
  });

  await assert.rejects(asApi((client) => client.query("SELECT id FROM uptech.identities LIMIT 1")), /permission denied/u);
  await assert.rejects(asApi((client) => client.query("SELECT id FROM uptech.users LIMIT 1")), /permission denied/u);
  await assert.rejects(asApi((client) => client.query("SELECT id FROM uptech.onboarding_sessions LIMIT 1")), /permission denied/u);

  const acl = await pool.query(`SELECT
    has_function_privilege('uptech_api_runtime', 'uptech.authenticate_google_workspace_bootstrap_source_v1(uptech.google_auth_hash32_v1)', 'EXECUTE') AS api_execute,
    has_function_privilege('uptech_worker_runtime', 'uptech.authenticate_google_workspace_bootstrap_source_v1(uptech.google_auth_hash32_v1)', 'EXECUTE') AS worker_execute,
    NOT EXISTS (
      SELECT 1 FROM pg_proc AS procedure_row
      CROSS JOIN LATERAL aclexplode(coalesce(procedure_row.proacl, acldefault('f', procedure_row.proowner))) AS acl_row
      WHERE procedure_row.oid = 'uptech.authenticate_google_workspace_bootstrap_source_v1(uptech.google_auth_hash32_v1)'::regprocedure
        AND acl_row.grantee = 0
    ) AS public_denied`);
  assert.deepEqual(acl.rows[0], { api_execute: true, worker_execute: false, public_denied: true });

  const worker = await pool.connect();
  try {
    await worker.query("BEGIN");
    await worker.query("SET LOCAL ROLE uptech_worker_runtime");
    await assert.rejects(worker.query(
      "SELECT * FROM uptech.authenticate_google_workspace_bootstrap_source_v1($1::uptech.google_auth_hash32_v1)",
      [hash32(source.sourceByte)],
    ), /permission denied/u);
  } finally {
    await worker.query("ROLLBACK");
    worker.release();
  }
});

test("revoked, expired, wrong-operation, and inactive bootstrap sources authenticate as masked misses", async () => {
  const cases = [
    { suffix: "31", byte: 0xd1, mutation: "UPDATE uptech.onboarding_sessions SET status='REVOKED',revoked_at=statement_timestamp() WHERE token_hash=$1" },
    { suffix: "32", byte: 0xd2, mutation: "UPDATE uptech.onboarding_sessions SET expires_at=created_at+interval '1 microsecond' WHERE token_hash=$1" },
    { suffix: "33", byte: 0xd3, mutation: "UPDATE uptech.onboarding_sessions SET allowed_operations=ARRAY['FIRST_DOMAIN_CLAIM_READ'] WHERE token_hash=$1" },
    { suffix: "34", byte: 0xd4, mutation: "UPDATE uptech.identities SET status='REVOKED' WHERE id=$1" },
    { suffix: "35", byte: 0xd5, mutation: "UPDATE uptech.users SET status='SUSPENDED' WHERE id=$1" },
  ] as const;
  for (const item of cases) {
    const ids = {
      userId: `96000000-0000-4000-8000-0000000000${item.suffix}`,
      identityId: `96000000-0000-4000-9000-0000000000${item.suffix}`,
      sourceId: `96000000-0000-4000-a000-0000000000${item.suffix}`,
    };
    await seedBootstrapSource({ ...ids, sourceByte: item.byte, subject: `masked-${item.suffix}`, domain: `masked-${item.suffix}.example` });
    const mutationValues: readonly unknown[] = item.suffix === "34" ? [ids.identityId]
      : item.suffix === "35" ? [ids.userId] : [hash32(item.byte)];
    await asMigrationOwner((client) => client.query(item.mutation, [...mutationValues]));
    assert.equal(await asApi((client) => createGoogleWorkspaceBootstrapSourceAuthority(client as never).authenticate({
      credentialHash: hash32(item.byte),
      requiredOperation: "FIRST_DOMAIN_CLAIM_RESERVE",
    })), null);
  }
});

test("Task 2 standalone verifier passes against the migrated disposable database", async () => {
  await pool.query(await sql("db/verify/google_workspace_tenant_bootstrap.sql"));
});

test("0009 fails closed legacy access capabilities that have no server reason provenance", async () => {
  const result = await pool.query("SELECT count(*)::int AS count FROM uptech.onboarding_sessions WHERE id='90000000-0000-0000-0000-000000000004'");
  assert.equal(result.rows[0]?.count, 0);
});

test("0009 safely reconciles unmatched, mixed, and duplicate legacy capabilities", async () => {
  const result = await pool.query("SELECT id::text,allowed_operations,resource_workspace_id::text FROM uptech.onboarding_sessions WHERE id IN ('90000000-0000-0000-0000-000000000014','90000000-0000-0000-0000-000000000015','90000000-0000-0000-0000-000000000016') ORDER BY id");
  assert.deepEqual(result.rows, [
    { id: '90000000-0000-0000-0000-000000000015', allowed_operations: ['FIRST_DOMAIN_CLAIM_READ'], resource_workspace_id: null },
  ]);
});

test("connector scope authority accepts only the exact legacy-four or current-five set", async () => {
  const base = [
    'https://www.googleapis.com/auth/admin.directory.customer.readonly',
    'https://www.googleapis.com/auth/admin.directory.user.readonly',
    'https://www.googleapis.com/auth/admin.directory.group.readonly',
    'https://www.googleapis.com/auth/admin.directory.orgunit.readonly',
  ];
  const domain = 'https://www.googleapis.com/auth/admin.directory.domain.readonly';
  await pool.query("SET ROLE uptech_migration_owner");
  assert.equal((await pool.query("SELECT uptech.directory_scopes_are_supported_v1($1::text[])", [base])).rows[0].directory_scopes_are_supported_v1, true);
  assert.equal((await pool.query("SELECT uptech.directory_scopes_are_supported_v1($1::text[])", [[...base, domain]])).rows[0].directory_scopes_are_supported_v1, true);
  assert.equal((await pool.query("SELECT uptech.directory_scopes_are_supported_v1($1::text[])", [[...base, base[0]]])).rows[0].directory_scopes_are_supported_v1, false);
  assert.equal((await pool.query("SELECT uptech.directory_scopes_are_supported_v1($1::text[])", [[...base, 'unknown']])).rows[0].directory_scopes_are_supported_v1, false);
  await pool.query("RESET ROLE");
});

test("approved activation and lease routines execute with five scopes and reject duplicates", async () => {
  const scopes = [
    'https://www.googleapis.com/auth/admin.directory.customer.readonly',
    'https://www.googleapis.com/auth/admin.directory.user.readonly',
    'https://www.googleapis.com/auth/admin.directory.group.readonly',
    'https://www.googleapis.com/auth/admin.directory.orgunit.readonly',
    'https://www.googleapis.com/auth/admin.directory.domain.readonly',
  ];
  await pool.query(`SET ROLE uptech_migration_owner;
    INSERT INTO uptech.workspace_memberships(workspace_id,id,user_id,role,status) VALUES ('90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000021','90000000-0000-0000-0000-000000000002','OWNER','ACTIVE');
    INSERT INTO uptech.service_actors(workspace_id,id,actor_kind) VALUES ('90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000022','SYNC_WORKER');
    INSERT INTO uptech.connectors(workspace_id,id,purpose) VALUES ('90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000023','DIRECTORY');
    INSERT INTO uptech.sessions(workspace_id,id,identity_id,user_id,membership_id,client_type,status,user_security_version,identity_security_version,workspace_security_version,membership_authz_version,idle_expires_at,absolute_expires_at)
      VALUES ('90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000024','90000000-0000-0000-0000-000000000003','90000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000021','WEB','ACTIVE',1,1,1,1,statement_timestamp()+interval '1 hour',statement_timestamp()+interval '1 day');
    RESET ROLE`);
  await pool.query("SET ROLE uptech_api_runtime");
  await pool.query("SELECT set_config('app.workspace_id',$1,false),set_config('app.actor_id',$2,false),set_config('app.membership_id',$3,false),set_config('app.session_id',$4,false)", ['90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000021','90000000-0000-0000-0000-000000000024']);
  const activated = await pool.query("SELECT outcome FROM uptech.activate_directory_connector_v1($1,$2,$3,$4,$5,$6,$7)", ['90000000-0000-0000-0000-000000000023','legacy-customer','secretref://five','legacy-sub','legacy.example',scopes,'90000000-0000-0000-0000-000000000025']);
  assert.equal(activated.rows[0]?.outcome, 'ACTIVATED');
  const denied = await pool.query("SELECT outcome FROM uptech.activate_directory_connector_v1($1,$2,$3,$4,$5,$6,$7)", ['90000000-0000-0000-0000-000000000023','legacy-customer','secretref://bad','legacy-sub','legacy.example',[...scopes.slice(0,4),scopes[0]],'90000000-0000-0000-0000-000000000026']);
  assert.equal(denied.rows[0]?.outcome, 'DENIED');
  await pool.query("RESET ROLE; SET ROLE uptech_worker_runtime");
  const leased = await pool.query("SELECT connector_id::text FROM uptech.lease_next_directory_job_v1()");
  assert.equal(leased.rows[0]?.connector_id, '90000000-0000-0000-0000-000000000023');
  await pool.query("RESET ROLE");
});

test("prepare is idempotent, denies a second live source attempt, creates no authority, and aborts one-way", async () => {
  const fixture = bootstrapFixtures.abort;
  const attemptId = "92000000-0000-0000-0000-000000000004";
  const candidateWorkspaceId = "92000000-0000-0000-0000-000000000005";
  const repositoryInput = {
    attemptId,
    sourceTokenHash: hash32(fixture.sourceByte),
    candidateWorkspaceId,
    statusTokenHash: hash32(0x22),
    requestId: "92000000-0000-0000-0000-000000000006",
  };

  const first = await asApi((client) =>
    createGoogleWorkspaceBootstrapRepository(client as never).prepare(repositoryInput));
  const retry = await asApi((client) =>
    createGoogleWorkspaceBootstrapRepository(client as never).prepare(repositoryInput));
  const competing = await asApi((client) =>
    createGoogleWorkspaceBootstrapRepository(client as never).prepare({
      ...repositoryInput,
      attemptId: "92000000-0000-0000-0000-000000000007",
      candidateWorkspaceId: "92000000-0000-0000-0000-000000000008",
      statusTokenHash: hash32(0x23),
    }));

  assert.deepEqual(first, { outcome: "PREPARED" });
  assert.deepEqual(retry, { outcome: "PREPARED" });
  assert.deepEqual(competing, { outcome: "DENIED" });
  const authority = await pool.query(`SELECT
    (SELECT count(*)::int FROM uptech.workspaces WHERE workspace_id=$1) AS workspaces,
    (SELECT count(*)::int FROM uptech.workspace_memberships WHERE workspace_id=$1) AS memberships,
    (SELECT count(*)::int FROM uptech.connectors WHERE workspace_id=$1) AS connectors,
    (SELECT count(*)::int FROM uptech.sessions WHERE workspace_id=$1) AS sessions`, [candidateWorkspaceId]);
  assert.deepEqual(authority.rows[0], { workspaces: 0, memberships: 0, connectors: 0, sessions: 0 });

  const aborted = await asApi((client) =>
    createGoogleWorkspaceBootstrapRepository(client as never).abort({
      attemptId,
      sourceTokenHash: hash32(fixture.sourceByte),
      requestId: "92000000-0000-0000-0000-000000000009",
    }));
  assert.deepEqual(aborted, { outcome: "ABORTED" });
  await assert.rejects(
    pool.query(`SET ROLE uptech_migration_owner;
      UPDATE uptech.google_workspace_bootstrap_attempts
      SET state='COMMITTED',committed_at=statement_timestamp()
      WHERE id='92000000-0000-0000-0000-000000000004'; RESET ROLE`),
    (error: { code?: string }) => error.code === "55000",
  );
  await pool.query("ROLLBACK; RESET ROLE");
});

test("idempotent prepare retries revalidate every current source authority and candidate collision", async () => {
  const scenarios = [
    {
      label: "revoked source",
      mutate: (client: PoolClient, sourceId: string) =>
        client.query("UPDATE uptech.onboarding_sessions SET status='REVOKED',revoked_at=statement_timestamp() WHERE id=$1", [sourceId]),
    },
    {
      label: "expired source",
      mutate: (client: PoolClient, sourceId: string) =>
        client.query("UPDATE uptech.onboarding_sessions SET expires_at=created_at+interval '1 microsecond' WHERE id=$1", [sourceId]),
    },
    {
      label: "wrong operation family",
      mutate: (client: PoolClient, sourceId: string) =>
        client.query("UPDATE uptech.onboarding_sessions SET allowed_operations=ARRAY['FIRST_DOMAIN_CLAIM_READ'] WHERE id=$1", [sourceId]),
    },
    {
      label: "revoked identity",
      mutate: (client: PoolClient, _sourceId: string, identityId: string) =>
        client.query("UPDATE uptech.identities SET status='REVOKED' WHERE id=$1", [identityId]),
    },
    {
      label: "suspended user",
      mutate: (client: PoolClient, _sourceId: string, _identityId: string, userId: string) =>
        client.query("UPDATE uptech.users SET status='SUSPENDED' WHERE id=$1", [userId]),
    },
    {
      label: "occupied candidate workspace",
      mutate: (client: PoolClient, _sourceId: string, _identityId: string, _userId: string, candidateWorkspaceId: string) =>
        client.query("INSERT INTO uptech.workspaces(workspace_id) VALUES ($1)", [candidateWorkspaceId]),
    },
    {
      label: "colliding status hash",
      mutate: (client: PoolClient, sourceId: string, identityId: string, _userId: string, _candidateWorkspaceId: string, statusTokenHash: Buffer) =>
        client.query(`INSERT INTO uptech.onboarding_sessions(id,identity_id,token_hash,allowed_operations,expires_at)
          VALUES (gen_random_uuid(),$1,$2,ARRAY['FIRST_DOMAIN_CLAIM_READ'],statement_timestamp()+interval '20 minutes')`, [identityId, statusTokenHash]),
    },
  ] as const;

  for (const [index, scenario] of scenarios.entries()) {
    const id = (offset: number) => `96000000-0000-0000-0000-${String(index * 10 + offset).padStart(12, "0")}`;
    const userId = id(1);
    const identityId = id(2);
    const sourceId = id(3);
    const attemptId = id(4);
    const candidateWorkspaceId = id(5);
    // Keep source/status credentials disjoint from the unknown-login fixtures.
    const sourceByte = 0x43 + index * 2;
    const statusTokenHash = hash32(sourceByte + 1);
    await seedBootstrapSource({
      userId, identityId, sourceId, sourceByte,
      subject: `prepare-retry-${index}-sub`, domain: `prepare-retry-${index}.example`,
    });
    const input = {
      attemptId, sourceTokenHash: hash32(sourceByte), candidateWorkspaceId, statusTokenHash,
      requestId: id(6),
    };
    assert.deepEqual(await asApi((client) => createGoogleWorkspaceBootstrapRepository(client as never).prepare(input)), { outcome: "PREPARED" }, scenario.label);
    await asMigrationOwner((client) => scenario.mutate(client, sourceId, identityId, userId, candidateWorkspaceId, statusTokenHash));
    assert.deepEqual(await asApi((client) => createGoogleWorkspaceBootstrapRepository(client as never).prepare(input)), { outcome: "DENIED" }, scenario.label);
  }
});

test("complete atomically creates the existing identity's tenant authority and no login session", async () => {
  const fixture = bootstrapFixtures.commit;
  const attemptId = "92000000-0000-0000-0000-000000000014";
  const candidateWorkspaceId = "92000000-0000-0000-0000-000000000015";
  const sourceTokenHash = hash32(fixture.sourceByte);
  const statusTokenHash = hash32(0x32);
  const before = await pool.query("SELECT (SELECT count(*)::int FROM uptech.users) AS users,(SELECT count(*)::int FROM uptech.identities) AS identities");
  const repository = (client: PoolClient) =>
    createGoogleWorkspaceBootstrapRepository(client as never);

  assert.deepEqual(await asApi((client) => repository(client).prepare({
    attemptId, sourceTokenHash, candidateWorkspaceId, statusTokenHash,
    requestId: "92000000-0000-0000-0000-000000000016",
  })), { outcome: "PREPARED" });

  const credentialReference = "secretref://google-workspace/commit";
  const completed = await asApi((client) => repository(client).complete({
    attemptId,
    sourceTokenHash,
    statusTokenHash,
    customerId: "customer-commit",
    customerDomain: " COMMIT.EXAMPLE ",
    providerSubject: fixture.subject,
    hostedDomain: " COMMIT.EXAMPLE ",
    verifiedDomains: [
      { normalizedDomain: "alias.commit.example", domainKind: "ALIAS", providerParentDomain: "commit.example" },
      { normalizedDomain: " COMMIT.EXAMPLE ", domainKind: "PRIMARY", providerParentDomain: null },
      { normalizedDomain: "secondary.commit.example", domainKind: "SECONDARY", providerParentDomain: null },
    ],
    credentialReference: credentialReference as never,
    authorizedScopes: CURRENT_DIRECTORY_SCOPES,
    requestId: "92000000-0000-0000-0000-000000000017",
  }));
  assert.equal(completed.outcome, "PROVISIONING");
  assert.ok(completed.outcome === "PROVISIONING" && completed.statusExpiresAt.getTime() > Date.now());
  assert.deepEqual(Object.keys(completed).sort(), ["outcome", "statusExpiresAt"]);

  const created = await pool.query(`SELECT
    workspace.status AS workspace_status,workspace.provisioning_policy,workspace.google_customer_id,
    attempt.state AS attempt_state,source.status AS source_status,
    status_capability.allowed_operations AS status_operations,
    status_capability.resource_workspace_id::text AS status_workspace_id,
    receipt.initial_status_onboarding_session_id::text AS status_capability_id,
    connector.status AS connector_status,connector.provider_customer_id,
    connector.directory_authorized_by_identity_id::text AS authorized_identity_id,
    actor.actor_kind,actor.status AS actor_status,job.job_kind,job.status AS job_status,
    membership.user_id::text AS owner_user_id,membership.role AS owner_role,
    (SELECT count(*)::int FROM uptech.workspace_domain_locators WHERE workspace_id=workspace.workspace_id AND status='VERIFIED') AS verified_domains,
    (SELECT count(*)::int FROM uptech.sessions WHERE workspace_id=workspace.workspace_id) AS sessions,
    (SELECT count(*)::int FROM uptech.audit_events WHERE workspace_id=workspace.workspace_id AND actor_kind='SYSTEM') AS system_audits,
    (SELECT count(*)::int FROM uptech.platform_audit_events WHERE metadata->>'workspace_id'=workspace.workspace_id::text) AS platform_audits,
    (SELECT count(*)::int FROM uptech.users) AS users,
    (SELECT count(*)::int FROM uptech.identities) AS identities
  FROM uptech.workspaces AS workspace
  JOIN uptech.google_workspace_bootstrap_attempts AS attempt ON attempt.candidate_workspace_id=workspace.workspace_id
  JOIN uptech.google_workspace_bootstrap_receipts AS receipt ON receipt.attempt_id=attempt.id
  JOIN uptech.onboarding_sessions AS source ON source.id=attempt.source_onboarding_session_id
  JOIN uptech.onboarding_sessions AS status_capability ON status_capability.id=receipt.initial_status_onboarding_session_id
  JOIN uptech.connectors AS connector ON connector.workspace_id=workspace.workspace_id AND connector.id=receipt.connector_id
  JOIN uptech.service_actors AS actor ON actor.workspace_id=workspace.workspace_id
  JOIN uptech.sync_jobs AS job ON job.workspace_id=workspace.workspace_id AND job.connector_id=connector.id
  JOIN uptech.workspace_memberships AS membership ON membership.workspace_id=workspace.workspace_id
  WHERE workspace.workspace_id=$1`, [candidateWorkspaceId]);
  assert.deepEqual(created.rows[0], {
    workspace_status: "ACTIVE", provisioning_policy: "GOOGLE_GROUP_CONTROLLED", google_customer_id: "customer-commit",
    attempt_state: "COMMITTED", source_status: "CONSUMED",
    status_operations: ["DIRECTORY_BOOTSTRAP_STATUS_READ", "DIRECTORY_BOOTSTRAP_SYNC_RETRY"],
    status_workspace_id: candidateWorkspaceId,
    status_capability_id: created.rows[0]?.status_capability_id,
    connector_status: "ACTIVE", provider_customer_id: "customer-commit",
    authorized_identity_id: fixture.identityId,
    actor_kind: "SYNC_WORKER", actor_status: "ACTIVE", job_kind: "DIRECTORY_SYNC", job_status: "QUEUED",
    owner_user_id: fixture.userId, owner_role: "OWNER", verified_domains: 3, sessions: 0,
    system_audits: 1, platform_audits: 1,
    users: before.rows[0].users, identities: before.rows[0].identities,
  });
  const encodedDomains = await pool.query(`SELECT normalized_domain::text,domain_kind::text,
    provider_parent_domain::text FROM uptech.workspace_domain_locators
    WHERE workspace_id=$1 ORDER BY normalized_domain`, [candidateWorkspaceId]);
  assert.deepEqual(encodedDomains.rows, [
    { normalized_domain: "alias.commit.example", domain_kind: "ALIAS", provider_parent_domain: "commit.example" },
    { normalized_domain: "commit.example", domain_kind: "PRIMARY", provider_parent_domain: null },
    { normalized_domain: "secondary.commit.example", domain_kind: "SECONDARY", provider_parent_domain: null },
  ]);
});

test("complete accepts a hosted domain proven as a verified secondary or alias", async () => {
  const cases = [
    { kind: "SECONDARY" as const, hostedDomain: "secondary.accepted.example", parent: null },
    { kind: "ALIAS" as const, hostedDomain: "alias.accepted.example", parent: "primary-alias.accepted.example" },
  ];
  for (const [index, domainCase] of cases.entries()) {
    const suffix = index === 0 ? "31" : "41";
    const userId = `96100000-0000-0000-0000-0000000000${suffix}`;
    const identityId = `96100000-0000-0000-0000-0000000000${Number(suffix) + 1}`;
    const sourceId = `96100000-0000-0000-0000-0000000000${Number(suffix) + 2}`;
    const attemptId = `96100000-0000-0000-0000-0000000000${Number(suffix) + 3}`;
    const candidateWorkspaceId = `96100000-0000-0000-0000-0000000000${Number(suffix) + 4}`;
    const primaryDomain = domainCase.parent ?? "primary-secondary.accepted.example";
    const sourceByte = 0xb0 + index * 2;
    await seedBootstrapSource({ userId, identityId, sourceId, sourceByte, subject: `accepted-${index}-sub`, domain: domainCase.hostedDomain });
    const repository = (client: PoolClient) => createGoogleWorkspaceBootstrapRepository(client as never);
    assert.deepEqual(await asApi((client) => repository(client).prepare({
      attemptId, sourceTokenHash: hash32(sourceByte), candidateWorkspaceId, statusTokenHash: hash32(sourceByte + 1),
      requestId: `96100000-0000-0000-0000-0000000000${Number(suffix) + 5}`,
    })), { outcome: "PREPARED" });
    const completed = await asApi((client) => repository(client).complete({
      attemptId, sourceTokenHash: hash32(sourceByte), statusTokenHash: hash32(sourceByte + 1),
      customerId: `customer-accepted-${index}`, customerDomain: primaryDomain,
      providerSubject: `accepted-${index}-sub`, hostedDomain: domainCase.hostedDomain,
      verifiedDomains: [
        { normalizedDomain: primaryDomain, domainKind: "PRIMARY", providerParentDomain: null },
        { normalizedDomain: domainCase.hostedDomain, domainKind: domainCase.kind, providerParentDomain: domainCase.parent },
      ],
      credentialReference: `secretref://google-workspace/accepted-${index}` as never,
      authorizedScopes: CURRENT_DIRECTORY_SCOPES,
      requestId: `96100000-0000-0000-0000-0000000000${Number(suffix) + 6}`,
    }));
    assert.equal(completed.outcome, "PROVISIONING", domainCase.kind);
  }
});

test("complete denies replay of an already committed attempt even when receipt bindings match", async () => {
  const fixture = {
    userId: "96200000-0000-0000-0000-000000000001", identityId: "96200000-0000-0000-0000-000000000002",
    sourceId: "96200000-0000-0000-0000-000000000003", sourceByte: 0xc1,
    subject: "committed-replay-sub", domain: "committed-replay.example",
  };
  const attemptId = "96200000-0000-0000-0000-000000000004";
  const candidateWorkspaceId = "96200000-0000-0000-0000-000000000005";
  const statusTokenHash = hash32(0xc2);
  const credentialReference = "secretref://google-workspace/committed-replay";
  await seedBootstrapSource(fixture);
  const repository = (client: PoolClient) => createGoogleWorkspaceBootstrapRepository(client as never);
  assert.deepEqual(await asApi((client) => repository(client).prepare({
    attemptId, sourceTokenHash: hash32(fixture.sourceByte), candidateWorkspaceId, statusTokenHash,
    requestId: "96200000-0000-0000-0000-000000000006",
  })), { outcome: "PREPARED" });
  const baseComplete = {
    attemptId, sourceTokenHash: hash32(fixture.sourceByte), statusTokenHash,
    customerId: "customer-committed-replay", customerDomain: fixture.domain,
    providerSubject: fixture.subject, hostedDomain: fixture.domain,
    verifiedDomains: [{ normalizedDomain: fixture.domain, domainKind: "PRIMARY" as const, providerParentDomain: null }],
    credentialReference: credentialReference as never, authorizedScopes: CURRENT_DIRECTORY_SCOPES,
    requestId: "96200000-0000-0000-0000-000000000007",
  };
  assert.equal((await asApi((client) => repository(client).complete(baseComplete))).outcome, "PROVISIONING");
  assert.deepEqual(await asApi((client) => repository(client).complete({
    ...baseComplete,
    customerId: "stale-customer", customerDomain: "stale.example",
    providerSubject: "stale-subject", hostedDomain: "stale.example",
    verifiedDomains: [{ normalizedDomain: "stale.example", domainKind: "PRIMARY", providerParentDomain: null }],
    requestId: "96200000-0000-0000-0000-000000000008",
  })), { outcome: "DENIED" });
});

test("complete denies mismatched proof without leaving partial tenant authority", async () => {
  const fixture = bootstrapFixtures.deny;
  const attemptId = "92000000-0000-0000-0000-000000000024";
  const candidateWorkspaceId = "92000000-0000-0000-0000-000000000025";
  const repository = (client: PoolClient) =>
    createGoogleWorkspaceBootstrapRepository(client as never);
  await asApi((client) => repository(client).prepare({
    attemptId,
    sourceTokenHash: hash32(fixture.sourceByte),
    candidateWorkspaceId,
    statusTokenHash: hash32(0x42),
    requestId: "92000000-0000-0000-0000-000000000026",
  }));

  const denied = await asApi((client) => repository(client).complete({
    attemptId,
    sourceTokenHash: hash32(fixture.sourceByte),
    statusTokenHash: hash32(0x42),
    customerId: "customer-deny",
    customerDomain: fixture.domain,
    providerSubject: "different-provider-subject",
    hostedDomain: fixture.domain,
    verifiedDomains: [{ normalizedDomain: fixture.domain, domainKind: "PRIMARY", providerParentDomain: null }],
    credentialReference: "secretref://google-workspace/denied" as never,
    authorizedScopes: CURRENT_DIRECTORY_SCOPES,
    requestId: "92000000-0000-0000-0000-000000000027",
  }));
  assert.deepEqual(denied, { outcome: "DENIED" });

  const residue = await pool.query(`SELECT
    (SELECT state::text FROM uptech.google_workspace_bootstrap_attempts WHERE id=$1) AS attempt_state,
    (SELECT count(*)::int FROM uptech.workspaces WHERE workspace_id=$2) AS workspaces,
    (SELECT count(*)::int FROM uptech.workspace_memberships WHERE workspace_id=$2) AS memberships,
    (SELECT count(*)::int FROM uptech.connectors WHERE workspace_id=$2) AS connectors,
    (SELECT count(*)::int FROM uptech.service_actors WHERE workspace_id=$2) AS actors,
    (SELECT count(*)::int FROM uptech.sync_jobs WHERE workspace_id=$2) AS jobs,
    (SELECT count(*)::int FROM uptech.google_workspace_bootstrap_receipts WHERE attempt_id=$1) AS receipts,
    (SELECT status FROM uptech.onboarding_sessions WHERE id=$3) AS source_status`,
    [attemptId, candidateWorkspaceId, fixture.sourceId]);
  assert.deepEqual(residue.rows[0], {
    attempt_state: "PREPARED", workspaces: 0, memberships: 0, connectors: 0,
    actors: 0, jobs: 0, receipts: 0, source_status: "ACTIVE",
  });
});

test("two completions racing for one Google customer and domain commit exactly one workspace", async () => {
  const sources = [
    {
      userId: "93000000-0000-0000-0000-000000000001",
      identityId: "93000000-0000-0000-0000-000000000002",
      sourceId: "93000000-0000-0000-0000-000000000003",
      sourceByte: 0x51,
      subject: "race-a-sub",
      domain: "race.example",
      attemptId: "93000000-0000-0000-0000-000000000004",
      workspaceId: "93000000-0000-0000-0000-000000000005",
      statusByte: 0x52,
    },
    {
      userId: "93000000-0000-0000-0000-000000000011",
      identityId: "93000000-0000-0000-0000-000000000012",
      sourceId: "93000000-0000-0000-0000-000000000013",
      sourceByte: 0x61,
      subject: "race-b-sub",
      domain: "race.example",
      attemptId: "93000000-0000-0000-0000-000000000014",
      workspaceId: "93000000-0000-0000-0000-000000000015",
      statusByte: 0x62,
    },
  ] as const;
  await Promise.all(sources.map(seedBootstrapSource));
  for (const [index, source] of sources.entries()) {
    assert.deepEqual(await asApi((client) => createGoogleWorkspaceBootstrapRepository(client as never).prepare({
      attemptId: source.attemptId,
      sourceTokenHash: hash32(source.sourceByte),
      candidateWorkspaceId: source.workspaceId,
      statusTokenHash: hash32(source.statusByte),
      requestId: `93000000-0000-0000-0000-00000000002${index}`,
    })), { outcome: "PREPARED" });
  }

  const completions = await Promise.all(sources.map((source, index) => asApi((client) =>
    createGoogleWorkspaceBootstrapRepository(client as never).complete({
      attemptId: source.attemptId,
      sourceTokenHash: hash32(source.sourceByte),
      statusTokenHash: hash32(source.statusByte),
      customerId: "customer-race",
      customerDomain: "race.example",
      providerSubject: source.subject,
      hostedDomain: source.domain,
      verifiedDomains: [
        { normalizedDomain: "race.example", domainKind: "PRIMARY", providerParentDomain: null },
        { normalizedDomain: "alias.race.example", domainKind: "ALIAS", providerParentDomain: "race.example" },
      ],
      credentialReference: `secretref://google-workspace/race-${index}` as never,
      authorizedScopes: CURRENT_DIRECTORY_SCOPES,
      requestId: `93000000-0000-0000-0000-00000000003${index}`,
    }))));

  assert.deepEqual(completions.map((result) => result.outcome).sort(), ["DENIED", "PROVISIONING"]);
  const committed = await pool.query(`SELECT
    (SELECT count(*)::int FROM uptech.workspaces WHERE google_customer_id='customer-race') AS workspaces,
    (SELECT count(*)::int FROM uptech.workspace_domain_locators WHERE normalized_domain='race.example') AS domains,
    (SELECT count(*)::int FROM uptech.google_workspace_bootstrap_attempts WHERE id = ANY($1::uuid[]) AND state='COMMITTED') AS attempts`,
    [sources.map((source) => source.attemptId)]);
  assert.deepEqual(committed.rows[0], { workspaces: 1, domains: 1, attempts: 1 });
});

test("reconcile waits for the completion lock and proves only the matching committed receipt", async () => {
  const source = {
    userId: "94000000-0000-0000-0000-000000000001",
    identityId: "94000000-0000-0000-0000-000000000002",
    sourceId: "94000000-0000-0000-0000-000000000003",
    sourceByte: 0x71,
    subject: "lock-sub",
    domain: "lock.example",
  } as const;
  const attemptId = "94000000-0000-0000-0000-000000000004";
  const workspaceId = "94000000-0000-0000-0000-000000000005";
  const statusTokenHash = hash32(0x72);
  const credentialReference = "secretref://google-workspace/lock";
  await seedBootstrapSource(source);
  assert.deepEqual(await asApi((client) => createGoogleWorkspaceBootstrapRepository(client as never).prepare({
    attemptId,
    sourceTokenHash: hash32(source.sourceByte),
    candidateWorkspaceId: workspaceId,
    statusTokenHash,
    requestId: "94000000-0000-0000-0000-000000000006",
  })), { outcome: "PREPARED" });

  const completingClient = await pool.connect();
  let transactionOpen = false;
  try {
    await completingClient.query("BEGIN");
    transactionOpen = true;
    await completingClient.query("SET LOCAL ROLE uptech_api_runtime");
    const completed = await createGoogleWorkspaceBootstrapRepository(completingClient as never).complete({
      attemptId,
      sourceTokenHash: hash32(source.sourceByte),
      statusTokenHash,
      customerId: "customer-lock",
      customerDomain: source.domain,
      providerSubject: source.subject,
      hostedDomain: source.domain,
      verifiedDomains: [{ normalizedDomain: source.domain, domainKind: "PRIMARY", providerParentDomain: null }],
      credentialReference: credentialReference as never,
      authorizedScopes: CURRENT_DIRECTORY_SCOPES,
      requestId: "94000000-0000-0000-0000-000000000007",
    });
    assert.equal(completed.outcome, "PROVISIONING");

    let reconcileSettled = false;
    const reconcilePromise = asApi((client) => createGoogleWorkspaceBootstrapRepository(client as never).reconcile({
      attemptId,
      sourceTokenHash: hash32(source.sourceByte),
      statusTokenHash,
      credentialReference: credentialReference as never,
      requestId: "94000000-0000-0000-0000-000000000008",
    })).finally(() => { reconcileSettled = true; });
    await delay(100);
    assert.equal(reconcileSettled, false);
    await completingClient.query("COMMIT");
    transactionOpen = false;
    assert.deepEqual(await reconcilePromise, { outcome: "COMMITTED" });
  } finally {
    if (transactionOpen) await completingClient.query("ROLLBACK");
    completingClient.release();
  }

  assert.deepEqual(await asApi((client) => createGoogleWorkspaceBootstrapRepository(client as never).reconcile({
    attemptId,
    sourceTokenHash: hash32(source.sourceByte),
    statusTokenHash,
    credentialReference: "secretref://google-workspace/wrong" as never,
    requestId: "94000000-0000-0000-0000-000000000009",
  })), { outcome: "UNKNOWN" });
});

test("reconcile aborts an expired clean attempt, denies delayed complete, and keeps live state unknown", async () => {
  const expired = {
    userId: "95000000-0000-0000-0000-000000000001",
    identityId: "95000000-0000-0000-0000-000000000002",
    sourceId: "95000000-0000-0000-0000-000000000003",
    sourceByte: 0x81,
    subject: "expired-sub",
    domain: "expired.example",
  } as const;
  const attemptId = "95000000-0000-0000-0000-000000000004";
  const workspaceId = "95000000-0000-0000-0000-000000000005";
  const statusTokenHash = hash32(0x82);
  const credentialReference = "secretref://google-workspace/expired";
  await seedBootstrapSource(expired);
  await asMigrationOwner((client) => client.query(`INSERT INTO uptech.google_workspace_bootstrap_attempts(
      id,source_onboarding_session_id,identity_id,candidate_workspace_id,
      candidate_status_hash,completion_deadline,created_at
    ) VALUES ($1,$2,$3,$4,$5,statement_timestamp()-interval '1 minute',statement_timestamp()-interval '11 minutes')`,
  [attemptId, expired.sourceId, expired.identityId, workspaceId, statusTokenHash]));

  const repositoryCall = <T>(operation: (repository: ReturnType<typeof createGoogleWorkspaceBootstrapRepository>) => Promise<T>) =>
    asApi((client) => operation(createGoogleWorkspaceBootstrapRepository(client as never)));
  assert.deepEqual(await repositoryCall((repository) => repository.reconcile({
    attemptId,
    sourceTokenHash: hash32(expired.sourceByte),
    statusTokenHash,
    credentialReference: credentialReference as never,
    requestId: "95000000-0000-0000-0000-000000000006",
  })), { outcome: "NOT_COMMITTED" });

  const delayed = await repositoryCall((repository) => repository.complete({
    attemptId,
    sourceTokenHash: hash32(expired.sourceByte),
    statusTokenHash,
    customerId: "customer-expired",
    customerDomain: expired.domain,
    providerSubject: expired.subject,
    hostedDomain: expired.domain,
    verifiedDomains: [{ normalizedDomain: expired.domain, domainKind: "PRIMARY", providerParentDomain: null }],
    credentialReference: credentialReference as never,
    authorizedScopes: CURRENT_DIRECTORY_SCOPES,
    requestId: "95000000-0000-0000-0000-000000000007",
  }));
  assert.deepEqual(delayed, { outcome: "DENIED" });
  const proof = await pool.query(`SELECT
    (SELECT state::text FROM uptech.google_workspace_bootstrap_attempts WHERE id=$1) AS state,
    (SELECT count(*)::int FROM uptech.google_workspace_bootstrap_receipts WHERE attempt_id=$1) AS receipts,
    (SELECT count(*)::int FROM uptech.connectors WHERE credential_reference=$2) AS connector_references`,
    [attemptId, credentialReference]);
  assert.deepEqual(proof.rows[0], { state: "ABORTED", receipts: 0, connector_references: 0 });

  const live = {
    userId: "95000000-0000-0000-0000-000000000011",
    identityId: "95000000-0000-0000-0000-000000000012",
    sourceId: "95000000-0000-0000-0000-000000000013",
    sourceByte: 0x91,
    subject: "live-sub",
    domain: "live.example",
  } as const;
  const liveAttemptId = "95000000-0000-0000-0000-000000000014";
  await seedBootstrapSource(live);
  assert.deepEqual(await repositoryCall((repository) => repository.prepare({
    attemptId: liveAttemptId,
    sourceTokenHash: hash32(live.sourceByte),
    candidateWorkspaceId: "95000000-0000-0000-0000-000000000015",
    statusTokenHash: hash32(0x92),
    requestId: "95000000-0000-0000-0000-000000000016",
  })), { outcome: "PREPARED" });
  assert.deepEqual(await repositoryCall((repository) => repository.reconcile({
    attemptId: liveAttemptId,
    sourceTokenHash: hash32(live.sourceByte),
    statusTokenHash: hash32(0x92),
    credentialReference: "secretref://google-workspace/live" as never,
    requestId: "95000000-0000-0000-0000-000000000017",
  })), { outcome: "UNKNOWN" });
});

test("status and retry expose only exact API routines and closed v1 result types", async () => {
  for (const signature of [
    "uptech.read_google_workspace_bootstrap_status_v1(uptech.google_auth_hash32_v1,uuid)",
    "uptech.retry_google_workspace_bootstrap_sync_v1(uptech.google_auth_hash32_v1,uuid)",
    "uptech.finish_google_workspace_bootstrap_v1(uptech.google_auth_hash32_v1,uuid)",
    "uptech.reissue_google_workspace_bootstrap_status_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uuid)",
    "uptech.revoke_onboarding_capability_v1(uptech.google_auth_hash32_v1,uuid)",
  ]) {
    const result = await pool.query(`SELECT p.prosecdef,p.provolatile,p.proconfig,
      has_function_privilege('uptech_api_runtime',p.oid,'EXECUTE') AS api_execute,
      has_function_privilege('uptech_worker_runtime',p.oid,'EXECUTE') AS worker_execute,
      has_function_privilege('public',p.oid,'EXECUTE') AS public_execute
      FROM pg_proc p WHERE p.oid=$1::regprocedure`, [signature]);
    assert.deepEqual(result.rows[0], { prosecdef: true, provolatile: "v",
      proconfig: ["search_path=pg_catalog, uptech"], api_execute: true,
      worker_execute: false, public_execute: false }, signature);
  }
  assert.deepEqual((await pool.query(`SELECT
    to_regtype('uptech.google_workspace_bootstrap_status_result_v1') IS NOT NULL AS status_result,
    to_regtype('uptech.google_workspace_bootstrap_retry_result_v1') IS NOT NULL AS retry_result,
    to_regtype('uptech.google_workspace_bootstrap_finish_result_v1') IS NOT NULL AS finish_result,
    to_regtype('uptech.google_workspace_bootstrap_reissue_result_v1') IS NOT NULL AS reissue_result,
    to_regtype('uptech.onboarding_capability_revoke_result_v1') IS NOT NULL AS revoke_result`)).rows[0],
  { status_result: true, retry_result: true, finish_result: true,
    reissue_result: true, revoke_result: true });
});

test("status and retry are capability-bound across job, generation, and tenant states", async () => {
  const fixture = {
    userId: "97000000-0000-0000-0000-000000000001",
    identityId: "97000000-0000-0000-0000-000000000002",
    sourceId: "97000000-0000-0000-0000-000000000003",
    sourceByte: 0xe1,
    subject: "bootstrap-status-sub",
    domain: "status.example",
  } as const;
  const attemptId = "97000000-0000-0000-0000-000000000004";
  const workspaceId = "97000000-0000-0000-0000-000000000005";
  const statusTokenHash = hash32(0xe2);
  const requestId = "99000000-0000-4000-8000-000000000001";
  const repositoryCall = <T>(operation: (repository: ReturnType<typeof createGoogleWorkspaceBootstrapRepository>) => Promise<T>) =>
    asApi((client) => operation(createGoogleWorkspaceBootstrapRepository(client as never)));
  const read = () => repositoryCall((repository) => repository.readStatus({ statusTokenHash, requestId }));
  const retry = () => repositoryCall((repository) => repository.retrySync({ statusTokenHash, requestId }));

  await seedBootstrapSource(fixture);
  assert.deepEqual(await repositoryCall((repository) => repository.prepare({
    attemptId,
    sourceTokenHash: hash32(fixture.sourceByte),
    candidateWorkspaceId: workspaceId,
    statusTokenHash,
    requestId: "97000000-0000-0000-0000-000000000006",
  })), { outcome: "PREPARED" });
  assert.equal((await repositoryCall((repository) => repository.complete({
    attemptId,
    sourceTokenHash: hash32(fixture.sourceByte),
    statusTokenHash,
    customerId: "customer-status",
    customerDomain: fixture.domain,
    providerSubject: fixture.subject,
    hostedDomain: fixture.domain,
    verifiedDomains: [{ normalizedDomain: fixture.domain, domainKind: "PRIMARY", providerParentDomain: null }],
    credentialReference: "secretref://google-workspace/status" as never,
    authorizedScopes: CURRENT_DIRECTORY_SCOPES,
    requestId: "97000000-0000-0000-0000-000000000007",
  }))).outcome, "PROVISIONING");

  const otherFixture = {
    userId: "97100000-0000-0000-0000-000000000001",
    identityId: "97100000-0000-0000-0000-000000000002",
    sourceId: "97100000-0000-0000-0000-000000000003",
    sourceByte: 0xe3,
    subject: "bootstrap-status-other-sub",
    domain: "status-other.example",
  } as const;
  const otherAttemptId = "97100000-0000-0000-0000-000000000004";
  const otherWorkspaceId = "97100000-0000-0000-0000-000000000005";
  const otherStatusTokenHash = hash32(0xe4);
  await seedBootstrapSource(otherFixture);
  assert.deepEqual(await repositoryCall((repository) => repository.prepare({
    attemptId: otherAttemptId,
    sourceTokenHash: hash32(otherFixture.sourceByte),
    candidateWorkspaceId: otherWorkspaceId,
    statusTokenHash: otherStatusTokenHash,
    requestId: "97100000-0000-0000-0000-000000000006",
  })), { outcome: "PREPARED" });
  assert.equal((await repositoryCall((repository) => repository.complete({
    attemptId: otherAttemptId,
    sourceTokenHash: hash32(otherFixture.sourceByte),
    statusTokenHash: otherStatusTokenHash,
    customerId: "customer-status-other",
    customerDomain: otherFixture.domain,
    providerSubject: otherFixture.subject,
    hostedDomain: otherFixture.domain,
    verifiedDomains: [{ normalizedDomain: otherFixture.domain, domainKind: "PRIMARY", providerParentDomain: null }],
    credentialReference: "secretref://google-workspace/status-other" as never,
    authorizedScopes: CURRENT_DIRECTORY_SCOPES,
    requestId: "97100000-0000-0000-0000-000000000007",
  }))).outcome, "PROVISIONING");

  assert.deepEqual(await read(), { outcome: "DIRECTORY_BOOTSTRAP_SYNC_PENDING" });
  assert.deepEqual(await retry(), { outcome: "DIRECTORY_BOOTSTRAP_SYNC_PENDING" });
  assert.deepEqual(await repositoryCall((repository) => repository.readStatus({
    statusTokenHash: hash32(0x21), requestId,
  })), { outcome: "DENIED" });

  const bound = await pool.query(`SELECT job.id::text AS job_id,receipt.connector_id::text AS connector_id
    FROM uptech.google_workspace_bootstrap_receipts receipt JOIN uptech.sync_jobs job
      ON job.workspace_id=receipt.workspace_id AND job.connector_id=receipt.connector_id
      AND job.payload->>'bootstrap_attempt_id'=receipt.attempt_id::text
    WHERE receipt.workspace_id=$1`, [workspaceId]);
  const { job_id: jobId, connector_id: connectorId } = bound.rows[0];
  const otherBefore = (await pool.query(`SELECT workspace_id::text,id::text,status,attempt_count,
    lease_fence::text,lease_expires_at FROM uptech.sync_jobs
    WHERE workspace_id<>$1 AND job_kind='DIRECTORY_SYNC' ORDER BY workspace_id,id LIMIT 1`, [workspaceId])).rows[0];

  await asMigrationOwner((client) => client.query(`UPDATE uptech.sync_jobs SET
    attempt_count=max_attempts,updated_at=statement_timestamp()
    WHERE workspace_id=$1 AND id=$2`, [workspaceId, jobId]));
  assert.deepEqual(await read(), { outcome: "DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED" });
  assert.deepEqual(await retry(), { outcome: "DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED" });

  await asMigrationOwner((client) => client.query(`UPDATE uptech.sync_jobs SET status='LEASED',
    attempt_count=1,max_attempts=3,leased_at=statement_timestamp()-interval '2 minutes',
    lease_expires_at=statement_timestamp()+interval '2 minutes',lease_owner='test-worker',
    lease_fence='99000000-0000-4000-8000-000000000002',updated_at=statement_timestamp()
    WHERE workspace_id=$1 AND id=$2`, [workspaceId, jobId]));
  assert.deepEqual(await read(), { outcome: "DIRECTORY_BOOTSTRAP_SYNC_PENDING" });
  assert.deepEqual(await retry(), { outcome: "DIRECTORY_BOOTSTRAP_SYNC_PENDING" });

  await asMigrationOwner((client) => client.query(`UPDATE uptech.sync_jobs SET
    leased_at=statement_timestamp()-interval '3 minutes',lease_expires_at=statement_timestamp()-interval '1 minute',
    updated_at=statement_timestamp() WHERE workspace_id=$1 AND id=$2`, [workspaceId, jobId]));
  assert.deepEqual(await read(), { outcome: "DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE" });
  assert.deepEqual(await retry(), { outcome: "REQUEUED" });
  assert.deepEqual((await pool.query(`SELECT status,attempt_count,leased_at,lease_expires_at,
    lease_owner,lease_fence FROM uptech.sync_jobs WHERE workspace_id=$1 AND id=$2`, [workspaceId, jobId])).rows[0],
  { status: "QUEUED", attempt_count: 1, leased_at: null, lease_expires_at: null,
    lease_owner: null, lease_fence: null });
  assert.deepEqual((await pool.query(`SELECT workspace_id::text,id::text,status,attempt_count,
    lease_fence::text,lease_expires_at FROM uptech.sync_jobs WHERE id=$1`, [otherBefore.id])).rows[0], otherBefore);

  await asMigrationOwner((client) => client.query(`UPDATE uptech.sync_jobs SET status='LEASED',
    attempt_count=max_attempts,leased_at=statement_timestamp()-interval '3 minutes',
    lease_expires_at=statement_timestamp()-interval '1 minute',lease_owner='test-worker',
    lease_fence='99000000-0000-4000-8000-000000000003',updated_at=statement_timestamp()
    WHERE workspace_id=$1 AND id=$2`, [workspaceId, jobId]));
  assert.deepEqual(await read(), { outcome: "DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED" });
  assert.deepEqual(await retry(), { outcome: "DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED" });

  await asMigrationOwner((client) => client.query(`INSERT INTO uptech.people_sync_generations(
    workspace_id,id,connector_id,job_id,lease_fence,status,traversal_complete,
    started_at,completed_at,fresh_until,google_customer_id,primary_domain)
    VALUES ($1,'99000000-0000-4000-8000-000000000004',$2,$3,
      '99000000-0000-4000-8000-000000000005','PUBLISHED',true,
      statement_timestamp()-interval '3 hours',statement_timestamp()-interval '2 hours',
      statement_timestamp()-interval '1 hour','customer-status','status.example')`,
  [workspaceId, connectorId, jobId]));
  assert.deepEqual(await read(), { outcome: "DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED" });
  await asMigrationOwner((client) => client.query(`UPDATE uptech.people_sync_generations SET
    completed_at=statement_timestamp(),fresh_until=statement_timestamp()+interval '4 minutes'
    WHERE workspace_id=$1 AND id='99000000-0000-4000-8000-000000000004'`, [workspaceId]));
  assert.deepEqual(await read(), { outcome: "READY" });
  assert.deepEqual(await retry(), { outcome: "READY" });

  const sessionsBeforeFinish = Number((await pool.query(
    "SELECT count(*) FROM uptech.sessions WHERE workspace_id=$1", [workspaceId],
  )).rows[0].count);
  assert.deepEqual(await repositoryCall((repository) => repository.finish({
    statusTokenHash, requestId,
  })), { outcome: "FINISHED" });
  assert.deepEqual(await repositoryCall((repository) => repository.finish({
    statusTokenHash, requestId,
  })), { outcome: "DENIED" });
  assert.equal(Number((await pool.query(
    "SELECT count(*) FROM uptech.sessions WHERE workspace_id=$1", [workspaceId],
  )).rows[0].count), sessionsBeforeFinish);

  await asMigrationOwner((client) => client.query(`UPDATE uptech.onboarding_sessions SET
    status='ACTIVE',consumed_at=NULL,
    resource_workspace_id='90000000-0000-0000-0000-000000000001' WHERE token_hash=$1`, [statusTokenHash]));
  assert.deepEqual(await read(), { outcome: "DENIED" });
  await asMigrationOwner((client) => client.query(`UPDATE uptech.onboarding_sessions SET
    resource_workspace_id=$2,created_at=statement_timestamp()-interval '23 hours',
    expires_at=statement_timestamp()-interval '1 minute' WHERE token_hash=$1`, [statusTokenHash, workspaceId]));
  assert.deepEqual(await read(), { outcome: "ONBOARDING_EXPIRED" });
  assert.deepEqual(await retry(), { outcome: "ONBOARDING_EXPIRED" });
  await asMigrationOwner((client) => client.query(`UPDATE uptech.onboarding_sessions SET status='REVOKED',
    revoked_at=statement_timestamp(),created_at=statement_timestamp()-interval '1 hour',
    expires_at=statement_timestamp()+interval '1 hour' WHERE token_hash=$1`, [statusTokenHash]));
  assert.deepEqual(await read(), { outcome: "DENIED" });
  assert.deepEqual(await retry(), { outcome: "DENIED" });

  const audits = await pool.query(`SELECT action,outcome,request_id::text,metadata
    FROM uptech.audit_events WHERE workspace_id=$1 AND request_id=$2
      AND action IN (
        'GOOGLE_WORKSPACE_BOOTSTRAP_STATUS_CHECKED',
        'GOOGLE_WORKSPACE_BOOTSTRAP_SYNC_RETRY_REQUESTED',
        'GOOGLE_WORKSPACE_BOOTSTRAP_SYNC_RETRY_RESULT',
        'GOOGLE_WORKSPACE_BOOTSTRAP_FINISHED'
      ) ORDER BY action`, [workspaceId, requestId]);
  assert.deepEqual(audits.rows.map((row) => row.action), [
    "GOOGLE_WORKSPACE_BOOTSTRAP_FINISHED",
    "GOOGLE_WORKSPACE_BOOTSTRAP_STATUS_CHECKED",
    "GOOGLE_WORKSPACE_BOOTSTRAP_SYNC_RETRY_REQUESTED",
    "GOOGLE_WORKSPACE_BOOTSTRAP_SYNC_RETRY_RESULT",
  ]);
  assert.ok(audits.rows.every((row) => row.request_id === requestId &&
    row.outcome === "SUCCEEDED" &&
    !/(credential|token|hash|secret|authority|customer)/iu.test(JSON.stringify(row.metadata))));
});

test("finish, fresh-OIDC status reissue, and exact capability revoke stay closed and replay-safe", async () => {
  const fixture = {
    userId: "97200000-0000-0000-0000-000000000001",
    identityId: "97200000-0000-0000-0000-000000000002",
    sourceId: "97200000-0000-0000-0000-000000000003",
    sourceByte: 0xf1,
    subject: "bootstrap-reissue-sub",
    domain: "reissue.example",
  } as const;
  const attemptId = "97200000-0000-0000-0000-000000000004";
  const workspaceId = "97200000-0000-0000-0000-000000000005";
  const initialStatusHash = hash32(0xf2);
  const repositoryCall = <T>(operation: (repository: ReturnType<typeof createGoogleWorkspaceBootstrapRepository>) => Promise<T>) =>
    asApi((client) => operation(createGoogleWorkspaceBootstrapRepository(client as never)));

  await seedBootstrapSource(fixture);
  assert.deepEqual(await repositoryCall((repository) => repository.prepare({
    attemptId, sourceTokenHash: hash32(fixture.sourceByte),
    candidateWorkspaceId: workspaceId, statusTokenHash: initialStatusHash,
    requestId: "97200000-0000-4000-8000-000000000006",
  })), { outcome: "PREPARED" });
  assert.equal((await repositoryCall((repository) => repository.complete({
    attemptId, sourceTokenHash: hash32(fixture.sourceByte),
    statusTokenHash: initialStatusHash, customerId: "customer-reissue",
    customerDomain: fixture.domain, providerSubject: fixture.subject,
    hostedDomain: fixture.domain,
    verifiedDomains: [{ normalizedDomain: fixture.domain, domainKind: "PRIMARY", providerParentDomain: null }],
    credentialReference: "secretref://google-workspace/reissue" as never,
    authorizedScopes: CURRENT_DIRECTORY_SCOPES,
    requestId: "97200000-0000-4000-8000-000000000007",
  }))).outcome, "PROVISIONING");

  let environmentName = "";
  await asMigrationOwner(async (client) => {
    const active = await client.query<{ environment_name: string }>(
      "SELECT environment_name::text FROM uptech.google_auth_environment_registry WHERE is_active",
    );
    environmentName = active.rows[0]?.environment_name ?? "bootstrap-reissue-test";
    if (active.rowCount === 0) {
      await client.query(`INSERT INTO uptech.google_auth_environment_registry(
        environment_name,rate_limit_audit_hmac_key,is_active
      ) VALUES ($1,$2,true)`, [environmentName, hash32(0x60)]);
    }
    await client.query(`INSERT INTO uptech.google_auth_configuration_registry(
      configuration_key,environment_name,purpose,google_client_id,google_audience,
      audience_configuration_key,callback_uri,scopes,allowed_azp_configuration_keys,
      web_pkce_kms_key_version,is_enabled
    ) VALUES ('GOOGLE_WEB_LOGIN_V1',$1,'WEB_LOGIN','reissue.apps.googleusercontent.com',
      'reissue.apps.googleusercontent.com','GOOGLE_WEB_LOGIN_V1',
      'https://reissue.example/api/v1/auth/google/callback',ARRAY['openid','email','profile'],
      ARRAY['GOOGLE_WEB_LOGIN_V1'::uptech.google_auth_configuration_key_v1],
      'test-key-v1',true) ON CONFLICT (configuration_key) DO NOTHING`, [environmentName]);
  });

  const reserve = async (index: number, completionByte: number, nonceByte: number, expired = false) => {
    const completionHash = hash32(completionByte);
    await asMigrationOwner((client) => client.query(`WITH timing AS (
      SELECT statement_timestamp() - interval '4 minutes' AS created_at,
        statement_timestamp() - CASE WHEN $7::boolean THEN interval '3 minutes' ELSE interval '30 seconds' END AS consumed_at
    ) INSERT INTO uptech.oauth_transactions(
      id,environment_name,purpose,configuration_key,locator_hash,web_state_hash,
      web_nonce_hash,web_browser_binding_hash,web_pkce_envelope_version,
      web_pkce_algorithm,web_pkce_nonce,web_pkce_ciphertext,web_pkce_tag,
      web_pkce_kms_key_version,web_pkce_associated_data,status,
      completion_handle_hash,request_id,created_at,expires_at,consumed_at,completion_expires_at
    ) SELECT $1,$2,'WEB_LOGIN','GOOGLE_WEB_LOGIN_V1',$3,$3,$4,$5,1,
      'AES-256-GCM',decode(repeat('ab',12),'hex'),decode(repeat('bc',40),'hex'),
      decode(repeat('cd',16),'hex'),'test-key-v1',decode(repeat('de',32),'hex'),
      'EXCHANGE_RESERVED',$6,$1,timing.created_at,timing.created_at+interval '10 minutes',
      timing.consumed_at,timing.consumed_at+interval '2 minutes' FROM timing`, [
      `97200000-0000-4000-8000-${String(100 + index).padStart(12, "0")}`,
      environmentName!, hash32(0x20 + index), hash32(nonceByte),
      hash32(0x30 + index), completionHash, expired,
    ]));
    return completionHash;
  };
  const claims = (nonceByte: number, providerSubject: string = fixture.subject) => {
    const now = Math.floor(Date.now() / 1000);
    return {
      issuer: "https://accounts.google.com" as const,
      providerSubject, normalizedEmail: `owner@${fixture.domain}`,
      emailVerified: true as const, hostedDomain: fixture.domain,
      issuedAtEpochSeconds: now - 5, expiresAtEpochSeconds: now + 3600,
      audienceConfigurationKey: "GOOGLE_WEB_LOGIN_V1" as const,
      authorizedPartyConfigurationKey: null, nonceHash: hash32(nonceByte),
      displayName: null, pictureUrl: null,
    };
  };

  assert.deepEqual(await repositoryCall((repository) => repository.finish({
    statusTokenHash: hash32(fixture.sourceByte),
    requestId: "97200000-0000-4000-8000-000000000008",
  })), { outcome: "DENIED" });
  assert.deepEqual(await repositoryCall((repository) => repository.reissueStatus({
    reservedCompletionHash: initialStatusHash, claims: claims(0x70),
    newStatusTokenHash: hash32(0xf3),
    requestId: "97200000-0000-4000-8000-000000000009",
  })), { outcome: "DENIED" });

  const completion = await reserve(1, 0x71, 0x72);
  const replacementHash = hash32(0xf3);
  const reissued = await repositoryCall((repository) => repository.reissueStatus({
    reservedCompletionHash: completion, claims: claims(0x72),
    newStatusTokenHash: replacementHash,
    requestId: "97200000-0000-4000-8000-000000000010",
  }));
  assert.equal(reissued.outcome, "REISSUED");
  assert.ok(reissued.outcome === "REISSUED" &&
    reissued.statusExpiresAt.getTime() <= Date.now() + 24 * 60 * 60 * 1000);
  assert.deepEqual((await pool.query(`SELECT status,
    (SELECT count(*)::int FROM uptech.onboarding_sessions
      WHERE identity_id=$2 AND resource_workspace_id=$3 AND status='ACTIVE'
        AND cardinality(allowed_operations)=2
        AND allowed_operations @> ARRAY['DIRECTORY_BOOTSTRAP_STATUS_READ','DIRECTORY_BOOTSTRAP_SYNC_RETRY']) AS active_statuses,
    (SELECT count(*)::int FROM uptech.sessions WHERE workspace_id=$3) AS sessions
    FROM uptech.onboarding_sessions WHERE token_hash=$1`,
  [initialStatusHash, fixture.identityId, workspaceId])).rows[0], {
    status: "REVOKED", active_statuses: 1, sessions: 0,
  });
  const readStatus = (statusTokenHash: Buffer) => repositoryCall((repository) => repository.readStatus({
    statusTokenHash, requestId: "97200000-0000-4000-8000-000000000021",
  }));
  const retryStatus = (statusTokenHash: Buffer) => repositoryCall((repository) => repository.retrySync({
    statusTokenHash, requestId: "97200000-0000-4000-8000-000000000022",
  }));
  assert.deepEqual(await readStatus(replacementHash), {
    outcome: "DIRECTORY_BOOTSTRAP_SYNC_PENDING",
  });
  assert.deepEqual(await retryStatus(replacementHash), {
    outcome: "DIRECTORY_BOOTSTRAP_SYNC_PENDING",
  });
  assert.deepEqual(await readStatus(initialStatusHash), { outcome: "DENIED" });
  assert.deepEqual(await retryStatus(initialStatusHash), { outcome: "DENIED" });

  const wrongIdentityHash = hash32(0xf8);
  const wrongWorkspaceHash = hash32(0xf9);
  const wrongFamilyHash = hash32(0xfa);
  await asMigrationOwner((client) => client.query(`INSERT INTO uptech.onboarding_sessions(
    id,identity_id,token_hash,allowed_operations,expires_at,resource_workspace_id,
    access_request_reason_class
  ) VALUES
    ('97200000-0000-4000-8000-000000000030','90000000-0000-0000-0000-000000000003',$1,
      ARRAY['DIRECTORY_BOOTSTRAP_STATUS_READ','DIRECTORY_BOOTSTRAP_SYNC_RETRY'],statement_timestamp()+interval '1 hour',$4,NULL),
    ('97200000-0000-4000-8000-000000000031',$5,$2,
      ARRAY['DIRECTORY_BOOTSTRAP_STATUS_READ','DIRECTORY_BOOTSTRAP_SYNC_RETRY'],statement_timestamp()+interval '1 hour',
      '90000000-0000-0000-0000-000000000001',NULL),
    ('97200000-0000-4000-8000-000000000032',$5,$3,
      ARRAY['ACCESS_REQUEST_READ','ACCESS_REQUEST_SUBMIT'],statement_timestamp()+interval '20 minutes',$4,
      'USER_NOT_PROVISIONED')`,
  [wrongIdentityHash, wrongWorkspaceHash, wrongFamilyHash, workspaceId, fixture.identityId]));
  for (const deniedHash of [wrongIdentityHash, wrongWorkspaceHash, wrongFamilyHash]) {
    assert.deepEqual(await readStatus(deniedHash), { outcome: "DENIED" });
    assert.deepEqual(await retryStatus(deniedHash), { outcome: "DENIED" });
  }
  assert.deepEqual(await repositoryCall((repository) => repository.reissueStatus({
    reservedCompletionHash: completion, claims: claims(0x72),
    newStatusTokenHash: hash32(0xf4),
    requestId: "97200000-0000-4000-8000-000000000011",
  })), { outcome: "DENIED" });

  const expiredCompletion = await reserve(2, 0x73, 0x74, true);
  assert.deepEqual(await repositoryCall((repository) => repository.reissueStatus({
    reservedCompletionHash: expiredCompletion, claims: claims(0x74),
    newStatusTokenHash: hash32(0xf5),
    requestId: "97200000-0000-4000-8000-000000000012",
  })), { outcome: "DENIED" });

  const crossIdentityCompletion = await reserve(3, 0x75, 0x76);
  assert.deepEqual(await repositoryCall((repository) => repository.reissueStatus({
    reservedCompletionHash: crossIdentityCompletion,
    claims: claims(0x76, "bootstrap-status-other-sub"),
    newStatusTokenHash: hash32(0xf6),
    requestId: "97200000-0000-4000-8000-000000000013",
  })), { outcome: "DENIED" });

  assert.deepEqual(await repositoryCall((repository) => repository.revokeCapability({
    statusTokenHash: replacementHash,
    requestId: "97200000-0000-4000-8000-000000000014",
  })), { outcome: "REVOKED" });
  assert.deepEqual(await repositoryCall((repository) => repository.revokeCapability({
    statusTokenHash: replacementHash,
    requestId: "97200000-0000-4000-8000-000000000015",
  })), { outcome: "REVOKED" });
  assert.deepEqual(await repositoryCall((repository) => repository.revokeCapability({
    statusTokenHash: hash32(0xfe),
    requestId: "97200000-0000-4000-8000-000000000016",
  })), { outcome: "DENIED" });

  const bound = await pool.query(`SELECT receipt.connector_id::text AS connector_id,job.id::text AS job_id
    FROM uptech.google_workspace_bootstrap_receipts receipt
    JOIN uptech.sync_jobs job ON job.workspace_id=receipt.workspace_id
      AND job.connector_id=receipt.connector_id
      AND job.payload->>'bootstrap_attempt_id'=receipt.attempt_id::text
    WHERE receipt.workspace_id=$1`, [workspaceId]);
  await asMigrationOwner((client) => client.query(`INSERT INTO uptech.people_sync_generations(
    workspace_id,id,connector_id,job_id,lease_fence,status,traversal_complete,
    started_at,completed_at,fresh_until,google_customer_id,primary_domain
  ) VALUES ($1,'97200000-0000-4000-8000-000000000020',$2,$3,
    '97200000-0000-4000-8000-000000000021','PUBLISHED',true,
    statement_timestamp()-interval '3 minutes',statement_timestamp()-interval '2 minutes',
    statement_timestamp()+interval '1 hour','customer-reissue','reissue.example')`,
  [workspaceId, bound.rows[0].connector_id, bound.rows[0].job_id]));
  const readyCompletion = await reserve(4, 0x77, 0x78);
  assert.deepEqual(await repositoryCall((repository) => repository.reissueStatus({
    reservedCompletionHash: readyCompletion, claims: claims(0x78),
    newStatusTokenHash: hash32(0xf7),
    requestId: "97200000-0000-4000-8000-000000000017",
  })), { outcome: "DENIED" });

  const audits = await pool.query(`SELECT action,outcome,request_id::text,metadata
    FROM uptech.audit_events WHERE workspace_id=$1 AND (
      (action='GOOGLE_WORKSPACE_BOOTSTRAP_STATUS_REISSUED' AND request_id=$2) OR
      (action='ONBOARDING_CAPABILITY_REVOKED' AND request_id IN ($3,$4))
    ) ORDER BY request_id`, [workspaceId,
    "97200000-0000-4000-8000-000000000010",
    "97200000-0000-4000-8000-000000000014",
    "97200000-0000-4000-8000-000000000015"]);
  assert.deepEqual(audits.rows.map(({ action, outcome, request_id }) => ({ action, outcome, request_id })), [
    { action: "GOOGLE_WORKSPACE_BOOTSTRAP_STATUS_REISSUED", outcome: "SUCCEEDED", request_id: "97200000-0000-4000-8000-000000000010" },
    { action: "ONBOARDING_CAPABILITY_REVOKED", outcome: "SUCCEEDED", request_id: "97200000-0000-4000-8000-000000000014" },
    { action: "ONBOARDING_CAPABILITY_REVOKED", outcome: "SUCCEEDED", request_id: "97200000-0000-4000-8000-000000000015" },
  ]);
  assert.ok(audits.rows.every((row) =>
    !/(credential|token|hash|secret|authority|customer)/iu.test(JSON.stringify(row.metadata))));
});

test("access requests are exact-capability bound, concurrent-deduplicated, and grant no access", async () => {
  const repositoryCall = <T>(operation: (repository: ReturnType<typeof createGoogleWorkspaceBootstrapRepository>) => Promise<T>) =>
    asApi((client) => operation(createGoogleWorkspaceBootstrapRepository(client as never)));
  const submit = () => repositoryCall((repository) => repository.submitAccessRequest({
    statusTokenHash: hash32(0x09), requestId: "97300000-0000-4000-8000-000000000001",
  }));
  const before = (await pool.query(`SELECT
    (SELECT count(*)::int FROM uptech.workspace_memberships) AS memberships,
    (SELECT count(*)::int FROM uptech.sessions) AS sessions`)).rows[0];
  const submitted = await Promise.all(Array.from({ length: 8 }, submit));
  assert.equal(new Set(submitted.map((result) => result.outcome === "PENDING" && result.requestId)).size, 1);
  assert.ok(submitted.every((result) => result.outcome === "PENDING" && result.status === "PENDING"));
  const receiptId = submitted[0]!.outcome === "PENDING" ? submitted[0]!.requestId : "";
  assert.deepEqual(await repositoryCall((repository) => repository.readAccessRequest({
    statusTokenHash: hash32(0x09), requestId: "97300000-0000-4000-8000-000000000002",
  })), { outcome: "FOUND", requestId: receiptId, status: "PENDING" });
  assert.deepEqual((await pool.query(`SELECT workspace_id::text,identity_id::text,reason_class,status,
    (SELECT count(*)::int FROM uptech.workspace_access_requests WHERE workspace_id=$1 AND identity_id=$2) AS request_count,
    (SELECT count(*)::int FROM uptech.workspace_memberships) AS memberships,
    (SELECT count(*)::int FROM uptech.sessions) AS sessions
    FROM uptech.workspace_access_requests WHERE id=$3`, [
      "90000000-0000-0000-0000-000000000001",
      "90000000-0000-0000-0000-000000000003", receiptId,
    ])).rows[0], {
    workspace_id: "90000000-0000-0000-0000-000000000001",
    identity_id: "90000000-0000-0000-0000-000000000003",
    reason_class: "USER_NOT_PROVISIONED", status: "PENDING", request_count: 1,
    memberships: before.memberships, sessions: before.sessions,
  });

  await asMigrationOwner((client) => client.query(`INSERT INTO uptech.onboarding_sessions(
    id,identity_id,token_hash,allowed_operations,expires_at,resource_workspace_id,
    access_request_reason_class
  ) VALUES
    ('97300000-0000-4000-8000-000000000030','90000000-0000-0000-0000-000000000003',decode(repeat('8b',32),'hex'),ARRAY['ACCESS_REQUEST_READ','ACCESS_REQUEST_SUBMIT'],statement_timestamp()+interval '20 minutes','90000000-0000-0000-0000-000000000001','ACCESS_MAPPING_CONFLICT'),
    ('97300000-0000-4000-8000-000000000031','90000000-0000-0000-0000-000000000003',decode(repeat('8c',32),'hex'),ARRAY['ACCESS_REQUEST_READ','ACCESS_REQUEST_SUBMIT'],statement_timestamp()+interval '20 minutes','90000000-0000-0000-0000-000000000001','DIRECTORY_STALE'),
    ('97300000-0000-4000-8000-000000000032','90000000-0000-0000-0000-000000000003',decode(repeat('8d',32),'hex'),ARRAY['ACCESS_REQUEST_READ','ACCESS_REQUEST_SUBMIT'],statement_timestamp()+interval '20 minutes','90000000-0000-0000-0000-000000000001','ORGANIZATION_ALREADY_REGISTERED')`));
  const reasonReceipts: Record<string, string> = {};
  for (const [byte, reason, suffix] of [
    [0x8b, "ACCESS_MAPPING_CONFLICT", "031"],
    [0x8c, "DIRECTORY_STALE", "032"],
    [0x8d, "ORGANIZATION_ALREADY_REGISTERED", "033"],
  ] as const) {
    const first = await repositoryCall((repository) => repository.submitAccessRequest({
      statusTokenHash: hash32(byte), requestId: `97300000-0000-4000-8000-000000000${suffix}`,
    }));
    const duplicate = await repositoryCall((repository) => repository.submitAccessRequest({
      statusTokenHash: hash32(byte), requestId: `97300000-0000-4000-8000-000000000${suffix}`,
    }));
    assert.ok(first.outcome === "PENDING" && duplicate.outcome === "PENDING");
    assert.equal(first.requestId, duplicate.requestId);
    if (first.outcome === "PENDING") reasonReceipts[reason] = first.requestId;
  }
  assert.equal(new Set(Object.values(reasonReceipts)).size, 3);
  assert.deepEqual((await pool.query(`SELECT reason_class,count(*)::int AS count
    FROM uptech.workspace_access_requests
    WHERE workspace_id='90000000-0000-0000-0000-000000000001'
      AND identity_id='90000000-0000-0000-0000-000000000003'
    GROUP BY reason_class ORDER BY reason_class`)).rows, [
    { reason_class: "ACCESS_MAPPING_CONFLICT", count: 1 },
    { reason_class: "DIRECTORY_STALE", count: 1 },
    { reason_class: "ORGANIZATION_ALREADY_REGISTERED", count: 1 },
    { reason_class: "USER_NOT_PROVISIONED", count: 1 },
  ]);
  for (const reason of [null, "USER_SUSPENDED"] as const) {
    await assert.rejects(asMigrationOwner((client) => client.query(`INSERT INTO uptech.onboarding_sessions(
      id,identity_id,token_hash,allowed_operations,expires_at,resource_workspace_id,access_request_reason_class
    ) VALUES (gen_random_uuid(),'90000000-0000-0000-0000-000000000003',decode(repeat('ee',32),'hex'),
      ARRAY['ACCESS_REQUEST_READ','ACCESS_REQUEST_SUBMIT'],statement_timestamp()+interval '20 minutes',
      '90000000-0000-0000-0000-000000000001',$1)`, [reason])), /onboarding_sessions_access_reason_check/u);
  }

  for (const tokenByte of [0x16, 0x21, 0xfe]) {
    assert.deepEqual(await repositoryCall((repository) => repository.submitAccessRequest({
      statusTokenHash: hash32(tokenByte), requestId: "97300000-0000-4000-8000-000000000003",
    })), { outcome: "DENIED" });
    assert.deepEqual(await repositoryCall((repository) => repository.readAccessRequest({
      statusTokenHash: hash32(tokenByte), requestId: "97300000-0000-4000-8000-000000000004",
    })), { outcome: "DENIED" });
  }

  await asMigrationOwner((client) => client.query(`
    INSERT INTO uptech.workspaces(workspace_id,status,google_customer_id)
      VALUES ('97300000-0000-4000-8000-000000000010','ACTIVE','customer-access-b');
    INSERT INTO uptech.users(id) VALUES ('97300000-0000-4000-8000-000000000011');
    INSERT INTO uptech.identities(id,user_id,provider,issuer,provider_subject,email_claim,
      email_verified,hosted_domain_claim,claims_observed_at)
      VALUES ('97300000-0000-4000-8000-000000000012','97300000-0000-4000-8000-000000000011',
      'GOOGLE','https://accounts.google.com','access-b-sub','user@access-b.example',true,
      'access-b.example',statement_timestamp());
    INSERT INTO uptech.onboarding_sessions(id,identity_id,token_hash,allowed_operations,
      status,created_at,expires_at,revoked_at,resource_workspace_id,
      access_request_reason_class) VALUES
      ('97300000-0000-4000-8000-000000000013','97300000-0000-4000-8000-000000000012',
       decode(repeat('88',32),'hex'),ARRAY['ACCESS_REQUEST_READ','ACCESS_REQUEST_SUBMIT'],
       'ACTIVE',statement_timestamp(),statement_timestamp()+interval '20 minutes',NULL,
       '97300000-0000-4000-8000-000000000010','USER_NOT_PROVISIONED'),
      ('97300000-0000-4000-8000-000000000014','97300000-0000-4000-8000-000000000012',
       decode(repeat('89',32),'hex'),ARRAY['ACCESS_REQUEST_READ','ACCESS_REQUEST_SUBMIT'],
       'REVOKED',statement_timestamp(),statement_timestamp()+interval '20 minutes',statement_timestamp(),
       '97300000-0000-4000-8000-000000000010','USER_NOT_PROVISIONED'),
      ('97300000-0000-4000-8000-000000000015','97300000-0000-4000-8000-000000000012',
       decode(repeat('8a',32),'hex'),ARRAY['ACCESS_REQUEST_READ','ACCESS_REQUEST_SUBMIT'],
       'ACTIVE',statement_timestamp()-interval '21 minutes',statement_timestamp()-interval '1 minute',NULL,
       '97300000-0000-4000-8000-000000000010','USER_NOT_PROVISIONED')`));
  const tenantB = await repositoryCall((repository) => repository.submitAccessRequest({
    statusTokenHash: hash32(0x88), requestId: "97300000-0000-4000-8000-000000000016",
  }));
  assert.ok(tenantB.outcome === "PENDING" && tenantB.requestId !== receiptId);
  assert.deepEqual(await repositoryCall((repository) => repository.readAccessRequest({
    statusTokenHash: hash32(0x09), requestId: "97300000-0000-4000-8000-000000000017",
  })), { outcome: "FOUND", requestId: receiptId, status: "PENDING" });
  for (const tokenByte of [0x89, 0x8a]) {
    assert.deepEqual(await repositoryCall((repository) => repository.submitAccessRequest({
      statusTokenHash: hash32(tokenByte), requestId: "97300000-0000-4000-8000-000000000018",
    })), { outcome: "DENIED" });
    assert.deepEqual(await repositoryCall((repository) => repository.readAccessRequest({
      statusTokenHash: hash32(tokenByte), requestId: "97300000-0000-4000-8000-000000000019",
    })), { outcome: "DENIED" });
  }

  await asMigrationOwner((client) => client.query(`UPDATE uptech.workspace_access_requests
    SET status='FULFILLED',fulfilled_at=statement_timestamp() WHERE workspace_id=$1 AND id=$2`,
  ["90000000-0000-0000-0000-000000000001", receiptId]));
  assert.deepEqual(await repositoryCall((repository) => repository.readAccessRequest({
    statusTokenHash: hash32(0x09), requestId: "97300000-0000-4000-8000-000000000020",
  })), { outcome: "FOUND", requestId: receiptId, status: "FULFILLED" });

  const audits = await pool.query(`SELECT action,count(*)::int AS count,
      bool_and(request_id IS NOT NULL) AS correlated,
      bool_and(metadata ? 'reason_class') AS has_reason,
      bool_and(metadata::text !~* '(credential|token|hash|secret|authority|customer)') AS redacted
    FROM uptech.audit_events
    WHERE workspace_id='90000000-0000-0000-0000-000000000001'
      AND action IN ('WORKSPACE_ACCESS_REQUEST_SUBMITTED','WORKSPACE_ACCESS_REQUEST_DEDUPLICATED','WORKSPACE_ACCESS_REQUEST_READ')
    GROUP BY action ORDER BY action`);
  assert.deepEqual(audits.rows, [
    { action: "WORKSPACE_ACCESS_REQUEST_DEDUPLICATED", count: 4, correlated: true, has_reason: true, redacted: true },
    { action: "WORKSPACE_ACCESS_REQUEST_READ", count: 3, correlated: true, has_reason: true, redacted: true },
    { action: "WORKSPACE_ACCESS_REQUEST_SUBMITTED", count: 4, correlated: true, has_reason: true, redacted: true },
  ]);
});

test("access-request routines expose only closed results to API runtime", async () => {
  for (const signature of [
    "uptech.submit_workspace_access_request_v1(uptech.google_auth_hash32_v1,uuid)",
    "uptech.read_workspace_access_request_v1(uptech.google_auth_hash32_v1,uuid)",
  ]) {
    const row = (await pool.query(`SELECT p.prosecdef,p.provolatile,p.proconfig,
      has_function_privilege('uptech_api_runtime',p.oid,'EXECUTE') AS api_execute,
      has_function_privilege('uptech_worker_runtime',p.oid,'EXECUTE') AS worker_execute,
      has_function_privilege('public',p.oid,'EXECUTE') AS public_execute
      FROM pg_proc p WHERE p.oid=$1::regprocedure`, [signature])).rows[0];
    assert.deepEqual(row, { prosecdef: true, provolatile: "v",
      proconfig: ["search_path=pg_catalog, uptech"], api_execute: true,
      worker_execute: false, public_execute: false }, signature);
  }
  assert.deepEqual((await pool.query(`SELECT
    to_regtype('uptech.workspace_access_request_submit_result_v1') IS NOT NULL AS submit_result,
    to_regtype('uptech.workspace_access_request_read_result_v1') IS NOT NULL AS read_result`)).rows[0],
  { submit_result: true, read_result: true });
});

test("Directory mapping evaluator is generation-bound, converges member signals, and fails closed", async () => {
  const rows = await asMigrationOwner(async (client) => {
    await client.query(`
      INSERT INTO uptech.workspaces(workspace_id,status,provisioning_policy,google_customer_id) VALUES
        ('97400000-0000-4000-8000-000000000001','ACTIVE','GOOGLE_GROUP_CONTROLLED','mapping-customer-a'),
        ('97400000-0000-4000-8000-000000000002','ACTIVE','GOOGLE_GROUP_CONTROLLED','mapping-customer-b');
      INSERT INTO uptech.users(id) VALUES
        ('97400000-0000-4000-8000-000000000003'),
        ('97400000-0000-4000-8000-000000000005');
      INSERT INTO uptech.identities(id,user_id,provider,issuer,provider_subject,email_claim,email_verified,hosted_domain_claim,claims_observed_at)
        VALUES
        ('97400000-0000-4000-8000-000000000004','97400000-0000-4000-8000-000000000003','GOOGLE','https://accounts.google.com','mapping-authorizer','admin@mapping-a.example',true,'mapping-a.example',statement_timestamp()),
        ('97400000-0000-4000-8000-000000000006','97400000-0000-4000-8000-000000000005','GOOGLE','https://accounts.google.com','mapping-authorizer-b','admin@mapping-b.example',true,'mapping-b.example',statement_timestamp());
      INSERT INTO uptech.workspace_domain_locators(normalized_domain,workspace_id,status,verified_at,google_customer_id,domain_kind)
        VALUES
        ('mapping-a.example','97400000-0000-4000-8000-000000000001','VERIFIED',statement_timestamp(),'mapping-customer-a','PRIMARY'),
        ('mapping-b.example','97400000-0000-4000-8000-000000000002','VERIFIED',statement_timestamp(),'mapping-customer-b','PRIMARY');
      INSERT INTO uptech.connectors(workspace_id,id,purpose,status,provider_customer_id,credential_reference,directory_authorized_by_identity_id,directory_authorized_scopes) VALUES
        ('97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000010','DIRECTORY','ACTIVE','mapping-customer-a','secret://mapping-a','97400000-0000-4000-8000-000000000004',ARRAY[
          'https://www.googleapis.com/auth/admin.directory.customer.readonly','https://www.googleapis.com/auth/admin.directory.user.readonly',
          'https://www.googleapis.com/auth/admin.directory.group.readonly','https://www.googleapis.com/auth/admin.directory.orgunit.readonly']),
        ('97400000-0000-4000-8000-000000000002','97400000-0000-4000-8000-000000000040','DIRECTORY','ACTIVE','mapping-customer-b','secret://mapping-b','97400000-0000-4000-8000-000000000006',ARRAY[
          'https://www.googleapis.com/auth/admin.directory.customer.readonly','https://www.googleapis.com/auth/admin.directory.user.readonly',
          'https://www.googleapis.com/auth/admin.directory.group.readonly','https://www.googleapis.com/auth/admin.directory.orgunit.readonly']);
      INSERT INTO uptech.service_actors(workspace_id,id,actor_kind,status)
        VALUES
        ('97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000011','SYNC_WORKER','ACTIVE'),
        ('97400000-0000-4000-8000-000000000002','97400000-0000-4000-8000-000000000041','SYNC_WORKER','ACTIVE');
      INSERT INTO uptech.sync_jobs(workspace_id,id,service_actor_id,connector_id,job_kind,status,dedupe_key,completed_at)
        VALUES
        ('97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000012','97400000-0000-4000-8000-000000000011','97400000-0000-4000-8000-000000000010','DIRECTORY_SYNC','SUCCEEDED','mapping-evaluator-a',statement_timestamp()),
        ('97400000-0000-4000-8000-000000000002','97400000-0000-4000-8000-000000000042','97400000-0000-4000-8000-000000000041','97400000-0000-4000-8000-000000000040','DIRECTORY_SYNC','SUCCEEDED','mapping-evaluator-b',statement_timestamp());
      INSERT INTO uptech.people_sync_generations(workspace_id,id,connector_id,job_id,lease_fence,status,traversal_complete,started_at,completed_at,fresh_until,google_customer_id,primary_domain) VALUES
        ('97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000020','97400000-0000-4000-8000-000000000010','97400000-0000-4000-8000-000000000012','97400000-0000-4000-8000-000000000013','SUPERSEDED',true,statement_timestamp()-interval '3 minutes',statement_timestamp()-interval '2 minutes',statement_timestamp()+interval '4 minutes','mapping-customer-a','mapping-a.example'),
        ('97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000021','97400000-0000-4000-8000-000000000010','97400000-0000-4000-8000-000000000012','97400000-0000-4000-8000-000000000014','PUBLISHED',true,statement_timestamp()-interval '1 minute',statement_timestamp()-interval '30 seconds',statement_timestamp()+interval '4 minutes','mapping-customer-a','mapping-a.example'),
        ('97400000-0000-4000-8000-000000000002','97400000-0000-4000-8000-000000000043','97400000-0000-4000-8000-000000000040','97400000-0000-4000-8000-000000000042','97400000-0000-4000-8000-000000000044','PUBLISHED',true,statement_timestamp()-interval '1 minute',statement_timestamp()-interval '30 seconds',statement_timestamp()+interval '4 minutes','mapping-customer-b','mapping-b.example');
      INSERT INTO uptech.people_org_units(workspace_id,generation_id,google_org_unit_id,org_unit_path) VALUES
        ('97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000021','ou-sales','/Sales');
      INSERT INTO uptech.people_profiles(workspace_id,generation_id,google_subject,full_name,primary_email,department,lifecycle_state,org_unit_path) VALUES
        ('97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000020','prior-absent','Prior','prior@mapping-a.example',NULL,'ACTIVE',NULL),
        ('97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000020','admin-sub','Old Admin','old-admin@mapping-a.example',NULL,'ACTIVE',NULL),
        ('97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000021','admin-sub','Admin','admin2@mapping-a.example','other','ACTIVE','/Sales'),
        ('97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000021','member-sub','Member','member@mapping-a.example',' Engineering ','ACTIVE','/Sales'),
        ('97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000021','conflict-sub','Conflict','conflict@mapping-a.example','engineering','ACTIVE',NULL),
        ('97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000021','none-sub','None','none@mapping-a.example',NULL,'ACTIVE',NULL),
        ('97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000021','suspended-sub','Suspended','suspended@mapping-a.example','engineering','SUSPENDED',NULL),
        ('97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000021','deleted-sub','Deleted','deleted@mapping-a.example','engineering','DELETED',NULL),
        ('97400000-0000-4000-8000-000000000002','97400000-0000-4000-8000-000000000043','admin-sub','Tenant B Admin','admin@mapping-b.example',NULL,'ACTIVE',NULL);
      INSERT INTO uptech.people_groups(workspace_id,generation_id,google_group_id,group_name) VALUES
        ('97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000020','g-admin','Old Admins'),
        ('97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000021','g-admin','Admins'),
        ('97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000021','g-sales','Sales'),
        ('97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000021','g-hr','HR'),
        ('97400000-0000-4000-8000-000000000002','97400000-0000-4000-8000-000000000043','g-admin','Tenant B Admins');
      INSERT INTO uptech.people_group_memberships(workspace_id,generation_id,google_group_id,google_subject) VALUES
        ('97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000020','g-admin','admin-sub'),
        ('97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000021','g-admin','admin-sub'),
        ('97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000021','g-hr','admin-sub'),
        ('97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000021','g-sales','member-sub'),
        ('97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000021','g-hr','conflict-sub'),
        ('97400000-0000-4000-8000-000000000002','97400000-0000-4000-8000-000000000043','g-admin','admin-sub');
      INSERT INTO uptech.people_permission_mappings(workspace_id,id,source_kind,source_value,target_role,target_department_key,status) VALUES
        ('97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000030','ADMIN_GROUP','g-admin','ADMIN',NULL,'ACTIVE'),
        ('97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000031','GROUP','g-sales','MEMBER','SALES','ACTIVE'),
        ('97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000032','GROUP','g-hr','MEMBER','HR','ACTIVE'),
        ('97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000033','DEPARTMENT','engineering','MEMBER','SALES','ACTIVE'),
        ('97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000034','ORG_UNIT','ou-sales','MEMBER','SALES','ACTIVE');
      UPDATE uptech.people_profiles SET google_is_admin=true,google_is_delegated_admin=true
        WHERE workspace_id='97400000-0000-4000-8000-000000000001' AND google_subject='none-sub';
      UPDATE uptech.people_sync_generations SET status='PUBLISHED'
        WHERE workspace_id='97400000-0000-4000-8000-000000000001'
          AND id='97400000-0000-4000-8000-000000000021';
    `);
    const evaluated = (await client.query(`
      SELECT subject,(evaluation).outcome::text AS outcome,(evaluation).target_role,(evaluation).target_department_key
      FROM (VALUES ('admin-sub'),('member-sub'),('conflict-sub'),('none-sub'),('suspended-sub'),
        ('deleted-sub'),('prior-absent'),('never-sub')) AS subject_row(subject)
      CROSS JOIN LATERAL uptech.evaluate_google_directory_mapping_v1(
        '97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000021',subject_row.subject
      ) AS evaluation ORDER BY subject`)).rows;
    const unpublished = (await client.query(`SELECT (evaluation).*
      FROM uptech.evaluate_google_directory_mapping_v1(
        '97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000020','admin-sub'
      ) AS evaluation`)).rows[0];
    const crossTenant = (await client.query(`SELECT (evaluation).*
      FROM uptech.evaluate_google_directory_mapping_v1(
        '97400000-0000-4000-8000-000000000002','97400000-0000-4000-8000-000000000043','admin-sub'
      ) AS evaluation`)).rows[0];
    await client.query(`UPDATE uptech.people_sync_generations
      SET fresh_until=statement_timestamp()-interval '1 second'
      WHERE workspace_id='97400000-0000-4000-8000-000000000001'
        AND id='97400000-0000-4000-8000-000000000021'`);
    const stale = (await client.query(`SELECT (evaluation).*
      FROM uptech.evaluate_google_directory_mapping_v1(
        '97400000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000021','admin-sub'
      ) AS evaluation`)).rows[0];
    return { evaluated, unpublished, crossTenant, stale };
  });
  assert.deepEqual(rows.evaluated, [
    { subject: "admin-sub", outcome: "ADMIN", target_role: "ADMIN", target_department_key: null },
    { subject: "conflict-sub", outcome: "ACCESS_MAPPING_CONFLICT", target_role: null, target_department_key: null },
    { subject: "deleted-sub", outcome: "USER_REMOVED", target_role: null, target_department_key: null },
    { subject: "member-sub", outcome: "MEMBER", target_role: "MEMBER", target_department_key: "SALES" },
    { subject: "never-sub", outcome: "USER_NOT_PROVISIONED", target_role: null, target_department_key: null },
    { subject: "none-sub", outcome: "USER_NOT_PROVISIONED", target_role: null, target_department_key: null },
    { subject: "prior-absent", outcome: "USER_REMOVED", target_role: null, target_department_key: null },
    { subject: "suspended-sub", outcome: "USER_SUSPENDED", target_role: null, target_department_key: null },
  ]);
  assert.deepEqual(rows.crossTenant, {
    outcome: "USER_NOT_PROVISIONED", target_role: null, target_department_key: null,
  });
  assert.deepEqual(rows.unpublished, {
    outcome: "USER_NOT_PROVISIONED", target_role: null, target_department_key: null,
  });
  assert.deepEqual(rows.stale, {
    outcome: "USER_NOT_PROVISIONED", target_role: null, target_department_key: null,
  });
  const grants = (await pool.query(`SELECT
    has_function_privilege('public','uptech.evaluate_google_directory_mapping_v1(uuid,uuid,text)','EXECUTE') AS public_execute,
    has_function_privilege('uptech_api_runtime','uptech.evaluate_google_directory_mapping_v1(uuid,uuid,text)','EXECUTE') AS api_execute,
    has_function_privilege('uptech_worker_runtime','uptech.evaluate_google_directory_mapping_v1(uuid,uuid,text)','EXECUTE') AS worker_execute`)).rows[0];
  assert.deepEqual(grants, { public_execute: false, api_execute: false, worker_execute: false });
});

test("V2 web completion atomically admits a mapped known-tenant administrator", async () => {
  const environment = await ensureActiveGoogleEnvironment();
  await asMigrationOwner(async (client) => {
    await client.query(`UPDATE uptech.people_sync_generations
      SET fresh_until=statement_timestamp()+interval '5 minutes'
      WHERE id='97400000-0000-4000-8000-000000000021'`);
    await client.query(`INSERT INTO uptech.google_auth_configuration_registry(
      configuration_key,environment_name,purpose,google_client_id,google_audience,
      audience_configuration_key,callback_uri,scopes,allowed_azp_configuration_keys,
      web_pkce_kms_key_version,is_enabled
    ) VALUES ('GOOGLE_WEB_LOGIN_V1',$1,'WEB_LOGIN','known.apps.googleusercontent.com',
      'known.apps.googleusercontent.com','GOOGLE_WEB_LOGIN_V1','https://known.example/callback',
      ARRAY['openid','email','profile'],ARRAY['GOOGLE_WEB_LOGIN_V1'::uptech.google_auth_configuration_key_v1],
      'test-key-v1',true) ON CONFLICT (configuration_key) DO NOTHING`, [environment]);
    await client.query(`INSERT INTO uptech.oauth_transactions(
      id,environment_name,purpose,configuration_key,locator_hash,web_state_hash,web_nonce_hash,
      web_browser_binding_hash,web_pkce_envelope_version,web_pkce_algorithm,web_pkce_nonce,
      web_pkce_ciphertext,web_pkce_tag,web_pkce_kms_key_version,web_pkce_associated_data,status,
      completion_handle_hash,request_id,created_at,expires_at,consumed_at,completion_expires_at
    ) VALUES ('97400000-0000-4000-8000-000000000090',$1,'WEB_LOGIN','GOOGLE_WEB_LOGIN_V1',
      decode(repeat('90',32),'hex'),decode(repeat('90',32),'hex'),decode(repeat('92',32),'hex'),
      decode(repeat('93',32),'hex'),1,'AES-256-GCM',decode(repeat('94',12),'hex'),decode(repeat('95',40),'hex'),
      decode(repeat('96',16),'hex'),'test-key-v1',decode(repeat('97',32),'hex'),'EXCHANGE_RESERVED',
      decode(repeat('98',32),'hex'),'97400000-0000-4000-8000-000000000090',statement_timestamp()-interval '1 minute',
      statement_timestamp()+interval '9 minutes',statement_timestamp()-interval '1 second',statement_timestamp()+interval '119 seconds')`, [environment]);
  });
  const row = (await asApi((client) => client.query(`SELECT outcome::text,route::text
    FROM uptech.complete_web_google_login_directory_v2(
      decode(repeat('98',32),'hex'),ROW('accounts.google.com','admin-sub','admin@mapping-a.example',true,
      'mapping-a.example',statement_timestamp()-interval '5 seconds',statement_timestamp()+interval '1 hour',
      'GOOGLE_WEB_LOGIN_V1',NULL,decode(repeat('92',32),'hex'))::uptech.google_verified_claims_assertion_v1,
      decode(repeat('99',32),'hex'),decode(repeat('9a',32),'hex'),decode(repeat('9b',32),'hex'),
      '97400000-0000-4000-8000-000000000090')`))).rows[0];
  assert.deepEqual(row, { outcome: "NORMAL", route: "/admin" });
  assert.deepEqual((await pool.query(`SELECT m.role,m.status,count(s.id)::int AS sessions
    FROM uptech.identities i JOIN uptech.workspace_memberships m ON m.user_id=i.user_id
    LEFT JOIN uptech.sessions s ON s.workspace_id=m.workspace_id AND s.membership_id=m.id
    WHERE i.provider_subject='admin-sub' AND m.workspace_id='97400000-0000-4000-8000-000000000001'
    GROUP BY m.role,m.status`)).rows[0], { role: "ADMIN", status: "ACTIVE", sessions: 1 });
});

test("V2 completion preserves controlled and invite-only authority with atomic credentials", async () => {
  const workspaceId = "97400000-0000-4000-8000-000000000001";
  const generationId = "97400000-0000-4000-8000-000000000021";
  const environment = await ensureActiveGoogleEnvironment();
  const token = (label: string) => {
    const value = Buffer.alloc(32);
    value.write(label);
    return value;
  };
  const reserve = (suffix: string, label: string, subject: string) =>
    asMigrationOwner((client) => client.query(`INSERT INTO uptech.oauth_transactions(
      id,environment_name,purpose,configuration_key,locator_hash,web_state_hash,web_nonce_hash,
      web_browser_binding_hash,web_pkce_envelope_version,web_pkce_algorithm,web_pkce_nonce,
      web_pkce_ciphertext,web_pkce_tag,web_pkce_kms_key_version,web_pkce_associated_data,status,
      completion_handle_hash,request_id,created_at,expires_at,consumed_at,completion_expires_at
    ) VALUES ($1,$2,'WEB_LOGIN','GOOGLE_WEB_LOGIN_V1',$3,$3,$4,$5,1,'AES-256-GCM',
      decode(repeat('41',12),'hex'),decode(repeat('42',40),'hex'),decode(repeat('43',16),'hex'),
      'test-key-v1',decode(repeat('44',32),'hex'),'EXCHANGE_RESERVED',$6,$1,
      statement_timestamp()-interval '1 minute',statement_timestamp()+interval '9 minutes',
      statement_timestamp()-interval '1 second',statement_timestamp()+interval '119 seconds')`, [
      `97500000-0000-4000-8000-0000000000${suffix}`, environment, token(`${label}-locator`),
      token(`${label}-nonce`), token(`${label}-browser`), token(`${label}-handle`),
    ]).then(() => ({
      id: `97500000-0000-4000-8000-0000000000${suffix}`,
      handle: token(`${label}-handle`), nonce: token(`${label}-nonce`), subject,
    })));
  const complete = (fixture: Awaited<ReturnType<typeof reserve>>, label: string,
    session = token(`${label}-session`), csrf = token(`${label}-csrf`),
    onboarding = token(`${label}-onboarding`), hostedDomain = "mapping-a.example") =>
    asApi((client) => client.query(`SELECT outcome::text,access_state::text,route::text
      FROM uptech.complete_web_google_login_directory_v2(
        $1,ROW('accounts.google.com',$2,$3,true,$9,
          statement_timestamp()-interval '5 seconds',statement_timestamp()+interval '1 hour',
          'GOOGLE_WEB_LOGIN_V1',NULL,$4)::uptech.google_verified_claims_assertion_v1,
        $5,$6,$7,$8)`, [fixture.handle, fixture.subject, `${fixture.subject}@${hostedDomain}`,
      fixture.nonce, session, csrf, onboarding, fixture.id, hostedDomain]));
  const permissionContext = async (subject: string) => {
    const authority = (await pool.query(`SELECT m.id AS membership_id,m.user_id,s.id AS session_id
      FROM uptech.identities i JOIN uptech.workspace_memberships m ON m.user_id=i.user_id
      JOIN uptech.sessions s ON s.workspace_id=m.workspace_id AND s.membership_id=m.id
      WHERE m.workspace_id=$1 AND i.provider_subject=$2 AND s.status='ACTIVE'
      ORDER BY s.created_at DESC LIMIT 1`, [workspaceId, subject])).rows[0];
    return (await asApi(async (client) => {
      await client.query(`SELECT set_config('app.workspace_id',$1,true),
        set_config('app.membership_id',$2,true),set_config('app.actor_id',$3,true),
        set_config('app.session_id',$4,true)`, [workspaceId, authority.membership_id,
        authority.user_id, authority.session_id]);
      return client.query(`SELECT workspace_id,membership_role,department_key,direct_group_ids
        FROM uptech.load_people_permission_context_v1()`);
    })).rows;
  };

  await asMigrationOwner(async (client) => {
    await client.query(`UPDATE uptech.people_sync_generations
      SET fresh_until=statement_timestamp()+interval '5 minutes'
      WHERE workspace_id=$1 AND id=$2`, [workspaceId, generationId]);
    await client.query(`INSERT INTO uptech.users(id) VALUES
      ('97500000-0000-4000-8000-000000000101'),('97500000-0000-4000-8000-000000000102')`);
    await client.query(`INSERT INTO uptech.identities(id,user_id,provider,issuer,provider_subject,status,email_claim,
      email_verified,hosted_domain_claim,claims_observed_at) VALUES
      ('97500000-0000-4000-8000-000000000111','97500000-0000-4000-8000-000000000101',
       'GOOGLE','https://accounts.google.com','member-sub','ACTIVE','member@mapping-a.example',true,
       'mapping-a.example',statement_timestamp()),
      ('97500000-0000-4000-8000-000000000112','97500000-0000-4000-8000-000000000102',
       'GOOGLE','https://accounts.google.com','none-sub','ACTIVE','owner@mapping-a.example',true,
       'mapping-a.example',statement_timestamp())`);
    await client.query(`INSERT INTO uptech.workspace_memberships(
      workspace_id,id,user_id,role,status,authz_version) VALUES
      ($1,'97500000-0000-4000-8000-000000000121','97500000-0000-4000-8000-000000000101',
       'MEMBER','DEPROVISIONED',7),
      ($1,'97500000-0000-4000-8000-000000000122','97500000-0000-4000-8000-000000000102',
       'OWNER','ACTIVE',3)`, [workspaceId]);
    await client.query(`INSERT INTO uptech.people_profiles(workspace_id,generation_id,google_subject,full_name,
      primary_email,department,lifecycle_state,org_unit_path) VALUES
      ($1,$2,'rollback-sub','Rollback','rollback@mapping-a.example','engineering','ACTIVE','/Sales'),
      ($1,$2,'org-only-sub','Org Only','org-only@mapping-a.example',NULL,'ACTIVE','/Sales')`,
    [workspaceId, generationId]);
    await client.query(`INSERT INTO uptech.people_group_memberships(
      workspace_id,generation_id,google_group_id,google_subject)
      VALUES ($1,$2,'g-sales','rollback-sub')`, [workspaceId, generationId]);
    await client.query(`UPDATE uptech.people_sync_generations SET status='PUBLISHED'
      WHERE workspace_id=$1 AND id=$2`, [workspaceId, generationId]);
  });

  const member = await reserve("91", "mapped-member", "member-sub");
  assert.deepEqual((await complete(member, "mapped-member")).rows[0], {
    outcome: "NORMAL", access_state: null, route: "/home",
  });
  const owner = await reserve("92", "existing-owner", "none-sub");
  assert.deepEqual((await complete(owner, "existing-owner")).rows[0], {
    outcome: "NORMAL", access_state: null, route: "/admin",
  });
  const orgOnly = await reserve("97", "org-only", "org-only-sub");
  assert.deepEqual((await complete(orgOnly, "org-only")).rows[0], {
    outcome: "NORMAL", access_state: null, route: "/home",
  });
  assert.deepEqual(await permissionContext("member-sub"), [{
    workspace_id: workspaceId, membership_role: "MEMBER", department_key: "SALES",
    direct_group_ids: ["g-sales"],
  }]);
  assert.deepEqual(await permissionContext("org-only-sub"), [{
    workspace_id: workspaceId, membership_role: "MEMBER", department_key: "SALES",
    direct_group_ids: [],
  }]);
  assert.deepEqual(await permissionContext("none-sub"), [{
    workspace_id: workspaceId, membership_role: "OWNER", department_key: null,
    direct_group_ids: [],
  }]);

  await asMigrationOwner((client) => client.query(`UPDATE uptech.connectors SET status='REVOKED'
    WHERE workspace_id=$1 AND id='97400000-0000-4000-8000-000000000010'`, [workspaceId]));
  const disabledOwner = await reserve("98", "disabled-owner", "none-sub");
  assert.deepEqual((await complete(disabledOwner, "disabled-owner")).rows[0], {
    outcome: "DENIED", access_state: "DIRECTORY_STALE", route: null,
  });
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM uptech.onboarding_sessions
    WHERE token_hash=$1`, [token("disabled-owner-onboarding")])).rows[0].count, 0);
  await asMigrationOwner((client) => client.query(`UPDATE uptech.connectors SET status='ACTIVE'
    WHERE workspace_id=$1 AND id='97400000-0000-4000-8000-000000000010'`, [workspaceId]));
  await asMigrationOwner((client) => client.query(`UPDATE uptech.identities
    SET hosted_domain_claim='mapping-b.example'
    WHERE id='97400000-0000-4000-8000-000000000004'`));
  const mismatchedOwner = await reserve("9b", "mismatched-owner", "none-sub");
  assert.deepEqual((await complete(mismatchedOwner, "mismatched-owner")).rows[0], {
    outcome: "DENIED", access_state: "DIRECTORY_STALE", route: null,
  });
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM uptech.onboarding_sessions
    WHERE token_hash=$1`, [token("mismatched-owner-onboarding")])).rows[0].count, 0);
  await asMigrationOwner((client) => client.query(`UPDATE uptech.identities
    SET hosted_domain_claim='mapping-a.example'
    WHERE id='97400000-0000-4000-8000-000000000004'`));
  assert.deepEqual((await pool.query(`SELECT request_id,metadata
    FROM uptech.platform_audit_events WHERE action='GOOGLE_AUTH_LOGIN_DENIED'
      AND request_id IN ($1,$2) ORDER BY request_id`, [disabledOwner.id, mismatchedOwner.id])).rows, [
    { request_id: disabledOwner.id, metadata: {
      access_state: "DIRECTORY_STALE", reason_class: "DIRECTORY_AUTHORITY_UNAVAILABLE",
    } },
    { request_id: mismatchedOwner.id, metadata: {
      access_state: "DIRECTORY_STALE", reason_class: "DIRECTORY_AUTHORITY_UNAVAILABLE",
    } },
  ]);
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM uptech.audit_events
    WHERE action='GOOGLE_AUTH_LOGIN_DENIED' AND actor_kind='SYSTEM'
      AND request_id IN ($1,$2)`, [disabledOwner.id, mismatchedOwner.id])).rows[0].count, 2);

  await asMigrationOwner((client) => client.query(`INSERT INTO uptech.people_group_memberships(
    workspace_id,generation_id,google_group_id,google_subject) VALUES ($1,$2,'g-admin','member-sub')`,
  [workspaceId, generationId]));
  await asMigrationOwner((client) => client.query(`UPDATE uptech.people_sync_generations
    SET status='PUBLISHED' WHERE workspace_id=$1 AND id=$2`, [workspaceId, generationId]));
  const promoted = await reserve("99", "promoted-member", "member-sub");
  assert.equal((await complete(promoted, "promoted-member")).rows[0].route, "/admin");
  await asMigrationOwner((client) => client.query(`DELETE FROM uptech.people_group_memberships
    WHERE workspace_id=$1 AND generation_id=$2 AND google_group_id='g-admin'
      AND google_subject='member-sub'`, [workspaceId, generationId]));
  await asMigrationOwner((client) => client.query(`UPDATE uptech.people_sync_generations
    SET status='PUBLISHED' WHERE workspace_id=$1 AND id=$2`, [workspaceId, generationId]));
  const demoted = await reserve("9a", "demoted-admin", "member-sub");
  assert.equal((await complete(demoted, "demoted-admin")).rows[0].route, "/home");
  assert.deepEqual((await pool.query(`SELECT metadata FROM uptech.audit_events
    WHERE request_id IN ($1,$2) AND action='MEMBERSHIP_AUTHORITY_CHANGED' ORDER BY occurred_at`,
  [promoted.id, demoted.id])).rows, [
    { metadata: { old_role: "MEMBER", new_role: "ADMIN" } },
    { metadata: { old_role: "ADMIN", new_role: "MEMBER" } },
  ]);
  assert.deepEqual((await pool.query(`SELECT role,status,authz_version::int
    FROM uptech.workspace_memberships WHERE workspace_id=$1 AND id IN(
      '97500000-0000-4000-8000-000000000121','97500000-0000-4000-8000-000000000122')
    ORDER BY id`, [workspaceId])).rows, [
    { role: "MEMBER", status: "ACTIVE", authz_version: 10 },
    { role: "OWNER", status: "ACTIVE", authz_version: 3 },
  ]);
  assert.deepEqual((await pool.query(`SELECT action,count(*)::int AS count
    FROM uptech.audit_events WHERE request_id IN ($1,$2) GROUP BY action ORDER BY action`,
  [member.id, owner.id])).rows, [
    { action: "GOOGLE_AUTH_LOGIN_SUCCEEDED", count: 2 },
    { action: "MEMBERSHIP_AUTO_PROVISIONED", count: 1 },
  ]);
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM uptech.platform_audit_events
    WHERE request_id IN ($1,$2) AND action='GOOGLE_AUTH_LOGIN_SUCCEEDED'`,
  [member.id, owner.id])).rows[0].count, 2);

  const normalCrossColumnCollision = await reserve("9c", "normal-cross-column", "rollback-sub");
  assert.deepEqual((await complete(normalCrossColumnCollision, "normal-cross-column",
    token("mapped-member-csrf"))).rows[0], {
    outcome: "DENIED", access_state: null, route: null,
  });
  const unknownCrossColumnCollision = await reserve("9d", "unknown-cross-column", "unknown-collision-sub");
  assert.deepEqual((await complete(unknownCrossColumnCollision, "unknown-cross-column",
    undefined, undefined, token("mapped-member-csrf"), "unknown-collision.example")).rows[0], {
    outcome: "DENIED", access_state: null, route: null,
  });
  assert.deepEqual((await pool.query(`SELECT
    (SELECT count(*)::int FROM uptech.identities
      WHERE provider_subject='unknown-collision-sub') AS identities,
    (SELECT count(*)::int FROM uptech.onboarding_sessions o JOIN uptech.identities i
      ON i.id=o.identity_id WHERE i.provider_subject='unknown-collision-sub') AS capabilities`)).rows[0], {
    identities: 0, capabilities: 0,
  });

  const rollback = await reserve("93", "collision-rollback", "rollback-sub");
  assert.deepEqual((await complete(rollback, "collision-rollback",
    token("mapped-member-session"))).rows[0], {
    outcome: "DENIED", access_state: null, route: null,
  });
  assert.deepEqual((await pool.query(`SELECT
    (SELECT status FROM uptech.oauth_transactions WHERE id=$1) AS transaction_status,
    (SELECT count(*)::int FROM uptech.identities WHERE provider_subject='rollback-sub') AS identities,
    (SELECT count(*)::int FROM uptech.workspace_memberships m JOIN uptech.identities i
      ON i.user_id=m.user_id WHERE i.provider_subject='rollback-sub') AS memberships,
    (SELECT count(*)::int FROM uptech.sessions s JOIN uptech.identities i
      ON i.id=s.identity_id WHERE i.provider_subject='rollback-sub') AS sessions,
    (SELECT count(*)::int FROM uptech.onboarding_sessions o JOIN uptech.identities i
      ON i.id=o.identity_id WHERE i.provider_subject='rollback-sub') AS capabilities,
    (SELECT count(*)::int FROM uptech.platform_audit_events WHERE request_id=$1) AS platform_audits,
    (SELECT count(*)::int FROM uptech.audit_events WHERE request_id=$1) AS workspace_audits`,
  [rollback.id])).rows[0], {
    transaction_status: "EXCHANGE_RESERVED", identities: 1, memberships: 0, sessions: 0,
    capabilities: 0, platform_audits: 1, workspace_audits: 1,
  });
  assert.deepEqual((await pool.query(`SELECT metadata FROM uptech.platform_audit_events
    WHERE request_id=$1 AND action='GOOGLE_AUTH_LOGIN_DENIED'`, [rollback.id])).rows[0].metadata,
  { access_state: "INTERNAL_ERROR", reason_class: "AUTHORITY_COMMIT_FAILED" });
  assert.deepEqual((await complete(member, "mapped-member-replay")).rows[0], {
    outcome: "DENIED", access_state: null, route: null,
  });

  await asMigrationOwner((client) => client.query(`UPDATE uptech.workspaces
    SET provisioning_policy='INVITE_ONLY' WHERE workspace_id=$1`, [workspaceId]));
  const inviteCases = [
    { suffix: "94", label: "invite-admin", subject: "admin-sub", route: "/admin" },
    { suffix: "95", label: "invite-member", subject: "member-sub", route: "/home" },
    { suffix: "96", label: "invite-owner", subject: "none-sub", route: "/admin" },
  ] as const;
  for (const inviteCase of inviteCases) {
    const fixture = await reserve(inviteCase.suffix, inviteCase.label, inviteCase.subject);
    assert.deepEqual((await complete(fixture, inviteCase.label)).rows[0], {
      outcome: "NORMAL", access_state: null, route: inviteCase.route,
    });
  }
  assert.deepEqual((await pool.query(`SELECT i.provider_subject,m.role,
      count(DISTINCT s.id)::int AS sessions,count(t.id)::int AS tokens
    FROM uptech.identities i JOIN uptech.workspace_memberships m ON m.user_id=i.user_id
    JOIN uptech.sessions s ON s.workspace_id=m.workspace_id AND s.membership_id=m.id
    JOIN uptech.session_tokens t ON t.workspace_id=s.workspace_id AND t.session_id=s.id
    WHERE m.workspace_id=$1 AND i.provider_subject IN ('admin-sub','member-sub','none-sub')
    GROUP BY i.provider_subject,m.role ORDER BY i.provider_subject`, [workspaceId])).rows, [
    { provider_subject: "admin-sub", role: "ADMIN", sessions: 2, tokens: 2 },
    { provider_subject: "member-sub", role: "MEMBER", sessions: 4, tokens: 4 },
    { provider_subject: "none-sub", role: "OWNER", sessions: 2, tokens: 2 },
  ]);
  assert.deepEqual(await permissionContext("admin-sub"), [{
    workspace_id: workspaceId, membership_role: "ADMIN", department_key: null,
    direct_group_ids: [],
  }]);
  assert.deepEqual(await permissionContext("member-sub"), [{
    workspace_id: workspaceId, membership_role: "MEMBER", department_key: null,
    direct_group_ids: [],
  }]);
  assert.deepEqual(await permissionContext("none-sub"), [{
    workspace_id: workspaceId, membership_role: "OWNER", department_key: null,
    direct_group_ids: [],
  }]);
});

test("V2 controlled denials commit only workspace-bound access-request capability", async () => {
  const workspaceId = "97400000-0000-4000-8000-000000000001";
  const generationId = "97400000-0000-4000-8000-000000000021";
  const environment = await ensureActiveGoogleEnvironment();
  let sequence = 1;
  const token = (label: string) => {
    const value = Buffer.alloc(32);
    value.write(`7b2b-${label}`);
    return value;
  };
  const complete = async (subject: string, label: string,
    onboarding = token(`${label}-onb`), hostedDomain = "mapping-a.example") => {
    const suffix = String(sequence++).padStart(12, "0");
    const id = `97600000-0000-4000-8000-${suffix}`;
    const handle = token(`${label}-handle`);
    const nonce = token(`${label}-nonce`);
    await asMigrationOwner((client) => client.query(`INSERT INTO uptech.oauth_transactions(
      id,environment_name,purpose,configuration_key,locator_hash,web_state_hash,web_nonce_hash,
      web_browser_binding_hash,web_pkce_envelope_version,web_pkce_algorithm,web_pkce_nonce,
      web_pkce_ciphertext,web_pkce_tag,web_pkce_kms_key_version,web_pkce_associated_data,status,
      completion_handle_hash,request_id,created_at,expires_at,consumed_at,completion_expires_at
    ) VALUES ($1,$2,'WEB_LOGIN','GOOGLE_WEB_LOGIN_V1',$3,$3,$4,$5,1,'AES-256-GCM',
      decode(repeat('51',12),'hex'),decode(repeat('52',40),'hex'),decode(repeat('53',16),'hex'),
      'test-key-v1',decode(repeat('54',32),'hex'),'EXCHANGE_RESERVED',$6,$1,
      statement_timestamp()-interval '1 minute',statement_timestamp()+interval '9 minutes',
      statement_timestamp()-interval '1 second',statement_timestamp()+interval '119 seconds')`,
    [id, environment, token(`${label}-locator`), nonce, token(`${label}-browser`), handle]));
    const row = (await asApi((client) => client.query(`SELECT outcome::text,access_state::text,
        allowed_operations,expires_at,route::text
      FROM uptech.complete_web_google_login_directory_v2(
        $1,ROW('accounts.google.com',$2,$3,true,$9,
          statement_timestamp()-interval '5 seconds',statement_timestamp()+interval '1 hour',
          'GOOGLE_WEB_LOGIN_V1',NULL,$4)::uptech.google_verified_claims_assertion_v1,
        $5,$6,$7,$8)`, [handle, subject, `${subject}@mapping-a.example`, nonce,
      token(`${label}-session`), token(`${label}-csrf`), onboarding, id, hostedDomain]))).rows[0];
    return { id, onboarding, row };
  };

  await asMigrationOwner(async (client) => {
    await client.query(`INSERT INTO uptech.google_auth_configuration_registry(
      configuration_key,environment_name,purpose,google_client_id,google_audience,
      audience_configuration_key,callback_uri,scopes,allowed_azp_configuration_keys,
      web_pkce_kms_key_version,is_enabled
    ) VALUES ('GOOGLE_WEB_LOGIN_V1',$1,'WEB_LOGIN','known.apps.googleusercontent.com',
      'known.apps.googleusercontent.com','GOOGLE_WEB_LOGIN_V1','https://known.example/callback',
      ARRAY['openid','email','profile'],ARRAY['GOOGLE_WEB_LOGIN_V1'::uptech.google_auth_configuration_key_v1],
      'test-key-v1',true) ON CONFLICT (configuration_key) DO NOTHING`, [environment]);
    await client.query(`UPDATE uptech.workspaces SET provisioning_policy='GOOGLE_GROUP_CONTROLLED'
      WHERE workspace_id=$1`, [workspaceId]);
    await client.query(`UPDATE uptech.people_sync_generations
      SET fresh_until=statement_timestamp()+interval '5 minutes'
      WHERE workspace_id=$1 AND id=$2`, [workspaceId, generationId]);
  });

  for (const [subject, state] of [
    ["conflict-sub", "ACCESS_MAPPING_CONFLICT"],
    ["never-denial-sub", "USER_NOT_PROVISIONED"],
  ] as const) {
    const result = await complete(subject, subject);
    assert.equal(result.row.outcome, "ONBOARDING");
    assert.equal(result.row.access_state, state);
    assert.deepEqual(result.row.allowed_operations, ["ACCESS_REQUEST_READ", "ACCESS_REQUEST_SUBMIT"]);
    assert.equal(result.row.route, null);
    assert.ok(new Date(result.row.expires_at).getTime() > Date.now());
    const capability = (await pool.query(`SELECT resource_workspace_id,access_request_reason_class,
        status,extract(epoch FROM expires_at-created_at)::int AS lifetime_seconds
      FROM uptech.onboarding_sessions WHERE token_hash=$1`, [result.onboarding])).rows[0];
    assert.equal(capability.resource_workspace_id, workspaceId);
    assert.equal(capability.access_request_reason_class, state);
    assert.equal(capability.status, "ACTIVE");
    assert.equal(capability.lifetime_seconds, 30 * 60);
    assert.deepEqual((await asApi((client) => client.query(`SELECT outcome::text,status::text
      FROM uptech.submit_workspace_access_request_v1($1,$2)`, [result.onboarding, crypto.randomUUID()])))
      .rows[0], { outcome: "PENDING", status: "PENDING" });
    assert.deepEqual((await asApi((client) => client.query(`SELECT outcome::text,status::text
      FROM uptech.read_workspace_access_request_v1($1,$2)`, [result.onboarding, crypto.randomUUID()])))
      .rows[0], { outcome: "FOUND", status: "PENDING" });
  }

  for (const [subject, state] of [
    ["suspended-sub", "USER_SUSPENDED"],
    ["deleted-sub", "USER_REMOVED"],
    ["prior-absent", "USER_REMOVED"],
  ] as const) {
    const result = await complete(subject, `base-${subject}`);
    assert.deepEqual(result.row, { outcome: "DENIED", access_state: state,
      allowed_operations: null, expires_at: null, route: null });
  }

  await asMigrationOwner((client) => client.query(`UPDATE uptech.people_sync_generations
    SET fresh_until=statement_timestamp()-interval '1 second' WHERE workspace_id=$1 AND id=$2`,
  [workspaceId, generationId]));
  const staleOwner = await complete("none-sub", "stale-owner");
  assert.equal(staleOwner.row.outcome, "DENIED");
  assert.equal(staleOwner.row.access_state, "DIRECTORY_STALE");
  const staleAdmin = await complete("admin-sub", "stale-admin");
  assert.equal(staleAdmin.row.outcome, "DENIED");
  assert.equal(staleAdmin.row.access_state, "DIRECTORY_STALE");
  const staleEmployee = await complete("stale-new-sub", "stale-employee");
  assert.equal(staleEmployee.row.outcome, "ONBOARDING");
  assert.equal(staleEmployee.row.access_state, "DIRECTORY_STALE_ACCESS_REQUEST_AVAILABLE");
  assert.equal((await pool.query(`SELECT access_request_reason_class FROM uptech.onboarding_sessions
    WHERE token_hash=$1`, [staleEmployee.onboarding])).rows[0].access_request_reason_class,
  "DIRECTORY_STALE");

  const staleCollision = await complete("stale-collision-sub", "stale-collision",
    token("stale-collision-session"));
  assert.deepEqual(staleCollision.row, { outcome: "DENIED", access_state: "DIRECTORY_STALE",
    allowed_operations: null, expires_at: null, route: null });
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM uptech.onboarding_sessions
    WHERE token_hash=$1`, [staleCollision.onboarding])).rows[0].count, 0);

  await asMigrationOwner((client) => client.query(`UPDATE uptech.people_sync_generations
    SET status='SUPERSEDED',fresh_until=statement_timestamp()+interval '5 minutes'
    WHERE workspace_id=$1 AND id=$2`, [workspaceId, generationId]));
  const pending = await complete("pending-sub", "pending");
  assert.deepEqual(pending.row, { outcome: "DENIED", access_state: "DIRECTORY_SYNC_PENDING",
    allowed_operations: null, expires_at: null, route: null });
  await asMigrationOwner((client) => client.query(`UPDATE uptech.people_sync_generations
    SET status='PUBLISHED',fresh_until=statement_timestamp()+interval '5 minutes'
    WHERE workspace_id=$1 AND id=$2`, [workspaceId, generationId]));

  const replacement = await complete("never-denial-sub", "never-replacement");
  assert.equal(replacement.row.outcome, "ONBOARDING");
  assert.deepEqual((await pool.query(`SELECT capability.status,count(*)::int AS count
    FROM uptech.onboarding_sessions capability JOIN uptech.identities identity_row
      ON identity_row.id=capability.identity_id
    WHERE identity_row.provider_subject='never-denial-sub'
      AND capability.allowed_operations @> ARRAY['ACCESS_REQUEST_READ','ACCESS_REQUEST_SUBMIT']::text[]
    GROUP BY capability.status ORDER BY capability.status`)).rows, [
    { status: "ACTIVE", count: 1 }, { status: "REVOKED", count: 1 },
  ]);

  const conflictCollision = await complete("conflict-sub", "conflict-collision",
    token("conflict-collision-session"));
  assert.deepEqual(conflictCollision.row, { outcome: "DENIED", access_state: null,
    allowed_operations: null, expires_at: null, route: null });

  await asMigrationOwner((client) => client.query(`UPDATE uptech.workspaces SET status='SUSPENDED'
    WHERE workspace_id=$1`, [workspaceId]));
  const workspaceSuspended = await complete("workspace-suspended-sub", "workspace-suspended");
  assert.deepEqual(workspaceSuspended.row, { outcome: "DENIED", access_state: "WORKSPACE_SUSPENDED",
    allowed_operations: null, expires_at: null, route: null });
  await asMigrationOwner((client) => client.query(`UPDATE uptech.workspaces SET status='ACTIVE'
    WHERE workspace_id=$1`, [workspaceId]));

  await asMigrationOwner(async (client) => {
    await client.query(`INSERT INTO uptech.users(id,status) VALUES
      ('97600000-0000-4000-8000-000000000101','SUSPENDED')`);
    await client.query(`INSERT INTO uptech.identities(id,user_id,provider,issuer,provider_subject,status,
      email_claim,email_verified,hosted_domain_claim,claims_observed_at) VALUES
      ('97600000-0000-4000-8000-000000000102','97600000-0000-4000-8000-000000000101',
       'GOOGLE','https://accounts.google.com','ineligible-sub','ACTIVE','ineligible@mapping-a.example',
       true,'mapping-a.example',statement_timestamp())`);
  });
  const ineligible = await complete("ineligible-sub", "ineligible");
  assert.deepEqual(ineligible.row, { outcome: "DENIED", access_state: "USER_REMOVED",
    allowed_operations: null, expires_at: null, route: null });

  await asMigrationOwner(async (client) => {
    await client.query(`INSERT INTO uptech.users(id) VALUES
      ('97600000-0000-4000-8000-000000000111')`);
    await client.query(`INSERT INTO uptech.identities(id,user_id,provider,issuer,provider_subject,status,
      email_claim,email_verified,hosted_domain_claim,claims_observed_at) VALUES
      ('97600000-0000-4000-8000-000000000112','97600000-0000-4000-8000-000000000111',
       'GOOGLE','https://accounts.google.com','absent-owner-sub','ACTIVE','owner@mapping-a.example',
       true,'mapping-a.example',statement_timestamp())`);
    await client.query(`INSERT INTO uptech.workspace_memberships(workspace_id,id,user_id,role,status)
      VALUES ($1,'97600000-0000-4000-8000-000000000113',
        '97600000-0000-4000-8000-000000000111','OWNER','ACTIVE')`, [workspaceId]);
  });
  const absentOwner = await complete("absent-owner-sub", "absent-owner");
  assert.equal(absentOwner.row.outcome, "ONBOARDING");
  assert.equal(absentOwner.row.access_state, "USER_NOT_PROVISIONED");
  assert.deepEqual(absentOwner.row.allowed_operations,
    ["ACCESS_REQUEST_READ", "ACCESS_REQUEST_SUBMIT"]);
  assert.deepEqual((await pool.query(`SELECT m.role,m.status,count(s.id)::int AS sessions
    FROM uptech.workspace_memberships m LEFT JOIN uptech.sessions s
      ON s.workspace_id=m.workspace_id AND s.membership_id=m.id
    WHERE m.workspace_id=$1 AND m.id='97600000-0000-4000-8000-000000000113'
    GROUP BY m.role,m.status`, [workspaceId])).rows[0],
  { role: "OWNER", status: "ACTIVE", sessions: 0 });
  assert.deepEqual((await pool.query(`SELECT resource_workspace_id,access_request_reason_class,
      allowed_operations
    FROM uptech.onboarding_sessions WHERE token_hash=$1`, [absentOwner.onboarding])).rows[0], {
    resource_workspace_id: workspaceId,
    access_request_reason_class: "USER_NOT_PROVISIONED",
    allowed_operations: ["ACCESS_REQUEST_READ", "ACCESS_REQUEST_SUBMIT"],
  });

  const memberSessionsBefore = (await pool.query(`SELECT count(*)::int AS count
    FROM uptech.sessions s JOIN uptech.identities i ON i.id=s.identity_id
    WHERE i.provider_subject='member-sub'`)).rows[0].count;
  await asMigrationOwner((client) => client.query(`UPDATE uptech.workspace_memberships
    SET status='SUSPENDED' WHERE workspace_id=$1
      AND id='97500000-0000-4000-8000-000000000121'`, [workspaceId]));
  const suspendedMembership = await complete("member-sub", "suspended-membership");
  assert.deepEqual(suspendedMembership.row, { outcome: "DENIED", access_state: "USER_SUSPENDED",
    allowed_operations: null, expires_at: null, route: null });
  assert.equal((await pool.query(`SELECT count(*)::int AS count
    FROM uptech.sessions s JOIN uptech.identities i ON i.id=s.identity_id
    WHERE i.provider_subject='member-sub'`)).rows[0].count, memberSessionsBefore);
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM uptech.audit_events
    WHERE request_id=$1 AND action='GOOGLE_AUTH_LOGIN_DENIED' AND actor_kind='SYSTEM'`,
  [suspendedMembership.id])).rows[0].count, 1);

  const tenantB = await complete("admin-sub", "tenant-b", token("tenant-b-onb"),
    "mapping-b.example");
  assert.equal(tenantB.row.outcome, "ONBOARDING");
  assert.equal(tenantB.row.access_state, "USER_NOT_PROVISIONED");
  assert.equal((await pool.query(`SELECT resource_workspace_id FROM uptech.onboarding_sessions
    WHERE token_hash=$1`, [tenantB.onboarding])).rows[0].resource_workspace_id,
  "97400000-0000-4000-8000-000000000002");
  assert.equal((await pool.query(`SELECT count(*)::int AS count
    FROM uptech.identities i JOIN uptech.workspace_memberships m ON m.user_id=i.user_id
    WHERE i.provider_subject='admin-sub'
      AND m.workspace_id='97400000-0000-4000-8000-000000000002'`)).rows[0].count, 0);

  const replay = (await asApi((client) => client.query(`SELECT outcome::text,access_state::text
    FROM uptech.complete_web_google_login_directory_v2(
      $1,NULL,NULL,NULL,NULL,$2)`, [staleEmployee.onboarding, staleEmployee.id]))).rows[0];
  assert.deepEqual(replay, { outcome: "DENIED", access_state: null });
  for (const auditTable of ["platform_audit_events", "audit_events"] as const) {
    const audit = (await pool.query(`SELECT count(*)::int AS count,
        bool_and(request_id IS NOT NULL) AS correlated,
        bool_and(metadata ? 'access_state' AND metadata ? 'reason_class') AS closed_reason,
        bool_and((metadata - ARRAY['access_state','reason_class']::text[])='{}'::jsonb) AS redacted
      FROM uptech.${auditTable}
      WHERE action='GOOGLE_AUTH_LOGIN_DENIED'
        AND request_id::text LIKE '97600000-0000-4000-8000-%'`)).rows[0];
    assert.deepEqual(audit, { count: 11, correlated: true, closed_reason: true, redacted: true });
  }
  assert.equal((await pool.query(`SELECT bool_and(identity_id IS NOT NULL) AS identity_correlated
    FROM uptech.platform_audit_events WHERE action='GOOGLE_AUTH_LOGIN_DENIED'
      AND request_id::text LIKE '97600000-0000-4000-8000-%'`)).rows[0].identity_correlated, true);
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM uptech.audit_events
    WHERE action='GOOGLE_AUTH_LOGIN_DENIED' AND actor_kind='SYSTEM' AND actor_id IS NULL
      AND target_id IS NOT NULL AND workspace_id=$1
      AND request_id::text LIKE '97600000-0000-4000-8000-%'`,
  [workspaceId])).rows[0].count, 11);
  assert.deepEqual((await pool.query(`SELECT
    count(DISTINCT m.id)::int AS memberships,count(DISTINCT s.id)::int AS sessions
    FROM uptech.identities i
    LEFT JOIN uptech.workspace_memberships m ON m.user_id=i.user_id AND m.workspace_id=$1
    LEFT JOIN uptech.sessions s ON s.membership_id=m.id AND s.workspace_id=m.workspace_id
    WHERE i.provider_subject IN ('conflict-sub','never-denial-sub','suspended-sub','deleted-sub',
      'prior-absent','stale-new-sub','stale-collision-sub','pending-sub')`, [workspaceId])).rows[0],
  { memberships: 0, sessions: 0 });
});

test("V2 controlled completion revalidates Directory authority after credential-lock contention", async () => {
  const workspaceId = "97400000-0000-4000-8000-000000000001";
  const generationId = "97400000-0000-4000-8000-000000000021";
  const connectorId = "97400000-0000-4000-8000-000000000010";
  const transactionId = "97700000-0000-4000-8000-000000000001";
  const requestId = transactionId;
  const subject = "directory-race-sub";
  const sessionToken = Buffer.alloc(32, 0xa1);
  const csrfToken = Buffer.alloc(32, 0xa2);
  const onboardingToken = Buffer.alloc(32, 0xa3);
  const handle = Buffer.alloc(32, 0xa4);
  const nonce = Buffer.alloc(32, 0xa5);
  const environment = await ensureActiveGoogleEnvironment();

  await asMigrationOwner(async (client) => {
    await client.query(`UPDATE uptech.workspaces
      SET status='ACTIVE',provisioning_policy='GOOGLE_GROUP_CONTROLLED'
      WHERE workspace_id=$1`, [workspaceId]);
    await client.query(`UPDATE uptech.connectors SET status='ACTIVE'
      WHERE workspace_id=$1 AND id=$2`, [workspaceId, connectorId]);
    await client.query(`UPDATE uptech.people_sync_generations
      SET status='PUBLISHED',fresh_until=statement_timestamp()+interval '5 minutes'
      WHERE workspace_id=$1 AND id=$2`, [workspaceId, generationId]);
    await client.query(`INSERT INTO uptech.people_profiles(
      workspace_id,generation_id,google_subject,full_name,primary_email,department,
      lifecycle_state,org_unit_path,effective_role,effective_department_key
    ) VALUES ($1,$2,$3,'Directory Race','directory-race@mapping-a.example','sales',
      'ACTIVE','/Sales','MEMBER','SALES')`, [workspaceId, generationId, subject]);
    await client.query(`INSERT INTO uptech.oauth_transactions(
      id,environment_name,purpose,configuration_key,locator_hash,web_state_hash,web_nonce_hash,
      web_browser_binding_hash,web_pkce_envelope_version,web_pkce_algorithm,web_pkce_nonce,
      web_pkce_ciphertext,web_pkce_tag,web_pkce_kms_key_version,web_pkce_associated_data,status,
      completion_handle_hash,request_id,created_at,expires_at,consumed_at,completion_expires_at
    ) VALUES ($1,$2,'WEB_LOGIN','GOOGLE_WEB_LOGIN_V1',decode(repeat('a6',32),'hex'),
      decode(repeat('a6',32),'hex'),$3,decode(repeat('a7',32),'hex'),1,'AES-256-GCM',
      decode(repeat('a8',12),'hex'),decode(repeat('a9',40),'hex'),decode(repeat('aa',16),'hex'),
      'test-key-v1',decode(repeat('ab',32),'hex'),'EXCHANGE_RESERVED',$4,$1,
      statement_timestamp()-interval '1 minute',statement_timestamp()+interval '9 minutes',
      statement_timestamp()-interval '1 second',statement_timestamp()+interval '119 seconds')`,
    [transactionId, environment, nonce, handle]);
  });

  const blocker = await pool.connect();
  const completion = await pool.connect();
  let completionPid = 0;
  try {
    await blocker.query(`SELECT pg_advisory_lock(pg_catalog.hashtextextended(
      'UPTECH_CREDENTIAL_V1' || pg_catalog.encode($1::bytea,'hex'),0))`, [sessionToken]);
    await completion.query("BEGIN");
    await completion.query("SET LOCAL ROLE uptech_api_runtime");
    completionPid = (await completion.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const pending = completion.query(`SELECT outcome::text,access_state::text,route::text
      FROM uptech.complete_web_google_login_directory_v2(
        $1,ROW('accounts.google.com',$2,$3,true,'mapping-a.example',
          statement_timestamp()-interval '5 seconds',statement_timestamp()+interval '1 hour',
          'GOOGLE_WEB_LOGIN_V1',NULL,$4)::uptech.google_verified_claims_assertion_v1,
        $5,$6,$7,$8)`, [handle, subject, `${subject}@mapping-a.example`, nonce,
      sessionToken, csrfToken, onboardingToken, requestId]);

    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const activity = (await pool.query(`SELECT wait_event_type,wait_event
        FROM pg_stat_activity WHERE pid=$1`, [completionPid])).rows[0];
      if (activity?.wait_event_type === "Lock" && activity.wait_event === "advisory") {
        blocked = true;
        break;
      }
      await delay(10);
    }
    assert.equal(blocked, true, "completion must wait on the selected credential lock");

    await asMigrationOwner((client) => client.query(`UPDATE uptech.connectors SET status='REVOKED'
      WHERE workspace_id=$1 AND id=$2`, [workspaceId, connectorId]));
    await blocker.query(`SELECT pg_advisory_unlock(pg_catalog.hashtextextended(
      'UPTECH_CREDENTIAL_V1' || pg_catalog.encode($1::bytea,'hex'),0))`, [sessionToken]);
    const row = (await pending).rows[0];
    await completion.query("COMMIT");
    assert.deepEqual(row, { outcome: "DENIED", access_state: null, route: null });
  } finally {
    if (completionPid !== 0) await completion.query("ROLLBACK").catch(() => undefined);
    await blocker.query(`SELECT pg_advisory_unlock_all()`).catch(() => undefined);
    completion.release();
    blocker.release();
    await asMigrationOwner((client) => client.query(`UPDATE uptech.connectors SET status='ACTIVE'
      WHERE workspace_id=$1 AND id=$2`, [workspaceId, connectorId]));
  }

  assert.deepEqual((await pool.query(`SELECT
    (SELECT count(*)::int FROM uptech.identities WHERE provider_subject=$2) AS identities,
    (SELECT count(*)::int FROM uptech.workspace_memberships membership
      JOIN uptech.identities identity_row ON identity_row.user_id=membership.user_id
      WHERE membership.workspace_id=$1 AND identity_row.provider_subject=$2) AS memberships,
    (SELECT count(*)::int FROM uptech.sessions session_row
      JOIN uptech.identities identity_row ON identity_row.id=session_row.identity_id
      WHERE session_row.workspace_id=$1 AND identity_row.provider_subject=$2) AS sessions,
    (SELECT count(*)::int FROM uptech.session_tokens token_row
      JOIN uptech.sessions session_row ON session_row.workspace_id=token_row.workspace_id
        AND session_row.id=token_row.session_id
      JOIN uptech.identities identity_row ON identity_row.id=session_row.identity_id
      WHERE token_row.workspace_id=$1 AND identity_row.provider_subject=$2) AS tokens`,
  [workspaceId, subject])).rows[0], { identities: 1, memberships: 0, sessions: 0, tokens: 0 });
  for (const auditTable of ["platform_audit_events", "audit_events"] as const) {
    const audit = (await pool.query(`SELECT count(*)::int AS count,
        bool_and(request_id=$1) AS correlated,
        bool_and(metadata=$2::jsonb) AS redacted
      FROM uptech.${auditTable} WHERE request_id=$1 AND action='GOOGLE_AUTH_LOGIN_DENIED'`,
    [requestId, JSON.stringify({
      access_state: "INTERNAL_ERROR", reason_class: "AUTHORITY_COMMIT_FAILED",
    })])).rows[0];
    assert.deepEqual(audit, { count: 1, correlated: true, redacted: true });
  }
});

test("V2 controlled completion denies when the locked Directory generation expires after authority writes", async () => {
  const workspaceId = "97400000-0000-4000-8000-000000000001";
  const generationId = "97400000-0000-4000-8000-000000000021";
  const connectorId = "97400000-0000-4000-8000-000000000010";
  const transactionId = "97900000-0000-4000-8000-000000000001";
  const subject = "directory-ttl-race-sub";
  const hash = (value: string) => createHash("sha256").update(value).digest();
  const sessionToken = hash("directory-ttl-race-session");
  const csrfToken = hash("directory-ttl-race-csrf");
  const onboardingToken = hash("directory-ttl-race-onboarding");
  const handle = hash("directory-ttl-race-handle");
  const nonce = hash("directory-ttl-race-nonce");
  const environment = await ensureActiveGoogleEnvironment();

  await asMigrationOwner(async (client) => {
    await client.query(`UPDATE uptech.workspaces
      SET status='ACTIVE',provisioning_policy='GOOGLE_GROUP_CONTROLLED'
      WHERE workspace_id=$1`, [workspaceId]);
    await client.query(`UPDATE uptech.connectors SET status='ACTIVE'
      WHERE workspace_id=$1 AND id=$2`, [workspaceId, connectorId]);
    await client.query(`UPDATE uptech.people_sync_generations
      SET status='SUPERSEDED',fresh_until=statement_timestamp()+interval '5 minutes'
      WHERE workspace_id=$1 AND status='PUBLISHED' AND id<>$2`, [workspaceId, generationId]);
    await client.query(`UPDATE uptech.people_sync_generations
      SET status='PUBLISHED',fresh_until=clock_timestamp()+interval '1 second'
      WHERE workspace_id=$1 AND id=$2`, [workspaceId, generationId]);
    await client.query(`INSERT INTO uptech.people_profiles(
      workspace_id,generation_id,google_subject,full_name,primary_email,department,
      lifecycle_state,org_unit_path,effective_role,effective_department_key
    ) VALUES ($1,$2,$3,'Directory TTL Race','directory-ttl-race@mapping-a.example','sales',
      'ACTIVE','/Sales','MEMBER','SALES')`, [workspaceId, generationId, subject]);
    await client.query(`INSERT INTO uptech.people_group_memberships(
      workspace_id,generation_id,google_group_id,google_subject
    ) VALUES ($1,$2,'g-sales',$3)`, [workspaceId, generationId, subject]);
    await client.query(`INSERT INTO uptech.oauth_transactions(
      id,environment_name,purpose,configuration_key,locator_hash,web_state_hash,web_nonce_hash,
      web_browser_binding_hash,web_pkce_envelope_version,web_pkce_algorithm,web_pkce_nonce,
      web_pkce_ciphertext,web_pkce_tag,web_pkce_kms_key_version,web_pkce_associated_data,status,
      completion_handle_hash,request_id,created_at,expires_at,consumed_at,completion_expires_at
    ) VALUES ($1,$2,'WEB_LOGIN','GOOGLE_WEB_LOGIN_V1',decode(repeat('c6',32),'hex'),
      decode(repeat('c6',32),'hex'),$3,decode(repeat('c7',32),'hex'),1,'AES-256-GCM',
      decode(repeat('c8',12),'hex'),decode(repeat('c9',40),'hex'),decode(repeat('ca',16),'hex'),
      'test-key-v1',decode(repeat('cb',32),'hex'),'EXCHANGE_RESERVED',$4,$1,
      statement_timestamp()-interval '1 minute',statement_timestamp()+interval '9 minutes',
      statement_timestamp()-interval '1 second',statement_timestamp()+interval '119 seconds')`,
    [transactionId, environment, nonce, handle]);
    await client.query(`CREATE FUNCTION uptech.test_block_login_success_audit_v1()
      RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog,uptech AS $function$
      BEGIN
        IF NEW.request_id='${transactionId}'::uuid
           AND NEW.action='GOOGLE_AUTH_LOGIN_SUCCEEDED' THEN
          PERFORM pg_catalog.pg_sleep(2);
        END IF;
        RETURN NEW;
      END $function$;
      CREATE TRIGGER test_block_login_success_audit_v1
      BEFORE INSERT ON uptech.platform_audit_events FOR EACH ROW
      EXECUTE FUNCTION uptech.test_block_login_success_audit_v1()`);
  });

  const completion = await pool.connect();
  try {
    await completion.query("BEGIN");
    await completion.query("SET LOCAL ROLE uptech_api_runtime");
    const row = (await completion.query(`SELECT outcome::text,access_state::text,route::text
      FROM uptech.complete_web_google_login_directory_v2(
        $1,ROW('accounts.google.com',$2,$3,true,'mapping-a.example',
          statement_timestamp()-interval '5 seconds',statement_timestamp()+interval '1 hour',
          'GOOGLE_WEB_LOGIN_V1',NULL,$4)::uptech.google_verified_claims_assertion_v1,
        $5,$6,$7,$8)`, [handle, subject, `${subject}@mapping-a.example`, nonce,
      sessionToken, csrfToken, onboardingToken, transactionId])).rows[0];
    await completion.query("COMMIT");
    assert.deepEqual(row, { outcome: "DENIED", access_state: null, route: null });
  } finally {
    await completion.query("ROLLBACK").catch(() => undefined);
    completion.release();
    await asMigrationOwner((client) => client.query(`DROP TRIGGER IF EXISTS test_block_login_success_audit_v1
      ON uptech.platform_audit_events;
      DROP FUNCTION IF EXISTS uptech.test_block_login_success_audit_v1()`));
  }

  assert.deepEqual((await pool.query(`SELECT
    (SELECT count(*)::int FROM uptech.workspace_memberships membership
      JOIN uptech.identities identity_row ON identity_row.user_id=membership.user_id
      WHERE membership.workspace_id=$1 AND identity_row.provider_subject=$2) AS memberships,
    (SELECT count(*)::int FROM uptech.sessions session_row
      JOIN uptech.identities identity_row ON identity_row.id=session_row.identity_id
      WHERE session_row.workspace_id=$1 AND identity_row.provider_subject=$2) AS sessions,
    (SELECT count(*)::int FROM uptech.session_tokens token_row
      JOIN uptech.sessions session_row ON session_row.workspace_id=token_row.workspace_id
        AND session_row.id=token_row.session_id
      JOIN uptech.identities identity_row ON identity_row.id=session_row.identity_id
      WHERE token_row.workspace_id=$1 AND identity_row.provider_subject=$2) AS tokens,
    (SELECT count(*)::int FROM uptech.platform_audit_events
      WHERE request_id=$3 AND action='GOOGLE_AUTH_LOGIN_SUCCEEDED') AS success_audits`,
  [workspaceId, subject, transactionId])).rows[0],
  { memberships: 0, sessions: 0, tokens: 0, success_audits: 0 });
  for (const auditTable of ["platform_audit_events", "audit_events"] as const) {
    const audit = (await pool.query(`SELECT count(*)::int AS count,
        bool_and(request_id=$1) AS correlated,
        bool_and(metadata=$2::jsonb) AS redacted
      FROM uptech.${auditTable} WHERE request_id=$1 AND action='GOOGLE_AUTH_LOGIN_DENIED'`,
    [transactionId, JSON.stringify({
      access_state: "INTERNAL_ERROR", reason_class: "AUTHORITY_COMMIT_FAILED",
    })])).rows[0];
    assert.deepEqual(audit, { count: 1, correlated: true, redacted: true });
  }
});

test("Directory publish and controlled login serialize without a workspace-generation deadlock", async () => {
  const workspaceId = "97400000-0000-4000-8000-000000000001";
  const connectorId = "97400000-0000-4000-8000-000000000010";
  const actorId = "97400000-0000-4000-8000-000000000011";
  const currentGenerationId = "97400000-0000-4000-8000-000000000021";
  const jobId = "97800000-0000-4000-8000-000000000001";
  const generationId = "97800000-0000-4000-8000-000000000002";
  const fence = "97800000-0000-4000-8000-000000000003";
  const transactionId = "97800000-0000-4000-8000-000000000004";
  const subject = "publish-login-race-sub";
  const sessionToken = Buffer.alloc(32, 0xb1);
  const csrfToken = Buffer.alloc(32, 0xb2);
  const onboardingToken = Buffer.alloc(32, 0xb3);
  const handle = Buffer.alloc(32, 0xb4);
  const nonce = Buffer.alloc(32, 0xb5);
  const environment = await ensureActiveGoogleEnvironment();

  await asMigrationOwner(async (client) => {
    await client.query(`UPDATE uptech.workspaces
      SET status='ACTIVE',provisioning_policy='GOOGLE_GROUP_CONTROLLED'
      WHERE workspace_id=$1`, [workspaceId]);
    await client.query(`UPDATE uptech.connectors SET status='ACTIVE'
      WHERE workspace_id=$1 AND id=$2`, [workspaceId, connectorId]);
    await client.query(`UPDATE uptech.people_sync_generations
      SET status='SUPERSEDED',fresh_until=statement_timestamp()+interval '5 minutes'
      WHERE workspace_id=$1 AND status='PUBLISHED' AND id<>$2`, [workspaceId, currentGenerationId]);
    await client.query(`UPDATE uptech.people_sync_generations
      SET status='PUBLISHED',fresh_until=statement_timestamp()+interval '5 minutes'
      WHERE workspace_id=$1 AND id=$2`, [workspaceId, currentGenerationId]);
    await client.query(`INSERT INTO uptech.people_profiles(
      workspace_id,generation_id,google_subject,full_name,primary_email,department,
      lifecycle_state,org_unit_path,effective_role,effective_department_key
    ) VALUES ($1,$2,$3,'Publish Login Race','publish-login-race@mapping-a.example','sales',
      'ACTIVE','/Sales','MEMBER','SALES')`, [workspaceId, currentGenerationId, subject]);
    await client.query(`INSERT INTO uptech.people_group_memberships(
      workspace_id,generation_id,google_group_id,google_subject
    ) VALUES ($1,$2,'g-sales',$3)`, [workspaceId, currentGenerationId, subject]);
    await client.query(`INSERT INTO uptech.sync_jobs(
      workspace_id,id,service_actor_id,connector_id,job_kind,status,dedupe_key,
      available_at,leased_at,lease_expires_at,lease_owner,lease_fence
    ) VALUES ($1,$2,$3,$4,'DIRECTORY_SYNC','LEASED','publish-login-race',
      statement_timestamp(),statement_timestamp(),statement_timestamp()+interval '5 minutes',
      session_user,$5)`, [workspaceId, jobId, actorId, connectorId, fence]);
    await client.query(`INSERT INTO uptech.people_sync_generations(
      workspace_id,id,connector_id,job_id,lease_fence,status,traversal_complete,
      started_at,google_customer_id,primary_domain
    ) VALUES ($1,$2,$3,$4,$5,'RUNNING',false,statement_timestamp(),
      'mapping-customer-a','mapping-a.example')`, [workspaceId, generationId, connectorId, jobId, fence]);
    await client.query(`INSERT INTO uptech.people_groups(
      workspace_id,generation_id,google_group_id,group_name
    ) VALUES ($1,$2,'g-sales','Sales')`, [workspaceId, generationId]);
    await client.query(`INSERT INTO uptech.people_profiles(
      workspace_id,generation_id,google_subject,full_name,primary_email,department,
      lifecycle_state,org_unit_path
    ) VALUES ($1,$2,$3,'Publish Login Race','publish-login-race@mapping-a.example','sales',
      'ACTIVE','/Sales')`, [workspaceId, generationId, subject]);
    await client.query(`INSERT INTO uptech.people_group_memberships(
      workspace_id,generation_id,google_group_id,google_subject
    ) VALUES ($1,$2,'g-sales',$3)`, [workspaceId, generationId, subject]);
    await client.query(`INSERT INTO uptech.oauth_transactions(
      id,environment_name,purpose,configuration_key,locator_hash,web_state_hash,web_nonce_hash,
      web_browser_binding_hash,web_pkce_envelope_version,web_pkce_algorithm,web_pkce_nonce,
      web_pkce_ciphertext,web_pkce_tag,web_pkce_kms_key_version,web_pkce_associated_data,status,
      completion_handle_hash,request_id,created_at,expires_at,consumed_at,completion_expires_at
    ) VALUES ($1,$2,'WEB_LOGIN','GOOGLE_WEB_LOGIN_V1',decode(repeat('b6',32),'hex'),
      decode(repeat('b6',32),'hex'),$3,decode(repeat('b7',32),'hex'),1,'AES-256-GCM',
      decode(repeat('b8',12),'hex'),decode(repeat('b9',40),'hex'),decode(repeat('ba',16),'hex'),
      'test-key-v1',decode(repeat('bb',32),'hex'),'EXCHANGE_RESERVED',$4,$1,
      statement_timestamp()-interval '1 minute',statement_timestamp()+interval '9 minutes',
      statement_timestamp()-interval '1 second',statement_timestamp()+interval '119 seconds')`,
    [transactionId, environment, nonce, handle]);
  });

  const blocker = await pool.connect();
  const login = await pool.connect();
  const publisher = await pool.connect();
  let loginPid = 0;
  let publisherPid = 0;
  let loginOutcome: string | null = null;
  try {
    await blocker.query(`SELECT pg_advisory_lock(pg_catalog.hashtextextended(
      'UPTECH_CREDENTIAL_V1' || pg_catalog.encode($1::bytea,'hex'),0))`, [sessionToken]);

    await login.query("BEGIN");
    await login.query("SET LOCAL statement_timeout='5s'");
    await login.query("SET LOCAL deadlock_timeout='50ms'");
    await login.query("SET LOCAL ROLE uptech_api_runtime");
    loginPid = (await login.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const loginPending = login.query(`SELECT outcome::text,access_state::text,route::text
      FROM uptech.complete_web_google_login_directory_v2(
        $1,ROW('accounts.google.com',$2,$3,true,'mapping-a.example',
          statement_timestamp()-interval '5 seconds',statement_timestamp()+interval '1 hour',
          'GOOGLE_WEB_LOGIN_V1',NULL,$4)::uptech.google_verified_claims_assertion_v1,
        $5,$6,$7,$8)`, [handle, subject, `${subject}@mapping-a.example`, nonce,
      sessionToken, csrfToken, onboardingToken, transactionId]);

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const activity = (await pool.query(`SELECT wait_event_type,wait_event
        FROM pg_stat_activity WHERE pid=$1`, [loginPid])).rows[0];
      if (activity?.wait_event_type === "Lock" && activity.wait_event === "advisory") break;
      if (attempt === 99) assert.fail("controlled login did not reach credential contention");
      await delay(10);
    }

    await publisher.query("BEGIN");
    await publisher.query("SET LOCAL statement_timeout='5s'");
    await publisher.query("SET LOCAL deadlock_timeout='50ms'");
    await publisher.query("SET LOCAL ROLE uptech_worker_runtime");
    publisherPid = (await publisher.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await publisher.query("SELECT set_config('app.workspace_id',$1,true),set_config('app.job_id',$2,true),set_config('app.lease_fence',$3,true)",
      [workspaceId, jobId, fence]);
    const publishPending = publisher.query(`SELECT outcome,generation_id::text
      FROM uptech.publish_people_sync_generation_v1($1,$2,$3,true,
        statement_timestamp()+interval '4 minutes',$4)`,
    [workspaceId, generationId, fence, crypto.randomUUID()]);

    let publisherWaitEvent: string | null = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const activity = (await pool.query(`SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=$1`,
        [publisherPid])).rows[0];
      if (activity?.wait_event_type === "Lock") {
        publisherWaitEvent = activity.wait_event;
        break;
      }
      if (attempt === 99) assert.fail("publisher did not reach workspace serialization contention");
      await delay(10);
    }
    await blocker.query(`SELECT pg_advisory_unlock(pg_catalog.hashtextextended(
      'UPTECH_CREDENTIAL_V1' || pg_catalog.encode($1::bytea,'hex'),0))`, [sessionToken]);
    const [loginSettled] = await Promise.allSettled([loginPending]);
    if (loginSettled.status === "fulfilled") await login.query("COMMIT");
    else await login.query("ROLLBACK");
    const [publishSettled] = await Promise.allSettled([publishPending]);
    if (publishSettled.status === "fulfilled") await publisher.query("COMMIT");
    else await publisher.query("ROLLBACK");

    assert.equal(publisherWaitEvent, "advisory",
      "publisher must wait on workspace serialization before taking generation rows");
    if (loginSettled.status !== "fulfilled") {
      assert.fail(`controlled login failed with ${loginSettled.reason?.code ?? "unknown"}`);
    }
    if (publishSettled.status !== "fulfilled") {
      assert.fail(`publisher failed with ${publishSettled.reason?.code ?? "unknown"}`);
    }
    const loginRow = loginSettled.value.rows[0];
    const publishRow = publishSettled.value.rows[0];

    assert.equal(["NORMAL", "DENIED"].includes(loginRow.outcome), true);
    loginOutcome = loginRow.outcome as string;
    assert.equal(loginRow.access_state, null);
    assert.equal(loginRow.route, loginRow.outcome === "NORMAL" ? "/home" : null);
    assert.deepEqual(publishRow, { outcome: "PUBLISHED", generation_id: generationId });
  } finally {
    if (loginPid !== 0) await login.query("ROLLBACK").catch(() => undefined);
    if (publisherPid !== 0) await publisher.query("ROLLBACK").catch(() => undefined);
    await blocker.query("SELECT pg_advisory_unlock_all()").catch(() => undefined);
    blocker.release();
    login.release();
    publisher.release();
  }

  const committedAuthority = (await pool.query(`SELECT
      count(DISTINCT membership.id)::int AS memberships,
      min(membership.role) AS role,min(membership.status) AS status,
      count(DISTINCT session_row.id)::int AS sessions,count(DISTINCT token_row.id)::int AS tokens
    FROM uptech.identities AS identity_row
    LEFT JOIN uptech.workspace_memberships AS membership ON membership.user_id=identity_row.user_id
      AND membership.workspace_id=$1
    LEFT JOIN uptech.sessions AS session_row ON session_row.membership_id=membership.id
      AND session_row.workspace_id=membership.workspace_id
    LEFT JOIN uptech.session_tokens AS token_row ON token_row.session_id=session_row.id
      AND token_row.workspace_id=session_row.workspace_id
    WHERE identity_row.provider_subject=$2
    `, [workspaceId, subject])).rows[0];
  assert.deepEqual(committedAuthority, loginOutcome === "NORMAL"
    ? { memberships: 1, role: "MEMBER", status: "ACTIVE", sessions: 1, tokens: 1 }
    : { memberships: 0, role: null, status: null, sessions: 0, tokens: 0 },
  "a denied login must retain no Membership, Session, or token authority");
});

test("Mobile Directory V2 exposes only the narrow API completion boundary", async () => {
  const row = (await pool.query(`SELECT
    to_regprocedure('uptech.complete_mobile_google_callback_directory_v2(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uuid)') IS NOT NULL AS exists,
    COALESCE(has_function_privilege('uptech_api_runtime',
      to_regprocedure('uptech.complete_mobile_google_callback_directory_v2(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uuid)'),'EXECUTE'),false) AS api_execute,
    COALESCE(has_function_privilege('uptech_worker_runtime',
      to_regprocedure('uptech.complete_mobile_google_callback_directory_v2(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uuid)'),'EXECUTE'),false) AS worker_execute,
    COALESCE(has_function_privilege('public',
      to_regprocedure('uptech.complete_mobile_google_callback_directory_v2(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uuid)'),'EXECUTE'),false) AS public_execute`)).rows[0];
  assert.deepEqual(row, {
    exists: true, api_execute: true, worker_execute: false, public_execute: false,
  });
});

test("Mobile Directory V2 creates only mapped handoffs and preserves an active Owner", async () => {
  const workspaceId = "97400000-0000-4000-8000-000000000001";
  const generationId = "97800000-0000-4000-8000-000000000002";
  const ownerUserId = "97900000-0000-4000-8000-000000000001";
  const ownerIdentityId = "97900000-0000-4000-8000-000000000002";
  const ownerMembershipId = "97900000-0000-4000-8000-000000000003";
  const environment = await ensureActiveGoogleEnvironment();
  const digest = (label: string) => createHash("sha256").update(`mobile-v2:${label}`).digest();

  await asMigrationOwner(async (client) => {
    await client.query(`INSERT INTO uptech.mobile_google_configuration_registry(
      environment_name,platform,configuration_key,google_client_id,google_audience,
      callback_uri,app_return_uri,scopes,allowed_azp_configuration_keys,pkce_kms_key_version,
      android_application_id,android_release_cert_sha256,is_enabled
    ) VALUES ($1,'ANDROID','GOOGLE_MOBILE_ANDROID_V1','mobile-v2.example.apps.googleusercontent.com',
      'mobile-v2.example.apps.googleusercontent.com',
      'https://uptech-knowledge-sigma.vercel.app/api/v1/auth/mobile/google/callback',
      'https://uptech-knowledge-sigma.vercel.app/auth/mobile/callback',
      ARRAY['openid','email','profile'],ARRAY['GOOGLE_WEB_LOGIN_V1'::uptech.google_auth_configuration_key_v1],
      'mobile-v2-kms','com.example.uptech',repeat('AA:',31)||'AA',true)
    ON CONFLICT (environment_name,platform) DO UPDATE SET is_enabled=true`, [environment]);
    await client.query(`UPDATE uptech.people_sync_generations SET status='PUBLISHED',
      traversal_complete=true,completed_at=statement_timestamp(),fresh_until=statement_timestamp()+interval '5 minutes'
      WHERE workspace_id=$1 AND id=$2`, [workspaceId, generationId]);
    await client.query(`INSERT INTO uptech.people_groups(workspace_id,generation_id,google_group_id,group_name)
      VALUES ($1,$2,'g-admin','Admins'),($1,$2,'g-sales','Sales') ON CONFLICT DO NOTHING`,
    [workspaceId, generationId]);
    await client.query(`INSERT INTO uptech.people_profiles(
      workspace_id,generation_id,google_subject,full_name,primary_email,department,lifecycle_state,
      google_is_admin,google_is_delegated_admin,effective_role,effective_department_key
    ) VALUES
      ($1,$2,'mobile-v2-admin-sub','Mobile Admin','mobile-admin@mapping-a.example',NULL,'ACTIVE',false,false,'ADMIN',NULL),
      ($1,$2,'mobile-v2-member-sub','Mobile Member','mobile-member@mapping-a.example','sales','ACTIVE',true,true,'MEMBER','SALES'),
      ($1,$2,'mobile-v2-owner-sub','Mobile Owner','mobile-owner@mapping-a.example',NULL,'ACTIVE',false,false,NULL,NULL)`,
    [workspaceId, generationId]);
    await client.query(`INSERT INTO uptech.people_group_memberships(
      workspace_id,generation_id,google_group_id,google_subject
    ) VALUES ($1,$2,'g-admin','mobile-v2-admin-sub'),($1,$2,'g-sales','mobile-v2-member-sub')`,
    [workspaceId, generationId]);
    await client.query(`INSERT INTO uptech.users(id) VALUES ($1)`, [ownerUserId]);
    await client.query(`INSERT INTO uptech.identities(id,user_id,provider,issuer,provider_subject,email_claim,
        email_verified,hosted_domain_claim,claims_observed_at)
      VALUES ($2,$1,'GOOGLE','https://accounts.google.com','mobile-v2-owner-sub',
        'mobile-owner@mapping-a.example',true,'mapping-a.example',statement_timestamp())`,
    [ownerUserId, ownerIdentityId]);
    await client.query(`INSERT INTO uptech.workspace_memberships(workspace_id,id,user_id,role,status)
      VALUES ($2,$3,$1,'OWNER','ACTIVE')`, [ownerUserId, workspaceId, ownerMembershipId]);
  });

  const cases = [
    { subject: "mobile-v2-admin-sub", role: "ADMIN", department: null, manual: false },
    { subject: "mobile-v2-member-sub", role: "MEMBER", department: "SALES", manual: false },
    { subject: "mobile-v2-owner-sub", role: "OWNER", department: null, manual: false },
    { subject: "mobile-v2-owner-sub", role: "OWNER", department: null, manual: true },
  ] as const;
  for (const [index, fixture] of cases.entries()) {
    const transactionId = `97900000-0000-4000-8000-00000000001${index}`;
    const requestId = transactionId;
    const handle = digest(`${fixture.subject}:handle:${index}`);
    const nonce = digest(`${fixture.subject}:nonce:${index}`);
    const handoff = digest(`${fixture.subject}:handoff:${index}`);
    if (fixture.manual) await asMigrationOwner((client) => client.query(`UPDATE uptech.workspaces
      SET provisioning_policy='INVITE_ONLY' WHERE workspace_id=$1`, [workspaceId]));
    await asMigrationOwner((client) => client.query(`INSERT INTO uptech.mobile_google_transactions(
      id,environment_name,platform,configuration_key,state_hash,nonce_hash,installation_binding_hash,
      app_exchange_challenge,pkce_envelope,pkce_kms_key_version,pkce_associated_data,status,
      completion_handle_hash,request_id,created_at,expires_at,reserved_at,completion_expires_at
    ) VALUES ($1,$2,'ANDROID','GOOGLE_MOBILE_ANDROID_V1',$3,$4,$5,$6,
      ROW(1,'AES-256-GCM',$7,$8,$9)::uptech.google_web_pkce_envelope_v1,
      'mobile-v2-kms',convert_to('mobile-v2','UTF8'),'EXCHANGE_RESERVED',$10,$1,
      statement_timestamp()-interval '1 minute',statement_timestamp()+interval '4 minutes',
      statement_timestamp()-interval '1 second',statement_timestamp()+interval '119 seconds')`,
    [transactionId, environment, digest(`${fixture.subject}:state:${index}`), nonce,
      digest(`${fixture.subject}:install:${index}`), digest(`${fixture.subject}:challenge:${index}`),
      Buffer.alloc(12, 0xc0 + index), Buffer.alloc(48, 0xd0 + index),
      Buffer.alloc(16, 0xe0 + index), handle]));
    const row = (await asApi((client) => client.query(`SELECT outcome::text,app_return_uri::text,
        denial_category::text FROM uptech.complete_mobile_google_callback_directory_v2(
          $1,ROW('accounts.google.com',$2,$3,true,'mapping-a.example',
            statement_timestamp()-interval '5 seconds',statement_timestamp()+interval '1 hour',
            'GOOGLE_WEB_LOGIN_V1',NULL,$4)::uptech.google_verified_claims_assertion_v1,$5,$6)`,
    [handle, fixture.subject, `${fixture.subject}@mapping-a.example`, nonce, handoff, requestId]))).rows[0];
    if (fixture.manual) await asMigrationOwner((client) => client.query(`UPDATE uptech.workspaces
      SET provisioning_policy='GOOGLE_GROUP_CONTROLLED' WHERE workspace_id=$1`, [workspaceId]));
    assert.deepEqual(row, { outcome: "NORMAL",
      app_return_uri: "https://uptech-knowledge-sigma.vercel.app/auth/mobile/callback",
      denial_category: null });
    const authority = (await pool.query(`SELECT membership.role,profile.effective_department_key,
        extract(epoch FROM handoff.expires_at-handoff.created_at)::int AS lifetime_seconds,
        (SELECT count(*)::int FROM uptech.sessions s WHERE s.identity_id=handoff.identity_id) AS sessions,
        (SELECT count(*)::int FROM uptech.onboarding_sessions o WHERE o.identity_id=handoff.identity_id) AS capabilities
      FROM uptech.mobile_handoffs handoff
      JOIN uptech.workspace_memberships membership ON membership.workspace_id=handoff.workspace_id
        AND membership.id=handoff.membership_id
      JOIN uptech.identities identity_row ON identity_row.id=handoff.identity_id
      JOIN uptech.people_profiles profile ON profile.workspace_id=handoff.workspace_id
        AND profile.generation_id=$2 AND profile.google_subject=identity_row.provider_subject
      WHERE handoff.handoff_hash=$1`, [handoff, generationId])).rows[0];
    assert.equal(authority.role, fixture.role);
    assert.equal(authority.effective_department_key, fixture.department);
    assert.equal(authority.lifetime_seconds, 60);
    assert.equal(authority.sessions, 0);
    assert.equal(authority.capabilities, 0);
  }
});

test("Mobile Directory V2 rejects a verified hosted-domain claim with no normalized email", async () => {
  const workspaceId = "97400000-0000-4000-8000-000000000001";
  const generationId = "97800000-0000-4000-8000-000000000002";
  const transactionId = "97900000-0000-4000-8000-000000000020";
  const subject = "mobile-v2-null-email-sub";
  const digest = (label: string) => createHash("sha256").update(`mobile-null-email:${label}`).digest();
  const handle = digest("handle");
  const nonce = digest("nonce");
  const handoff = digest("handoff");
  const environment = await ensureActiveGoogleEnvironment();

  await asMigrationOwner(async (client) => {
    await client.query(`INSERT INTO uptech.people_profiles(
      workspace_id,generation_id,google_subject,full_name,primary_email,lifecycle_state,
      effective_role,effective_department_key
    ) VALUES ($1,$2,$3,'Null Email','null-email@mapping-a.example','ACTIVE','ADMIN',NULL)`,
    [workspaceId, generationId, subject]);
    await client.query(`INSERT INTO uptech.people_group_memberships(
      workspace_id,generation_id,google_group_id,google_subject
    ) VALUES ($1,$2,'g-admin',$3)`, [workspaceId, generationId, subject]);
    await client.query(`INSERT INTO uptech.mobile_google_transactions(
      id,environment_name,platform,configuration_key,state_hash,nonce_hash,installation_binding_hash,
      app_exchange_challenge,pkce_envelope,pkce_kms_key_version,pkce_associated_data,status,
      completion_handle_hash,request_id,created_at,expires_at,reserved_at,completion_expires_at
    ) VALUES ($1,$2,'ANDROID','GOOGLE_MOBILE_ANDROID_V1',$3,$4,$5,$6,
      ROW(1,'AES-256-GCM',$7,$8,$9)::uptech.google_web_pkce_envelope_v1,
      'mobile-v2-kms',convert_to('mobile-null-email','UTF8'),'EXCHANGE_RESERVED',$10,$1,
      statement_timestamp()-interval '1 minute',statement_timestamp()+interval '4 minutes',
      statement_timestamp()-interval '1 second',statement_timestamp()+interval '119 seconds')`,
    [transactionId, environment, digest("state"), nonce, digest("install"), digest("challenge"),
      Buffer.alloc(12, 0xf1), Buffer.alloc(48, 0xf2), Buffer.alloc(16, 0xf3), handle]);
  });

  const row = (await asApi((client) => client.query(`SELECT outcome::text,denial_category::text
    FROM uptech.complete_mobile_google_callback_directory_v2(
      $1,ROW('accounts.google.com',$2,NULL,true,'mapping-a.example',
        statement_timestamp()-interval '5 seconds',statement_timestamp()+interval '1 hour',
        'GOOGLE_WEB_LOGIN_V1',NULL,$3)::uptech.google_verified_claims_assertion_v1,$4,$5)`,
  [handle, subject, nonce, handoff, transactionId]))).rows[0];
  assert.equal(row.outcome, "DENIED");
  assert.equal(row.denial_category, "AUTH_ERROR");
  assert.deepEqual((await pool.query(`SELECT
      (SELECT count(*)::int FROM uptech.identities WHERE provider_subject=$1) AS identities,
      (SELECT count(*)::int FROM uptech.workspace_memberships membership
        JOIN uptech.identities identity_row ON identity_row.user_id=membership.user_id
        WHERE identity_row.provider_subject=$1) AS memberships,
      (SELECT count(*)::int FROM uptech.mobile_handoffs
        WHERE handoff_hash=$2 AND identity_id IS NOT NULL) AS authoritative_handoffs,
      (SELECT count(*)::int FROM uptech.platform_audit_events
        WHERE request_id=$3 AND action='MOBILE_GOOGLE_HANDOFF_CREATED') AS success_audits,
      (SELECT status::text FROM uptech.mobile_google_transactions WHERE id=$3) AS transaction_status`,
  [subject, handoff, transactionId])).rows[0], {
    identities: 0, memberships: 0, authoritative_handoffs: 0,
    success_audits: 0, transaction_status: "REJECTED",
  });
});

test("Mobile Directory V2 classifies revoked Directory authority without tenant authority", async () => {
  const workspaceId = "97400000-0000-4000-8000-000000000001";
  const connectorId = "97400000-0000-4000-8000-000000000010";
  const transactionId = "97900000-0000-4000-8000-000000000030";
  const subject = "mobile-v2-member-sub";
  const digest = (label: string) => createHash("sha256").update(`mobile-denial:${label}`).digest();
  const handle = digest("handle");
  const nonce = digest("nonce");
  const handoff = digest("handoff");
  const install = digest("install");
  const challenge = digest("challenge");
  const environment = await ensureActiveGoogleEnvironment();

  await asMigrationOwner(async (client) => {
    await client.query(`UPDATE uptech.workspaces SET status='ACTIVE',
      provisioning_policy='GOOGLE_GROUP_CONTROLLED' WHERE workspace_id=$1`, [workspaceId]);
    await client.query(`UPDATE uptech.connectors SET status='REVOKED'
      WHERE workspace_id=$1 AND id=$2`, [workspaceId, connectorId]);
    await client.query(`INSERT INTO uptech.mobile_google_transactions(
      id,environment_name,platform,configuration_key,state_hash,nonce_hash,installation_binding_hash,
      app_exchange_challenge,pkce_envelope,pkce_kms_key_version,pkce_associated_data,status,
      completion_handle_hash,request_id,created_at,expires_at,reserved_at,completion_expires_at
    ) VALUES ($1,$2,'ANDROID','GOOGLE_MOBILE_ANDROID_V1',$3,$4,$5,$6,
      ROW(1,'AES-256-GCM',$7,$8,$9)::uptech.google_web_pkce_envelope_v1,
      'mobile-v2-kms',convert_to('mobile-denial','UTF8'),'EXCHANGE_RESERVED',$10,$1,
      statement_timestamp()-interval '1 minute',statement_timestamp()+interval '4 minutes',
      statement_timestamp()-interval '1 second',statement_timestamp()+interval '119 seconds')`,
    [transactionId, environment, digest("state"), nonce, install, challenge,
      Buffer.alloc(12, 0xa1), Buffer.alloc(48, 0xa2), Buffer.alloc(16, 0xa3), handle]);
  });

  try {
    const row = (await asApi((client) => client.query(`SELECT outcome::text,app_return_uri::text,
        denial_category::text FROM uptech.complete_mobile_google_callback_directory_v2(
          $1,ROW('accounts.google.com',$2,$3,true,'mapping-a.example',
            statement_timestamp()-interval '5 seconds',statement_timestamp()+interval '1 hour',
            'GOOGLE_WEB_LOGIN_V1',NULL,$4)::uptech.google_verified_claims_assertion_v1,$5,$6)`,
    [handle, subject, `${subject}@mapping-a.example`, nonce, handoff, transactionId]))).rows[0];
    assert.deepEqual(row, {
      outcome: "DENIED",
      app_return_uri: "https://uptech-knowledge-sigma.vercel.app/auth/mobile/callback",
      denial_category: "POLICY_OR_DEVICE_BLOCKED",
    });
    assert.deepEqual((await pool.query(`SELECT identity_id,user_id,workspace_id,membership_id,
        denial_category::text,extract(epoch FROM expires_at-created_at)::int AS lifetime_seconds
      FROM uptech.mobile_handoffs WHERE handoff_hash=$1`, [handoff])).rows[0], {
      identity_id: null, user_id: null, workspace_id: null, membership_id: null,
      denial_category: "POLICY_OR_DEVICE_BLOCKED", lifetime_seconds: 60,
    });
    const exchanged = (await asApi((client) => client.query(`SELECT outcome::text,
        denial_category::text FROM uptech.exchange_mobile_handoff_v2($1,$2,$3,$4,$5,$6,$7)`,
    [digest("network"), handoff, challenge, install, digest("access"), digest("refresh"),
      "97900000-0000-4000-8000-000000000031"]))).rows[0];
    assert.deepEqual(exchanged, {
      outcome: "ACCESS_DENIED", denial_category: "POLICY_OR_DEVICE_BLOCKED",
    });
    assert.deepEqual((await pool.query(`SELECT count(*)::int AS count,
        bool_and(metadata->>'denial_category'='POLICY_OR_DEVICE_BLOCKED') AS exact_category,
        bool_and(metadata::text !~* '(token|credential|secret|hash)') AS redacted
      FROM uptech.platform_audit_events WHERE request_id=$1
        AND action='MOBILE_GOOGLE_CALLBACK_REJECTED'`, [transactionId])).rows[0], {
      count: 1, exact_category: true, redacted: true,
    });
  } finally {
    await asMigrationOwner((client) => client.query(`UPDATE uptech.connectors SET status='ACTIVE'
      WHERE workspace_id=$1 AND id=$2`, [workspaceId, connectorId]));
  }
});

test("Mobile Directory V2 denial categories roll back every core authority source", async () => {
  const workspaceId = "97400000-0000-4000-8000-000000000001";
  const generationId = "97800000-0000-4000-8000-000000000002";
  const priorGenerationId = "97400000-0000-4000-8000-000000000021";
  const environment = await ensureActiveGoogleEnvironment();
  const digest = (label: string) => createHash("sha256").update(`mobile-matrix:${label}`).digest();
  const subjects = {
    mapped: "mobile-matrix-mapped", unmapped: "mobile-matrix-unmapped",
    conflict: "mobile-matrix-conflict", suspended: "mobile-matrix-suspended",
    deleted: "mobile-matrix-deleted", prior: "mobile-matrix-prior",
    inactiveUser: "mobile-matrix-inactive-user", inactiveIdentity: "mobile-matrix-inactive-identity",
    suspendedMembership: "mobile-matrix-membership-suspended",
    deprovisionedMembership: "mobile-matrix-membership-deprovisioned",
  } as const;

  await asMigrationOwner(async (client) => {
    await client.query(`UPDATE uptech.workspaces SET status='ACTIVE',
      provisioning_policy='GOOGLE_GROUP_CONTROLLED' WHERE workspace_id=$1`, [workspaceId]);
    await client.query(`UPDATE uptech.people_sync_generations SET status='PUBLISHED',
      traversal_complete=true,completed_at=statement_timestamp(),fresh_until=statement_timestamp()+interval '5 minutes'
      WHERE workspace_id=$1 AND id=$2`, [workspaceId, generationId]);
    await client.query(`INSERT INTO uptech.people_groups(workspace_id,generation_id,google_group_id,group_name)
      VALUES ($1,$2,'g-hr','HR') ON CONFLICT DO NOTHING`, [workspaceId, generationId]);
    await client.query(`INSERT INTO uptech.people_profiles(workspace_id,generation_id,google_subject,
      full_name,primary_email,lifecycle_state,effective_role,effective_department_key) VALUES
      ($1,$2,$3,'Mapped','mapped@mapping-a.example','ACTIVE','MEMBER','SALES'),
      ($1,$2,$4,'Unmapped','unmapped@mapping-a.example','ACTIVE',NULL,NULL),
      ($1,$2,$5,'Conflict','conflict-matrix@mapping-a.example','ACTIVE',NULL,NULL),
      ($1,$2,$6,'Suspended','suspended-matrix@mapping-a.example','SUSPENDED',NULL,NULL),
      ($1,$2,$7,'Deleted','deleted-matrix@mapping-a.example','DELETED',NULL,NULL),
      ($1,$2,$8,'Inactive User','inactive-user@mapping-a.example','ACTIVE','MEMBER','SALES'),
      ($1,$2,$9,'Inactive Identity','inactive-identity@mapping-a.example','ACTIVE','MEMBER','SALES'),
      ($1,$2,$10,'Suspended Membership','membership-suspended@mapping-a.example','ACTIVE','MEMBER','SALES'),
      ($1,$2,$11,'Deprovisioned Membership','membership-deprovisioned@mapping-a.example','ACTIVE','MEMBER','SALES')`,
    [workspaceId, generationId, subjects.mapped, subjects.unmapped, subjects.conflict,
      subjects.suspended, subjects.deleted, subjects.inactiveUser, subjects.inactiveIdentity,
      subjects.suspendedMembership, subjects.deprovisionedMembership]);
    await client.query(`INSERT INTO uptech.people_profiles(workspace_id,generation_id,google_subject,
      full_name,primary_email,lifecycle_state) VALUES
      ($1,$2,$3,'Prior','prior-matrix@mapping-a.example','ACTIVE')`,
    [workspaceId, priorGenerationId, subjects.prior]);
    await client.query(`INSERT INTO uptech.people_group_memberships(
      workspace_id,generation_id,google_group_id,google_subject)
      SELECT $1,$2,'g-sales',subject FROM unnest($3::text[]) AS subject`,
    [workspaceId, generationId, [subjects.mapped, subjects.conflict, subjects.inactiveUser,
      subjects.inactiveIdentity, subjects.suspendedMembership, subjects.deprovisionedMembership]]);
    await client.query(`INSERT INTO uptech.people_group_memberships(
      workspace_id,generation_id,google_group_id,google_subject) VALUES ($1,$2,'g-hr',$3)`,
    [workspaceId, generationId, subjects.conflict]);
    await client.query(`INSERT INTO uptech.users(id) VALUES
      ('97a00000-0000-4000-8000-000000000001'),('97a00000-0000-4000-8000-000000000002'),
      ('97a00000-0000-4000-8000-000000000003'),('97a00000-0000-4000-8000-000000000004')`);
    await client.query(`INSERT INTO uptech.identities(id,user_id,provider,issuer,provider_subject,email_claim,email_verified,
        hosted_domain_claim,claims_observed_at) VALUES
      ('97a00000-0000-4000-8000-000000000011','97a00000-0000-4000-8000-000000000001','GOOGLE','https://accounts.google.com',$1,$1||'@mapping-a.example',true,'mapping-a.example',statement_timestamp()),
      ('97a00000-0000-4000-8000-000000000012','97a00000-0000-4000-8000-000000000002','GOOGLE','https://accounts.google.com',$2,$2||'@mapping-a.example',true,'mapping-a.example',statement_timestamp()),
      ('97a00000-0000-4000-8000-000000000013','97a00000-0000-4000-8000-000000000003','GOOGLE','https://accounts.google.com',$3,$3||'@mapping-a.example',true,'mapping-a.example',statement_timestamp()),
      ('97a00000-0000-4000-8000-000000000014','97a00000-0000-4000-8000-000000000004','GOOGLE','https://accounts.google.com',$4,$4||'@mapping-a.example',true,'mapping-a.example',statement_timestamp())`,
    [subjects.inactiveUser, subjects.inactiveIdentity, subjects.suspendedMembership,
      subjects.deprovisionedMembership]);
    await client.query(`INSERT INTO uptech.workspace_memberships(workspace_id,id,user_id,role,status) VALUES
      ($1,'97a00000-0000-4000-8000-000000000021','97a00000-0000-4000-8000-000000000001','MEMBER','ACTIVE'),
      ($1,'97a00000-0000-4000-8000-000000000022','97a00000-0000-4000-8000-000000000002','MEMBER','ACTIVE'),
      ($1,'97a00000-0000-4000-8000-000000000023','97a00000-0000-4000-8000-000000000003','MEMBER','ACTIVE'),
      ($1,'97a00000-0000-4000-8000-000000000024','97a00000-0000-4000-8000-000000000004','MEMBER','ACTIVE')`,
    [workspaceId]);
  });

  const cases: Array<{ label: string; subject: string; category: string;
    mutate: string; restore: string }> = [
    { label: "no-generation", subject: subjects.mapped, category: "POLICY_OR_DEVICE_BLOCKED",
      mutate: `UPDATE uptech.people_sync_generations SET status='SUPERSEDED' WHERE workspace_id='${workspaceId}' AND id='${generationId}'`,
      restore: `UPDATE uptech.people_sync_generations SET status='PUBLISHED',fresh_until=statement_timestamp()+interval '5 minutes' WHERE workspace_id='${workspaceId}' AND id='${generationId}'` },
    { label: "stale", subject: subjects.mapped, category: "POLICY_OR_DEVICE_BLOCKED",
      mutate: `UPDATE uptech.people_sync_generations SET completed_at=statement_timestamp()-interval '2 minutes',fresh_until=statement_timestamp()-interval '1 minute' WHERE workspace_id='${workspaceId}' AND id='${generationId}'`,
      restore: `UPDATE uptech.people_sync_generations SET completed_at=statement_timestamp(),fresh_until=statement_timestamp()+interval '5 minutes' WHERE workspace_id='${workspaceId}' AND id='${generationId}'` },
    { label: "unmapped", subject: subjects.unmapped, category: "USER_NOT_PROVISIONED", mutate: "SELECT 1", restore: "SELECT 1" },
    { label: "conflict", subject: subjects.conflict, category: "USER_NOT_PROVISIONED", mutate: "SELECT 1", restore: "SELECT 1" },
    { label: "profile-suspended", subject: subjects.suspended, category: "USER_SUSPENDED", mutate: "SELECT 1", restore: "SELECT 1" },
    { label: "profile-deleted", subject: subjects.deleted, category: "USER_SUSPENDED", mutate: "SELECT 1", restore: "SELECT 1" },
    { label: "prior-absent", subject: subjects.prior, category: "USER_SUSPENDED", mutate: "SELECT 1", restore: "SELECT 1" },
    { label: "user-inactive", subject: subjects.inactiveUser, category: "USER_SUSPENDED",
      mutate: "UPDATE uptech.users SET status='SUSPENDED' WHERE id='97a00000-0000-4000-8000-000000000001'",
      restore: "UPDATE uptech.users SET status='ACTIVE' WHERE id='97a00000-0000-4000-8000-000000000001'" },
    { label: "identity-inactive", subject: subjects.inactiveIdentity, category: "USER_SUSPENDED",
      mutate: "UPDATE uptech.identities SET status='REVOKED' WHERE id='97a00000-0000-4000-8000-000000000012'",
      restore: "UPDATE uptech.identities SET status='ACTIVE' WHERE id='97a00000-0000-4000-8000-000000000012'" },
    { label: "membership-suspended", subject: subjects.suspendedMembership, category: "USER_SUSPENDED",
      mutate: "UPDATE uptech.workspace_memberships SET status='SUSPENDED' WHERE id='97a00000-0000-4000-8000-000000000023'",
      restore: "UPDATE uptech.workspace_memberships SET status='ACTIVE' WHERE id='97a00000-0000-4000-8000-000000000023'" },
    { label: "membership-deprovisioned", subject: subjects.deprovisionedMembership, category: "USER_SUSPENDED",
      mutate: "UPDATE uptech.workspace_memberships SET status='DEPROVISIONED' WHERE id='97a00000-0000-4000-8000-000000000024'",
      restore: "UPDATE uptech.workspace_memberships SET status='ACTIVE' WHERE id='97a00000-0000-4000-8000-000000000024'" },
    { label: "workspace-suspended", subject: subjects.mapped, category: "WORKSPACE_SUSPENDED",
      mutate: `UPDATE uptech.workspaces SET status='SUSPENDED' WHERE workspace_id='${workspaceId}'`,
      restore: `UPDATE uptech.workspaces SET status='ACTIVE' WHERE workspace_id='${workspaceId}'` },
    { label: "workspace-deprovisioned", subject: subjects.mapped, category: "WORKSPACE_SUSPENDED",
      mutate: `UPDATE uptech.workspaces SET status='DEPROVISIONED' WHERE workspace_id='${workspaceId}'`,
      restore: `UPDATE uptech.workspaces SET status='ACTIVE' WHERE workspace_id='${workspaceId}'` },
  ];

  for (const [index, fixture] of cases.entries()) {
    const transactionId = `97b00000-0000-4000-8000-${String(40 + index).padStart(12, "0")}`;
    const handle = digest(`${fixture.label}:handle`); const nonce = digest(`${fixture.label}:nonce`);
    const handoff = digest(`${fixture.label}:handoff`);
    await asMigrationOwner(async (client) => {
      await client.query(fixture.mutate);
      await client.query(`INSERT INTO uptech.mobile_google_transactions(id,environment_name,platform,
        configuration_key,state_hash,nonce_hash,installation_binding_hash,app_exchange_challenge,
        pkce_envelope,pkce_kms_key_version,pkce_associated_data,status,completion_handle_hash,request_id,
        created_at,expires_at,reserved_at,completion_expires_at)
      VALUES ($1,$2,'ANDROID','GOOGLE_MOBILE_ANDROID_V1',$3,$4,$5,$6,
        ROW(1,'AES-256-GCM',$7,$8,$9)::uptech.google_web_pkce_envelope_v1,'mobile-v2-kms',
        convert_to('mobile-matrix','UTF8'),'EXCHANGE_RESERVED',$10,$1,statement_timestamp()-interval '1 minute',
        statement_timestamp()+interval '4 minutes',statement_timestamp()-interval '1 second',
        statement_timestamp()+interval '119 seconds')`, [transactionId, environment,digest(`${fixture.label}:state`),
        nonce,digest(`${fixture.label}:install`),digest(`${fixture.label}:challenge`),
        Buffer.alloc(12,0x40+index),Buffer.alloc(48,0x50+index),Buffer.alloc(16,0x60+index),handle]);
    });
    const beforeMembership = await pool.query(`SELECT m.role,m.status,m.authz_version FROM uptech.identities i
      JOIN uptech.workspace_memberships m ON m.user_id=i.user_id AND m.workspace_id=$1
      WHERE i.provider_subject=$2`, [workspaceId, fixture.subject]);
    try {
      const row = (await asApi((client) => client.query(`SELECT outcome::text,denial_category::text
        FROM uptech.complete_mobile_google_callback_directory_v2($1,
          ROW('accounts.google.com',$2,$3,true,'mapping-a.example',statement_timestamp()-interval '5 seconds',
            statement_timestamp()+interval '1 hour','GOOGLE_WEB_LOGIN_V1',NULL,$4)
            ::uptech.google_verified_claims_assertion_v1,$5,$6)`,
      [handle,fixture.subject,`${fixture.subject}@mapping-a.example`,nonce,handoff,transactionId]))).rows[0];
      assert.deepEqual(row,{ outcome:"DENIED",denial_category:fixture.category },fixture.label);
      assert.deepEqual((await pool.query(`SELECT identity_id,user_id,workspace_id,membership_id,
          denial_category::text,extract(epoch FROM expires_at-created_at)::int AS lifetime_seconds
        FROM uptech.mobile_handoffs WHERE handoff_hash=$1`,[handoff])).rows[0],{
        identity_id:null,user_id:null,workspace_id:null,membership_id:null,
        denial_category:fixture.category,lifetime_seconds:60,
      },fixture.label);
      assert.deepEqual((await pool.query(`SELECT m.role,m.status,m.authz_version FROM uptech.identities i
        JOIN uptech.workspace_memberships m ON m.user_id=i.user_id AND m.workspace_id=$1
        WHERE i.provider_subject=$2`,[workspaceId,fixture.subject])).rows,beforeMembership.rows,fixture.label);
      assert.deepEqual((await pool.query(`SELECT
          (SELECT count(*)::int FROM uptech.sessions s JOIN uptech.identities i ON i.id=s.identity_id
            WHERE i.provider_subject=$1) AS sessions,
          (SELECT count(*)::int FROM uptech.session_tokens t JOIN uptech.sessions s
            ON s.workspace_id=t.workspace_id AND s.id=t.session_id JOIN uptech.identities i
            ON i.id=s.identity_id WHERE i.provider_subject=$1) AS tokens,
          (SELECT count(*)::int FROM uptech.onboarding_sessions o JOIN uptech.identities i
            ON i.id=o.identity_id WHERE i.provider_subject=$1) AS capabilities,
          (SELECT count(*)::int FROM uptech.platform_audit_events WHERE request_id=$2
            AND metadata::text~*'(token|credential|secret|hash)') AS secret_metadata`,
      [fixture.subject,transactionId])).rows[0],{ sessions:0,tokens:0,capabilities:0,secret_metadata:0 },fixture.label);
    } finally {
      await asMigrationOwner((client)=>client.query(fixture.restore));
    }
  }
});
