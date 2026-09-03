import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import { Pool, type PoolClient } from "pg";
import { TEST_DOCUMENTS, TEST_PERSONAS } from "../fixtures/multitenant-department-personas.ts";
import { authorizeKnowledgeAccess } from "../../src/server/domain/knowledge-access.ts";
import { resolveWebRouteAuthority } from "../../src/server/auth/web-route-authority.ts";
import { authenticateSession } from "../../src/server/db/core.ts";

const TEST_DATABASE_NAME_PREFIX = "uptech_phase1_test";
const API_LOGIN = `uptech_people_api_${process.pid}`;
const WORKER_LOGIN = `uptech_people_worker_${process.pid}`;
const PASSWORD = "people-permission-integration-only";

const TENANT_A = "a7000000-0000-0000-0000-000000000001";
const TENANT_B = "b7000000-0000-0000-0000-000000000001";
const TENANT_PREP = "c7000000-0000-0000-0000-000000000001";
const ACTOR_A = "a7010000-0000-0000-0000-000000000001";
const ACTOR_B = "b7010000-0000-0000-0000-000000000001";
const CONNECTOR_A = "a7020000-0000-0000-0000-000000000001";
const CONNECTOR_B = "b7020000-0000-0000-0000-000000000001";
const JOB_A = "a7030000-0000-0000-0000-000000000001";
const JOB_B = "b7030000-0000-0000-0000-000000000001";
const LEASE_A = "a7040000-0000-0000-0000-000000000001";
const LEASE_B = "b7040000-0000-0000-0000-000000000001";
const PREP_OWNER = [
  "c7050000-0000-0000-0000-000000000001",
  "c7060000-0000-0000-0000-000000000001",
  "c7070000-0000-0000-0000-000000000001",
  "tenant-prep-owner",
] as const;
const PREP_ADMIN = [
  "c7100000-0000-0000-0000-000000000001",
  "c7110000-0000-0000-0000-000000000001",
  "c7120000-0000-0000-0000-000000000001",
  "tenant-prep-admin",
] as const;
const DIRECTORY_SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.customer.readonly",
  "https://www.googleapis.com/auth/admin.directory.user.readonly",
  "https://www.googleapis.com/auth/admin.directory.group.readonly",
  "https://www.googleapis.com/auth/admin.directory.orgunit.readonly",
] as const;

const USERS = {
  ownerA: ["a7050000-0000-0000-0000-000000000001", "a7060000-0000-0000-0000-000000000001", "a7070000-0000-0000-0000-000000000001", "tenant-a-owner"],
  adminA: ["a7100000-0000-0000-0000-000000000001", "a7110000-0000-0000-0000-000000000001", "a7120000-0000-0000-0000-000000000001", "tenant-a-admin"],
  salesA: ["a7200000-0000-0000-0000-000000000001", "a7210000-0000-0000-0000-000000000001", "a7220000-0000-0000-0000-000000000001", "tenant-a-sales"],
  hrA: ["a7300000-0000-0000-0000-000000000001", "a7310000-0000-0000-0000-000000000001", "a7320000-0000-0000-0000-000000000001", "tenant-a-hr"],
  unmappedA: ["a7400000-0000-0000-0000-000000000001", "a7410000-0000-0000-0000-000000000001", "a7420000-0000-0000-0000-000000000001", "tenant-a-unmapped"],
  suspendedA: ["a7500000-0000-0000-0000-000000000001", "a7510000-0000-0000-0000-000000000001", "a7520000-0000-0000-0000-000000000001", "tenant-a-suspended"],
  financeA: ["a7600000-0000-0000-0000-000000000001", "a7610000-0000-0000-0000-000000000001", "a7620000-0000-0000-0000-000000000001", "tenant-a-finance"],
  adminB: ["b7100000-0000-0000-0000-000000000001", "b7110000-0000-0000-0000-000000000001", "b7120000-0000-0000-0000-000000000001", "tenant-b-admin"],
} as const;

type UserFixture = readonly [string, string, string, string];
let admin: Pool;
let api: Pool;
let worker: Pool;

function requiredDatabaseUrl(): string {
  const value = process.env.UPTECH_TEST_DATABASE_URL;
  if (!value) throw new Error("UPTECH_TEST_DATABASE_URL is required; enterprise PostgreSQL tests never skip");
  const name = decodeURIComponent(new URL(value).pathname.slice(1));
  if (!name.startsWith(TEST_DATABASE_NAME_PREFIX)) {
    throw new Error(`refusing non-disposable database: name must start with ${TEST_DATABASE_NAME_PREFIX}`);
  }
  return value;
}

function rolePool(login: string, role: string): Pool {
  const url = new URL(requiredDatabaseUrl());
  url.username = login;
  url.password = PASSWORD;
  return new Pool({ connectionString: url.toString(), max: 1, options: `-c role=${role}` });
}

async function asOwner<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE uptech_migration_owner");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function withWorkerLease<T>(workspaceId: string, jobId: string, fence: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await worker.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT set_config('app.workspace_id',$1,true),set_config('app.job_id',$2,true),set_config('app.lease_fence',$3,true)`,
      [workspaceId, jobId, fence],
    );
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function loadContext(workspaceId: string, fixture: UserFixture, sessionId: string): Promise<unknown[]> {
  const client = await api.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT set_config('app.workspace_id',$1,true),set_config('app.membership_id',$2,true),
              set_config('app.actor_id',$3,true),set_config('app.session_id',$4,true)`,
      [workspaceId, fixture[2], fixture[0], sessionId],
    );
    const result = await client.query("SELECT * FROM uptech.load_people_permission_context_v1()");
    await client.query("COMMIT");
    return result.rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function issueWebSession(workspaceId: string, fixture: UserFixture, sequence: number): Promise<{ sessionId: string; tokenHash: Buffer }> {
  const sessionId = randomUUID();
  const tokenHash = randomBytes(32);
  await asOwner(async (client) => {
    await client.query(
      `INSERT INTO uptech.sessions (
       workspace_id,id,identity_id,user_id,membership_id,client_type,status,
       user_security_version,identity_security_version,workspace_security_version,
       membership_authz_version,idle_expires_at,absolute_expires_at
     ) SELECT $1,$2,$3,$4,$5,'WEB','ACTIVE',u.security_version,i.security_version,
       w.security_version,m.authz_version,clock_timestamp()+interval '1 hour',
       clock_timestamp()+interval '1 day'
     FROM uptech.users u JOIN uptech.identities i ON i.id=$3 AND i.user_id=u.id
     JOIN uptech.workspaces w ON w.workspace_id=$1
     JOIN uptech.workspace_memberships m ON m.workspace_id=$1 AND m.id=$5 AND m.user_id=u.id
     WHERE u.id=$4`,
      [workspaceId, sessionId, fixture[1], fixture[0], fixture[2]],
    );
    await client.query(
      `INSERT INTO uptech.session_tokens (
       workspace_id,id,session_id,client_type,token_kind,token_status,token_hash,
       csrf_token_hash,session_security_version,rotation_version,expires_at
     ) VALUES ($1,$2,$3,'WEB','WEB_SESSION','CURRENT',$4,$5,1,1,clock_timestamp()+interval '1 hour')`,
      [workspaceId, randomUUID(), sessionId, tokenHash, Buffer.alloc(32, sequence)],
    );
  });
  return { sessionId, tokenHash };
}

async function withApiSessionContext<T>(
  workspaceId: string,
  fixture: UserFixture,
  sessionId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await api.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT set_config('app.workspace_id',$1,true),set_config('app.membership_id',$2,true),
              set_config('app.actor_id',$3,true),set_config('app.session_id',$4,true)`,
      [workspaceId, fixture[2], fixture[0], sessionId],
    );
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function issueNativeSession(workspaceId: string, fixture: UserFixture, sequence: number): Promise<{
  sessionId: string;
  accessTokenHash: Buffer;
  refreshTokenHash: Buffer;
  deviceBindingHash: Buffer;
}> {
  const sessionId = randomUUID();
  const accessTokenHash = randomBytes(32);
  const refreshTokenHash = randomBytes(32);
  const deviceBindingHash = Buffer.alloc(32, sequence);
  await asOwner(async (client) => {
    await client.query(
      `INSERT INTO uptech.sessions (
       workspace_id,id,identity_id,user_id,membership_id,client_type,status,
       user_security_version,identity_security_version,workspace_security_version,
       membership_authz_version,device_binding_hash,idle_expires_at,absolute_expires_at
     ) SELECT $1,$2,$3,$4,$5,'NATIVE','ACTIVE',u.security_version,i.security_version,
       w.security_version,m.authz_version,$6,clock_timestamp()+interval '1 hour',
       clock_timestamp()+interval '1 day'
     FROM uptech.users u JOIN uptech.identities i ON i.id=$3 AND i.user_id=u.id
     JOIN uptech.workspaces w ON w.workspace_id=$1
     JOIN uptech.workspace_memberships m ON m.workspace_id=$1 AND m.id=$5 AND m.user_id=u.id
     WHERE u.id=$4`,
      [workspaceId, sessionId, fixture[1], fixture[0], fixture[2], deviceBindingHash],
    );
    await client.query(
      `INSERT INTO uptech.session_tokens (
       workspace_id,id,session_id,client_type,token_kind,token_status,token_hash,
       session_security_version,rotation_version,expires_at
     ) VALUES
       ($1,$2,$3,'NATIVE','NATIVE_ACCESS','CURRENT',$4,1,1,clock_timestamp()+interval '15 minutes'),
       ($1,$5,$3,'NATIVE','NATIVE_REFRESH','CURRENT',$6,1,1,clock_timestamp()+interval '1 day')`,
      [workspaceId, randomUUID(), sessionId, accessTokenHash, randomUUID(), refreshTokenHash],
    );
  });
  return { sessionId, accessTokenHash, refreshTokenHash, deviceBindingHash };
}

before(async () => {
  admin = new Pool({ connectionString: requiredDatabaseUrl(), max: 6 });
  await admin.query(`
    CREATE ROLE ${API_LOGIN} LOGIN PASSWORD '${PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
    CREATE ROLE ${WORKER_LOGIN} LOGIN PASSWORD '${PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
    GRANT uptech_api_runtime TO ${API_LOGIN} WITH INHERIT FALSE, SET TRUE;
    GRANT uptech_worker_runtime TO ${WORKER_LOGIN} WITH INHERIT FALSE, SET TRUE;`);
  api = rolePool(API_LOGIN, "uptech_api_runtime");
  worker = rolePool(WORKER_LOGIN, "uptech_worker_runtime");

  await asOwner(async (client) => {
    await client.query("INSERT INTO uptech.workspaces (workspace_id,status,google_customer_id) VALUES ($1,'ACTIVE','customer-a'),($2,'ACTIVE','customer-b')", [TENANT_A, TENANT_B]);
    await client.query("INSERT INTO uptech.workspace_domain_locators (normalized_domain,workspace_id,status,verified_at) VALUES ('tenant-a.example',$1,'VERIFIED',clock_timestamp()),('tenant-b.example',$2,'VERIFIED',clock_timestamp())", [TENANT_A, TENANT_B]);
    await client.query("INSERT INTO uptech.service_actors (workspace_id,id,actor_kind,status) VALUES ($1,$2,'SYNC_WORKER','ACTIVE'),($3,$4,'SYNC_WORKER','ACTIVE')", [TENANT_A, ACTOR_A, TENANT_B, ACTOR_B]);
    await client.query("INSERT INTO uptech.connectors (workspace_id,id,purpose,status,provider_customer_id,credential_reference,directory_authorized_by_identity_id,directory_authorized_scopes) VALUES ($1,$2,'DIRECTORY','ACTIVE','customer-a','secretref://tenant-a-directory',$5,ARRAY['https://www.googleapis.com/auth/admin.directory.customer.readonly','https://www.googleapis.com/auth/admin.directory.user.readonly','https://www.googleapis.com/auth/admin.directory.group.readonly','https://www.googleapis.com/auth/admin.directory.orgunit.readonly']),($3,$4,'DIRECTORY','ACTIVE','customer-b','secretref://tenant-b-directory',$6,ARRAY['https://www.googleapis.com/auth/admin.directory.customer.readonly','https://www.googleapis.com/auth/admin.directory.user.readonly','https://www.googleapis.com/auth/admin.directory.group.readonly','https://www.googleapis.com/auth/admin.directory.orgunit.readonly'])", [TENANT_A, CONNECTOR_A, TENANT_B, CONNECTOR_B, USERS.ownerA[1], USERS.adminB[1]]);
    await client.query(
      `INSERT INTO uptech.sync_jobs (workspace_id,id,service_actor_id,connector_id,job_kind,status,dedupe_key,attempt_count,leased_at,lease_expires_at,lease_owner,lease_fence)
       VALUES ($1,$2,$3,$4,'DIRECTORY_SYNC','LEASED','tenant-a-directory',1,clock_timestamp(),clock_timestamp()+interval '1 hour',$5,$6),
              ($7,$8,$9,$10,'DIRECTORY_SYNC','LEASED','tenant-b-directory',1,clock_timestamp(),clock_timestamp()+interval '1 hour',$5,$11)`,
      [TENANT_A, JOB_A, ACTOR_A, CONNECTOR_A, WORKER_LOGIN, LEASE_A, TENANT_B, JOB_B, ACTOR_B, CONNECTOR_B, LEASE_B],
    );
    for (const fixture of Object.values(USERS)) {
      const workspaceId = fixture[3].startsWith("tenant-a-") ? TENANT_A : TENANT_B;
      const domain = workspaceId === TENANT_A ? "tenant-a.example" : "tenant-b.example";
      await client.query("INSERT INTO uptech.users (id,status) VALUES ($1,'ACTIVE')", [fixture[0]]);
      await client.query(
        `INSERT INTO uptech.identities (id,user_id,provider,issuer,provider_subject,status,email_claim,email_verified,hosted_domain_claim,claims_observed_at)
         VALUES ($1,$2,'GOOGLE','https://accounts.google.com',$3,'ACTIVE',$4,true,$5,clock_timestamp())`,
        [fixture[1], fixture[0], fixture[3], `${fixture[3]}@${domain}`, domain],
      );
      await client.query("INSERT INTO uptech.workspace_memberships (workspace_id,id,user_id,role,status) VALUES ($1,$2,$3,$4,'ACTIVE')", [workspaceId, fixture[2], fixture[0], fixture[3]==="tenant-a-owner" ? "OWNER" : "MEMBER"]);
    }
    await client.query(
      "INSERT INTO uptech.workspaces (workspace_id,status) VALUES ($1,'ACTIVE')",
      [TENANT_PREP],
    );
    await client.query(
      "INSERT INTO uptech.workspace_domain_locators (normalized_domain,workspace_id,status,verified_at) VALUES ('unknown.example',$1,'VERIFIED',clock_timestamp())",
      [TENANT_PREP],
    );
    for (const [fixture, role] of [[PREP_OWNER, "OWNER"], [PREP_ADMIN, "ADMIN"]] as const) {
      await client.query("INSERT INTO uptech.users (id,status) VALUES ($1,'ACTIVE')", [fixture[0]]);
      await client.query(
        `INSERT INTO uptech.identities (
           id,user_id,provider,issuer,provider_subject,status,email_claim,
           email_verified,hosted_domain_claim,claims_observed_at
         ) VALUES ($1,$2,'GOOGLE','https://accounts.google.com',$3,'ACTIVE',$4,true,'unknown.example',clock_timestamp())`,
        [fixture[1], fixture[0], fixture[3], `${fixture[3]}@unknown.example`],
      );
      await client.query(
        "INSERT INTO uptech.workspace_memberships (workspace_id,id,user_id,role,status) VALUES ($1,$2,$3,$4,'ACTIVE')",
        [TENANT_PREP, fixture[2], fixture[0], role],
      );
    }
    await client.query(
      `INSERT INTO uptech.people_permission_mappings (workspace_id,id,source_kind,source_value,target_role,target_department_key,status)
       VALUES ($1,$3,'ADMIN_GROUP','tenant-a-admin-group','ADMIN',NULL,'ACTIVE'),
              ($1,$4,'DEPARTMENT','sales','MEMBER','SALES','ACTIVE'),
               ($1,$5,'DEPARTMENT','hr','MEMBER','HR','ACTIVE'),
               ($1,$6,'DEPARTMENT','revenue','MEMBER','SALES','ACTIVE'),
               ($1,$7,'DEPARTMENT','finance','MEMBER','FINANCE','ACTIVE'),
               ($2,$8,'ADMIN_GROUP','tenant-b-admin-group','ADMIN',NULL,'ACTIVE'),
               ($1,$9,'GROUP','tenant-a-sales-group','MEMBER','SALES','ACTIVE')`,
      [TENANT_A, TENANT_B, randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()],
    );
  });
});

after(async () => {
  await api?.end();
  await worker?.end();
  if (admin) {
    await admin.query(`DROP ROLE IF EXISTS ${API_LOGIN}; DROP ROLE IF EXISTS ${WORKER_LOGIN};`);
    await admin.end();
  }
});

test("catalog contains only the lean People snapshot and mapping authority", async () => {
  const tables = ["people_group_memberships", "people_groups", "people_org_units", "people_permission_mappings", "people_profiles", "people_sync_generations"];
  const catalog = await asOwner((client) => client.query<{
    relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean; owner_policy: boolean;
  }>(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,
       EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname=c.relname||'_migration_owner'
         AND p.polroles=ARRAY['uptech_migration_owner'::regrole::oid]) AS owner_policy
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='uptech' AND c.relname=ANY($1::text[]) ORDER BY c.relname`, [tables]));
  assert.equal(catalog.rowCount ?? 0, tables.length);
  assert.ok(catalog.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity && row.owner_policy));
  const connectorMetadata = await asOwner((client) => client.query<{ provider_customer_id: string | null; credential_reference: string | null; directory_authorized_by_identity_id: string | null; directory_authorized_scopes: string[] | null }>(
    `SELECT provider_customer_id,credential_reference,directory_authorized_by_identity_id,directory_authorized_scopes
       FROM uptech.connectors WHERE workspace_id=$1 AND id=$2`, [TENANT_A, CONNECTOR_A],
  ));
  assert.deepEqual(connectorMetadata.rows, [{
    provider_customer_id: "customer-a",
    credential_reference: "secretref://tenant-a-directory",
    directory_authorized_by_identity_id: USERS.ownerA[1],
    directory_authorized_scopes: [
      "https://www.googleapis.com/auth/admin.directory.customer.readonly",
      "https://www.googleapis.com/auth/admin.directory.user.readonly",
      "https://www.googleapis.com/auth/admin.directory.group.readonly",
      "https://www.googleapis.com/auth/admin.directory.orgunit.readonly",
    ],
  }]);
  assert.equal((await asOwner((client)=>client.query("SELECT 1 FROM pg_indexes WHERE schemaname='uptech' AND indexname='people_sync_generations_one_published_workspace'"))).rowCount ?? 0,1);

  const forbidden = await asOwner((client) => client.query<{ object_name: string | null }>(
    `SELECT to_regclass('uptech.'||name)::text AS object_name FROM unnest(ARRAY[
       'enterprise_login_transactions','enterprise_discovery_rate_buckets','people_data_connections',
       'workspace_identity_connections','workspace_secret_envelopes','setup_sessions','setup_invitations','platform_operators'
     ]) AS forbidden(name)`,
  ));
  assert.deepEqual(forbidden.rows.map((row) => row.object_name), Array(8).fill(null));

  const routines = await asOwner((client) => client.query<{ name: string; prosecdef: boolean; config: string[] | null; public_execute: boolean }>(
    `SELECT p.proname AS name,p.prosecdef,p.proconfig AS config,
       EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
         WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='uptech' AND p.proname IN (
       'prepare_directory_consent_v1','activate_directory_connector_v1',
       'begin_people_sync_generation_v1',
       'stage_people_directory_customer_v1','stage_people_org_unit_v1',
       'stage_people_profile_v1','stage_people_profile_v2','stage_people_group_v1',
       'stage_people_group_membership_v1','publish_people_sync_generation_v1','load_people_permission_context_v1',
       'has_current_people_authority_v1','complete_web_google_login_directory_v1',
       'complete_mobile_google_callback_directory_v1',
       'mobile_directory_memberships_json_v1',
       'exchange_mobile_handoff_directory_v1','authenticate_mobile_access_directory_v1',
       'list_mobile_workspaces_directory_v1','rotate_mobile_refresh_directory_v1',
       'switch_mobile_workspace_directory_v1','lease_next_directory_job_v1')`,
  ));
  assert.equal(routines.rowCount ?? 0, 21);
  assert.ok(routines.rows.every((row) => row.prosecdef && row.config?.includes("search_path=pg_catalog, uptech") && !row.public_execute));
  await assert.rejects(worker.query("SELECT * FROM uptech.people_profiles"), /permission denied/u);
  await assert.rejects(api.query("SELECT * FROM uptech.people_permission_mappings"), /permission denied/u);
  await assert.rejects(api.query("UPDATE uptech.people_permission_mappings SET status='DISABLED'"), /permission denied/u);

  const bootstrapAuthority = await asOwner((client) => client.query<{
    owner_allowed: boolean;
    member_denied: boolean;
  }>(`SELECT
      uptech.has_current_people_authority_v1($1,$2,$3,$4) AS owner_allowed,
      NOT uptech.has_current_people_authority_v1($1,$5,$6,$7) AS member_denied`, [
    TENANT_A, USERS.ownerA[0], USERS.ownerA[1], USERS.ownerA[2],
    USERS.salesA[0], USERS.salesA[1], USERS.salesA[2],
  ]));
  assert.deepEqual(bootstrapAuthority.rows, [{ owner_allowed: false, member_denied: true }]);
});

type DirectoryConsentPreparation = {
  outcome: string;
  connector_id: string | null;
  provider_subject: string | null;
  provider_email: string | null;
  hosted_domain: string | null;
};

async function prepareDirectoryConsent(
  workspaceId: string,
  fixture: UserFixture,
  sessionId: string,
): Promise<DirectoryConsentPreparation> {
  return withApiSessionContext(workspaceId, fixture, sessionId, async (client) => {
    const prepared = await client.query<DirectoryConsentPreparation>(
      "SELECT * FROM uptech.prepare_directory_consent_v1($1)",
      [randomUUID()],
    );
    assert.equal(prepared.rowCount, 1);
    return prepared.rows[0];
  });
}

test("Directory consent preparation derives admin authority and reuses tenant setup anchors", async () => {
  const ownerSession = await issueWebSession(TENANT_PREP, PREP_OWNER, 41);
  const prepared = await prepareDirectoryConsent(
    TENANT_PREP,
    PREP_OWNER,
    ownerSession.sessionId,
  );
  assert.equal(prepared.outcome, "PREPARED");
  assert.ok(prepared.connector_id);
  assert.deepEqual({
    provider_subject: prepared.provider_subject,
    provider_email: prepared.provider_email,
    hosted_domain: prepared.hosted_domain,
  }, {
    provider_subject: PREP_OWNER[3],
    provider_email: "tenant-prep-owner@unknown.example",
    hosted_domain: "unknown.example",
  });

  const adminSession = await issueWebSession(TENANT_PREP, PREP_ADMIN, 42);
  const preparedByAdmin = await prepareDirectoryConsent(
    TENANT_PREP,
    PREP_ADMIN,
    adminSession.sessionId,
  );
  assert.deepEqual(preparedByAdmin, {
    outcome: "PREPARED",
    connector_id: prepared.connector_id,
    provider_subject: PREP_ADMIN[3],
    provider_email: "tenant-prep-admin@unknown.example",
    hosted_domain: "unknown.example",
  });

  const anchors = await asOwner((client) => client.query<{
    directory_connectors: number;
    active_workers: number;
    connector_status: string;
    provider_customer_id: string | null;
    credential_reference: string | null;
  }>(`SELECT
       (SELECT count(*)::int FROM uptech.connectors
         WHERE workspace_id=$1 AND purpose='DIRECTORY'
           AND status IN ('AUTHORIZING','ACTIVE','DEGRADED','DISCONNECTED')) AS directory_connectors,
       (SELECT count(*)::int FROM uptech.service_actors
         WHERE workspace_id=$1 AND actor_kind='SYNC_WORKER' AND status='ACTIVE') AS active_workers,
       connector.status AS connector_status,
       connector.provider_customer_id,
       connector.credential_reference
     FROM uptech.connectors AS connector
     WHERE connector.workspace_id=$1 AND connector.id=$2`, [
    TENANT_PREP,
    prepared.connector_id,
  ]));
  assert.deepEqual(anchors.rows, [{
    directory_connectors: 1,
    active_workers: 1,
    connector_status: "AUTHORIZING",
    provider_customer_id: null,
    credential_reference: null,
  }]);

  const memberSession = await issueWebSession(TENANT_A, USERS.salesA, 43);
  assert.deepEqual(
    await prepareDirectoryConsent(TENANT_A, USERS.salesA, memberSession.sessionId),
    {
      outcome: "DENIED",
      connector_id: null,
      provider_subject: null,
      provider_email: null,
      hosted_domain: null,
    },
  );

  assert.deepEqual(
    await prepareDirectoryConsent(TENANT_B, PREP_OWNER, ownerSession.sessionId),
    {
      outcome: "DENIED",
      connector_id: null,
      provider_subject: null,
      provider_email: null,
      hosted_domain: null,
    },
  );
});

test("Directory activation binds the initial customer only to matching consent identity and tenant", async () => {
  const ownerSession = await issueWebSession(TENANT_PREP, PREP_OWNER, 44);
  const prepared = await prepareDirectoryConsent(
    TENANT_PREP,
    PREP_OWNER,
    ownerSession.sessionId,
  );
  assert.equal(prepared.outcome, "PREPARED");
  assert.ok(prepared.connector_id);

  const activate = (
    connectorId: string,
    customerId: string,
    providerSubject: string,
    hostedDomain: string,
  ) => withApiSessionContext(TENANT_PREP, PREP_OWNER, ownerSession.sessionId, async (client) => {
    const result = await client.query<{
      outcome: string;
      previous_credential_reference: string | null;
    }>(
      "SELECT * FROM uptech.activate_directory_connector_v1($1,$2,$3,$4,$5,$6,$7)",
      [
        connectorId,
        customerId,
        "gcp-sm:v1:uptech-00000000-0000-0000-0000-000000000001",
        providerSubject,
        hostedDomain,
        [...DIRECTORY_SCOPES],
        randomUUID(),
      ],
    );
    return result.rows[0];
  });

  assert.deepEqual(
    await activate(prepared.connector_id, "customer-prep", USERS.adminB[3], "unknown.example"),
    { outcome: "DENIED", previous_credential_reference: null },
  );
  assert.deepEqual(
    await activate(prepared.connector_id, "customer-prep", PREP_OWNER[3], "tenant-b.example"),
    { outcome: "DENIED", previous_credential_reference: null },
  );
  assert.deepEqual(
    await activate(CONNECTOR_B, "customer-prep", PREP_OWNER[3], "unknown.example"),
    { outcome: "DENIED", previous_credential_reference: null },
  );
  assert.deepEqual(
    await activate(prepared.connector_id, "customer-b", PREP_OWNER[3], "unknown.example"),
    { outcome: "DENIED", previous_credential_reference: null },
  );

  const unbound = await asOwner((client) => client.query<{
    workspace_customer_id: string | null;
    connector_customer_id: string | null;
    credential_reference: string | null;
  }>(`SELECT workspace.google_customer_id AS workspace_customer_id,
            connector.provider_customer_id AS connector_customer_id,
            connector.credential_reference
       FROM uptech.workspaces AS workspace
       JOIN uptech.connectors AS connector ON connector.workspace_id=workspace.workspace_id
      WHERE workspace.workspace_id=$1 AND connector.id=$2`, [TENANT_PREP, prepared.connector_id]));
  assert.deepEqual(unbound.rows, [{
    workspace_customer_id: null,
    connector_customer_id: null,
    credential_reference: null,
  }]);

  assert.deepEqual(
    await activate(prepared.connector_id, "customer-prep", PREP_OWNER[3], "unknown.example"),
    { outcome: "ACTIVATED", previous_credential_reference: null },
  );
  const bound = await asOwner((client) => client.query<{
    workspace_customer_id: string;
    connector_customer_id: string;
    authorized_identity_id: string;
    status: string;
    queued_jobs: number;
  }>(`SELECT workspace.google_customer_id AS workspace_customer_id,
            connector.provider_customer_id AS connector_customer_id,
            connector.directory_authorized_by_identity_id AS authorized_identity_id,
            connector.status,
            (SELECT count(*)::int FROM uptech.sync_jobs AS job
              WHERE job.workspace_id=connector.workspace_id
                AND job.connector_id=connector.id
                AND job.job_kind='DIRECTORY_SYNC'
                AND job.status='QUEUED') AS queued_jobs
       FROM uptech.workspaces AS workspace
       JOIN uptech.connectors AS connector ON connector.workspace_id=workspace.workspace_id
      WHERE workspace.workspace_id=$1 AND connector.id=$2`, [TENANT_PREP, prepared.connector_id]));
  assert.deepEqual(bound.rows, [{
    workspace_customer_id: "customer-prep",
    connector_customer_id: "customer-prep",
    authorized_identity_id: PREP_OWNER[1],
    status: "ACTIVE",
    queued_jobs: 1,
  }]);
});

async function stageProfile(client: PoolClient, workspaceId: string, generationId: string, fence: string, profile: readonly string[]): Promise<void> {
  const result = await client.query(
    "SELECT * FROM uptech.stage_people_profile_v1($1,$2,$3,$4,$5,$6,$7,$8)",
    [workspaceId, generationId, fence, ...profile],
  );
  assert.equal(result.rows[0].outcome, "STAGED");
}

async function stageCustomer(
  client: PoolClient,
  workspaceId: string,
  generationId: string,
  fence: string,
  customerId: string,
  primaryDomain: string,
): Promise<void> {
  const result = await client.query(
    "SELECT * FROM uptech.stage_people_directory_customer_v1($1,$2,$3,$4,$5)",
    [workspaceId, generationId, fence, customerId, primaryDomain],
  );
  assert.equal(result.rows[0]?.outcome, "STAGED");
}

test("lease-bound generations derive tenant permission and revoke removed mappings", async () => {
  const generationA1 = randomUUID();
  const generationB1 = randomUUID();
  await withWorkerLease(TENANT_A, JOB_A, LEASE_A, async (client) => {
    assert.deepEqual((await client.query("SELECT * FROM uptech.begin_people_sync_generation_v1($1,$2,$3,$4)", [TENANT_A, generationA1, LEASE_A, randomUUID()])).rows[0],
      { outcome: "STARTED", generation_id: generationA1, connector_id: CONNECTOR_A });
    await stageCustomer(client, TENANT_A, generationA1, LEASE_A, "customer-a", "tenant-a.example");
    assert.equal((await client.query(
      "SELECT * FROM uptech.stage_people_org_unit_v1($1,$2,$3,$4,$5,$6)",
      [TENANT_A, generationA1, LEASE_A, "root", "/", null],
    )).rows[0].outcome, "STAGED");
    assert.equal((await client.query("SELECT * FROM uptech.begin_people_sync_generation_v1($1,$2,$3,$4)", [TENANT_A, randomUUID(), randomUUID(), randomUUID()])).rows[0].outcome, "DENIED");
    assert.equal((await client.query("SELECT * FROM uptech.stage_people_profile_v1($1,$2,$3,$4,$5,$6,$7,$8)", [TENANT_B, generationA1, LEASE_A, "tenant-b-confused", "Confused", "x@tenant-b.example", "HR", "ACTIVE"])).rows[0].outcome, "DENIED");
    await stageProfile(client, TENANT_A, generationA1, LEASE_A, [USERS.adminA[3], "Tenant A Admin", "admin@tenant-a.example", "Operations", "ACTIVE"]);
    await stageProfile(client, TENANT_A, generationA1, LEASE_A, [USERS.ownerA[3], "Tenant A Owner", "owner@tenant-a.example", "Sales", "ACTIVE"]);
    assert.equal((await client.query(
      "SELECT * FROM uptech.stage_people_profile_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [TENANT_A, generationA1, LEASE_A, USERS.salesA[3], "Tenant A Sales", "sales@tenant-a.example", "Unmapped Sales Org", "ACTIVE", "/", true, true],
    )).rows[0].outcome, "STAGED");
    const invalidOuSubject = "tenant-a-invalid-ou";
    assert.equal((await client.query(
      "SELECT * FROM uptech.stage_people_profile_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [TENANT_A, generationA1, LEASE_A, invalidOuSubject, "Invalid OU", "invalid-ou@tenant-a.example", "Sales", "ACTIVE", "", false, false],
    )).rows[0].outcome, "DENIED");
    await stageProfile(client, TENANT_A, generationA1, LEASE_A, [USERS.hrA[3], "Tenant A HR", "hr@tenant-a.example", "HR", "ACTIVE"]);
    await stageProfile(client, TENANT_A, generationA1, LEASE_A, [USERS.unmappedA[3], "Tenant A Unknown", "unknown@tenant-a.example", "Legal", "ACTIVE"]);
    await stageProfile(client, TENANT_A, generationA1, LEASE_A, [USERS.suspendedA[3], "Tenant A Lifecycle", "lifecycle@tenant-a.example", "Sales", "ACTIVE"]);
    await stageProfile(client, TENANT_A, generationA1, LEASE_A, [USERS.financeA[3], "Tenant A Finance", "finance@tenant-a.example", "Finance", "ACTIVE"]);
    assert.equal((await client.query("SELECT * FROM uptech.stage_people_group_v1($1,$2,$3,$4,$5)", [TENANT_A, generationA1, LEASE_A, "tenant-a-admin-group", "Tenant A Admins"])).rows[0].outcome, "STAGED");
    assert.equal((await client.query("SELECT * FROM uptech.stage_people_group_v1($1,$2,$3,$4,$5)", [TENANT_A, generationA1, LEASE_A, "tenant-a-sales-group", "Tenant A Sales"])).rows[0].outcome, "STAGED");
    assert.equal((await client.query("SELECT * FROM uptech.stage_people_group_membership_v1($1,$2,$3,$4,$5)", [TENANT_A, generationA1, LEASE_A, "tenant-a-admin-group", USERS.adminA[3]])).rows[0].outcome, "STAGED");
    assert.equal((await client.query("SELECT * FROM uptech.stage_people_group_membership_v1($1,$2,$3,$4,$5)", [TENANT_A, generationA1, LEASE_A, "tenant-a-admin-group", USERS.ownerA[3]])).rows[0].outcome, "STAGED");
    assert.equal((await client.query("SELECT * FROM uptech.stage_people_group_membership_v1($1,$2,$3,$4,$5)", [TENANT_A, generationA1, LEASE_A, "tenant-a-sales-group", USERS.salesA[3]])).rows[0].outcome, "STAGED");
    assert.equal((await client.query("SELECT * FROM uptech.publish_people_sync_generation_v1($1,$2,$3,$4,$5,$6)", [TENANT_A, generationA1, LEASE_A, false, new Date(Date.now() + 240_000), randomUUID()])).rows[0].outcome, "DENIED");
    assert.equal((await client.query("SELECT * FROM uptech.publish_people_sync_generation_v1($1,$2,$3,$4,$5,$6)", [TENANT_A, generationA1, LEASE_A, true, new Date(Date.now() + 240_000), randomUUID()])).rows[0].outcome, "PUBLISHED");
  });
  const recurringJob = await asOwner((client) => client.query<{
    status: string;
    attempt_count: number;
    is_scheduled_before_freshness_expiry: boolean;
    lease_cleared: boolean;
  }>(`SELECT job.status,job.attempt_count,
       job.available_at < generation.fresh_until AS is_scheduled_before_freshness_expiry,
       job.leased_at IS NULL AND job.lease_expires_at IS NULL
         AND job.lease_owner IS NULL AND job.lease_fence IS NULL
         AND job.completed_at IS NULL AND job.last_error_code IS NULL AS lease_cleared
     FROM uptech.sync_jobs AS job
     JOIN uptech.people_sync_generations AS generation
       ON generation.workspace_id=job.workspace_id AND generation.job_id=job.id
     WHERE job.workspace_id=$1 AND job.id=$2 AND generation.id=$3`, [TENANT_A, JOB_A, generationA1]));
  assert.deepEqual(recurringJob.rows, [{
    status: "QUEUED",
    attempt_count: 0,
    is_scheduled_before_freshness_expiry: true,
    lease_cleared: true,
  }]);
  assert.equal((await asOwner((owner) => owner.query(
    "SELECT 1 FROM uptech.people_profiles WHERE workspace_id=$1 AND generation_id=$2 AND google_subject=$3",
    [TENANT_A, generationA1, "tenant-a-invalid-ou"],
  ))).rowCount ?? 0, 0);
  await withWorkerLease(TENANT_B, JOB_B, LEASE_B, async (client) => {
    assert.equal((await client.query("SELECT * FROM uptech.begin_people_sync_generation_v1($1,$2,$3,$4)", [TENANT_B, generationB1, LEASE_B, randomUUID()])).rows[0].outcome, "STARTED");
    await stageCustomer(client, TENANT_B, generationB1, LEASE_B, "customer-b", "tenant-b.example");
    assert.equal((await client.query("SELECT * FROM uptech.stage_people_profile_v1($1,$2,$3,$4,$5,$6,$7,$8)",[TENANT_A,generationA1,LEASE_B,"tenant-cross","Cross","cross@tenant-a.example","Sales","ACTIVE"])).rows[0].outcome,"DENIED");
    await stageProfile(client, TENANT_B, generationB1, LEASE_B, [USERS.adminB[3], "Tenant B Admin", "admin@tenant-b.example", "Operations", "ACTIVE"]);
    assert.equal((await client.query("SELECT * FROM uptech.stage_people_group_v1($1,$2,$3,$4,$5)", [TENANT_B, generationB1, LEASE_B, "tenant-b-admin-group", "Tenant B Admins"])).rows[0].outcome, "STAGED");
    assert.equal((await client.query("SELECT * FROM uptech.stage_people_group_membership_v1($1,$2,$3,$4,$5)", [TENANT_B, generationB1, LEASE_B, "tenant-b-admin-group", USERS.adminB[3]])).rows[0].outcome, "STAGED");
    assert.equal((await client.query("SELECT * FROM uptech.publish_people_sync_generation_v1($1,$2,$3,$4,$5,$6)", [TENANT_B, generationB1, LEASE_B, true, new Date(Date.now() + 240_000), randomUUID()])).rows[0].outcome, "PUBLISHED");
  });

  const adminSession = await issueWebSession(TENANT_A, USERS.adminA, 1);
  const ownerSession = await issueWebSession(TENANT_A, USERS.ownerA, 6);
  const salesSession = await issueWebSession(TENANT_A, USERS.salesA, 2);
  const hrSession = await issueWebSession(TENANT_A, USERS.hrA, 3);
  const financeSession = await issueWebSession(TENANT_A, USERS.financeA, 7);
  const adminBSession = await issueWebSession(TENANT_B, USERS.adminB, 4);
  const lifecycleSession = await issueWebSession(TENANT_A, USERS.suspendedA, 5);
  assert.deepEqual(await loadContext(TENANT_A, USERS.adminA, adminSession.sessionId), [{ workspace_id: TENANT_A, membership_role: "ADMIN", department_key: null, direct_group_ids: ["tenant-a-admin-group"] }]);
  assert.deepEqual(await loadContext(TENANT_A, USERS.ownerA, ownerSession.sessionId), [{ workspace_id: TENANT_A, membership_role: "OWNER", department_key: null, direct_group_ids: ["tenant-a-admin-group"] }]);
  assert.deepEqual(await loadContext(TENANT_A, USERS.salesA, salesSession.sessionId), [{ workspace_id: TENANT_A, membership_role: "MEMBER", department_key: "SALES", direct_group_ids: ["tenant-a-sales-group"] }]);
  assert.deepEqual(await loadContext(TENANT_A, USERS.hrA, hrSession.sessionId), [{ workspace_id: TENANT_A, membership_role: "MEMBER", department_key: "HR", direct_group_ids: [] }]);
  assert.deepEqual(await loadContext(TENANT_A, USERS.financeA, financeSession.sessionId), [{ workspace_id: TENANT_A, membership_role: "MEMBER", department_key: "FINANCE", direct_group_ids: [] }]);
  assert.deepEqual(await loadContext(TENANT_B, USERS.adminA, adminSession.sessionId), []);
  assert.deepEqual(await loadContext(TENANT_A, USERS.unmappedA, randomUUID()), []);

  const ownerNative = await issueNativeSession(TENANT_A, USERS.ownerA, 20);
  const salesNative = await issueNativeSession(TENANT_A, USERS.salesA, 21);
  const adminBNativeAccess = await issueNativeSession(TENANT_B, USERS.adminB, 22);
  const adminBNativeRefresh = await issueNativeSession(TENANT_B, USERS.adminB, 23);
  assert.equal((await api.query(
    "SELECT outcome::text FROM uptech.authenticate_mobile_access_directory_v1($1)",
    [ownerNative.accessTokenHash],
  )).rows[0]?.outcome, "AUTHORIZED");
  assert.equal((await api.query(
    "SELECT outcome::text FROM uptech.authenticate_mobile_access_directory_v1($1)",
    [salesNative.accessTokenHash],
  )).rows[0]?.outcome, "AUTHORIZED");

  const unauthorizedTenantBMembership = randomUUID();
  await asOwner((client) => client.query(
    "INSERT INTO uptech.workspace_memberships (workspace_id,id,user_id,role,status) VALUES ($1,$2,$3,'MEMBER','ACTIVE')",
    [TENANT_B, unauthorizedTenantBMembership, USERS.salesA[0]],
  ));
  const mobileWorkspaceList = await api.query<{ outcome: string; memberships: Array<{ workspace_id: string }> }>(
    "SELECT outcome::text,memberships FROM uptech.list_mobile_workspaces_directory_v1($1)",
    [salesNative.accessTokenHash],
  );
  assert.equal(mobileWorkspaceList.rows[0]?.outcome, "AUTHORIZED");
  assert.deepEqual(mobileWorkspaceList.rows[0]?.memberships.map((entry) => entry.workspace_id), [TENANT_A]);
  const deniedSwitch = await api.query(
    `SELECT outcome::text,replay_capsule,access_expires_at,refresh_expires_at
       FROM uptech.switch_mobile_workspace_directory_v1($1,$2,$3,$4,$5,$6,$7,$8)`,
    [salesNative.accessTokenHash, TENANT_B, salesNative.deviceBindingHash, randomBytes(32),
      randomBytes(32), Buffer.alloc(115, 9), "directory-denied-switch", randomUUID()],
  );
  assert.deepEqual(deniedSwitch.rows, [{
    outcome: "DENIED", replay_capsule: null, access_expires_at: null, refresh_expires_at: null,
  }]);
  await asOwner((client)=>client.query("UPDATE uptech.people_permission_mappings SET status='DISABLED' WHERE workspace_id=$1 AND source_kind='DEPARTMENT' AND source_value='sales'",[TENANT_A]));
  assert.equal((await loadContext(TENANT_A,USERS.salesA,salesSession.sessionId) as Array<{department_key:string}>)[0].department_key,"SALES");
  await asOwner((client)=>client.query("UPDATE uptech.people_permission_mappings SET status='ACTIVE' WHERE workspace_id=$1 AND source_kind='DEPARTMENT' AND source_value='sales'",[TENANT_A]));
  assert.equal(authorizeKnowledgeAccess(TEST_PERSONAS.sales.subject,"document.read",TEST_DOCUMENTS.hr).decision,"DENY");
  assert.equal(authorizeKnowledgeAccess(TEST_PERSONAS.hr.subject,"document.read",TEST_DOCUMENTS.sales).decision,"DENY");
  assert.equal(TEST_PERSONAS.sales.subject.workspaceRole,"MEMBER");
  const salesRouteContext = await authenticateSession(salesSession.tokenHash, api);
  if (
    salesRouteContext?.kind !== "session" ||
    salesRouteContext.csrfTokenHash === null
  ) {
    throw new Error("expected an authenticated Web session context");
  }
  const salesCsrfTokenHash = salesRouteContext.csrfTokenHash;
  assert.equal(await resolveWebRouteAuthority(new Headers(),"ADMIN",{
    loadConfig:()=>({databaseUrl:"postgres://unused",sessionPepper:new Uint8Array(32)}),
    getPool:()=>api,
    authenticate:async()=>({
      rawCredential:"integration-only",
      credentialHash:salesSession.tokenHash,
      csrfCredential:"integration-only",
      context:{
        ...salesRouteContext,
        csrfTokenHash:salesCsrfTokenHash,
      },
    }),
  }),"HOME");
  const denied = await asOwner((client) => client.query<{ subject: string; status: string }>(
    `SELECT i.provider_subject AS subject,m.status FROM uptech.workspace_memberships m JOIN uptech.identities i ON i.user_id=m.user_id
     WHERE m.workspace_id=$1 AND i.provider_subject=$2`, [TENANT_A, USERS.unmappedA[3]],
  ));
  assert.deepEqual(denied.rows, [{ subject: USERS.unmappedA[3], status: "SUSPENDED" }]);

  const generationA2 = randomUUID();
  await asOwner((client) => client.query(
    "UPDATE uptech.sync_jobs SET available_at='2000-01-01T00:00:00Z'::timestamptz WHERE workspace_id=$1 AND id=$2",
    [TENANT_A, JOB_A],
  ));
  const nextLease = await worker.query<{
    workspace_id: string;
    job_id: string;
    lease_fence: string;
  }>("SELECT workspace_id,job_id,lease_fence FROM uptech.lease_next_directory_job_v1()");
  assert.equal(nextLease.rows[0]?.workspace_id, TENANT_A);
  assert.equal(nextLease.rows[0]?.job_id, JOB_A);
  assert.notEqual(nextLease.rows[0]?.lease_fence, LEASE_A);
  const nextLeaseFence = nextLease.rows[0]?.lease_fence;
  assert.ok(nextLeaseFence);
  await withWorkerLease(TENANT_A, JOB_A, nextLeaseFence, async (client) => {
    assert.equal((await client.query("SELECT * FROM uptech.begin_people_sync_generation_v1($1,$2,$3,$4)", [TENANT_A, generationA2, nextLeaseFence, randomUUID()])).rows[0].outcome, "STARTED");
    await stageCustomer(client, TENANT_A, generationA2, nextLeaseFence, "customer-a", "tenant-a.example");
    await asOwner((owner)=>owner.query("UPDATE uptech.service_actors SET status='REVOKED' WHERE workspace_id=$1 AND id=$2",[TENANT_A,ACTOR_A]));
    assert.equal((await client.query("SELECT * FROM uptech.stage_people_profile_v1($1,$2,$3,$4,$5,$6,$7,$8)",[TENANT_A,generationA2,nextLeaseFence,"revoked-worker","Denied","denied@tenant-a.example","Sales","ACTIVE"])).rows[0].outcome,"DENIED");
    await asOwner((owner)=>owner.query("UPDATE uptech.service_actors SET status='ACTIVE' WHERE workspace_id=$1 AND id=$2",[TENANT_A,ACTOR_A]));
    await stageProfile(client, TENANT_A, generationA2, nextLeaseFence, [USERS.adminA[3], "Tenant A Admin", "admin@tenant-a.example", "Operations", "ACTIVE"]);
    await stageProfile(client, TENANT_A, generationA2, nextLeaseFence, [USERS.salesA[3], "Tenant A Sales", "sales@tenant-a.example", "Revenue", "ACTIVE"]);
    await stageProfile(client, TENANT_A, generationA2, nextLeaseFence, [USERS.suspendedA[3], "Tenant A Lifecycle", "lifecycle@tenant-a.example", "Sales", "SUSPENDED"]);
    assert.equal((await client.query("SELECT * FROM uptech.stage_people_group_v1($1,$2,$3,$4,$5)", [TENANT_A,generationA2,nextLeaseFence,"unmapped-newsletter","Newsletter"])).rows[0].outcome,"STAGED");
    assert.equal((await client.query("SELECT * FROM uptech.stage_people_group_membership_v1($1,$2,$3,$4,$5)", [TENANT_A,generationA2,nextLeaseFence,"unmapped-newsletter",USERS.salesA[3]])).rows[0].outcome,"STAGED");
    await asOwner((owner)=>owner.query("UPDATE uptech.service_actors SET status='REVOKED' WHERE workspace_id=$1 AND id=$2",[TENANT_A,ACTOR_A]));
    assert.equal((await client.query("SELECT * FROM uptech.publish_people_sync_generation_v1($1,$2,$3,$4,$5,$6)", [TENANT_A, generationA2, nextLeaseFence, true, new Date(Date.now() + 240_000), randomUUID()])).rows[0].outcome, "DENIED");
    await asOwner((owner)=>owner.query("UPDATE uptech.service_actors SET status='ACTIVE' WHERE workspace_id=$1 AND id=$2",[TENANT_A,ACTOR_A]));
    assert.equal((await client.query("SELECT * FROM uptech.publish_people_sync_generation_v1($1,$2,$3,$4,$5,$6)", [TENANT_A, generationA2, nextLeaseFence, true, new Date(Date.now() + 240_000), randomUUID()])).rows[0].outcome, "PUBLISHED");
  });
  const revoked = await asOwner((client) => client.query<{ membership_status: string; session_status: string; token_status: string }>(
    `SELECT m.status AS membership_status,s.status AS session_status,t.token_status FROM uptech.workspace_memberships m
     JOIN uptech.sessions s ON s.workspace_id=m.workspace_id AND s.membership_id=m.id
     JOIN uptech.session_tokens t ON t.workspace_id=s.workspace_id AND t.session_id=s.id
     WHERE m.workspace_id=$1 AND m.id=$2 AND s.id=$3`, [TENANT_A, USERS.adminA[2], adminSession.sessionId],
  ));
  assert.deepEqual(revoked.rows, [{ membership_status: "SUSPENDED", session_status: "REVOKED", token_status: "REVOKED" }]);
  assert.equal((await api.query("SELECT * FROM uptech.authenticate_session($1)", [adminSession.tokenHash])).rowCount ?? 0, 0);
  const removedSalesGroup = await asOwner((client) => client.query<{ session_status: string; token_status: string }>(
    `SELECT s.status AS session_status,t.token_status FROM uptech.sessions s JOIN uptech.session_tokens t
     ON t.workspace_id=s.workspace_id AND t.session_id=s.id WHERE s.workspace_id=$1 AND s.id=$2`,
    [TENANT_A, salesSession.sessionId],
  ));
  assert.deepEqual(removedSalesGroup.rows, [{ session_status: "REVOKED", token_status: "REVOKED" }]);
  assert.equal((await api.query("SELECT * FROM uptech.authenticate_session($1)", [salesSession.tokenHash])).rowCount ?? 0, 0);
  const removedOwner = await asOwner((client)=>client.query<{
    membership_status:string; session_status:string; token_status:string;
  }>(`SELECT m.status AS membership_status,s.status AS session_status,t.token_status
     FROM uptech.workspace_memberships m
     JOIN uptech.sessions s ON s.workspace_id=m.workspace_id AND s.membership_id=m.id
     JOIN uptech.session_tokens t ON t.workspace_id=s.workspace_id AND t.session_id=s.id
     WHERE m.workspace_id=$1 AND m.id=$2 AND s.id=$3`, [
    TENANT_A, USERS.ownerA[2], ownerSession.sessionId,
  ]));
  assert.deepEqual(removedOwner.rows, [{
    membership_status:"SUSPENDED", session_status:"REVOKED", token_status:"REVOKED",
  }]);
  assert.equal((await api.query("SELECT * FROM uptech.authenticate_session($1)",[ownerSession.tokenHash])).rowCount ?? 0,0);
  assert.deepEqual(await loadContext(TENANT_A, USERS.ownerA, ownerSession.sessionId), []);
  assert.equal((await api.query("SELECT * FROM uptech.authenticate_session($1)", [hrSession.tokenHash])).rowCount ?? 0, 0);
  assert.equal((await api.query("SELECT * FROM uptech.authenticate_session($1)", [lifecycleSession.tokenHash])).rowCount ?? 0, 0);

  await asOwner((client) => client.query("UPDATE uptech.people_sync_generations SET fresh_until=completed_at+interval '1 microsecond' WHERE workspace_id=$1 AND id=$2", [TENANT_B, generationB1]));
  assert.deepEqual(await loadContext(TENANT_B, USERS.adminB, adminBSession.sessionId), []);
  const staleRefresh = await api.query(
    `SELECT outcome::text,replay_capsule,access_expires_at,refresh_expires_at
       FROM uptech.rotate_mobile_refresh_directory_v1($1,$2,$3,$4,$5,$6,$7)`,
    [adminBNativeRefresh.refreshTokenHash, adminBNativeRefresh.deviceBindingHash,
      randomBytes(32), randomBytes(32), Buffer.alloc(115, 4), "stale-directory-refresh", randomUUID()],
  );
  assert.deepEqual(staleRefresh.rows, [{
    outcome: "SESSION_REVOKED", replay_capsule: null, access_expires_at: null, refresh_expires_at: null,
  }]);
  const staleAccess = await api.query(
    `SELECT outcome::text,session_id,user_id,identity_id,workspace_id,membership_id,workspace_role
       FROM uptech.authenticate_mobile_access_directory_v1($1)`,
    [adminBNativeAccess.accessTokenHash],
  );
  assert.deepEqual(staleAccess.rows, [{
    outcome: "SESSION_REVOKED", session_id: null, user_id: null, identity_id: null,
    workspace_id: null, membership_id: null, workspace_role: null,
  }]);
});

test("Directory reauthorization reuses one tenant job and never leases Drive work", async () => {
  const ownerSession = await issueWebSession(TENANT_PREP, PREP_OWNER, 45);
  const prepared = await prepareDirectoryConsent(
    TENANT_PREP,
    PREP_OWNER,
    ownerSession.sessionId,
  );
  assert.equal(prepared.outcome, "PREPARED");
  assert.ok(prepared.connector_id);

  const credentialReferences = [
    "gcp-sm:v1:uptech-00000000-0000-0000-0000-000000000011",
    "gcp-sm:v1:uptech-00000000-0000-0000-0000-000000000012",
  ] as const;
  const previousCredentialReferences: Array<string | null> = [];
  for (let call = 0; call < 2; call += 1) {
    await withApiSessionContext(
      TENANT_PREP,
      PREP_OWNER,
      ownerSession.sessionId,
      async (client) => {
      const activation = await client.query<{
        outcome: string;
        previous_credential_reference: string | null;
      }>(
        "SELECT * FROM uptech.activate_directory_connector_v1($1,$2,$3,$4,$5,$6,$7)",
        [
          prepared.connector_id,
          "customer-prep",
          credentialReferences[call],
          PREP_OWNER[3],
          "unknown.example",
          [...DIRECTORY_SCOPES],
          randomUUID(),
        ],
      );
      assert.equal(activation.rows[0]?.outcome, "ACTIVATED");
      previousCredentialReferences.push(
        activation.rows[0]?.previous_credential_reference ?? null,
      );
      },
    );
  }
  assert.equal(previousCredentialReferences[1], credentialReferences[0]);

  const jobs = await asOwner((client) => client.query<{
    workspace_id: string;
    connector_id: string;
    service_actor_id: string;
    job_kind: string;
    status: string;
    attempt_count: number;
    lease_cleared: boolean;
    is_available: boolean;
  }>(`SELECT workspace_id,connector_id,service_actor_id,job_kind,status,attempt_count,
       leased_at IS NULL AND lease_expires_at IS NULL AND lease_owner IS NULL
         AND lease_fence IS NULL AND completed_at IS NULL AS lease_cleared,
       available_at <= statement_timestamp() AS is_available
     FROM uptech.sync_jobs
     WHERE workspace_id=$1 AND connector_id=$2`, [TENANT_PREP, prepared.connector_id]));
  assert.equal(jobs.rowCount, 1);
  assert.deepEqual(jobs.rows, [{
    workspace_id: TENANT_PREP,
    connector_id: prepared.connector_id,
    service_actor_id: jobs.rows[0]?.service_actor_id,
    job_kind: "DIRECTORY_SYNC",
    status: "QUEUED",
    attempt_count: 0,
    lease_cleared: true,
    is_available: true,
  }]);

  const driveConnectorId = randomUUID();
  const driveSourceId = randomUUID();
  const driveJobId = randomUUID();
  const prepActorId = jobs.rows[0]?.service_actor_id;
  assert.ok(prepActorId);
  await asOwner(async (client) => {
    await client.query(
      `UPDATE uptech.sync_jobs SET available_at=clock_timestamp()+interval '1 hour'
        WHERE job_kind='DIRECTORY_SYNC' AND workspace_id<>$1`,
      [TENANT_PREP],
    );
    await client.query(
      "INSERT INTO uptech.connectors (workspace_id,id,purpose,status) VALUES ($1,$2,'DRIVE','ACTIVE')",
      [TENANT_PREP, driveConnectorId],
    );
    await client.query(
      "INSERT INTO uptech.sources (workspace_id,id,connector_id,source_kind,status) VALUES ($1,$2,$3,'GOOGLE_DRIVE','ACTIVE')",
      [TENANT_PREP, driveSourceId, driveConnectorId],
    );
    await client.query(
      `INSERT INTO uptech.sync_jobs
         (workspace_id,id,service_actor_id,connector_id,source_id,job_kind,status,priority,dedupe_key)
       VALUES ($1,$2,$3,$4,$5,'DRIVE_SYNC','QUEUED',100,$6)`,
      [TENANT_PREP, driveJobId, prepActorId, driveConnectorId, driveSourceId, `drive-sync:${driveSourceId}`],
    );
  });

  const directoryLease = await worker.query<{
    workspace_id: string;
    job_id: string;
    job_kind: string;
    connector_id: string;
  }>("SELECT workspace_id,job_id,job_kind,connector_id FROM uptech.lease_next_directory_job_v1()");
  assert.deepEqual(directoryLease.rows.map((row) => ({
    workspace_id: row.workspace_id,
    job_kind: row.job_kind,
    connector_id: row.connector_id,
  })), [{
    workspace_id: TENANT_PREP,
    job_kind: "DIRECTORY_SYNC",
    connector_id: prepared.connector_id,
  }]);
  assert.deepEqual((await asOwner((client) => client.query<{ status: string; attempt_count: number }>(
    "SELECT status,attempt_count FROM uptech.sync_jobs WHERE workspace_id=$1 AND id=$2",
    [TENANT_PREP, driveJobId],
  ))).rows, [{ status: "QUEUED", attempt_count: 0 }]);
});
