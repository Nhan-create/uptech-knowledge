import assert from "node:assert/strict";
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
    RESET ROLE`);
});

after(async () => { await pool?.end(); });

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
          AND conname IN ('onboarding_sessions_operations_check','onboarding_sessions_expiry_check','onboarding_sessions_resource_workspace_fk')
        GROUP BY conrelid HAVING count(*)=3 AND bool_and(convalidated)
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
  await asMigrationOwner((client) => client.query(`
    INSERT INTO uptech.google_auth_environment_registry(
      environment_name, rate_limit_audit_hmac_key, is_active
    ) VALUES ('bootstrap-admission-test', $1::uptech.google_auth_hash32_v1, true)
  `, [hash32(0x98)]));
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

test("0009 preserves a populated legacy access capability with its unique verified tenant binding", async () => {
  const result = await pool.query("SELECT resource_workspace_id::text FROM uptech.onboarding_sessions WHERE id='90000000-0000-0000-0000-000000000004'");
  assert.equal(result.rows[0]?.resource_workspace_id, "90000000-0000-0000-0000-000000000001");
});

test("0009 safely reconciles unmatched, mixed, and duplicate legacy capabilities", async () => {
  const result = await pool.query("SELECT id::text,allowed_operations,resource_workspace_id::text FROM uptech.onboarding_sessions WHERE id IN ('90000000-0000-0000-0000-000000000014','90000000-0000-0000-0000-000000000015','90000000-0000-0000-0000-000000000016') ORDER BY id");
  assert.deepEqual(result.rows, [
    { id: '90000000-0000-0000-0000-000000000015', allowed_operations: ['FIRST_DOMAIN_CLAIM_READ'], resource_workspace_id: null },
    { id: '90000000-0000-0000-0000-000000000016', allowed_operations: ['ACCESS_REQUEST_SUBMIT'], resource_workspace_id: '90000000-0000-0000-0000-000000000001' },
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
    const sourceByte = 0xa0 + index * 2;
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
    to_regtype('uptech.google_workspace_bootstrap_retry_result_v1') IS NOT NULL AS retry_result`)).rows[0],
  { status_result: true, retry_result: true });
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

  await asMigrationOwner((client) => client.query(`UPDATE uptech.onboarding_sessions SET
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
});
