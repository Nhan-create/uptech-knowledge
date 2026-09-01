import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import { Pool, type PoolClient } from "pg";
import { TEST_DOCUMENTS, TEST_PERSONAS } from "../fixtures/multitenant-department-personas.ts";
import { authorizeKnowledgeAccess } from "../../src/server/domain/knowledge-access.ts";
import { resolveWebRouteAuthority } from "../../src/server/auth/web-route-authority.ts";

const TEST_DATABASE_NAME_PREFIX = "uptech_phase1_test";
const API_LOGIN = `uptech_people_api_${process.pid}`;
const WORKER_LOGIN = `uptech_people_worker_${process.pid}`;
const PASSWORD = "people-permission-integration-only";

const TENANT_A = "a7000000-0000-0000-0000-000000000001";
const TENANT_B = "b7000000-0000-0000-0000-000000000001";
const ACTOR_A = "a7010000-0000-0000-0000-000000000001";
const ACTOR_B = "b7010000-0000-0000-0000-000000000001";
const CONNECTOR_A = "a7020000-0000-0000-0000-000000000001";
const CONNECTOR_B = "b7020000-0000-0000-0000-000000000001";
const JOB_A = "a7030000-0000-0000-0000-000000000001";
const JOB_B = "b7030000-0000-0000-0000-000000000001";
const LEASE_A = "a7040000-0000-0000-0000-000000000001";
const LEASE_B = "b7040000-0000-0000-0000-000000000001";

const USERS = {
  ownerA: ["a7050000-0000-0000-0000-000000000001", "a7060000-0000-0000-0000-000000000001", "a7070000-0000-0000-0000-000000000001", "tenant-a-owner"],
  adminA: ["a7100000-0000-0000-0000-000000000001", "a7110000-0000-0000-0000-000000000001", "a7120000-0000-0000-0000-000000000001", "tenant-a-admin"],
  salesA: ["a7200000-0000-0000-0000-000000000001", "a7210000-0000-0000-0000-000000000001", "a7220000-0000-0000-0000-000000000001", "tenant-a-sales"],
  hrA: ["a7300000-0000-0000-0000-000000000001", "a7310000-0000-0000-0000-000000000001", "a7320000-0000-0000-0000-000000000001", "tenant-a-hr"],
  unmappedA: ["a7400000-0000-0000-0000-000000000001", "a7410000-0000-0000-0000-000000000001", "a7420000-0000-0000-0000-000000000001", "tenant-a-unmapped"],
  suspendedA: ["a7500000-0000-0000-0000-000000000001", "a7510000-0000-0000-0000-000000000001", "a7520000-0000-0000-0000-000000000001", "tenant-a-suspended"],
  adminB: ["b7100000-0000-0000-0000-000000000001", "b7110000-0000-0000-0000-000000000001", "b7120000-0000-0000-0000-000000000001", "tenant-b-admin"],
} as const;

type UserFixture = (typeof USERS)[keyof typeof USERS];
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
    await client.query("INSERT INTO uptech.workspaces (workspace_id,status) VALUES ($1,'ACTIVE'),($2,'ACTIVE')", [TENANT_A, TENANT_B]);
    await client.query("INSERT INTO uptech.service_actors (workspace_id,id,actor_kind,status) VALUES ($1,$2,'SYNC_WORKER','ACTIVE'),($3,$4,'SYNC_WORKER','ACTIVE')", [TENANT_A, ACTOR_A, TENANT_B, ACTOR_B]);
    await client.query("INSERT INTO uptech.connectors (workspace_id,id,purpose,status) VALUES ($1,$2,'DIRECTORY','ACTIVE'),($3,$4,'DIRECTORY','ACTIVE')", [TENANT_A, CONNECTOR_A, TENANT_B, CONNECTOR_B]);
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
      `INSERT INTO uptech.people_permission_mappings (workspace_id,id,source_kind,source_value,target_role,target_department_key,status)
       VALUES ($1,$3,'ADMIN_GROUP','tenant-a-admin-group','ADMIN',NULL,'ACTIVE'),
              ($1,$4,'DEPARTMENT','sales','MEMBER','SALES','ACTIVE'),
              ($1,$5,'DEPARTMENT','hr','MEMBER','HR','ACTIVE'),
              ($1,$6,'DEPARTMENT','revenue','MEMBER','SALES','ACTIVE'),
              ($2,$7,'ADMIN_GROUP','tenant-b-admin-group','ADMIN',NULL,'ACTIVE')`,
      [TENANT_A, TENANT_B, randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()],
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
  const tables = ["people_group_memberships", "people_groups", "people_permission_mappings", "people_profiles", "people_sync_generations"];
  const catalog = await asOwner((client) => client.query<{
    relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean; owner_policy: boolean;
  }>(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,
       EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname=c.relname||'_migration_owner'
         AND p.polroles=ARRAY['uptech_migration_owner'::regrole::oid]) AS owner_policy
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='uptech' AND c.relname=ANY($1::text[]) ORDER BY c.relname`, [tables]));
  assert.equal(catalog.rowCount ?? 0, tables.length);
  assert.ok(catalog.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity && row.owner_policy));
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
       'begin_people_sync_generation_v1','stage_people_profile_v1','stage_people_group_v1',
       'stage_people_group_membership_v1','publish_people_sync_generation_v1','load_people_permission_context_v1')`,
  ));
  assert.equal(routines.rowCount ?? 0, 6);
  assert.ok(routines.rows.every((row) => row.prosecdef && row.config?.includes("search_path=pg_catalog, uptech") && !row.public_execute));
  await assert.rejects(worker.query("SELECT * FROM uptech.people_profiles"), /permission denied/u);
  await assert.rejects(api.query("SELECT * FROM uptech.people_permission_mappings"), /permission denied/u);
  await assert.rejects(api.query("UPDATE uptech.people_permission_mappings SET status='DISABLED'"), /permission denied/u);
});

async function stageProfile(client: PoolClient, workspaceId: string, generationId: string, fence: string, profile: readonly string[]): Promise<void> {
  const result = await client.query(
    "SELECT * FROM uptech.stage_people_profile_v1($1,$2,$3,$4,$5,$6,$7,$8)",
    [workspaceId, generationId, fence, ...profile],
  );
  assert.equal(result.rows[0].outcome, "STAGED");
}

test("lease-bound generations derive tenant permission and revoke removed mappings", async () => {
  const generationA1 = randomUUID();
  const generationB1 = randomUUID();
  await withWorkerLease(TENANT_A, JOB_A, LEASE_A, async (client) => {
    assert.deepEqual((await client.query("SELECT * FROM uptech.begin_people_sync_generation_v1($1,$2,$3,$4)", [TENANT_A, generationA1, LEASE_A, randomUUID()])).rows[0],
      { outcome: "STARTED", generation_id: generationA1, connector_id: CONNECTOR_A });
    assert.equal((await client.query("SELECT * FROM uptech.begin_people_sync_generation_v1($1,$2,$3,$4)", [TENANT_A, randomUUID(), randomUUID(), randomUUID()])).rows[0].outcome, "DENIED");
    assert.equal((await client.query("SELECT * FROM uptech.stage_people_profile_v1($1,$2,$3,$4,$5,$6,$7,$8)", [TENANT_B, generationA1, LEASE_A, "tenant-b-confused", "Confused", "x@tenant-b.example", "HR", "ACTIVE"])).rows[0].outcome, "DENIED");
    await stageProfile(client, TENANT_A, generationA1, LEASE_A, [USERS.adminA[3], "Tenant A Admin", "admin@tenant-a.example", "Operations", "ACTIVE"]);
    await stageProfile(client, TENANT_A, generationA1, LEASE_A, [USERS.ownerA[3], "Tenant A Owner", "owner@tenant-a.example", "Sales", "ACTIVE"]);
    await stageProfile(client, TENANT_A, generationA1, LEASE_A, [USERS.salesA[3], "Tenant A Sales", "sales@tenant-a.example", "Sales", "ACTIVE"]);
    await stageProfile(client, TENANT_A, generationA1, LEASE_A, [USERS.hrA[3], "Tenant A HR", "hr@tenant-a.example", "HR", "ACTIVE"]);
    await stageProfile(client, TENANT_A, generationA1, LEASE_A, [USERS.unmappedA[3], "Tenant A Unknown", "unknown@tenant-a.example", "Finance", "ACTIVE"]);
    await stageProfile(client, TENANT_A, generationA1, LEASE_A, [USERS.suspendedA[3], "Tenant A Lifecycle", "lifecycle@tenant-a.example", "Sales", "ACTIVE"]);
    assert.equal((await client.query("SELECT * FROM uptech.stage_people_group_v1($1,$2,$3,$4,$5)", [TENANT_A, generationA1, LEASE_A, "tenant-a-admin-group", "Tenant A Admins"])).rows[0].outcome, "STAGED");
    assert.equal((await client.query("SELECT * FROM uptech.stage_people_group_membership_v1($1,$2,$3,$4,$5)", [TENANT_A, generationA1, LEASE_A, "tenant-a-admin-group", USERS.adminA[3]])).rows[0].outcome, "STAGED");
    assert.equal((await client.query("SELECT * FROM uptech.stage_people_group_membership_v1($1,$2,$3,$4,$5)", [TENANT_A, generationA1, LEASE_A, "tenant-a-admin-group", USERS.ownerA[3]])).rows[0].outcome, "STAGED");
    assert.equal((await client.query("SELECT * FROM uptech.publish_people_sync_generation_v1($1,$2,$3,$4,$5,$6)", [TENANT_A, generationA1, LEASE_A, false, new Date(Date.now() + 3_600_000), randomUUID()])).rows[0].outcome, "DENIED");
    assert.equal((await client.query("SELECT * FROM uptech.publish_people_sync_generation_v1($1,$2,$3,$4,$5,$6)", [TENANT_A, generationA1, LEASE_A, true, new Date(Date.now() + 3_600_000), randomUUID()])).rows[0].outcome, "PUBLISHED");
  });
  await withWorkerLease(TENANT_B, JOB_B, LEASE_B, async (client) => {
    assert.equal((await client.query("SELECT * FROM uptech.begin_people_sync_generation_v1($1,$2,$3,$4)", [TENANT_B, generationB1, LEASE_B, randomUUID()])).rows[0].outcome, "STARTED");
    assert.equal((await client.query("SELECT * FROM uptech.stage_people_profile_v1($1,$2,$3,$4,$5,$6,$7,$8)",[TENANT_A,generationA1,LEASE_B,"tenant-cross","Cross","cross@tenant-a.example","Sales","ACTIVE"])).rows[0].outcome,"DENIED");
    await stageProfile(client, TENANT_B, generationB1, LEASE_B, [USERS.adminB[3], "Tenant B Admin", "admin@tenant-b.example", "Operations", "ACTIVE"]);
    assert.equal((await client.query("SELECT * FROM uptech.stage_people_group_v1($1,$2,$3,$4,$5)", [TENANT_B, generationB1, LEASE_B, "tenant-b-admin-group", "Tenant B Admins"])).rows[0].outcome, "STAGED");
    assert.equal((await client.query("SELECT * FROM uptech.stage_people_group_membership_v1($1,$2,$3,$4,$5)", [TENANT_B, generationB1, LEASE_B, "tenant-b-admin-group", USERS.adminB[3]])).rows[0].outcome, "STAGED");
    assert.equal((await client.query("SELECT * FROM uptech.publish_people_sync_generation_v1($1,$2,$3,$4,$5,$6)", [TENANT_B, generationB1, LEASE_B, true, new Date(Date.now() + 3_600_000), randomUUID()])).rows[0].outcome, "PUBLISHED");
  });

  const adminSession = await issueWebSession(TENANT_A, USERS.adminA, 1);
  const ownerSession = await issueWebSession(TENANT_A, USERS.ownerA, 6);
  const salesSession = await issueWebSession(TENANT_A, USERS.salesA, 2);
  const hrSession = await issueWebSession(TENANT_A, USERS.hrA, 3);
  const adminBSession = await issueWebSession(TENANT_B, USERS.adminB, 4);
  const lifecycleSession = await issueWebSession(TENANT_A, USERS.suspendedA, 5);
  assert.deepEqual(await loadContext(TENANT_A, USERS.adminA, adminSession.sessionId), [{ workspace_id: TENANT_A, membership_role: "ADMIN", department_key: null, direct_group_ids: ["tenant-a-admin-group"] }]);
  assert.deepEqual(await loadContext(TENANT_A, USERS.ownerA, ownerSession.sessionId), [{ workspace_id: TENANT_A, membership_role: "OWNER", department_key: null, direct_group_ids: ["tenant-a-admin-group"] }]);
  assert.deepEqual(await loadContext(TENANT_A, USERS.salesA, salesSession.sessionId), [{ workspace_id: TENANT_A, membership_role: "MEMBER", department_key: "SALES", direct_group_ids: [] }]);
  assert.deepEqual(await loadContext(TENANT_A, USERS.hrA, hrSession.sessionId), [{ workspace_id: TENANT_A, membership_role: "MEMBER", department_key: "HR", direct_group_ids: [] }]);
  assert.deepEqual(await loadContext(TENANT_B, USERS.adminA, adminSession.sessionId), []);
  assert.deepEqual(await loadContext(TENANT_A, USERS.unmappedA, randomUUID()), []);
  await asOwner((client)=>client.query("UPDATE uptech.people_permission_mappings SET status='DISABLED' WHERE workspace_id=$1 AND source_kind='DEPARTMENT' AND source_value='sales'",[TENANT_A]));
  assert.equal((await loadContext(TENANT_A,USERS.salesA,salesSession.sessionId) as Array<{department_key:string}>)[0].department_key,"SALES");
  await asOwner((client)=>client.query("UPDATE uptech.people_permission_mappings SET status='ACTIVE' WHERE workspace_id=$1 AND source_kind='DEPARTMENT' AND source_value='sales'",[TENANT_A]));
  assert.equal(authorizeKnowledgeAccess(TEST_PERSONAS.sales.subject,"document.read",TEST_DOCUMENTS.hr).decision,"DENY");
  assert.equal(authorizeKnowledgeAccess(TEST_PERSONAS.hr.subject,"document.read",TEST_DOCUMENTS.sales).decision,"DENY");
  assert.equal(TEST_PERSONAS.sales.subject.workspaceRole,"MEMBER");
  assert.equal(await resolveWebRouteAuthority(new Headers(),"ADMIN",{
    loadConfig:()=>({databaseUrl:"postgres://unused",sessionPepper:new Uint8Array(32)}),
    getPool:()=>({query:async()=>{ throw new Error("must not query"); }} as never),
    authenticate:async()=>({context:{workspaceRole:"MEMBER"}} as never),
  }),"HOME");
  const denied = await asOwner((client) => client.query<{ subject: string; status: string }>(
    `SELECT i.provider_subject AS subject,m.status FROM uptech.workspace_memberships m JOIN uptech.identities i ON i.user_id=m.user_id
     WHERE m.workspace_id=$1 AND i.provider_subject=$2`, [TENANT_A, USERS.unmappedA[3]],
  ));
  assert.deepEqual(denied.rows, [{ subject: USERS.unmappedA[3], status: "SUSPENDED" }]);

  const generationA2 = randomUUID();
  await withWorkerLease(TENANT_A, JOB_A, LEASE_A, async (client) => {
    assert.equal((await client.query("SELECT * FROM uptech.begin_people_sync_generation_v1($1,$2,$3,$4)", [TENANT_A, generationA2, LEASE_A, randomUUID()])).rows[0].outcome, "STARTED");
    await asOwner((owner)=>owner.query("UPDATE uptech.service_actors SET status='REVOKED' WHERE workspace_id=$1 AND id=$2",[TENANT_A,ACTOR_A]));
    assert.equal((await client.query("SELECT * FROM uptech.stage_people_profile_v1($1,$2,$3,$4,$5,$6,$7,$8)",[TENANT_A,generationA2,LEASE_A,"revoked-worker","Denied","denied@tenant-a.example","Sales","ACTIVE"])).rows[0].outcome,"DENIED");
    await asOwner((owner)=>owner.query("UPDATE uptech.service_actors SET status='ACTIVE' WHERE workspace_id=$1 AND id=$2",[TENANT_A,ACTOR_A]));
    await stageProfile(client, TENANT_A, generationA2, LEASE_A, [USERS.adminA[3], "Tenant A Admin", "admin@tenant-a.example", "Operations", "ACTIVE"]);
    await stageProfile(client, TENANT_A, generationA2, LEASE_A, [USERS.ownerA[3], "Tenant A Owner", "owner@tenant-a.example", "HR", "ACTIVE"]);
    await stageProfile(client, TENANT_A, generationA2, LEASE_A, [USERS.salesA[3], "Tenant A Sales", "sales@tenant-a.example", "Revenue", "ACTIVE"]);
    await stageProfile(client, TENANT_A, generationA2, LEASE_A, [USERS.suspendedA[3], "Tenant A Lifecycle", "lifecycle@tenant-a.example", "Sales", "SUSPENDED"]);
    assert.equal((await client.query("SELECT * FROM uptech.stage_people_group_v1($1,$2,$3,$4,$5)", [TENANT_A,generationA2,LEASE_A,"unmapped-newsletter","Newsletter"])).rows[0].outcome,"STAGED");
    assert.equal((await client.query("SELECT * FROM uptech.stage_people_group_membership_v1($1,$2,$3,$4,$5)", [TENANT_A,generationA2,LEASE_A,"unmapped-newsletter",USERS.salesA[3]])).rows[0].outcome,"STAGED");
    await asOwner((owner)=>owner.query("UPDATE uptech.service_actors SET status='REVOKED' WHERE workspace_id=$1 AND id=$2",[TENANT_A,ACTOR_A]));
    assert.equal((await client.query("SELECT * FROM uptech.publish_people_sync_generation_v1($1,$2,$3,$4,$5,$6)", [TENANT_A, generationA2, LEASE_A, true, new Date(Date.now() + 3_600_000), randomUUID()])).rows[0].outcome, "DENIED");
    await asOwner((owner)=>owner.query("UPDATE uptech.service_actors SET status='ACTIVE' WHERE workspace_id=$1 AND id=$2",[TENANT_A,ACTOR_A]));
    assert.equal((await client.query("SELECT * FROM uptech.publish_people_sync_generation_v1($1,$2,$3,$4,$5,$6)", [TENANT_A, generationA2, LEASE_A, true, new Date(Date.now() + 3_600_000), randomUUID()])).rows[0].outcome, "PUBLISHED");
  });
  const revoked = await asOwner((client) => client.query<{ membership_status: string; session_status: string; token_status: string }>(
    `SELECT m.status AS membership_status,s.status AS session_status,t.token_status FROM uptech.workspace_memberships m
     JOIN uptech.sessions s ON s.workspace_id=m.workspace_id AND s.membership_id=m.id
     JOIN uptech.session_tokens t ON t.workspace_id=s.workspace_id AND t.session_id=s.id
     WHERE m.workspace_id=$1 AND m.id=$2 AND s.id=$3`, [TENANT_A, USERS.adminA[2], adminSession.sessionId],
  ));
  assert.deepEqual(revoked.rows, [{ membership_status: "SUSPENDED", session_status: "REVOKED", token_status: "REVOKED" }]);
  assert.equal((await api.query("SELECT * FROM uptech.authenticate_session($1)", [adminSession.tokenHash])).rowCount ?? 0, 0);
  const unchangedSales = await asOwner((client) => client.query<{ session_status: string; token_status: string }>(
    `SELECT s.status AS session_status,t.token_status FROM uptech.sessions s JOIN uptech.session_tokens t
     ON t.workspace_id=s.workspace_id AND t.session_id=s.id WHERE s.workspace_id=$1 AND s.id=$2`,
    [TENANT_A, salesSession.sessionId],
  ));
  assert.deepEqual(unchangedSales.rows, [{ session_status: "ACTIVE", token_status: "CURRENT" }]);
  assert.equal((await api.query("SELECT * FROM uptech.authenticate_session($1)", [salesSession.tokenHash])).rowCount ?? 0, 1);
  const unchangedOwner = await asOwner((client)=>client.query<{session_status:string;token_status:string}>(
    `SELECT s.status AS session_status,t.token_status FROM uptech.sessions s JOIN uptech.session_tokens t
     ON t.workspace_id=s.workspace_id AND t.session_id=s.id WHERE s.workspace_id=$1 AND s.id=$2`,[TENANT_A,ownerSession.sessionId]));
  assert.deepEqual(unchangedOwner.rows,[{session_status:"ACTIVE",token_status:"CURRENT"}]);
  assert.equal((await api.query("SELECT * FROM uptech.authenticate_session($1)",[ownerSession.tokenHash])).rowCount ?? 0,1);
  assert.equal((await api.query("SELECT * FROM uptech.authenticate_session($1)", [hrSession.tokenHash])).rowCount ?? 0, 0);
  assert.equal((await api.query("SELECT * FROM uptech.authenticate_session($1)", [lifecycleSession.tokenHash])).rowCount ?? 0, 0);

  await asOwner((client) => client.query("UPDATE uptech.people_sync_generations SET fresh_until=completed_at+interval '1 microsecond' WHERE workspace_id=$1 AND id=$2", [TENANT_B, generationB1]));
  assert.deepEqual(await loadContext(TENANT_B, USERS.adminB, adminBSession.sessionId), []);
});
