\set ON_ERROR_STOP on

-- Run after Phase 1, A1, A2, and the Google Web-login registry seed.
-- Every fixture and assertion is rolled back.
BEGIN;

DO $verify$
DECLARE
  create_routine regprocedure := pg_catalog.to_regprocedure(
    'uptech.create_initial_owner_bootstrap_v1(uuid,uuid,uptech.google_normalized_domain_v1,uptech.google_normalized_email_v1,timestamp with time zone,uuid)'
  );
  completion_routine regprocedure := pg_catalog.to_regprocedure(
    'uptech.complete_web_google_login_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)'
  );
  internal_routine regprocedure := pg_catalog.to_regprocedure(
    'uptech.complete_web_google_login_a1_internal_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)'
  );
  routine_oid regprocedure;
BEGIN
  IF create_routine IS NULL OR completion_routine IS NULL
     OR internal_routine IS NULL THEN
    RAISE EXCEPTION 'one or more exact A2 routines are missing';
  END IF;

  FOREACH routine_oid IN ARRAY ARRAY[
    create_routine, completion_routine, internal_routine
  ]::regprocedure[] LOOP
    IF NOT (
      SELECT procedure_row.prosecdef
        AND procedure_row.provolatile = 'v'
        AND procedure_row.proconfig =
          ARRAY['search_path=pg_catalog, uptech']::text[]
        AND procedure_row.proowner = (
          SELECT role_row.oid FROM pg_catalog.pg_roles AS role_row
          WHERE role_row.rolname = 'uptech_migration_owner'
        )
      FROM pg_catalog.pg_proc AS procedure_row
      WHERE procedure_row.oid = routine_oid
    ) THEN
      RAISE EXCEPTION 'A2 routine % has unsafe attributes', routine_oid;
    END IF;

    IF (
      SELECT procedure_row.prosrc ~*
        '(^|[^[:alnum:]_])EXECUTE([^[:alnum:]_]|$)'
      FROM pg_catalog.pg_proc AS procedure_row
      WHERE procedure_row.oid = routine_oid
    ) THEN
      RAISE EXCEPTION 'dynamic SQL found in A2 routine %', routine_oid;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS procedure_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(
          procedure_row.proacl,
          pg_catalog.acldefault('f', procedure_row.proowner)
        )
      ) AS acl_row
      WHERE procedure_row.oid = routine_oid
        AND acl_row.grantee = 0
        AND acl_row.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'PUBLIC can execute A2 routine %', routine_oid;
    END IF;
  END LOOP;

  IF pg_catalog.has_function_privilege(
       'uptech_api_runtime', create_routine, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'uptech_worker_runtime', create_routine, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'uptech_api_runtime', internal_routine, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'uptech_worker_runtime', internal_routine, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'uptech_api_runtime', completion_routine, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'uptech_worker_runtime', completion_routine, 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'A2 operator/internal/runtime execute separation is wrong';
  END IF;

  IF pg_catalog.has_table_privilege(
       'uptech_api_runtime',
       'uptech.initial_owner_bootstrap_intents', 'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'uptech_api_runtime',
       'uptech.initial_owner_bootstrap_intents', 'INSERT'
     )
     OR pg_catalog.has_table_privilege(
       'uptech_worker_runtime',
       'uptech.initial_owner_bootstrap_intents', 'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'uptech_worker_runtime',
       'uptech.initial_owner_bootstrap_intents', 'INSERT'
     ) THEN
    RAISE EXCEPTION 'runtime role can access A2 bootstrap intent table';
  END IF;
END
$verify$;

SET LOCAL ROLE uptech_migration_owner;

INSERT INTO uptech.google_auth_environment_registry (
  environment_name, rate_limit_audit_hmac_key, is_active
)
SELECT
  'a2-verify', pg_catalog.decode(pg_catalog.repeat('a2', 32), 'hex'), true
WHERE NOT EXISTS (
  SELECT 1 FROM uptech.google_auth_environment_registry WHERE is_active
);

INSERT INTO uptech.google_auth_configuration_registry (
  configuration_key, environment_name, purpose, google_client_id,
  google_audience, audience_configuration_key, callback_uri, scopes,
  allowed_azp_configuration_keys, web_pkce_kms_key_version, is_enabled
)
SELECT
  'GOOGLE_WEB_LOGIN_V1', environment_row.environment_name, 'WEB_LOGIN',
  'a2-verify.apps.googleusercontent.com',
  'a2-verify.apps.googleusercontent.com', 'GOOGLE_WEB_LOGIN_V1',
  'https://a2-verify.test/api/v1/auth/google/callback',
  ARRAY['openid', 'email', 'profile']::text[],
  ARRAY['GOOGLE_WEB_LOGIN_V1'::uptech.google_auth_configuration_key_v1],
  'a2-verify-kms-v1', true
FROM uptech.google_auth_environment_registry AS environment_row
WHERE environment_row.is_active
ON CONFLICT (configuration_key) DO NOTHING;

INSERT INTO uptech.workspaces (
  workspace_id, status, provisioning_policy
) VALUES (
  'a2000000-0000-0000-0000-000000000001', 'PENDING', 'INVITE_ONLY'
);

INSERT INTO uptech.workspace_domain_locators (
  normalized_domain, workspace_id, status, verified_at
) VALUES (
  'a2-verify.test', 'a2000000-0000-0000-0000-000000000001',
  'VERIFIED', pg_catalog.clock_timestamp()
);

SELECT uptech.create_initial_owner_bootstrap_v1(
  'a2000000-0000-0000-0000-000000000002',
  'a2000000-0000-0000-0000-000000000001',
  'a2-verify.test', 'owner@a2-verify.test',
  pg_catalog.clock_timestamp() + interval '1 hour',
  'a2000000-0000-0000-0000-000000000003'
);

RESET ROLE;
SET LOCAL ROLE uptech_api_runtime;

DO $verify$
DECLARE
  begin_result uptech.google_login_begin_result_v1;
  consume_result uptech.google_web_login_consume_result_v1;
  completion_result uptech.google_login_completion_result_v1;
BEGIN
  begin_result := uptech.begin_google_login_transaction_v1(
    'WEB_LOGIN',
    pg_catalog.decode(pg_catalog.repeat('b0', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('b1', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('b2', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('b3', 32), 'hex'),
    ROW(
      1, 'AES-256-GCM',
      pg_catalog.decode(pg_catalog.repeat('b4', 12), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('b5', 36), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('b6', 16), 'hex')
    )::uptech.google_web_pkce_envelope_v1,
    'a2000000-0000-0000-0000-000000000004'
  );

  consume_result := uptech.consume_google_login_transaction_v1(
    'WEB_LOGIN'::uptech.google_login_purpose_v1,
    pg_catalog.decode(pg_catalog.repeat('b0', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('b1', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('b3', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('b7', 32), 'hex')::uptech.google_auth_hash32_v1,
    'a2000000-0000-0000-0000-000000000005'::uuid
  );

  IF (begin_result).outcome <> 'CREATED'
     OR (consume_result).outcome <> 'RESERVED' THEN
    RAISE EXCEPTION 'A2 positive transaction fixture did not reserve';
  END IF;

  completion_result := uptech.complete_web_google_login_v1(
    pg_catalog.decode(pg_catalog.repeat('b7', 32), 'hex'),
    ROW(
      'https://accounts.google.com', 'A2VerifiedOwnerSubject',
      'owner@a2-verify.test', true, 'a2-verify.test',
      pg_catalog.clock_timestamp() - interval '1 second',
      pg_catalog.clock_timestamp() + interval '1 hour',
      'GOOGLE_WEB_LOGIN_V1', NULL,
      pg_catalog.decode(pg_catalog.repeat('b2', 32), 'hex')
    )::uptech.google_verified_claims_assertion_v1,
    pg_catalog.decode(pg_catalog.repeat('b8', 32), 'hex'),
    pg_catalog.decode(pg_catalog.repeat('b9', 32), 'hex'),
    NULL,
    'a2000000-0000-0000-0000-000000000006'
  );

  IF (completion_result).outcome <> 'NORMAL'
     OR (completion_result).allowed_operations IS NOT NULL THEN
    RAISE EXCEPTION 'A2 positive completion did not issue a normal session';
  END IF;
END
$verify$;

RESET ROLE;
SET LOCAL ROLE uptech_migration_owner;

DO $verify$
BEGIN
  IF (
    SELECT workspace_row.status <> 'ACTIVE'
    FROM uptech.workspaces AS workspace_row
    WHERE workspace_row.workspace_id =
      'a2000000-0000-0000-0000-000000000001'
  )
  OR (
    SELECT count(*) <> 1
    FROM uptech.workspace_memberships AS membership_row
    WHERE membership_row.workspace_id =
        'a2000000-0000-0000-0000-000000000001'
      AND membership_row.role = 'OWNER'
      AND membership_row.status = 'ACTIVE'
  )
  OR (
    SELECT intent.status <> 'CONSUMED'
      OR intent.resolved_identity_id IS NULL
      OR intent.resolved_membership_id IS NULL
    FROM uptech.initial_owner_bootstrap_intents AS intent
    WHERE intent.bootstrap_id =
      'a2000000-0000-0000-0000-000000000002'
  )
  OR (
    SELECT count(*) <> 1
    FROM uptech.session_tokens AS token_row
    WHERE token_row.token_hash =
      pg_catalog.decode(pg_catalog.repeat('b8', 32), 'hex')
      AND token_row.token_kind = 'WEB_SESSION'
      AND token_row.token_status = 'CURRENT'
  )
  OR (
    SELECT count(*) <> 1
    FROM uptech.platform_audit_events AS audit_row
    WHERE audit_row.action = 'INITIAL_OWNER_BOOTSTRAP_CONSUMED'
      AND audit_row.request_id =
        'a2000000-0000-0000-0000-000000000006'
      AND NOT (audit_row.metadata ? 'normalized_target_email')
      AND NOT (audit_row.metadata ? 'verified_provider_subject')
  )
  OR (
    SELECT count(*) <> 1
    FROM uptech.audit_events AS audit_row
    WHERE audit_row.action = 'INITIAL_OWNER_BOOTSTRAP_CONSUMED'
      AND audit_row.request_id =
        'a2000000-0000-0000-0000-000000000006'
  ) THEN
    RAISE EXCEPTION 'A2 positive persistence/audit invariants failed';
  END IF;
END
$verify$;

ROLLBACK;

\echo 'SCKP-001-A2 initial Owner bootstrap verification passed (transaction rolled back).'
