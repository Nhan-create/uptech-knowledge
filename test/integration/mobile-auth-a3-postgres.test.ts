import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import { Pool, type QueryResultRow } from "pg";

const DATABASE_PREFIX = "uptech_phase1_test";
let pool: Pool;
const ids = {
  user: randomUUID(), identity: randomUUID(), workspace: randomUUID(), membership: randomUUID(),
};
const existingSubject = `a3-${randomUUID()}`;
const installation = randomBytes(32);
const transactionIds: string[] = [];

function testDatabaseUrl(): string {
  const value = process.env.UPTECH_TEST_DATABASE_URL;
  if (!value) throw new Error("UPTECH_TEST_DATABASE_URL is required; A3 integration never skips");
  const parsed = new URL(value);
  if (!decodeURIComponent(parsed.pathname.slice(1)).startsWith(DATABASE_PREFIX)) {
    throw new Error(`refusing non-disposable database: name must start with ${DATABASE_PREFIX}`);
  }
  return value;
}

async function asRole<Row extends QueryResultRow>(role: "uptech_migration_owner" | "uptech_api_runtime", text: string,
  values: readonly unknown[] = []): Promise<Row[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${role}`);
    const result = await client.query<Row>(text, [...values]);
    await client.query("COMMIT");
    return result.rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function api<Row extends QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<Row[]> {
  return asRole<Row>("uptech_api_runtime", text, values);
}

async function seedHandoff(input: { expiresAt?: Date; verifier?: Buffer; installation?: Buffer } = {}) {
  const transaction = randomUUID();
  transactionIds.push(transaction);
  const handoff = randomBytes(32);
  const verifier = input.verifier ?? randomBytes(32);
  const install = input.installation ?? installation;
  const expiresAt = input.expiresAt ?? new Date(Date.now()+60_000);
  const createdAt = new Date(expiresAt.getTime()-60_000);
  await asRole("uptech_migration_owner", `
    INSERT INTO uptech.mobile_google_transactions(id,environment_name,platform,configuration_key,
      state_hash,nonce_hash,installation_binding_hash,app_exchange_challenge,pkce_envelope,
      pkce_kms_key_version,pkce_associated_data,status,request_id,created_at,expires_at,completed_at)
    SELECT $1,e.environment_name,'ANDROID','GOOGLE_MOBILE_ANDROID_V1',$2,$3,$4,$5,
      ROW(1,'AES-256-GCM',$6,$7,$8)::uptech.google_web_pkce_envelope_v1,
      'a3-test-kms',convert_to('a3-test','UTF8'),'COMPLETED',$9,clock_timestamp(),
      clock_timestamp()+interval '5 minutes',clock_timestamp()
    FROM uptech.google_auth_environment_registry e WHERE e.is_active;
    INSERT INTO uptech.mobile_handoffs(id,transaction_id,handoff_hash,platform,installation_binding_hash,
      app_exchange_challenge,identity_id,user_id,workspace_id,membership_id,user_security_version,
      identity_security_version,workspace_security_version,membership_authz_version,created_at,expires_at)
    VALUES($10,$1,$11,'ANDROID',$4,$5,$12,$13,$14,$15,1,1,1,1,$17,$16)`,
    [transaction,randomBytes(32),randomBytes(32),install,verifier,randomBytes(12),randomBytes(48),randomBytes(16),
      randomUUID(),randomUUID(),handoff,ids.identity,ids.user,ids.workspace,ids.membership,
      expiresAt,createdAt]);
  return { handoff, verifier, install };
}

async function exchange(fixture: Awaited<ReturnType<typeof seedHandoff>>) {
  const access = randomBytes(32); const refresh = randomBytes(32);
  const [row] = await api<{outcome:string;session_id:string|null}>(`
    SELECT r.outcome::text,r.session_id FROM uptech.exchange_mobile_handoff_v1(
      $1,$2,$3,$4,$5,$6,$7) r`,
    [randomBytes(32),fixture.handoff,fixture.verifier,fixture.install,access,refresh,randomUUID()]);
  return { ...row, access, refresh };
}

async function completeCallback(input: { workspaceId: string; domain: string; email: string; subject: string }) {
  const transaction=randomUUID(); transactionIds.push(transaction);
  const completion=randomBytes(32); const nonce=randomBytes(32); const handoff=randomBytes(32);
  await asRole("uptech_migration_owner", `
    INSERT INTO uptech.mobile_google_transactions(id,environment_name,platform,configuration_key,state_hash,
      nonce_hash,installation_binding_hash,app_exchange_challenge,pkce_envelope,pkce_kms_key_version,
      pkce_associated_data,status,completion_handle_hash,request_id,created_at,expires_at,reserved_at,completion_expires_at)
    SELECT $1,e.environment_name,'ANDROID','GOOGLE_MOBILE_ANDROID_V1',$2,$3,$4,$5,
      ROW(1,'AES-256-GCM',$6,$7,$8)::uptech.google_web_pkce_envelope_v1,'a3-test-kms',
      convert_to('a3-test','UTF8'),'EXCHANGE_RESERVED',$9,$10,clock_timestamp(),clock_timestamp()+interval '5 minutes',
      clock_timestamp(),clock_timestamp()+interval '2 minutes'
    FROM uptech.google_auth_environment_registry e WHERE e.is_active`,
    [transaction,randomBytes(32),nonce,installation,randomBytes(32),randomBytes(12),randomBytes(48),randomBytes(16),completion,randomUUID()]);
  const requestId=randomUUID();
  const [result]=await api<{outcome:string;category:string|null}>(`SELECT r.outcome::text,r.category::text
    FROM uptech.complete_mobile_google_callback_v1($1,
      ROW('https://accounts.google.com',$2,$3,true,$4,clock_timestamp(),clock_timestamp()+interval '5 minutes',
        'GOOGLE_WEB_LOGIN_V1',NULL,$5)::uptech.google_verified_claims_assertion_v1,$6,$7) r`,
    [completion,input.subject,input.email,input.domain,nonce,handoff,requestId]);
  return { ...result, requestId };
}

before(async () => {
  pool = new Pool({ connectionString: testDatabaseUrl(), max: 8, connectionTimeoutMillis: 5_000 });
  await asRole("uptech_migration_owner", `
    INSERT INTO uptech.mobile_google_configuration_registry(environment_name,platform,configuration_key,
      google_client_id,google_audience,callback_uri,app_return_uri,scopes,allowed_azp_configuration_keys,
      pkce_kms_key_version,android_application_id,android_release_cert_sha256,is_enabled)
    SELECT environment_name,'ANDROID','GOOGLE_MOBILE_ANDROID_V1','a3-test','a3-test',
      'https://uptech-knowledge-sigma.vercel.app/api/v1/auth/mobile/google/callback',
      'https://uptech-knowledge-sigma.vercel.app/auth/mobile/callback',ARRAY['openid','email','profile'],
      ARRAY['GOOGLE_WEB_LOGIN_V1'::uptech.google_auth_configuration_key_v1],'a3-test-kms','com.uptech.test',
      'AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA',true
    FROM uptech.google_auth_environment_registry WHERE is_active ON CONFLICT DO NOTHING;
    INSERT INTO uptech.users(id,status,security_version) VALUES($1,'ACTIVE',1);
    INSERT INTO uptech.identities(id,user_id,provider,issuer,provider_subject,status,security_version)
      VALUES($2,$1,'GOOGLE','https://accounts.google.com',$3,'ACTIVE',1);
    INSERT INTO uptech.workspaces(workspace_id,status,provisioning_policy,security_version)
      VALUES($4,'ACTIVE','INVITE_ONLY',1);
    INSERT INTO uptech.workspace_memberships(workspace_id,id,user_id,role,status,authz_version)
      VALUES($4,$5,$1,'MEMBER','ACTIVE',1)`,
    [ids.user,ids.identity,existingSubject,ids.workspace,ids.membership]);
});

after(async () => {
  if (!pool) return;
  await pool.end();
});

test("A3 catalog grants expose only API routines and force owner-only RLS on tenant state", async () => {
  const [row] = await asRole<{bad_functions:number;bad_tables:number;bad_rls:number}>("uptech_migration_owner", `
    WITH routines AS (SELECT unnest(ARRAY[
      'uptech.rotate_mobile_refresh_v1(uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,bytea,uptech.google_auth_ascii_identifier_v1,uuid)'::regprocedure,
      'uptech.authenticate_mobile_access_v1(uptech.google_auth_hash32_v1)'::regprocedure,
      'uptech.list_mobile_workspaces_v1(uptech.google_auth_hash32_v1)'::regprocedure,
      'uptech.switch_mobile_workspace_v1(uptech.google_auth_hash32_v1,uuid,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,bytea,uptech.google_auth_ascii_identifier_v1,uuid)'::regprocedure,
      'uptech.revoke_mobile_session_v1(uptech.google_auth_hash32_v1,uuid)'::regprocedure]) oid),
    relations AS (SELECT unnest(ARRAY['mobile_google_transactions','mobile_handoffs','sessions','session_tokens',
      'mobile_refresh_replay_receipts','mobile_workspace_switch_replay_receipts','invitations']) name)
    SELECT (SELECT count(*) FROM routines WHERE NOT has_function_privilege('uptech_api_runtime',oid,'EXECUTE')
      OR has_function_privilege('uptech_worker_runtime',oid,'EXECUTE') OR EXISTS(SELECT 1 FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid=routines.oid AND a.grantee=0 AND a.privilege_type='EXECUTE')) bad_functions,
      (SELECT count(*) FROM relations WHERE has_table_privilege('uptech_api_runtime','uptech.'||name,'SELECT,INSERT,UPDATE,DELETE')
       OR has_table_privilege('uptech_worker_runtime','uptech.'||name,'SELECT,INSERT,UPDATE,DELETE')
       OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
         WHERE n.nspname='uptech' AND c.relname=relations.name AND a.grantee=0
           AND a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE'))) bad_tables,
      (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='uptech' AND c.relname IN
          ('mobile_refresh_replay_receipts','mobile_workspace_switch_replay_receipts','invitations')
          AND NOT (c.relrowsecurity AND c.relforcerowsecurity)) bad_rls`);
  assert.deepEqual(row,{bad_functions:0,bad_tables:0,bad_rls:0});
});

test("handoff is single-winner and wrong verifier, installation, or expiry issues no session", async () => {
  const fixture=await seedHandoff();
  const [a,b]=await Promise.all([exchange(fixture),exchange(fixture)]);
  assert.deepEqual([a.outcome,b.outcome].sort(),["DENIED","ISSUED"]);
  for (const bad of [
    {...await seedHandoff(),verifier:randomBytes(32)},
    {...await seedHandoff(),install:randomBytes(32)},
    await seedHandoff({expiresAt:new Date(Date.now()-1_000)}),
  ]) assert.equal((await exchange(bad)).outcome,"DENIED");
});

test("callback locks hosted-domain authority, preserves active group members, and provisions with schema-valid SYSTEM audits", async () => {
  const activeDomain=`active-${randomUUID()}.example`; const autoDomain=`auto-${randomUUID()}.example`;
  const inviteDomain=`invite-${randomUUID()}.example`; const inviteEmail=`invited-${randomUUID()}@${inviteDomain}`;
  const autoWorkspace=randomUUID(); const inviteWorkspace=randomUUID();
  await asRole("uptech_migration_owner", `
    UPDATE uptech.workspaces SET provisioning_policy='GOOGLE_GROUP_CONTROLLED' WHERE workspace_id=$1;
    INSERT INTO uptech.workspace_domain_locators(normalized_domain,workspace_id,status,verified_at)
      VALUES($2,$1,'VERIFIED',clock_timestamp());
    INSERT INTO uptech.workspaces(workspace_id,status,provisioning_policy,security_version)
      VALUES($3,'ACTIVE','DOMAIN_AUTO_PROVISION',1);
    INSERT INTO uptech.workspace_domain_locators(normalized_domain,workspace_id,status,verified_at)
      VALUES($4,$3,'VERIFIED',clock_timestamp());
    INSERT INTO uptech.workspaces(workspace_id,status,provisioning_policy,security_version)
      VALUES($5,'ACTIVE','INVITE_ONLY',1);
    INSERT INTO uptech.workspace_domain_locators(normalized_domain,workspace_id,status,verified_at)
      VALUES($6,$5,'VERIFIED',clock_timestamp());
    INSERT INTO uptech.invitations(workspace_id,id,normalized_email,token_hash,role,status,created_at,expires_at,accepted_at)
      VALUES($5,$7,$8,$9,'MEMBER','ACCEPTED',clock_timestamp(),clock_timestamp()+interval '1 day',clock_timestamp())`,
    [ids.workspace,activeDomain,autoWorkspace,autoDomain,inviteWorkspace,inviteDomain,randomUUID(),inviteEmail,randomBytes(32)]);
  assert.equal((await completeCallback({workspaceId:ids.workspace,domain:activeDomain,
    email:`existing-${randomUUID()}@${activeDomain}`,subject:existingSubject})).outcome,"NORMAL");
  const auto=await completeCallback({workspaceId:autoWorkspace,domain:autoDomain,
    email:`new-${randomUUID()}@${autoDomain}`,subject:`subject-${randomUUID()}`});
  assert.equal(auto.outcome,"NORMAL");
  const [audit]=await asRole<{count:number}>("uptech_migration_owner", `SELECT count(*)::int count
    FROM uptech.audit_events WHERE workspace_id=$1 AND request_id=$2 AND actor_kind='SYSTEM'
      AND actor_id IS NULL AND membership_id IS NULL AND session_id IS NULL
      AND action='MEMBERSHIP_PROVISIONED'`, [autoWorkspace,auto.requestId]);
  assert.equal(audit.count,1);
  const invited=await completeCallback({workspaceId:inviteWorkspace,domain:inviteDomain,email:inviteEmail,
    subject:`subject-${randomUUID()}`});
  assert.equal(invited.outcome,"NORMAL");
  const [inviteAudit]=await asRole<{count:number}>("uptech_migration_owner", `SELECT count(*)::int count
    FROM uptech.audit_events WHERE workspace_id=$1 AND request_id=$2 AND actor_kind='SYSTEM'
      AND actor_id IS NULL AND membership_id IS NULL AND session_id IS NULL
      AND action IN ('INVITATION_CONSUMED','MEMBERSHIP_PROVISIONED')`, [inviteWorkspace,invited.requestId]);
  assert.equal(inviteAudit.count,2);
});

test("refresh exact replay returns one capsule and differing reuse atomically revokes and audits", async () => {
  const issued=await exchange(await seedHandoff()); assert.equal(issued.outcome,"ISSUED");
  const args=[issued.refresh,installation,randomBytes(32),randomBytes(32),randomBytes(115),"a3-retry",randomUUID()];
  const [rotated]=await api<{outcome:string;replay_capsule:Buffer|null}>(`SELECT r.outcome::text,r.replay_capsule
    FROM uptech.rotate_mobile_refresh_v1($1,$2,$3,$4,$5,$6,$7) r`,args);
  const [replay]=await api<{outcome:string;replay_capsule:Buffer|null}>(`SELECT r.outcome::text,r.replay_capsule
    FROM uptech.rotate_mobile_refresh_v1($1,$2,$3,$4,$5,$6,$7) r`,args);
  const reuseRequest=randomUUID();
  const [reuse]=await api<{outcome:string}>(`SELECT r.outcome::text FROM uptech.rotate_mobile_refresh_v1(
    $1,$2,$3,$4,$5,$6,$7) r`,[issued.refresh,installation,randomBytes(32),randomBytes(32),randomBytes(115),"different",reuseRequest]);
  assert.equal(rotated.outcome,"ROTATED"); assert.equal(replay.outcome,"REPLAY");
  assert.ok(replay.replay_capsule); assert.equal(reuse.outcome,"FAMILY_REVOKED");
  const [audit]=await asRole<{platform:number;tenant:number}>("uptech_migration_owner",`SELECT
    (SELECT count(*)::int FROM uptech.platform_audit_events WHERE request_id=$1 AND action='MOBILE_REFRESH_FAMILY_REVOKED') platform,
    (SELECT count(*)::int FROM uptech.audit_events WHERE request_id=$1 AND action='MOBILE_REFRESH_FAMILY_REVOKED') tenant`,[reuseRequest]);
  assert.deepEqual(audit,{platform:1,tenant:1});
});

test("refresh rejects a NULL idempotency key before mutating the token family", async () => {
  const issued=await exchange(await seedHandoff()); assert.equal(issued.outcome,"ISSUED");
  const [before]=await asRole<{version:number}>("uptech_migration_owner", `SELECT s.security_version version
    FROM uptech.sessions s JOIN uptech.session_tokens t ON t.workspace_id=s.workspace_id AND t.session_id=s.id
    WHERE t.token_hash=$1`, [issued.refresh]);
  const [denied]=await api<{outcome:string}>(`SELECT r.outcome::text FROM uptech.rotate_mobile_refresh_v1(
    $1,$2,$3,$4,$5,NULL,$6) r`, [issued.refresh,installation,randomBytes(32),randomBytes(32),randomBytes(115),randomUUID()]);
  const [after]=await asRole<{version:number}>("uptech_migration_owner", `SELECT s.security_version version
    FROM uptech.sessions s JOIN uptech.session_tokens t ON t.workspace_id=s.workspace_id AND t.session_id=s.id
    WHERE t.token_hash=$1`, [issued.refresh]);
  assert.equal(denied.outcome,"DENIED");
  assert.equal(after.version,before.version);
});

test("logout and membership removal immediately deny old access", async () => {
  const first=await exchange(await seedHandoff()); assert.equal(first.outcome,"ISSUED");
  assert.equal((await api<{outcome:string}>(`SELECT uptech.revoke_mobile_session_v1($1,$2)::text outcome`,
    [first.access,randomUUID()]))[0].outcome,"REVOKED");
  assert.equal((await api<{outcome:string}>(`SELECT r.outcome::text FROM uptech.authenticate_mobile_access_v1($1) r`,
    [first.access]))[0].outcome,"SESSION_REVOKED");
  const second=await exchange(await seedHandoff()); assert.equal(second.outcome,"ISSUED");
  await asRole("uptech_migration_owner",`UPDATE uptech.workspace_memberships SET status='DEPROVISIONED',authz_version=authz_version+1
    WHERE workspace_id=$1 AND id=$2`,[ids.workspace,ids.membership]);
  assert.equal((await api<{outcome:string}>(`SELECT r.outcome::text FROM uptech.authenticate_mobile_access_v1($1) r`,
    [second.access]))[0].outcome,"SESSION_REVOKED");
});
