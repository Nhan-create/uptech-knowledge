\set ON_ERROR_STOP on

-- Run only against a disposable database after A1, A2, and A3 migrations.
BEGIN;

DO $verify$
DECLARE
  pretenant regprocedure[] := ARRAY[
    to_regprocedure('uptech.begin_google_login_transaction_v1(uptech.mobile_platform_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_web_pkce_envelope_v1,uuid)'),
    to_regprocedure('uptech.consume_google_login_transaction_v1(uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)'),
    to_regprocedure('uptech.complete_mobile_google_callback_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uuid)'),
    to_regprocedure('uptech.exchange_mobile_handoff_v1(uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)'),
    to_regprocedure('uptech.record_google_login_rejection_v1(uptech.mobile_platform_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_rejection_class_v1,uuid)')
  ]::regprocedure[];
  routine regprocedure;
  runtime_routines regprocedure[] := ARRAY[
    to_regprocedure('uptech.rotate_mobile_refresh_v1(uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,bytea,uptech.google_auth_ascii_identifier_v1,uuid)'),
    to_regprocedure('uptech.authenticate_mobile_access_v1(uptech.google_auth_hash32_v1)'),
    to_regprocedure('uptech.list_mobile_workspaces_v1(uptech.google_auth_hash32_v1)'),
    to_regprocedure('uptech.switch_mobile_workspace_v1(uptech.google_auth_hash32_v1,uuid,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,bytea,uptech.google_auth_ascii_identifier_v1,uuid)'),
    to_regprocedure('uptech.revoke_mobile_session_v1(uptech.google_auth_hash32_v1,uuid)')
  ]::regprocedure[];
  relation text;
BEGIN
  IF array_position(pretenant, NULL::regprocedure) IS NOT NULL OR cardinality(pretenant) <> 5 THEN
    RAISE EXCEPTION 'one or more exact A3 pre-tenant overloads are missing';
  END IF;

  FOREACH routine IN ARRAY pretenant LOOP
    IF NOT (SELECT p.prosecdef AND p.provolatile='v'
      AND p.proconfig=ARRAY['search_path=pg_catalog, uptech']::text[]
      AND pg_get_userbyid(p.proowner)='uptech_migration_owner'
      FROM pg_proc p WHERE p.oid=routine) THEN
      RAISE EXCEPTION 'unsafe A3 routine attributes: %', routine;
    END IF;
    IF (SELECT p.prosrc ~* '(^|[^[:alnum:]_])EXECUTE([^[:alnum:]_]|$)'
      FROM pg_proc p WHERE p.oid=routine) THEN
      RAISE EXCEPTION 'dynamic SQL in A3 routine: %', routine;
    END IF;
    IF NOT has_function_privilege('uptech_api_runtime',routine,'EXECUTE')
      OR has_function_privilege('uptech_worker_runtime',routine,'EXECUTE') THEN
      RAISE EXCEPTION 'wrong API/worker grant for %', routine;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(
      COALESCE(p.proacl,acldefault('f',p.proowner))) acl
      WHERE p.oid=routine AND acl.grantee=0 AND acl.privilege_type='EXECUTE') THEN
      RAISE EXCEPTION 'PUBLIC can execute %', routine;
    END IF;
  END LOOP;

  IF array_position(runtime_routines,NULL::regprocedure) IS NOT NULL OR cardinality(runtime_routines)<>5 THEN
    RAISE EXCEPTION 'one or more exact A3 session routines are missing';
  END IF;
  FOREACH routine IN ARRAY runtime_routines LOOP
    IF NOT (SELECT p.prosecdef AND p.provolatile='v'
      AND p.proconfig=ARRAY['search_path=pg_catalog, uptech']::text[]
      AND pg_get_userbyid(p.proowner)='uptech_migration_owner'
      FROM pg_proc p WHERE p.oid=routine)
      OR NOT has_function_privilege('uptech_api_runtime',routine,'EXECUTE')
      OR has_function_privilege('uptech_worker_runtime',routine,'EXECUTE')
      OR EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(
        COALESCE(p.proacl,acldefault('f',p.proowner))) acl
        WHERE p.oid=routine AND acl.grantee=0 AND acl.privilege_type='EXECUTE') THEN
      RAISE EXCEPTION 'unsafe A3 session routine attributes/grants: %',routine;
    END IF;
  END LOOP;

  FOREACH relation IN ARRAY ARRAY[
    'mobile_google_configuration_registry','mobile_google_transactions',
    'mobile_handoffs','mobile_refresh_replay_receipts','mobile_workspace_switch_replay_receipts',
    'invitations','users','identities','sessions','session_tokens','platform_audit_events'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl
        WHERE n.nspname='uptech' AND c.relname=relation AND acl.grantee=0
          AND acl.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE'))
      OR has_table_privilege('uptech_api_runtime','uptech.'||relation,'SELECT,INSERT,UPDATE,DELETE')
      OR has_table_privilege('uptech_worker_runtime','uptech.'||relation,'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'runtime direct table privilege exists on %', relation;
    END IF;
  END LOOP;

  FOREACH relation IN ARRAY ARRAY[
    'mobile_refresh_replay_receipts','mobile_workspace_switch_replay_receipts','invitations'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='uptech' AND c.relname=relation AND c.relrowsecurity AND c.relforcerowsecurity)
      OR NOT EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='uptech' AND c.relname=relation
          AND p.polroles=ARRAY['uptech_migration_owner'::regrole::oid]
          AND pg_get_expr(p.polqual,p.polrelid)='true'
          AND pg_get_expr(p.polwithcheck,p.polrelid)='true') THEN
      RAISE EXCEPTION 'workspace-owned A3 relation lacks forced owner-only RLS: %',relation;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='uptech.mobile_google_configuration_registry'::regclass
      AND pg_get_constraintdef(oid) LIKE '%uptech-knowledge-sigma.vercel.app/api/v1/auth/mobile/google/callback%')
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='uptech.mobile_google_configuration_registry'::regclass
      AND pg_get_constraintdef(oid) LIKE '%uptech-knowledge-sigma.vercel.app/auth/mobile/callback%') THEN
    RAISE EXCEPTION 'fixed A3 callback/return registry constraints are missing';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='uptech' AND table_name IN ('mobile_google_transactions','mobile_handoffs')
      AND column_name ~ '(raw|secret|token|code|verifier)$') THEN
    RAISE EXCEPTION 'raw secret-shaped A3 persistence column found';
  END IF;

  IF has_function_privilege('uptech_api_runtime',
      'uptech.mobile_google_auth_admit_internal_v1(uptech.google_auth_hash32_v1,uuid)','EXECUTE')
    OR has_function_privilege('uptech_worker_runtime',
      'uptech.mobile_google_auth_admit_internal_v1(uptech.google_auth_hash32_v1,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'private mobile admission helper is runtime-callable';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p
    WHERE p.oid=to_regprocedure('uptech.rotate_mobile_refresh_v1(uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,bytea,uptech.google_auth_ascii_identifier_v1,uuid)')
      AND p.prosrc ~ 'IF p_idempotency_key IS NULL THEN[[:space:]]+RETURN ROW\(''DENIED''') THEN
    RAISE EXCEPTION 'refresh routine lacks a pre-mutation NULL idempotency-key guard';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p
    WHERE p.oid=to_regprocedure('uptech.complete_mobile_google_callback_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uuid)')
      AND p.prosrc ~ 'workspace_domain_locators[[:space:]]+WHERE[^;]+FOR SHARE'
      AND p.prosrc !~ '''USER'',usr.id,mem.id,''(INVITATION_CONSUMED|MEMBERSHIP_PROVISIONED)'''
      AND p.prosrc ~ '''SYSTEM'',NULL,NULL,''INVITATION_CONSUMED'''
      AND p.prosrc ~ '''SYSTEM'',NULL,NULL,''MEMBERSHIP_PROVISIONED''') THEN
    RAISE EXCEPTION 'callback lacks locked domain authority or schema-valid pre-session audit shape';
  END IF;
END
$verify$;

SET LOCAL ROLE uptech_migration_owner;

INSERT INTO uptech.google_auth_environment_registry(
  environment_name,rate_limit_audit_hmac_key,is_active)
SELECT 'a3-verify',decode(repeat('a3',32),'hex'),true
WHERE NOT EXISTS (SELECT 1 FROM uptech.google_auth_environment_registry WHERE is_active);

INSERT INTO uptech.mobile_google_configuration_registry(
  environment_name,platform,configuration_key,google_client_id,google_audience,
  callback_uri,app_return_uri,scopes,allowed_azp_configuration_keys,pkce_kms_key_version,
  android_application_id,android_release_cert_sha256,is_enabled)
SELECT e.environment_name,'ANDROID','GOOGLE_MOBILE_ANDROID_V1','verify-mobile-client',
  'verify-mobile-client','https://uptech-knowledge-sigma.vercel.app/api/v1/auth/mobile/google/callback',
  'https://uptech-knowledge-sigma.vercel.app/auth/mobile/callback',
  ARRAY['openid','email','profile']::text[],
  ARRAY['GOOGLE_WEB_LOGIN_V1'::uptech.google_auth_configuration_key_v1],
  'verify-mobile-kms-v1','com.uptech.knowledge',
  'AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA',true
FROM uptech.google_auth_environment_registry e WHERE e.is_active
ON CONFLICT (environment_name,platform) DO NOTHING;

RESET ROLE;
SET LOCAL ROLE uptech_api_runtime;

DO $aad_begin$
DECLARE result uptech.google_login_begin_result_v1;
BEGIN
  result:=uptech.begin_google_login_transaction_v1('ANDROID',decode(repeat('10',32),'hex'),
    decode(repeat('11',32),'hex'),decode(repeat('12',32),'hex'),decode(repeat('13',32),'hex'),
    decode(repeat('14',32),'hex'),ROW(1,'AES-256-GCM',decode(repeat('15',12),'hex'),
      decode(repeat('16',96),'hex'),decode(repeat('17',16),'hex'))::uptech.google_web_pkce_envelope_v1,
    '4d6e25c6-e7cb-45ad-9147-e93b1a2fca21');
  IF (result).outcome<>'CREATED' THEN RAISE EXCEPTION 'mobile AAD fixture begin failed'; END IF;
END
$aad_begin$;

RESET ROLE;
SET LOCAL ROLE uptech_migration_owner;

DO $aad_verify$
DECLARE stored bytea; env text;
BEGIN
  SELECT environment_name::text INTO STRICT env FROM uptech.google_auth_environment_registry WHERE is_active;
  SELECT pkce_associated_data INTO STRICT stored FROM uptech.mobile_google_transactions
    WHERE state_hash=decode(repeat('11',32),'hex');
  IF stored<>convert_to(env||chr(31)||'ANDROID'||chr(31)||'GOOGLE_MOBILE_ANDROID_V1'||chr(31)||repeat('11',32),'UTF8') THEN
    RAISE EXCEPTION 'mobile PKCE AAD encoding differs from canonical contract';
  END IF;
END
$aad_verify$;

INSERT INTO uptech.users(id,status,security_version) VALUES
  ('a3000000-0000-4000-8000-000000000001','ACTIVE',1);
INSERT INTO uptech.identities(id,user_id,provider,issuer,provider_subject,status,security_version)
VALUES('a3000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000001',
  'GOOGLE','https://accounts.google.com','a3-verify-subject','ACTIVE',1);
INSERT INTO uptech.workspaces(workspace_id,status,security_version)
VALUES('a3000000-0000-4000-8000-000000000003','ACTIVE',1);
INSERT INTO uptech.workspace_memberships(workspace_id,id,user_id,role,status,authz_version)
VALUES('a3000000-0000-4000-8000-000000000003','a3000000-0000-4000-8000-000000000004',
  'a3000000-0000-4000-8000-000000000001','MEMBER','ACTIVE',1);
INSERT INTO uptech.sessions(workspace_id,id,identity_id,user_id,membership_id,client_type,status,
  user_security_version,identity_security_version,workspace_security_version,membership_authz_version,
  device_binding_hash,created_at,last_seen_at,idle_expires_at,absolute_expires_at)
VALUES
 ('a3000000-0000-4000-8000-000000000003','a3000000-0000-4000-8000-000000000005',
  'a3000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000004','NATIVE','ACTIVE',1,1,1,1,
  decode(repeat('20',32),'hex'),clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '7 days',
  clock_timestamp()+interval '30 days'),
 ('a3000000-0000-4000-8000-000000000003','a3000000-0000-4000-8000-000000000006',
  'a3000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000004','NATIVE','ACTIVE',1,1,1,1,
  decode(repeat('30',32),'hex'),clock_timestamp()-interval '8 days',clock_timestamp()-interval '8 days',
  clock_timestamp()-interval '1 second',clock_timestamp()+interval '22 days');
INSERT INTO uptech.session_tokens(workspace_id,id,session_id,client_type,token_kind,token_hash,
  session_security_version,rotation_version,issued_at,expires_at)
VALUES
 ('a3000000-0000-4000-8000-000000000003','a3000000-0000-4000-8000-000000000007',
  'a3000000-0000-4000-8000-000000000005','NATIVE','NATIVE_ACCESS',decode(repeat('21',32),'hex'),1,1,
  clock_timestamp(),clock_timestamp()+interval '15 minutes'),
 ('a3000000-0000-4000-8000-000000000003','a3000000-0000-4000-8000-000000000008',
  'a3000000-0000-4000-8000-000000000005','NATIVE','NATIVE_REFRESH',decode(repeat('22',32),'hex'),1,1,
  clock_timestamp(),clock_timestamp()+interval '30 days'),
 ('a3000000-0000-4000-8000-000000000003','a3000000-0000-4000-8000-000000000009',
  'a3000000-0000-4000-8000-000000000006','NATIVE','NATIVE_ACCESS',decode(repeat('31',32),'hex'),1,1,
  clock_timestamp(),clock_timestamp()+interval '15 minutes');

RESET ROLE;
SET LOCAL ROLE uptech_api_runtime;

DO $session_verify$
DECLARE auth uptech.mobile_auth_result_v1; rotated uptech.mobile_refresh_result_v1;
  replayed uptech.mobile_refresh_result_v1; reused uptech.mobile_refresh_result_v1;
BEGIN
  auth:=uptech.authenticate_mobile_access_v1(decode(repeat('21',32),'hex'));
  IF (auth).outcome<>'AUTHORIZED' THEN RAISE EXCEPTION 'current mobile access did not authorize'; END IF;
  auth:=uptech.authenticate_mobile_access_v1(decode(repeat('31',32),'hex'));
  IF (auth).outcome<>'SESSION_EXPIRED' THEN RAISE EXCEPTION 'idle-expired mobile access was not terminal'; END IF;
  rotated:=uptech.rotate_mobile_refresh_v1(decode(repeat('22',32),'hex'),decode(repeat('20',32),'hex'),
    decode(repeat('23',32),'hex'),decode(repeat('24',32),'hex'),decode(repeat('ab',115),'hex'),
    'a3-retry-1','a3000000-0000-4000-8000-000000000010');
  replayed:=uptech.rotate_mobile_refresh_v1(decode(repeat('22',32),'hex'),decode(repeat('20',32),'hex'),
    decode(repeat('25',32),'hex'),decode(repeat('26',32),'hex'),decode(repeat('ac',115),'hex'),
    'a3-retry-1','a3000000-0000-4000-8000-000000000011');
  reused:=uptech.rotate_mobile_refresh_v1(decode(repeat('22',32),'hex'),decode(repeat('20',32),'hex'),
    decode(repeat('27',32),'hex'),decode(repeat('28',32),'hex'),decode(repeat('ad',115),'hex'),
    'a3-retry-different','a3000000-0000-4000-8000-000000000012');
  IF (rotated).outcome<>'ROTATED' OR (replayed).outcome<>'REPLAY'
    OR (reused).outcome<>'FAMILY_REVOKED' OR (replayed).replay_capsule<>decode(repeat('ab',115),'hex') THEN
    RAISE EXCEPTION 'mobile refresh rotate/replay/reuse contract failed';
  END IF;
END
$session_verify$;

RESET ROLE;
SET LOCAL ROLE uptech_migration_owner;

DO $audit_verify$
BEGIN
  IF (SELECT count(*) FROM uptech.platform_audit_events
      WHERE action='MOBILE_REFRESH_FAMILY_REVOKED' AND request_id='a3000000-0000-4000-8000-000000000012')<>1
    OR (SELECT count(*) FROM uptech.audit_events
      WHERE action='MOBILE_REFRESH_FAMILY_REVOKED' AND request_id='a3000000-0000-4000-8000-000000000012')<>1
    OR (SELECT status FROM uptech.sessions WHERE id='a3000000-0000-4000-8000-000000000005')<>'REVOKED' THEN
    RAISE EXCEPTION 'refresh reuse was not atomically revoked and audited';
  END IF;
END
$audit_verify$;

ROLLBACK;
