import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { before, after } from "node:test";
import { Pool } from "pg";

import { createGoogleWorkspaceBootstrapRepository } from "../../src/server/onboarding/google-workspace/repository.ts";

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

async function asApi<T>(operation: (client: Awaited<ReturnType<Pool["connect"]>>) => Promise<T>): Promise<T> {
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

test("complete atomically creates the existing identity's tenant authority and no login session", async () => {
  const fixture = bootstrapFixtures.commit;
  const attemptId = "92000000-0000-0000-0000-000000000014";
  const candidateWorkspaceId = "92000000-0000-0000-0000-000000000015";
  const sourceTokenHash = hash32(fixture.sourceByte);
  const statusTokenHash = hash32(0x32);
  const before = await pool.query("SELECT (SELECT count(*)::int FROM uptech.users) AS users,(SELECT count(*)::int FROM uptech.identities) AS identities");
  const repository = (client: Awaited<ReturnType<Pool["connect"]>>) =>
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
});

test("complete denies mismatched proof without leaving partial tenant authority", async () => {
  const fixture = bootstrapFixtures.deny;
  const attemptId = "92000000-0000-0000-0000-000000000024";
  const candidateWorkspaceId = "92000000-0000-0000-0000-000000000025";
  const repository = (client: Awaited<ReturnType<Pool["connect"]>>) =>
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
