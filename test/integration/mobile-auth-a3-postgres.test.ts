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

async function asApiSession<Row extends QueryResultRow>(workspaceId: string, sessionId: string, text: string,
  values: readonly unknown[] = []): Promise<Row[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE uptech_api_runtime");
    await client.query("SELECT set_config('app.workspace_id',$1,true)", [workspaceId]);
    await client.query("SELECT set_config('app.actor_id',$1,true)", [ids.user]);
    await client.query("SELECT set_config('app.membership_id',$1,true)", [ids.membership]);
    await client.query("SELECT set_config('app.session_id',$1,true)", [sessionId]);
    const result = await client.query<Row>(text, [...values]);
    await client.query("COMMIT");
    return result.rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function assertExactWebSessionPolicies(): Promise<void> {
  await asRole("uptech_migration_owner", `
    CREATE TEMP TABLE a3_expected_sessions_policy (LIKE uptech.sessions) ON COMMIT DROP;
    CREATE POLICY a3_expected_sessions_api_scope ON a3_expected_sessions_policy
      TO uptech_api_runtime
      USING (
        client_type='WEB'
        AND workspace_id::text=NULLIF(current_setting('app.workspace_id',true),'')
        AND id::text=NULLIF(current_setting('app.session_id',true),'')
        AND EXISTS (SELECT 1 FROM uptech.workspaces AS context_workspace
          WHERE context_workspace.workspace_id=a3_expected_sessions_policy.workspace_id)
      )
      WITH CHECK (
        client_type='WEB'
        AND workspace_id::text=NULLIF(current_setting('app.workspace_id',true),'')
        AND id::text=NULLIF(current_setting('app.session_id',true),'')
        AND EXISTS (SELECT 1 FROM uptech.workspaces AS context_workspace
          WHERE context_workspace.workspace_id=a3_expected_sessions_policy.workspace_id)
      );
    CREATE TEMP TABLE a3_expected_session_tokens_policy (LIKE uptech.session_tokens) ON COMMIT DROP;
    CREATE POLICY a3_expected_session_tokens_api_scope ON a3_expected_session_tokens_policy
      TO uptech_api_runtime
      USING (
        client_type='WEB'
        AND session_id::text=NULLIF(current_setting('app.session_id',true),'')
        AND workspace_id::text=NULLIF(current_setting('app.workspace_id',true),'')
        AND EXISTS (SELECT 1 FROM uptech.workspaces AS context_workspace
          WHERE context_workspace.workspace_id=a3_expected_session_tokens_policy.workspace_id)
      )
      WITH CHECK (
        client_type='WEB'
        AND session_id::text=NULLIF(current_setting('app.session_id',true),'')
        AND workspace_id::text=NULLIF(current_setting('app.workspace_id',true),'')
        AND EXISTS (SELECT 1 FROM uptech.workspaces AS context_workspace
          WHERE context_workspace.workspace_id=a3_expected_session_tokens_policy.workspace_id)
      );
    DO $exact_policy$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM (VALUES
          ('sessions','sessions_api_scope','a3_expected_sessions_policy','a3_expected_sessions_api_scope'),
          ('session_tokens','session_tokens_api_scope','a3_expected_session_tokens_policy',
            'a3_expected_session_tokens_api_scope')
        ) expected(relation_name,policy_name,reference_relation_name,reference_policy_name)
        JOIN pg_class relation ON relation.relname=expected.relation_name
        JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace AND namespace.nspname='uptech'
        LEFT JOIN pg_policy policy
          ON policy.polrelid=relation.oid AND policy.polname=expected.policy_name
        LEFT JOIN pg_class reference_relation
          ON reference_relation.relnamespace=pg_my_temp_schema()
          AND reference_relation.relname=expected.reference_relation_name
        LEFT JOIN pg_policy reference_policy
          ON reference_policy.polrelid=reference_relation.oid
          AND reference_policy.polname=expected.reference_policy_name
        WHERE policy.oid IS NULL OR reference_policy.oid IS NULL
          OR regexp_replace(pg_get_expr(policy.polqual,policy.polrelid),
              '\\m'||expected.relation_name||'\\M','__a3_target_relation__','g')
            IS DISTINCT FROM regexp_replace(
              pg_get_expr(reference_policy.polqual,reference_policy.polrelid),
              '\\m'||expected.reference_relation_name||'\\M','__a3_target_relation__','g')
          OR regexp_replace(pg_get_expr(policy.polwithcheck,policy.polrelid),
              '\\m'||expected.relation_name||'\\M','__a3_target_relation__','g')
            IS DISTINCT FROM regexp_replace(
              pg_get_expr(reference_policy.polwithcheck,reference_policy.polrelid),
              '\\m'||expected.reference_relation_name||'\\M','__a3_target_relation__','g')
      ) THEN
        RAISE EXCEPTION 'shared session policy differs from exact reference parse tree';
      END IF;
    END
    $exact_policy$;`);
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

test("A3 catalog grants expose only API routines and keep shared session policies Web-only", async () => {
  await assertExactWebSessionPolicies();
  const [row] = await asRole<{bad_functions:number;bad_tables:number;bad_rls:number;
    bad_session_policies:number;bad_session_column_acls:number}>("uptech_migration_owner", `
    WITH routines AS (SELECT unnest(ARRAY[
      'uptech.rotate_mobile_refresh_v1(uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,bytea,uptech.google_auth_ascii_identifier_v1,uuid)'::regprocedure,
      'uptech.authenticate_mobile_access_v1(uptech.google_auth_hash32_v1)'::regprocedure,
      'uptech.list_mobile_workspaces_v1(uptech.google_auth_hash32_v1)'::regprocedure,
      'uptech.switch_mobile_workspace_v1(uptech.google_auth_hash32_v1,uuid,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,bytea,uptech.google_auth_ascii_identifier_v1,uuid)'::regprocedure,
      'uptech.revoke_mobile_session_v1(uptech.google_auth_hash32_v1,uuid)'::regprocedure]) oid),
    relations AS (SELECT unnest(ARRAY['mobile_google_configuration_registry','mobile_google_transactions',
      'mobile_handoffs','mobile_refresh_replay_receipts','mobile_workspace_switch_replay_receipts',
      'invitations','users','identities','sessions','session_tokens','platform_audit_events']) name),
    expected_session_policies(relation_name,policy_name) AS (VALUES
      ('sessions','sessions_api_scope'),('session_tokens','session_tokens_api_scope')),
    session_columns AS (SELECT table_name,column_name FROM information_schema.columns
      WHERE table_schema='uptech' AND table_name IN ('sessions','session_tokens'))
    SELECT (SELECT count(*)::int FROM routines WHERE NOT has_function_privilege('uptech_api_runtime',oid,'EXECUTE')
      OR has_function_privilege('uptech_worker_runtime',oid,'EXECUTE') OR EXISTS(SELECT 1 FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid=routines.oid AND a.grantee=0 AND a.privilege_type='EXECUTE')) bad_functions,
      (SELECT count(*)::int FROM relations WHERE has_table_privilege('uptech_api_runtime','uptech.'||name,'SELECT,INSERT,UPDATE,DELETE')
       OR has_table_privilege('uptech_worker_runtime','uptech.'||name,'SELECT,INSERT,UPDATE,DELETE')
       OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
         WHERE n.nspname='uptech' AND c.relname=relations.name AND a.grantee=0
            AND a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE'))) bad_tables,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='uptech' AND c.relname IN
          ('mobile_refresh_replay_receipts','mobile_workspace_switch_replay_receipts','invitations')
          AND NOT (c.relrowsecurity AND c.relforcerowsecurity)) bad_rls,
      ((SELECT count(*)::int FROM expected_session_policies expected
          JOIN pg_class c ON c.relname=expected.relation_name
          JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='uptech'
          LEFT JOIN pg_policy p ON p.polrelid=c.oid AND p.polname=expected.policy_name
          WHERE NOT (c.relrowsecurity AND c.relforcerowsecurity) OR p.oid IS NULL OR p.polcmd<>'*'
            OR NOT p.polpermissive OR p.polroles<>ARRAY['uptech_api_runtime'::regrole::oid])
        + (SELECT count(*)::int FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
          JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='uptech' AND c.relname IN ('sessions','session_tokens')
            AND (0=ANY(p.polroles) OR 'uptech_api_runtime'::regrole::oid=ANY(p.polroles))
            AND NOT ((c.relname='sessions' AND p.polname='sessions_api_scope')
              OR (c.relname='session_tokens' AND p.polname='session_tokens_api_scope'))))
        bad_session_policies,
      (SELECT count(*)::int FROM session_columns c WHERE
        has_column_privilege('uptech_api_runtime','uptech.'||c.table_name,c.column_name,'SELECT') <>
          ((c.table_name='sessions' AND c.column_name=ANY(ARRAY['workspace_id','id','user_id',
            'membership_id','client_type','status','security_version','idle_expires_at',
            'absolute_expires_at','revoked_at']))
           OR (c.table_name='session_tokens' AND c.column_name=ANY(ARRAY['workspace_id','id',
            'session_id','client_type','token_kind','token_status','session_security_version',
            'rotation_version','issued_at','expires_at','became_previous_at','previous_valid_until','revoked_at'])))
        OR has_column_privilege('uptech_api_runtime','uptech.'||c.table_name,c.column_name,'UPDATE') <>
          ((c.table_name='sessions' AND c.column_name=ANY(ARRAY['status','security_version',
            'current_rotation_version','last_seen_at','idle_expires_at','revoked_at','revocation_reason']))
           OR (c.table_name='session_tokens' AND c.column_name=ANY(ARRAY['token_status',
            'became_previous_at','previous_valid_until','revoked_at'])))
        OR has_column_privilege('uptech_api_runtime','uptech.'||c.table_name,c.column_name,'INSERT')
        OR has_column_privilege('uptech_worker_runtime','uptech.'||c.table_name,c.column_name,'SELECT')
        OR has_column_privilege('uptech_worker_runtime','uptech.'||c.table_name,c.column_name,'INSERT')
        OR has_column_privilege('uptech_worker_runtime','uptech.'||c.table_name,c.column_name,'UPDATE'))
        bad_session_column_acls`);
  assert.deepEqual(row,{bad_functions:0,bad_tables:0,bad_rls:0,bad_session_policies:0,
    bad_session_column_acls:0});
});

test("shared Web session grants cannot read, update, or insert Native credentials", async () => {
  const webSession=randomUUID(); const otherWebSession=randomUUID(); const nativeSession=randomUUID();
  const webToken=randomUUID(); const otherWebToken=randomUUID(); const nativeToken=randomUUID();
  await asRole("uptech_migration_owner", `
    INSERT INTO uptech.sessions(workspace_id,id,identity_id,user_id,membership_id,client_type,status,
      user_security_version,identity_security_version,workspace_security_version,membership_authz_version,
      device_binding_hash,created_at,last_seen_at,idle_expires_at,absolute_expires_at)
    VALUES
      ($1,$2,$3,$4,$5,'WEB','ACTIVE',1,1,1,1,$6,clock_timestamp(),clock_timestamp(),
        clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day'),
      ($1,$7,$3,$4,$5,'NATIVE','ACTIVE',1,1,1,1,$8,clock_timestamp(),clock_timestamp(),
        clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day'),
      ($1,$9,$3,$4,$5,'WEB','ACTIVE',1,1,1,1,$10,clock_timestamp(),clock_timestamp(),
        clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day')`,
    [ids.workspace,webSession,ids.identity,ids.user,ids.membership,randomBytes(32),nativeSession,
      randomBytes(32),otherWebSession,randomBytes(32)]);
  await asRole("uptech_migration_owner", `
    INSERT INTO uptech.session_tokens(workspace_id,id,session_id,client_type,token_kind,token_hash,
      csrf_token_hash,session_security_version,rotation_version,issued_at,expires_at)
    VALUES
      ($1,$2,$5,'WEB','WEB_SESSION',$8,$9,1,1,clock_timestamp(),clock_timestamp()+interval '1 hour'),
      ($1,$3,$6,'NATIVE','NATIVE_ACCESS',$10,NULL,1,1,clock_timestamp(),clock_timestamp()+interval '15 minutes'),
      ($1,$4,$7,'WEB','WEB_SESSION',$11,$12,1,1,clock_timestamp(),clock_timestamp()+interval '1 hour')`,
    [ids.workspace,webToken,nativeToken,otherWebToken,webSession,nativeSession,otherWebSession,
      randomBytes(32),randomBytes(32),randomBytes(32),randomBytes(32),randomBytes(32)]);

  const sessions=await asApiSession<{id:string}>(ids.workspace,webSession,
    "SELECT id FROM uptech.sessions WHERE id=ANY($1::uuid[]) ORDER BY id",
    [[webSession,nativeSession,otherWebSession]]);
  const tokens=await asApiSession<{id:string}>(ids.workspace,webSession,
    "SELECT id FROM uptech.session_tokens WHERE id=ANY($1::uuid[]) ORDER BY id",
    [[webToken,nativeToken,otherWebToken]]);
  assert.deepEqual(sessions.map(({id})=>id),[webSession]);
  assert.deepEqual(tokens.map(({id})=>id),[webToken]);

  const nativeContextSessions=await asApiSession<{id:string}>(ids.workspace,nativeSession,
    "SELECT id FROM uptech.sessions WHERE id=$1",[nativeSession]);
  const nativeContextTokens=await asApiSession<{id:string}>(ids.workspace,nativeSession,
    "SELECT id FROM uptech.session_tokens WHERE id=$1",[nativeToken]);
  assert.deepEqual(nativeContextSessions,[]);
  assert.deepEqual(nativeContextTokens,[]);

  const nativeUpdate=await asApiSession<{id:string}>(ids.workspace,webSession, `UPDATE uptech.sessions
    SET status='REVOKED',revoked_at=transaction_timestamp(),revocation_reason='USER_LOGOUT',
      security_version=security_version+1 WHERE workspace_id=$1 AND id=$2 RETURNING id`,
    [ids.workspace,nativeSession]);
  const otherWebUpdate=await asApiSession<{id:string}>(ids.workspace,webSession, `UPDATE uptech.sessions
    SET status='REVOKED',revoked_at=transaction_timestamp(),revocation_reason='USER_LOGOUT',
      security_version=security_version+1 WHERE workspace_id=$1 AND id=$2 RETURNING id`,
    [ids.workspace,otherWebSession]);
  const inaccessibleTokenUpdate=await asApiSession<{id:string}>(ids.workspace,webSession,
    `UPDATE uptech.session_tokens SET token_status='REVOKED',revoked_at=transaction_timestamp()
      WHERE workspace_id=$1 AND id=ANY($2::uuid[]) RETURNING id`,
    [ids.workspace,[nativeToken,otherWebToken]]);
  const nativeContextUpdate=await asApiSession<{id:string}>(ids.workspace,nativeSession,
    `UPDATE uptech.session_tokens SET token_status='REVOKED',revoked_at=transaction_timestamp()
      WHERE workspace_id=$1 AND id=$2 RETURNING id`,[ids.workspace,nativeToken]);
  assert.deepEqual(nativeUpdate,[]);
  assert.deepEqual(otherWebUpdate,[]);
  assert.deepEqual(inaccessibleTokenUpdate,[]);
  assert.deepEqual(nativeContextUpdate,[]);

  const revokedWebToken=await asApiSession<{id:string}>(ids.workspace,webSession, `UPDATE uptech.session_tokens
    SET token_status='REVOKED',revoked_at=transaction_timestamp()
    WHERE workspace_id=$1 AND id=$2 RETURNING id`,[ids.workspace,webToken]);
  const revokedWebSession=await asApiSession<{id:string}>(ids.workspace,webSession, `UPDATE uptech.sessions
    SET status='REVOKED',revoked_at=transaction_timestamp(),revocation_reason='USER_LOGOUT',
      security_version=security_version+1 WHERE workspace_id=$1 AND id=$2 RETURNING id`,
    [ids.workspace,webSession]);
  assert.deepEqual(revokedWebToken,[{id:webToken}]);
  assert.deepEqual(revokedWebSession,[{id:webSession}]);

  await assert.rejects(asApiSession(ids.workspace,webSession, `INSERT INTO uptech.sessions(
    workspace_id,id,identity_id,user_id,membership_id,client_type,status,user_security_version,
    identity_security_version,workspace_security_version,membership_authz_version,device_binding_hash,
    created_at,last_seen_at,idle_expires_at,absolute_expires_at)
    VALUES($1,$2,$3,$4,$5,'NATIVE','ACTIVE',1,1,1,1,$6,clock_timestamp(),clock_timestamp(),
      clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day')`,
    [ids.workspace,randomUUID(),ids.identity,ids.user,ids.membership,randomBytes(32)]),
  (error:unknown)=>(error as {code?:string}).code==="42501");
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
