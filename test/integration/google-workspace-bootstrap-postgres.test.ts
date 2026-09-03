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
  await pool.query("SET ROLE uptech_migration_owner; DROP SCHEMA IF EXISTS uptech CASCADE; RESET ROLE; CREATE SCHEMA uptech AUTHORIZATION uptech_migration_owner");
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
        INSERT INTO uptech.users(id) VALUES ('90000000-0000-0000-0000-000000000002');
        INSERT INTO uptech.identities(id,user_id,provider,issuer,provider_subject,email_claim,email_verified,hosted_domain_claim,claims_observed_at)
          VALUES ('90000000-0000-0000-0000-000000000003','90000000-0000-0000-0000-000000000002','GOOGLE','https://accounts.google.com','legacy-sub','owner@legacy.example',true,'legacy.example',statement_timestamp());
        INSERT INTO uptech.workspace_domain_locators(normalized_domain,workspace_id,status,verified_at)
          VALUES ('legacy.example','90000000-0000-0000-0000-000000000001','VERIFIED',statement_timestamp());
        INSERT INTO uptech.onboarding_sessions(id,identity_id,token_hash,allowed_operations,expires_at)
          VALUES ('90000000-0000-0000-0000-000000000004','90000000-0000-0000-0000-000000000003',decode(repeat('09',32),'hex'),ARRAY['ACCESS_REQUEST_READ','ACCESS_REQUEST_SUBMIT'],statement_timestamp()+interval '20 minutes');
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
  const definitions = await pool.query(`SELECT proname,prosrc FROM pg_proc JOIN pg_namespace n ON n.oid=pronamespace
    WHERE n.nspname='uptech' AND proname IN ('activate_directory_connector_v1','lease_next_directory_job_v1')`);
  assert.ok(definitions.rows.every((row) => row.prosrc.includes('directory_scopes_are_supported_v1')));
  await pool.query("RESET ROLE");
});
