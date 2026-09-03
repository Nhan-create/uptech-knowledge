import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { before, after } from "node:test";
import { Pool } from "pg";

const PREFIX = "uptech_phase1_test";
let pool: Pool;

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
  pool = new Pool({ connectionString: databaseUrl(), max: 1 });
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
});

after(async () => { await pool?.end(); });

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
