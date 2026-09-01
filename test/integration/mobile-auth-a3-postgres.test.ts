import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
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

async function asRoleBatch(
  role: "uptech_migration_owner" | "uptech_api_runtime",
  statements: readonly { readonly text: string; readonly values?: readonly unknown[] }[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${role}`);
    for (const statement of statements) {
      await client.query(statement.text, [...(statement.values ?? [])]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function api<Row extends QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<Row[]> {
  return asRole<Row>("uptech_api_runtime", text, values);
}

async function ensureFixedExampleWorkspace(
  domain: "tenant-a.example" | "tenant-b.example" | "unknown.example",
  status: "ACTIVE" | "SUSPENDED",
): Promise<string> {
  const workspaceId = randomUUID();
  const [row] = await asRole<{ workspace_id: string }>(
    "uptech_migration_owner",
    `WITH domain_lock AS MATERIALIZED (
       SELECT pg_catalog.pg_advisory_xact_lock(
         pg_catalog.hashtextextended('uptech-example-domain:' || $1, 0)
       )
     ), existing AS (
       SELECT locator.workspace_id
       FROM uptech.workspace_domain_locators AS locator
       CROSS JOIN domain_lock
       WHERE normalized_domain = $1::uptech.google_normalized_domain_v1
     ), inserted_workspace AS (
       INSERT INTO uptech.workspaces
         (workspace_id, status, provisioning_policy, security_version)
       SELECT $2::uuid, $3::text, 'DOMAIN_AUTO_PROVISION', 1
       WHERE NOT EXISTS (SELECT 1 FROM existing)
       RETURNING workspace_id
     ), inserted_locator AS (
       INSERT INTO uptech.workspace_domain_locators
         (normalized_domain, workspace_id, status, verified_at)
       SELECT $1::uptech.google_normalized_domain_v1, workspace_id,
         'VERIFIED', clock_timestamp()
       FROM inserted_workspace
       RETURNING workspace_id
     ), updated_existing AS (
       UPDATE uptech.workspaces AS workspace_row
       SET status = $3::text,
           provisioning_policy = 'DOMAIN_AUTO_PROVISION'
       FROM existing
       WHERE workspace_row.workspace_id = existing.workspace_id
       RETURNING workspace_row.workspace_id
     )
     SELECT workspace_id::text FROM updated_existing
     UNION ALL
     SELECT workspace_id::text FROM inserted_locator`,
    [domain, workspaceId, status],
  );
  assert.ok(row?.workspace_id);
  return row.workspace_id;
}

async function acquireFixedExampleDomainLock(): Promise<() => Promise<void>> {
  const client = await pool.connect();
  await client.query(
    `SELECT pg_catalog.pg_advisory_lock(
       pg_catalog.hashtextextended('uptech-fixed-example-domains-v1', 0)
     )`,
  );
  return async () => {
    try {
      await client.query(
        `SELECT pg_catalog.pg_advisory_unlock(
           pg_catalog.hashtextextended('uptech-fixed-example-domains-v1', 0)
         )`,
      );
    } finally {
      client.release();
    }
  };
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
  await asRoleBatch("uptech_migration_owner", [{
    text: `INSERT INTO uptech.mobile_google_transactions(id,environment_name,platform,configuration_key,
      state_hash,nonce_hash,installation_binding_hash,app_exchange_challenge,pkce_envelope,
      pkce_kms_key_version,pkce_associated_data,status,request_id,created_at,expires_at,completed_at)
    SELECT $1,e.environment_name,'ANDROID','GOOGLE_MOBILE_ANDROID_V1',$2,$3,$4,$5,
      ROW(1,'AES-256-GCM',$6,$7,$8)::uptech.google_web_pkce_envelope_v1,
      'a3-test-kms',convert_to('a3-test','UTF8'),'COMPLETED',$9,statement_timestamp(),
      statement_timestamp()+interval '5 minutes',statement_timestamp()
    FROM uptech.google_auth_environment_registry e WHERE e.is_active`,
    values: [transaction,randomBytes(32),randomBytes(32),install,verifier,randomBytes(12),randomBytes(48),randomBytes(16),
      randomUUID()],
  }, {
    text: `INSERT INTO uptech.mobile_handoffs(id,transaction_id,handoff_hash,platform,installation_binding_hash,
      app_exchange_challenge,identity_id,user_id,workspace_id,membership_id,user_security_version,
      identity_security_version,workspace_security_version,membership_authz_version,created_at,expires_at)
    VALUES($1,$2,$3,'ANDROID',$4,$5,$6,$7,$8,$9,1,1,1,1,$11,$10)`,
    values: [randomUUID(),transaction,handoff,install,verifier,ids.identity,ids.user,ids.workspace,ids.membership,
      expiresAt,createdAt],
  }]);
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

async function exchangeV2(input: {
  handoff: Buffer;
  verifier: Buffer;
  install: Buffer;
  networkHmac?: Buffer;
}) {
  const networkHmac = input.networkHmac ?? randomBytes(32);
  const access = randomBytes(32);
  const refresh = randomBytes(32);
  const [row] = await api<{
    outcome: string;
    session_id: string | null;
    denial_category: string | null;
  }>(`SELECT result.outcome,result.session_id,
      result.denial_category::text AS denial_category
    FROM uptech.exchange_mobile_handoff_v2(
      $1,$2,$3,$4,$5,$6,$7
    ) AS result`, [
      networkHmac,input.handoff,input.verifier,input.install,access,refresh,randomUUID(),
    ]);
  return { ...row, networkHmac, access, refresh };
}

async function nativeFamily(workspaceId: string, sessionId: string, access: Buffer, refresh: Buffer) {
  const [family] = await asRole<{session_status:string;token_count:number;token_statuses:string[]}>(
    "uptech_migration_owner", `
      SELECT s.status::text session_status,count(*)::int token_count,
        array_agg(t.token_status::text ORDER BY t.token_kind) token_statuses
      FROM uptech.sessions s JOIN uptech.session_tokens t
        ON t.workspace_id=s.workspace_id AND t.session_id=s.id
      WHERE s.workspace_id=$1 AND s.id=$2 AND t.token_hash IN ($3,$4)
      GROUP BY s.status`, [workspaceId,sessionId,access,refresh]);
  return family;
}

async function completeCallback(input: {
  workspaceId: string;
  domain: string;
  email: string;
  subject: string;
  issuer?: "https://accounts.google.com" | "accounts.google.com";
}) {
  const transaction=randomUUID(); transactionIds.push(transaction);
  const completion=randomBytes(32); const nonce=randomBytes(32); const handoff=randomBytes(32);
  const appExchangeChallenge=randomBytes(32);
  await asRole("uptech_migration_owner", `
    INSERT INTO uptech.mobile_google_transactions(id,environment_name,platform,configuration_key,state_hash,
      nonce_hash,installation_binding_hash,app_exchange_challenge,pkce_envelope,pkce_kms_key_version,
      pkce_associated_data,status,completion_handle_hash,request_id,created_at,expires_at,reserved_at,completion_expires_at)
    SELECT $1,e.environment_name,'ANDROID','GOOGLE_MOBILE_ANDROID_V1',$2,$3,$4,$5,
      ROW(1,'AES-256-GCM',$6,$7,$8)::uptech.google_web_pkce_envelope_v1,'a3-test-kms',
      convert_to('a3-test','UTF8'),'EXCHANGE_RESERVED',$9,$10,statement_timestamp(),statement_timestamp()+interval '5 minutes',
      statement_timestamp(),statement_timestamp()+interval '2 minutes'
    FROM uptech.google_auth_environment_registry e WHERE e.is_active`,
    [transaction,randomBytes(32),nonce,installation,appExchangeChallenge,randomBytes(12),randomBytes(48),randomBytes(16),completion,randomUUID()]);
  const requestId=randomUUID();
  const [result]=await api<{outcome:string;category:string|null;app_return_uri:string|null}>(`SELECT r.outcome::text,
      r.denial_category::text AS category,r.app_return_uri::text
    FROM uptech.complete_mobile_google_callback_v1($1,
      ROW($8::uptech.google_auth_issuer_v1,$2,$3,true,$4,clock_timestamp(),clock_timestamp()+interval '5 minutes',
        'GOOGLE_WEB_LOGIN_V1',NULL,$5)::uptech.google_verified_claims_assertion_v1,$6,$7) r`,
    [
      completion,
      input.subject,
      input.email,
      input.domain,
      nonce,
      handoff,
      requestId,
      input.issuer ?? "https://accounts.google.com",
    ]);
  return {
    ...result,
    requestId,
    transactionId: transaction,
    handoff,
    verifier: appExchangeChallenge,
    install: installation,
  };
}

async function seedReservedDenialTransaction() {
  const transactionId = randomUUID();
  transactionIds.push(transactionId);
  const completionHash = randomBytes(32);
  const handoffHash = randomBytes(32);
  const installationBinding = randomBytes(32);
  const appExchangeChallenge = randomBytes(32);
  await asRole("uptech_migration_owner", `
    INSERT INTO uptech.mobile_google_transactions(
      id,environment_name,platform,configuration_key,state_hash,nonce_hash,
      installation_binding_hash,app_exchange_challenge,pkce_envelope,
      pkce_kms_key_version,pkce_associated_data,status,completion_handle_hash,
      request_id,created_at,expires_at,reserved_at,completion_expires_at
    )
    SELECT $1,e.environment_name,'ANDROID','GOOGLE_MOBILE_ANDROID_V1',$2,$3,$4,$5,
      ROW(1,'AES-256-GCM',$6,$7,$8)::uptech.google_web_pkce_envelope_v1,
      'a3-test-kms',convert_to('a3-test','UTF8'),'EXCHANGE_RESERVED',$9,$10,
      statement_timestamp(),statement_timestamp()+interval '5 minutes',statement_timestamp(),
      statement_timestamp()+interval '2 minutes'
    FROM uptech.google_auth_environment_registry AS e
    WHERE e.is_active`, [
      transactionId, randomBytes(32), randomBytes(32), installationBinding,
      appExchangeChallenge, randomBytes(12), randomBytes(48), randomBytes(16),
      completionHash, randomUUID(),
    ]);
  return {
    transactionId,
    completionHash,
    handoffHash,
    installationBinding,
    appExchangeChallenge,
  };
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
      ARRAY['GOOGLE_WEB_LOGIN_V1'::uptech.google_auth_configuration_key_v1],'a3-test-kms','unknown.example',
      'AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA',true
    FROM uptech.google_auth_environment_registry WHERE is_active ON CONFLICT DO NOTHING`);
  await asRole("uptech_migration_owner",
    `INSERT INTO uptech.users(id,status,security_version) VALUES($1,'ACTIVE',1)`,
    [ids.user]);
  await asRole("uptech_migration_owner",
    `INSERT INTO uptech.identities(id,user_id,provider,issuer,provider_subject,status,security_version)
      VALUES($2,$1,'GOOGLE','https://accounts.google.com',$3,'ACTIVE',1)`,
    [ids.user,ids.identity,existingSubject]);
  await asRole("uptech_migration_owner",
    `INSERT INTO uptech.workspaces(workspace_id,status,provisioning_policy,security_version)
      VALUES($1,'ACTIVE','INVITE_ONLY',1)`,
    [ids.workspace]);
  await asRole("uptech_migration_owner",
    `INSERT INTO uptech.workspace_memberships(workspace_id,id,user_id,role,status,authz_version)
      VALUES($1,$2,$3,'MEMBER','ACTIVE',1)`,
    [ids.workspace,ids.membership,ids.user]);
});

after(async () => {
  if (!pool) return;
  await pool.end();
});

test("A3 fixtures use only the closed example-domain set", async () => {
  const source = await readFile(new URL(import.meta.url),"utf8");
  const domains = new Set(source.match(/[a-z0-9-]+\.example/gu) ?? []);
  assert.deepEqual([...domains].sort(),[
    "tenant-a.example","tenant-b.example","unknown.example",
  ]);
  assert.doesNotMatch(source,/\$\{[^}\r\n]+\}\.example/u);
  assert.doesNotMatch(source,/[+]\s*["'`]\.example/u);
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

test("authenticated denial handoff is proof-bound, single-use, and never creates authority", async () => {
  const fixture = await seedReservedDenialTransaction();
  const [before] = await asRole<{ sessions: number; tokens: number }>(
    "uptech_migration_owner",
    `SELECT (SELECT count(*)::integer FROM uptech.sessions) AS sessions,
       (SELECT count(*)::integer FROM uptech.session_tokens) AS tokens`,
  );

  const [completed] = await api<{
    outcome: string;
    app_return_uri: string | null;
    denial_category: string | null;
  }>(`SELECT result.outcome::text,result.app_return_uri::text,
      result.denial_category::text
    FROM uptech.complete_mobile_google_denial_v1(
      $1,$2,'PROVIDER_REJECTED','GOOGLE_CANCELLED',$3
    ) AS result`, [fixture.completionHash,fixture.handoffHash,randomUUID()]);
  assert.equal(completed.outcome,"DENIED");
  assert.equal(typeof completed.app_return_uri,"string");
  assert.equal(completed.denial_category,"GOOGLE_CANCELLED");

  const [persisted] = await asRole<{
    transaction_status: string;
    handoff_status: string;
    denial_category: string;
    authority_is_null: boolean;
    lifetime_seconds: number;
  }>("uptech_migration_owner", `
    SELECT transaction_row.status::text AS transaction_status,
      handoff_row.status::text AS handoff_status,
      handoff_row.denial_category::text,
      handoff_row.identity_id IS NULL AND handoff_row.user_id IS NULL
        AND handoff_row.workspace_id IS NULL AND handoff_row.membership_id IS NULL
        AND handoff_row.user_security_version IS NULL
        AND handoff_row.identity_security_version IS NULL
        AND handoff_row.workspace_security_version IS NULL
        AND handoff_row.membership_authz_version IS NULL AS authority_is_null,
      extract(epoch FROM handoff_row.expires_at-handoff_row.created_at)::integer
        AS lifetime_seconds
    FROM uptech.mobile_google_transactions AS transaction_row
    JOIN uptech.mobile_handoffs AS handoff_row
      ON handoff_row.transaction_id=transaction_row.id
    WHERE transaction_row.id=$1`, [fixture.transactionId]);
  assert.deepEqual(persisted, {
    transaction_status: "REJECTED",
    handoff_status: "ACTIVE",
    denial_category: "GOOGLE_CANCELLED",
    authority_is_null: true,
    lifetime_seconds: 60,
  });

  assert.equal((await exchangeV2({
    handoff: fixture.handoffHash,
    verifier: randomBytes(32),
    install: fixture.installationBinding,
  })).outcome,"DENIED");
  assert.equal((await exchangeV2({
    handoff: fixture.handoffHash,
    verifier: fixture.appExchangeChallenge,
    install: randomBytes(32),
  })).outcome,"DENIED");
  assert.equal((await exchangeV2({
    handoff: randomBytes(32),
    verifier: fixture.appExchangeChallenge,
    install: fixture.installationBinding,
  })).outcome,"DENIED");

  const [legacy] = await api<{ outcome: string }>(`
    SELECT result.outcome::text
    FROM uptech.exchange_mobile_handoff_v1($1,$2,$3,$4,$5,$6,$7) AS result`, [
      randomBytes(32),fixture.handoffHash,fixture.appExchangeChallenge,
      fixture.installationBinding,randomBytes(32),randomBytes(32),randomUUID(),
    ]);
  assert.equal(legacy.outcome,"DENIED");

  const networkHmac = randomBytes(32);
  const issuedDenial = await exchangeV2({
    handoff: fixture.handoffHash,
    verifier: fixture.appExchangeChallenge,
    install: fixture.installationBinding,
    networkHmac,
  });
  assert.deepEqual({
    outcome: issuedDenial.outcome,
    session_id: issuedDenial.session_id,
    denial_category: issuedDenial.denial_category,
  }, {
    outcome: "ACCESS_DENIED",
    session_id: null,
    denial_category: "GOOGLE_CANCELLED",
  });
  assert.equal((await exchangeV2({
    handoff: fixture.handoffHash,
    verifier: fixture.appExchangeChallenge,
    install: fixture.installationBinding,
  })).outcome,"DENIED");

  const [after] = await asRole<{
    sessions: number;
    tokens: number;
    admission_count: number;
    handoff_status: string;
  }>("uptech_migration_owner", `
    SELECT (SELECT count(*)::integer FROM uptech.sessions) AS sessions,
      (SELECT count(*)::integer FROM uptech.session_tokens) AS tokens,
      (SELECT sum(request_count)::integer
       FROM uptech.google_auth_rate_limit_buckets
       WHERE network_hmac=$1) AS admission_count,
      (SELECT status::text FROM uptech.mobile_handoffs
       WHERE handoff_hash=$2) AS handoff_status`, [networkHmac,fixture.handoffHash]);
  assert.deepEqual(after, {
    sessions: before.sessions,
    tokens: before.tokens,
    admission_count: 1,
    handoff_status: "CONSUMED",
  });
});

test("v2 handoff exchange delegates normal issuance unchanged", async () => {
  const fixture = await seedHandoff();
  const result = await exchangeV2(fixture);
  assert.equal(result.outcome,"ISSUED");
  assert.equal(typeof result.session_id,"string");
  assert.equal(result.denial_category,null);
});

test("callback locks hosted-domain authority, preserves active group members, and provisions with schema-valid SYSTEM audits", async () => {
  const releaseFixedDomains = await acquireFixedExampleDomainLock();
  try {
  const activeDomain="tenant-a.example";
  const autoDomain="tenant-b.example";
  const inviteDomain="unknown.example";
  const inviteEmail="invited-user@unknown.example";
  const activeWorkspace=await ensureFixedExampleWorkspace(activeDomain,"ACTIVE");
  const autoWorkspace=await ensureFixedExampleWorkspace(autoDomain,"ACTIVE");
  const inviteWorkspace=await ensureFixedExampleWorkspace(inviteDomain,"ACTIVE");
  const activeMembership=randomUUID();
  await asRoleBatch("uptech_migration_owner", [
    {
      text: `UPDATE uptech.workspaces
        SET provisioning_policy='GOOGLE_GROUP_CONTROLLED' WHERE workspace_id=$1`,
      values: [activeWorkspace],
    },
    {
      text: `UPDATE uptech.workspaces
        SET provisioning_policy='INVITE_ONLY' WHERE workspace_id=$1`,
      values: [inviteWorkspace],
    },
    {
      text: `INSERT INTO uptech.workspace_memberships
        (workspace_id,id,user_id,role,status,authz_version)
        SELECT $1,$2,$3,'MEMBER','ACTIVE',1
        WHERE NOT EXISTS (
          SELECT 1 FROM uptech.workspace_memberships
          WHERE workspace_id=$1 AND user_id=$3
        )`,
      values: [activeWorkspace,activeMembership,ids.user],
    },
    {
      text: `INSERT INTO uptech.invitations
        (workspace_id,id,normalized_email,token_hash,role,status,created_at,expires_at,accepted_at)
        VALUES($1,$2,$3,$4,'MEMBER','ACCEPTED',clock_timestamp(),
          clock_timestamp()+interval '1 day',clock_timestamp())`,
      values: [inviteWorkspace,randomUUID(),inviteEmail,randomBytes(32)],
    },
  ]);
  assert.equal((await completeCallback({workspaceId:activeWorkspace,domain:activeDomain,
    email:"existing-user@tenant-a.example",subject:existingSubject})).outcome,"NORMAL");
  const auto=await completeCallback({workspaceId:autoWorkspace,domain:autoDomain,
    email:"new-user@tenant-b.example",subject:`subject-${randomUUID()}`});
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
  } finally {
    await releaseFixedDomains();
  }
});

test("Mobile A3 public completion gives GROUP_CONTROLLED subjects without membership only a denial handoff", async () => {
  const releaseFixedDomains = await acquireFixedExampleDomainLock();
  const domain = "tenant-a.example";
  try {
    const workspaceId = await ensureFixedExampleWorkspace(domain, "ACTIVE");
    await asRole(
      "uptech_migration_owner",
      `UPDATE uptech.workspaces
       SET provisioning_policy = 'GOOGLE_GROUP_CONTROLLED'
       WHERE workspace_id = $1::uuid`,
      [workspaceId],
    );
    const subject = `group-unprovisioned-${randomUUID()}`;
    const completion = await completeCallback({
      workspaceId,
      domain,
      email: "member@tenant-a.example",
      subject,
    });

    assert.deepEqual(
      {
        outcome: completion.outcome,
        category: completion.category,
        hasReturnUri: typeof completion.app_return_uri === "string",
      },
      {
        outcome: "DENIED",
        category: "POLICY_OR_DEVICE_BLOCKED",
        hasReturnUri: true,
      },
    );
    const [handoff] = await asRole<{
      denial_category: string;
      normal_authority_fields: number;
      identity_count: number;
    }>("uptech_migration_owner", `
      SELECT handoff_row.denial_category::text AS denial_category,
        pg_catalog.num_nonnulls(
          handoff_row.identity_id, handoff_row.user_id,
          handoff_row.workspace_id, handoff_row.membership_id,
          handoff_row.user_security_version,
          handoff_row.identity_security_version,
          handoff_row.workspace_security_version,
          handoff_row.membership_authz_version
        )::integer AS normal_authority_fields,
        (SELECT count(*)::integer FROM uptech.identities
         WHERE provider = 'GOOGLE' AND provider_subject = $2) AS identity_count
      FROM uptech.mobile_handoffs AS handoff_row
      WHERE handoff_row.handoff_hash = $1::uptech.google_auth_hash32_v1`,
      [completion.handoff, subject],
    );
    assert.deepEqual(handoff, {
      denial_category: "POLICY_OR_DEVICE_BLOCKED",
      normal_authority_fields: 0,
      identity_count: 0,
    });

    const exchanged = await exchangeV2({
      handoff: completion.handoff,
      verifier: completion.verifier,
      install: completion.install,
    });
    assert.deepEqual(
      {
        outcome: exchanged.outcome,
        sessionId: exchanged.session_id,
        category: exchanged.denial_category,
      },
      {
        outcome: "ACCESS_DENIED",
        sessionId: null,
        category: "POLICY_OR_DEVICE_BLOCKED",
      },
    );
    const [tokens] = await asRole<{ count: number }>(
      "uptech_migration_owner",
      `SELECT count(*)::integer AS count
       FROM uptech.session_tokens
       WHERE token_hash IN (
         $1::uptech.google_auth_hash32_v1,
         $2::uptech.google_auth_hash32_v1
       )`,
      [exchanged.access, exchanged.refresh],
    );
    assert.equal(tokens.count, 0);
  } finally {
    await asRole(
      "uptech_migration_owner",
      `UPDATE uptech.workspaces AS workspace_row
       SET provisioning_policy = 'DOMAIN_AUTO_PROVISION'
       FROM uptech.workspace_domain_locators AS locator
       WHERE locator.workspace_id = workspace_row.workspace_id
         AND locator.normalized_domain = $1::uptech.google_normalized_domain_v1`,
      [domain],
    );
    await releaseFixedDomains();
  }
});

test("mobile callback never JIT-attaches an existing Google subject to another tenant", async () => {
  const releaseFixedDomains = await acquireFixedExampleDomainLock();
  try {
  await ensureFixedExampleWorkspace("tenant-a.example", "ACTIVE");
  const targetWorkspace = await ensureFixedExampleWorkspace(
    "tenant-b.example",
    "ACTIVE",
  );
  await asRole("uptech_migration_owner", `
    UPDATE uptech.identities
    SET hosted_domain_claim='tenant-a.example'
    WHERE id=$1`,
    [ids.identity]);

  const result = await completeCallback({
    workspaceId: targetWorkspace,
    domain: "tenant-b.example",
    email: "person@tenant-b.example",
    subject: existingSubject,
    issuer: "accounts.google.com",
  });
  assert.deepEqual(
    { outcome: result.outcome, category: result.category },
    { outcome: "DENIED", category: "AUTH_ERROR" },
  );

  const [persisted] = await asRole<{
    hosted_domain_claim: string | null;
    target_memberships: number;
    transaction_status: string;
  }>("uptech_migration_owner", `
    SELECT identity_row.hosted_domain_claim,
      (SELECT count(*)::integer
       FROM uptech.workspace_memberships AS membership_row
       WHERE membership_row.workspace_id=$2
         AND membership_row.user_id=identity_row.user_id) AS target_memberships,
      (SELECT status::text
       FROM uptech.mobile_google_transactions
       WHERE id=$3::uuid) AS transaction_status
    FROM uptech.identities AS identity_row
    WHERE identity_row.id=$1`, [
      ids.identity,
      targetWorkspace,
      result.transactionId,
    ]);
  assert.deepEqual(persisted, {
    hosted_domain_claim: "tenant-a.example",
    target_memberships: 0,
    transaction_status: "REJECTED",
  });
  } finally {
    await releaseFixedDomains();
  }
});

test("mobile callback cannot reactivate a deprovisioned member", async () => {
  const releaseFixedDomains = await acquireFixedExampleDomainLock();
  try {
  const userId = randomUUID();
  const identityId = randomUUID();
  const membershipId = randomUUID();
  const workspaceId = await ensureFixedExampleWorkspace(
    "tenant-a.example",
    "ACTIVE",
  );
  const subject = `deprovisioned-${randomUUID()}`;
  await asRoleBatch("uptech_migration_owner", [
    {
      text: `INSERT INTO uptech.users(id,status,security_version)
        VALUES($1,'ACTIVE',1)`,
      values: [userId],
    },
    {
      text: `INSERT INTO uptech.identities
        (id,user_id,provider,issuer,provider_subject,status,security_version,hosted_domain_claim)
        VALUES($1,$2,'GOOGLE','https://accounts.google.com',$3,'ACTIVE',1,'tenant-a.example')`,
      values: [identityId,userId,subject],
    },
    {
      text: `INSERT INTO uptech.workspace_memberships
        (workspace_id,id,user_id,role,status,authz_version)
        VALUES($1,$2,$3,'MEMBER','DEPROVISIONED',1)`,
      values: [workspaceId,membershipId,userId],
    },
  ]);

  const result = await completeCallback({
    workspaceId,
    domain: "tenant-a.example",
    email: "person@tenant-a.example",
    subject,
  });
  assert.deepEqual(
    { outcome: result.outcome, category: result.category },
    { outcome: "DENIED", category: "USER_SUSPENDED" },
  );
  const [persisted] = await asRole<{
    status: string;
    handoff_count: number;
    transaction_status: string;
  }>(
    "uptech_migration_owner",
    `SELECT membership_row.status::text,
       (SELECT count(*)::integer
        FROM uptech.mobile_handoffs AS handoff_row
        WHERE handoff_row.identity_id=$2) AS handoff_count,
       (SELECT status::text
        FROM uptech.mobile_google_transactions
        WHERE id=$4::uuid) AS transaction_status
     FROM uptech.workspace_memberships AS membership_row
     WHERE membership_row.workspace_id=$1 AND membership_row.id=$3`,
    [workspaceId, identityId, membershipId, result.transactionId],
  );
  assert.deepEqual(persisted, {
    status: "DEPROVISIONED",
    handoff_count: 0,
    transaction_status: "REJECTED",
  });
  } finally {
    await releaseFixedDomains();
  }
});

test("callback distinguishes a suspended workspace from a suspended user", async () => {
  const releaseFixedDomains = await acquireFixedExampleDomainLock();
  try {
  const suspendedWorkspace = await ensureFixedExampleWorkspace(
    "unknown.example",
    "SUSPENDED",
  );

  const result = await completeCallback({
    workspaceId: suspendedWorkspace,
    domain: "unknown.example",
    email: "person@unknown.example",
    subject: `suspended-workspace-${randomUUID()}`,
  });

  assert.deepEqual({ outcome: result.outcome, category: result.category }, {
    outcome: "DENIED",
    category: "WORKSPACE_SUSPENDED",
  });
  assert.equal(typeof result.app_return_uri,"string");
  const exchanged = await exchangeV2(result);
  assert.deepEqual({
    outcome: exchanged.outcome,
    session_id: exchanged.session_id,
    denial_category: exchanged.denial_category,
  }, {
    outcome: "ACCESS_DENIED",
    session_id: null,
    denial_category: "WORKSPACE_SUSPENDED",
  });
  assert.deepEqual(
    await asRole<{ status: string }>(
      "uptech_migration_owner",
      `SELECT status::text
       FROM uptech.mobile_google_transactions
       WHERE id=$1::uuid`,
      [result.transactionId],
    ),
    [{ status: "REJECTED" }],
  );
  } finally {
    await releaseFixedDomains();
  }
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

test("workspace switch rotates once, replays exactly, denies mismatches and old credentials, and inherits absolute expiry", async () => {
  const targetWorkspace=randomUUID(); const targetMembership=randomUUID();
  await asRoleBatch("uptech_migration_owner", [
    {
      text: `INSERT INTO uptech.workspaces
        (workspace_id,status,provisioning_policy,security_version)
        VALUES($1,'ACTIVE','INVITE_ONLY',1)`,
      values: [targetWorkspace],
    },
    {
      text: `INSERT INTO uptech.workspace_memberships
        (workspace_id,id,user_id,role,status,authz_version)
        VALUES($1,$2,$3,'MEMBER','ACTIVE',1)`,
      values: [targetWorkspace,targetMembership,ids.user],
    },
  ]);

  const issued=await exchange(await seedHandoff()); assert.equal(issued.outcome,"ISSUED"); assert.ok(issued.session_id);
  const absoluteExpiry=new Date(Date.now()+5*60_000);
  await asRole("uptech_migration_owner", `UPDATE uptech.sessions
    SET idle_expires_at=$3,absolute_expires_at=$3
    WHERE workspace_id=$1 AND id=$2`, [ids.workspace,issued.session_id,absoluteExpiry]);

  const successorAccess=randomBytes(32); const successorRefresh=randomBytes(32);
  const capsule=randomBytes(115); const idempotencyKey="a3-switch-retry";
  const switchSql=`SELECT r.outcome::text,r.replay_capsule,r.access_expires_at,r.refresh_expires_at
    FROM uptech.switch_mobile_workspace_v1($1,$2,$3,$4,$5,$6,$7,$8) r`;
  const args=[issued.access,targetWorkspace,installation,successorAccess,successorRefresh,
    capsule,idempotencyKey,randomUUID()];
  const [rotated]=await api<{outcome:string;replay_capsule:Buffer|null;access_expires_at:Date;refresh_expires_at:Date}>(
    switchSql,args);
  const [replay]=await api<{outcome:string;replay_capsule:Buffer|null;access_expires_at:Date;refresh_expires_at:Date}>(
    switchSql,args);
  const [mismatch]=await api<{outcome:string}>(switchSql,
    [issued.access,targetWorkspace,installation,successorAccess,successorRefresh,capsule,"different",randomUUID()]);

  assert.equal(rotated.outcome,"ROTATED"); assert.equal(rotated.replay_capsule,null);
  assert.equal(replay.outcome,"REPLAY"); assert.deepEqual(replay.replay_capsule,capsule);
  assert.equal(mismatch.outcome,"DENIED");
  assert.equal(rotated.refresh_expires_at.getTime(),absoluteExpiry.getTime());
  assert.ok(rotated.access_expires_at.getTime()<=absoluteExpiry.getTime());
  assert.equal(replay.refresh_expires_at.getTime(),absoluteExpiry.getTime());

  assert.deepEqual(await nativeFamily(ids.workspace,issued.session_id,issued.access,issued.refresh),{
    session_status:"REVOKED",token_count:2,token_statuses:["REVOKED","REVOKED"],
  });

  const [successor]=await asRole<{absolute_expires_at:Date;max_token_expiry:Date}>("uptech_migration_owner", `
    SELECT s.absolute_expires_at,max(t.expires_at) max_token_expiry
    FROM uptech.sessions s JOIN uptech.session_tokens t
      ON t.workspace_id=s.workspace_id AND t.session_id=s.id
    WHERE s.workspace_id=$1 AND t.token_hash IN ($2,$3)
    GROUP BY s.absolute_expires_at`, [targetWorkspace,successorAccess,successorRefresh]);
  assert.equal(successor.absolute_expires_at.getTime(),absoluteExpiry.getTime());
  assert.ok(successor.max_token_expiry.getTime()<=absoluteExpiry.getTime());

  assert.equal((await api<{outcome:string}>(`SELECT r.outcome::text
    FROM uptech.authenticate_mobile_access_v1($1) r`,[issued.access]))[0].outcome,"SESSION_REVOKED");
  const [oldRefresh]=await api<{outcome:string}>(`SELECT r.outcome::text FROM uptech.rotate_mobile_refresh_v1(
    $1,$2,$3,$4,$5,$6,$7) r`,[issued.refresh,installation,randomBytes(32),randomBytes(32),
    randomBytes(115),"old-after-switch",randomUUID()]);
  assert.equal(oldRefresh.outcome,"FAMILY_REVOKED");

  const expired=await exchange(await seedHandoff()); assert.equal(expired.outcome,"ISSUED");
  await asRole("uptech_migration_owner", `UPDATE uptech.sessions
    SET created_at=clock_timestamp()-interval '1 day',last_seen_at=clock_timestamp()-interval '1 hour',
      idle_expires_at=clock_timestamp()-interval '1 second',absolute_expires_at=clock_timestamp()-interval '1 second'
    WHERE workspace_id=$1 AND id=$2`, [ids.workspace,expired.session_id]);
  const [expiredSwitch]=await api<{outcome:string}>(switchSql,[expired.access,targetWorkspace,installation,
    randomBytes(32),randomBytes(32),randomBytes(115),"expired-switch",randomUUID()]);
  assert.equal(expiredSwitch.outcome,"DENIED");
});

test("logout and membership removal immediately deny old access", async () => {
  const first=await exchange(await seedHandoff()); assert.equal(first.outcome,"ISSUED");
  assert.equal((await api<{outcome:string}>(`SELECT uptech.revoke_mobile_session_v1($1,$2)::text outcome`,
    [first.access,randomUUID()]))[0].outcome,"REVOKED");
  assert.equal((await api<{outcome:string}>(`SELECT r.outcome::text FROM uptech.authenticate_mobile_access_v1($1) r`,
    [first.access]))[0].outcome,"SESSION_REVOKED");
  const second=await exchange(await seedHandoff()); assert.equal(second.outcome,"ISSUED");
  const [membershipBefore]=await asRole<{status:string;authz_version:number}>("uptech_migration_owner", `
    SELECT status::text,authz_version FROM uptech.workspace_memberships WHERE workspace_id=$1 AND id=$2`,
    [ids.workspace,ids.membership]);
  assert.ok(membershipBefore);
  try {
    await asRole("uptech_migration_owner",`UPDATE uptech.workspace_memberships SET status='DEPROVISIONED',authz_version=authz_version+1
      WHERE workspace_id=$1 AND id=$2`,[ids.workspace,ids.membership]);
    assert.equal((await api<{outcome:string}>(`SELECT r.outcome::text FROM uptech.authenticate_mobile_access_v1($1) r`,
      [second.access]))[0].outcome,"SESSION_REVOKED");
  } finally {
    await asRole("uptech_migration_owner",`UPDATE uptech.workspace_memberships SET status=$3,
      authz_version=$4 WHERE workspace_id=$1 AND id=$2`,
      [ids.workspace,ids.membership,membershipBefore.status,membershipBefore.authz_version]);
  }
});

test("logout revokes the exact old access and refresh credentials without issuing a successor token family", async () => {
  const issued=await exchange(await seedHandoff()); assert.equal(issued.outcome,"ISSUED"); assert.ok(issued.session_id);
  assert.equal((await api<{outcome:string}>(`SELECT uptech.revoke_mobile_session_v1($1,$2)::text outcome`,
    [issued.access,randomUUID()]))[0].outcome,"REVOKED");
  assert.deepEqual(await nativeFamily(ids.workspace,issued.session_id,issued.access,issued.refresh),{
    session_status:"REVOKED",token_count:2,token_statuses:["REVOKED","REVOKED"],
  });

  const successorAccess=randomBytes(32); const successorRefresh=randomBytes(32);
  const [oldAccess]=await api<{outcome:string}>(`
    SELECT r.outcome::text FROM uptech.authenticate_mobile_access_v1($1) r`,[issued.access]);
  const [oldRefresh]=await api<{outcome:string}>(`
    SELECT r.outcome::text FROM uptech.rotate_mobile_refresh_v1($1,$2,$3,$4,$5,$6,$7) r`,
    [issued.refresh,installation,successorAccess,successorRefresh,randomBytes(115),"logout-old-refresh",randomUUID()]);
  const [candidateTokens]=await asRole<{count:number}>("uptech_migration_owner", `
    SELECT count(*)::int count FROM uptech.session_tokens WHERE token_hash IN ($1,$2)`,
    [successorAccess,successorRefresh]);

  assert.equal(oldAccess.outcome,"SESSION_REVOKED");
  assert.equal(oldRefresh.outcome,"FAMILY_REVOKED");
  assert.equal(candidateTokens.count,0);
  assert.deepEqual(await nativeFamily(ids.workspace,issued.session_id,issued.access,issued.refresh),{
    session_status:"REVOKED",token_count:2,token_statuses:["REVOKED","REVOKED"],
  });
});
