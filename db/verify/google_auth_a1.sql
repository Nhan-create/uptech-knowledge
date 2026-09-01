\set ON_ERROR_STOP on

-- Run after A1 alone or after the staged A4 migration. All fixtures are
-- rolled back; A4 must have retired the obsolete native completion boundary.
BEGIN;

DO $verify$
DECLARE
  a4_decommission_applied boolean :=
    pg_catalog.to_regtype('uptech.google_login_completion_result_v2') IS NOT NULL;
  legacy_native_completion regprocedure := pg_catalog.to_regprocedure(
    'uptech.complete_native_google_login_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)'
  );
  expected_routines regprocedure[] := ARRAY[
    pg_catalog.to_regprocedure(
      'uptech.begin_google_login_transaction_v1(uptech.google_login_purpose_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_web_pkce_envelope_v1,uuid)'
    ),
    pg_catalog.to_regprocedure(
      'uptech.begin_google_login_transaction_v1(uptech.google_login_purpose_v1,uptech.google_auth_hash32_v1,uptech.google_native_transaction_handle_hash_v1,uptech.google_native_s256_hash_v1,uuid)'
    ),
    pg_catalog.to_regprocedure(
      'uptech.consume_google_login_transaction_v1(uptech.google_login_purpose_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)'
    ),
    pg_catalog.to_regprocedure(
      'uptech.consume_google_login_transaction_v1(uptech.google_login_purpose_v1,uptech.google_auth_hash32_v1,uptech.google_native_transaction_handle_hash_v1,uptech.google_native_s256_hash_v1,uptech.google_auth_hash32_v1,uuid)'
    ),
    pg_catalog.to_regprocedure(
      'uptech.complete_web_google_login_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)'
    ),
    pg_catalog.to_regprocedure(
      'uptech.complete_native_google_login_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)'
    ),
    pg_catalog.to_regprocedure(
      'uptech.record_google_login_rejection_v1(uptech.google_login_purpose_v1,uptech.google_auth_hash32_v1,uptech.google_auth_rejection_class_v1,uuid)'
    ),
    pg_catalog.to_regprocedure(
      'uptech.record_google_login_rejection_v1(uptech.google_auth_hash32_v1,uptech.google_auth_rejection_class_v1,uuid)'
    )
  ]::regprocedure[];
  routine_oid regprocedure;
BEGIN
  IF array_position(expected_routines, NULL::regprocedure) IS NOT NULL
     OR cardinality(expected_routines) <> 8 THEN
    RAISE EXCEPTION 'one or more exact A1 routine overloads are missing';
  END IF;

  IF NOT a4_decommission_applied AND (
    SELECT count(*)
    FROM pg_catalog.pg_proc AS procedure_row
    JOIN pg_catalog.pg_namespace AS namespace_row
      ON namespace_row.oid = procedure_row.pronamespace
    WHERE namespace_row.nspname = 'uptech'
      AND procedure_row.proname IN (
        'begin_google_login_transaction_v1',
        'consume_google_login_transaction_v1',
        'complete_web_google_login_v1',
        'complete_native_google_login_v1',
        'record_google_login_rejection_v1'
      )
  ) <> 8 THEN
    RAISE EXCEPTION 'A1 privileged routine catalog is not exhaustive';
  END IF;

  FOREACH routine_oid IN ARRAY expected_routines LOOP
    IF NOT (
      SELECT procedure_row.prosecdef
        AND procedure_row.provolatile = 'v'
        AND procedure_row.proconfig =
          ARRAY['search_path=pg_catalog, uptech']::text[]
        AND procedure_row.proowner = (
          SELECT role_row.oid
          FROM pg_catalog.pg_roles AS role_row
          WHERE role_row.rolname = 'uptech_migration_owner'
        )
      FROM pg_catalog.pg_proc AS procedure_row
      WHERE procedure_row.oid = routine_oid
    ) THEN
      RAISE EXCEPTION 'A1 routine % has unsafe ownership/attributes', routine_oid;
    END IF;

    IF (
      SELECT procedure_row.prosrc ~*
        '(^|[^[:alnum:]_])EXECUTE([^[:alnum:]_]|$)'
      FROM pg_catalog.pg_proc AS procedure_row
      WHERE procedure_row.oid = routine_oid
    ) THEN
      RAISE EXCEPTION 'dynamic SQL found in A1 routine %', routine_oid;
    END IF;

    IF routine_oid = legacy_native_completion AND a4_decommission_applied THEN
      IF pg_catalog.has_function_privilege(
           'uptech_api_runtime', routine_oid, 'EXECUTE'
         ) OR pg_catalog.has_function_privilege(
           'uptech_worker_runtime', routine_oid, 'EXECUTE'
         ) THEN
        RAISE EXCEPTION 'obsolete native completion remains runtime-executable';
      END IF;
    ELSIF NOT pg_catalog.has_function_privilege(
           'uptech_api_runtime', routine_oid, 'EXECUTE'
         ) OR pg_catalog.has_function_privilege(
           'uptech_worker_runtime', routine_oid, 'EXECUTE'
         ) THEN
      RAISE EXCEPTION 'A1 API/worker execute separation is wrong for %', routine_oid;
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
      RAISE EXCEPTION 'PUBLIC can execute A1 routine %', routine_oid;
    END IF;
  END LOOP;

  IF NOT a4_decommission_applied AND (
    SELECT count(*)
    FROM pg_catalog.pg_proc AS procedure_row
    JOIN pg_catalog.pg_namespace AS namespace_row
      ON namespace_row.oid = procedure_row.pronamespace
    WHERE namespace_row.nspname = 'uptech'
      AND procedure_row.prosecdef
  ) <> 10 THEN
    RAISE EXCEPTION 'unexpected SECURITY DEFINER routine added outside A1 allowlist';
  END IF;
END
$verify$;

SET LOCAL ROLE uptech_migration_owner;

-- Seed the immutable deployment registry before exercising any ingress.
INSERT INTO uptech.google_auth_environment_registry (
  environment_name, rate_limit_audit_hmac_key, is_active
) VALUES (
  'verify', pg_catalog.decode(pg_catalog.repeat('a0', 32), 'hex'), true
)
ON CONFLICT DO NOTHING;

INSERT INTO uptech.google_auth_configuration_registry (
  configuration_key,
  environment_name,
  purpose,
  google_client_id,
  google_audience,
  audience_configuration_key,
  callback_uri,
  scopes,
  allowed_azp_configuration_keys,
  web_pkce_kms_key_version,
  is_enabled
) VALUES (
  'GOOGLE_WEB_LOGIN_V1',
  'verify',
  'WEB_LOGIN',
  'verify-client.apps.googleusercontent.com',
  'verify-client.apps.googleusercontent.com',
  'GOOGLE_WEB_LOGIN_V1',
      'https://tenant-a.example/api/v1/auth/google/callback',
  ARRAY['openid', 'email', 'profile']::text[],
  ARRAY[
    'GOOGLE_WEB_LOGIN_V1'::uptech.google_auth_configuration_key_v1
  ],
  'verify-kms-key-v1',
  true
)
ON CONFLICT DO NOTHING;

DO $verify$
BEGIN
  IF uptech.google_auth_hmac_sha256_v1(
       pg_catalog.decode(pg_catalog.repeat('a0', 32), 'hex')::uptech.google_auth_hash32_v1,
       pg_catalog.convert_to('A1-HMAC-VERIFY', 'UTF8')
     ) <> pg_catalog.decode(
       'f14179c7d6464f0e0c48dfbf80db0b9393321d88d53a979c6b4031c4062a41c9',
       'hex'
     ) THEN
    RAISE EXCEPTION 'private HMAC-SHA-256 primitive failed known vector';
  END IF;
END
$verify$;

RESET ROLE;
SET LOCAL ROLE uptech_api_runtime;

DO $verify$
DECLARE
  begin_result uptech.google_login_begin_result_v1;
  wrong_browser_result uptech.google_web_login_consume_result_v1;
  reserved_result uptech.google_web_login_consume_result_v1;
  replay_result uptech.google_web_login_consume_result_v1;
  rejection_result uptech.google_login_rejection_outcome_v1;
BEGIN
  begin_result := uptech.begin_google_login_transaction_v1(
    'WEB_LOGIN'::uptech.google_login_purpose_v1,
    pg_catalog.decode(pg_catalog.repeat('20', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('22', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('23', 32), 'hex')::uptech.google_auth_hash32_v1,
    ROW(
      1,
      'AES-256-GCM'::uptech.google_auth_pkce_algorithm_v1,
      pg_catalog.decode(pg_catalog.repeat('24', 12), 'hex')::uptech.google_auth_nonce12_v1,
      pg_catalog.decode(pg_catalog.repeat('25', 36), 'hex')::uptech.google_auth_pkce_ciphertext_v1,
      pg_catalog.decode(pg_catalog.repeat('26', 16), 'hex')::uptech.google_auth_tag16_v1
    )::uptech.google_web_pkce_envelope_v1,
    '62000000-0000-0000-0000-000000000001'::uuid
  );

  wrong_browser_result := uptech.consume_google_login_transaction_v1(
    'WEB_LOGIN'::uptech.google_login_purpose_v1,
    pg_catalog.decode(pg_catalog.repeat('20', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('ff', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('27', 32), 'hex')::uptech.google_auth_hash32_v1,
    '62000000-0000-0000-0000-000000000002'::uuid
  );

  reserved_result := uptech.consume_google_login_transaction_v1(
    'WEB_LOGIN'::uptech.google_login_purpose_v1,
    pg_catalog.decode(pg_catalog.repeat('20', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('23', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('28', 32), 'hex')::uptech.google_auth_hash32_v1,
    '62000000-0000-0000-0000-000000000003'::uuid
  );

  replay_result := uptech.consume_google_login_transaction_v1(
    'WEB_LOGIN'::uptech.google_login_purpose_v1,
    pg_catalog.decode(pg_catalog.repeat('20', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('23', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('29', 32), 'hex')::uptech.google_auth_hash32_v1,
    '62000000-0000-0000-0000-000000000004'::uuid
  );

  IF (begin_result).outcome <> 'CREATED'
     OR (wrong_browser_result).outcome <> 'DENIED'
     OR (reserved_result).outcome <> 'RESERVED'
     OR (replay_result).outcome <> 'DENIED' THEN
    RAISE EXCEPTION 'wrong-browser/single-use reservation matrix failed';
  END IF;

  rejection_result := uptech.record_google_login_rejection_v1(
    pg_catalog.decode(pg_catalog.repeat('28', 32), 'hex')::uptech.google_auth_hash32_v1,
    'PROVIDER_REJECTED'::uptech.google_auth_rejection_class_v1,
    '62000000-0000-0000-0000-000000000005'::uuid
  );
  IF rejection_result <> 'RECORDED' THEN
    RAISE EXCEPTION 'bound provider rejection was not recorded';
  END IF;

  rejection_result := uptech.record_google_login_rejection_v1(
    pg_catalog.decode(pg_catalog.repeat('28', 32), 'hex')::uptech.google_auth_hash32_v1,
    'PROVIDER_REJECTED'::uptech.google_auth_rejection_class_v1,
    '62000000-0000-0000-0000-000000000006'::uuid
  );
  IF rejection_result <> 'RECORDED' THEN
    RAISE EXCEPTION 'replayed bound rejection leaked handle state';
  END IF;
END
$verify$;

DO $verify$
DECLARE
  begin_result uptech.google_login_begin_result_v1;
  consume_result uptech.google_web_login_consume_result_v1;
  completion_result record;
BEGIN
  begin_result := uptech.begin_google_login_transaction_v1(
    'WEB_LOGIN'::uptech.google_login_purpose_v1,
    pg_catalog.decode(pg_catalog.repeat('30', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('31', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('32', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('33', 32), 'hex')::uptech.google_auth_hash32_v1,
    ROW(
      1, 'AES-256-GCM'::uptech.google_auth_pkce_algorithm_v1,
      pg_catalog.decode(pg_catalog.repeat('34', 12), 'hex')::uptech.google_auth_nonce12_v1,
      pg_catalog.decode(pg_catalog.repeat('35', 36), 'hex')::uptech.google_auth_pkce_ciphertext_v1,
      pg_catalog.decode(pg_catalog.repeat('36', 16), 'hex')::uptech.google_auth_tag16_v1
    )::uptech.google_web_pkce_envelope_v1,
    '63000000-0000-0000-0000-000000000001'::uuid
  );
  consume_result := uptech.consume_google_login_transaction_v1(
    'WEB_LOGIN'::uptech.google_login_purpose_v1,
    pg_catalog.decode(pg_catalog.repeat('30', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('31', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('33', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('37', 32), 'hex')::uptech.google_auth_hash32_v1,
    '63000000-0000-0000-0000-000000000002'::uuid
  );
  completion_result := uptech.complete_web_google_login_v1(
    pg_catalog.decode(pg_catalog.repeat('37', 32), 'hex')::uptech.google_auth_hash32_v1,
    ROW(
      'https://accounts.google.com'::uptech.google_auth_issuer_v1,
      'NonceMismatchSubject'::uptech.google_provider_subject_v1,
      'nonce-mismatch@unknown.example'::uptech.google_normalized_email_v1,
      true,
      'tenant-a.example'::uptech.google_normalized_domain_v1,
      pg_catalog.clock_timestamp(),
      pg_catalog.clock_timestamp() + interval '1 hour',
      'GOOGLE_WEB_LOGIN_V1'::uptech.google_auth_configuration_key_v1,
      NULL::uptech.google_auth_configuration_key_v1,
      pg_catalog.decode(pg_catalog.repeat('ff', 32), 'hex')::uptech.google_auth_hash32_v1
    )::uptech.google_verified_claims_assertion_v1,
    pg_catalog.decode(pg_catalog.repeat('38', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('39', 32), 'hex')::uptech.google_auth_hash32_v1,
    NULL::uptech.google_auth_hash32_v1,
    '63000000-0000-0000-0000-000000000003'::uuid
  );

  IF (begin_result).outcome <> 'CREATED'
     OR (consume_result).outcome <> 'RESERVED'
     OR (completion_result).outcome <> 'DENIED' THEN
    RAISE EXCEPTION 'nonce mismatch was not denied after reservation';
  END IF;
END
$verify$;

DO $verify$
DECLARE
  begin_result uptech.google_login_begin_result_v1;
  consume_result uptech.google_web_login_consume_result_v1;
  completion_result record;
BEGIN
  begin_result := uptech.begin_google_login_transaction_v1(
    'WEB_LOGIN'::uptech.google_login_purpose_v1,
    pg_catalog.decode(pg_catalog.repeat('40', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('42', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('43', 32), 'hex')::uptech.google_auth_hash32_v1,
    ROW(
      1, 'AES-256-GCM'::uptech.google_auth_pkce_algorithm_v1,
      pg_catalog.decode(pg_catalog.repeat('44', 12), 'hex')::uptech.google_auth_nonce12_v1,
      pg_catalog.decode(pg_catalog.repeat('45', 36), 'hex')::uptech.google_auth_pkce_ciphertext_v1,
      pg_catalog.decode(pg_catalog.repeat('46', 16), 'hex')::uptech.google_auth_tag16_v1
    )::uptech.google_web_pkce_envelope_v1,
    '64000000-0000-0000-0000-000000000001'::uuid
  );
  consume_result := uptech.consume_google_login_transaction_v1(
    'WEB_LOGIN'::uptech.google_login_purpose_v1,
    pg_catalog.decode(pg_catalog.repeat('40', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('41', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('43', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('47', 32), 'hex')::uptech.google_auth_hash32_v1,
    '64000000-0000-0000-0000-000000000002'::uuid
  );
  completion_result := uptech.complete_web_google_login_v1(
    pg_catalog.decode(pg_catalog.repeat('47', 32), 'hex')::uptech.google_auth_hash32_v1,
    ROW(
      'https://accounts.google.com'::uptech.google_auth_issuer_v1,
      'OnboardingSubject'::uptech.google_provider_subject_v1,
      'person@tenant-b.example'::uptech.google_normalized_email_v1,
      true,
      'tenant-b.example'::uptech.google_normalized_domain_v1,
      pg_catalog.clock_timestamp(),
      pg_catalog.clock_timestamp() + interval '1 hour',
      'GOOGLE_WEB_LOGIN_V1'::uptech.google_auth_configuration_key_v1,
      NULL::uptech.google_auth_configuration_key_v1,
      pg_catalog.decode(pg_catalog.repeat('42', 32), 'hex')::uptech.google_auth_hash32_v1
    )::uptech.google_verified_claims_assertion_v1,
    pg_catalog.decode(pg_catalog.repeat('48', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('49', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('4a', 32), 'hex')::uptech.google_auth_hash32_v1,
    '64000000-0000-0000-0000-000000000003'::uuid
  );

  IF (begin_result).outcome <> 'CREATED'
     OR (consume_result).outcome <> 'RESERVED'
     OR (completion_result).outcome <> 'ONBOARDING'
     OR cardinality((completion_result).allowed_operations) <> 5
     OR (completion_result).expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'bounded unknown-domain onboarding was not issued';
  END IF;
END
$verify$;

DO $verify$
BEGIN
  IF (
    SELECT count(*)
    FROM uptech.authenticate_session(
      pg_catalog.decode(pg_catalog.repeat('4a', 32), 'hex')
    ) AS authenticated
    WHERE authenticated.context_kind = 'ONBOARDING'
      AND authenticated.workspace_id IS NULL
      AND cardinality(authenticated.allowed_operations) = 5
  ) <> 1 THEN
    RAISE EXCEPTION 'onboarding credential gained authority or did not authenticate';
  END IF;
END
$verify$;

RESET ROLE;
SET LOCAL ROLE uptech_migration_owner;

DO $verify$
DECLARE
  current_window timestamptz := pg_catalog.to_timestamp(
    pg_catalog.floor(
      pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()) / 60
    ) * 60
  );
BEGIN
  IF EXISTS (
    SELECT 1 FROM uptech.session_tokens AS token_row
    WHERE token_row.token_hash =
      pg_catalog.decode(pg_catalog.repeat('38', 32), 'hex')
  ) OR EXISTS (
    SELECT 1 FROM uptech.identities AS identity_row
    WHERE identity_row.provider_subject = 'NonceMismatchSubject'
  ) THEN
    RAISE EXCEPTION 'nonce-mismatch completion persisted identity/session state';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM uptech.oauth_transactions AS transaction_row
    WHERE transaction_row.locator_hash =
        pg_catalog.decode(pg_catalog.repeat('31', 32), 'hex')
      AND transaction_row.status = 'REJECTED'
  ) THEN
    RAISE EXCEPTION 'nonce-mismatch reservation was not terminally rejected';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM uptech.oauth_transactions AS transaction_row
    WHERE transaction_row.locator_hash =
        pg_catalog.decode(pg_catalog.repeat('21', 32), 'hex')
      AND transaction_row.status = 'REJECTED'
  ) OR (
    SELECT count(*) FROM uptech.platform_audit_events AS audit_row
    WHERE audit_row.action = 'GOOGLE_AUTH_EXCHANGE_REJECTED'
      AND audit_row.request_id IN (
        '62000000-0000-0000-0000-000000000005'::uuid,
        '62000000-0000-0000-0000-000000000006'::uuid
      )
  ) <> 1 THEN
    RAISE EXCEPTION 'bound rejection was not single-use and masked';
  END IF;

  INSERT INTO uptech.google_auth_rate_limit_buckets (
    environment_name, bucket_scope, network_hmac, window_started_at,
    request_count, over_limit_observed, expires_at, updated_at
  ) VALUES (
    'verify',
    'GOOGLE_AUTH',
    pg_catalog.decode(pg_catalog.repeat('50', 32), 'hex'),
    current_window,
    10,
    false,
    current_window + interval '1 minute',
    pg_catalog.clock_timestamp()
  );
END
$verify$;

RESET ROLE;
SET LOCAL ROLE uptech_api_runtime;

DO $verify$
DECLARE
  first_result uptech.google_login_rejection_outcome_v1;
  second_result uptech.google_login_rejection_outcome_v1;
  independent_result uptech.google_login_rejection_outcome_v1;
BEGIN
  first_result := uptech.record_google_login_rejection_v1(
    'WEB_LOGIN'::uptech.google_login_purpose_v1,
    pg_catalog.decode(pg_catalog.repeat('50', 32), 'hex')::uptech.google_auth_hash32_v1,
    'PROTOCOL_INVALID'::uptech.google_auth_rejection_class_v1,
    '65000000-0000-0000-0000-000000000001'::uuid
  );
  second_result := uptech.record_google_login_rejection_v1(
    'NATIVE_ANDROID_LOGIN'::uptech.google_login_purpose_v1,
    pg_catalog.decode(pg_catalog.repeat('50', 32), 'hex')::uptech.google_auth_hash32_v1,
    'PROTOCOL_INVALID'::uptech.google_auth_rejection_class_v1,
    '65000000-0000-0000-0000-000000000002'::uuid
  );
  independent_result := uptech.record_google_login_rejection_v1(
    'WEB_LOGIN'::uptech.google_login_purpose_v1,
    pg_catalog.decode(pg_catalog.repeat('51', 32), 'hex')::uptech.google_auth_hash32_v1,
    'PROTOCOL_INVALID'::uptech.google_auth_rejection_class_v1,
    '65000000-0000-0000-0000-000000000003'::uuid
  );

  IF first_result <> 'RATE_LIMITED'
     OR second_result <> 'RATE_LIMITED'
     OR independent_result <> 'RECORDED' THEN
    RAISE EXCEPTION 'shared/cross-purpose GOOGLE_AUTH admission is incorrect';
  END IF;
END
$verify$;

RESET ROLE;
SET LOCAL ROLE uptech_migration_owner;

DO $verify$
BEGIN
  IF (
    SELECT count(*)
    FROM uptech.platform_audit_events AS audit_row
    WHERE audit_row.action = 'GOOGLE_AUTH_RATE_LIMITED'
      AND audit_row.google_auth_rate_limit_audit_key IS NOT NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'over-limit flood produced more than one summary event';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM uptech.google_auth_rate_limit_buckets AS bucket_row
    WHERE bucket_row.network_hmac =
        pg_catalog.decode(pg_catalog.repeat('50', 32), 'hex')
      AND bucket_row.request_count = 10
      AND bucket_row.over_limit_observed
  ) OR NOT EXISTS (
    SELECT 1
    FROM uptech.google_auth_rate_limit_buckets AS bucket_row
    WHERE bucket_row.network_hmac =
        pg_catalog.decode(pg_catalog.repeat('51', 32), 'hex')
      AND bucket_row.request_count = 1
      AND NOT bucket_row.over_limit_observed
  ) THEN
    RAISE EXCEPTION 'rate bucket saturation or independent HMAC behavior is wrong';
  END IF;

  BEGIN
    UPDATE uptech.platform_audit_events
    SET metadata = '{"tampered":true}'::jsonb
    WHERE google_auth_rate_limit_audit_key IS NOT NULL;
    RAISE EXCEPTION 'rate-limit summary audit was mutable';
  EXCEPTION
    WHEN object_not_in_prerequisite_state THEN NULL;
  END;
END
$verify$;

DO $verify$
DECLARE
  table_name text;
  role_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'google_auth_environment_registry',
    'google_auth_configuration_registry',
    'workspace_domain_locators',
    'google_auth_rate_limit_buckets',
    'oauth_transactions',
    'platform_audit_events',
    'users',
    'identities',
    'onboarding_sessions'
  ]::text[] LOOP
    FOREACH role_name IN ARRAY ARRAY[
      'uptech_api_runtime', 'uptech_worker_runtime'
    ]::text[] LOOP
      IF pg_catalog.has_table_privilege(
           role_name,
           pg_catalog.format('uptech.%I', table_name),
           'SELECT'
         )
         OR pg_catalog.has_table_privilege(
           role_name,
           pg_catalog.format('uptech.%I', table_name),
           'INSERT'
         )
         OR pg_catalog.has_table_privilege(
           role_name,
           pg_catalog.format('uptech.%I', table_name),
           'UPDATE'
         )
         OR pg_catalog.has_table_privilege(
           role_name,
           pg_catalog.format('uptech.%I', table_name),
           'DELETE'
         ) THEN
        RAISE EXCEPTION '% has direct A1/pre-tenant privilege on %',
          role_name, table_name;
      END IF;
    END LOOP;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_indexes AS index_row
    WHERE index_row.schemaname = 'uptech'
      AND index_row.indexname =
        'platform_audit_google_auth_rate_limit_key_unique'
      AND index_row.indexdef ~* 'UNIQUE'
      AND index_row.indexdef ~* 'google_auth_rate_limit_audit_key'
  ) THEN
    RAISE EXCEPTION 'coalesced rate-limit audit uniqueness is missing';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid IN (
      'uptech.google_auth_environment_registry'::regclass,
      'uptech.google_auth_configuration_registry'::regclass
    )
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgenabled = 'O'
  ) <> 2 THEN
    RAISE EXCEPTION 'immutable Google configuration triggers are missing';
  END IF;
END
$verify$;

SET LOCAL ROLE uptech_migration_owner;

INSERT INTO uptech.google_auth_environment_registry (
  environment_name, rate_limit_audit_hmac_key, is_active
) VALUES (
  'verify', pg_catalog.decode(pg_catalog.repeat('a0', 32), 'hex'), true
)
ON CONFLICT DO NOTHING;

INSERT INTO uptech.google_auth_configuration_registry (
  configuration_key,
  environment_name,
  purpose,
  google_client_id,
  google_audience,
  audience_configuration_key,
  callback_uri,
  scopes,
  allowed_azp_configuration_keys,
  web_pkce_kms_key_version,
  is_enabled
) VALUES (
  'GOOGLE_WEB_LOGIN_V1',
  'verify',
  'WEB_LOGIN',
  'verify-client.apps.googleusercontent.com',
  'verify-client.apps.googleusercontent.com',
  'GOOGLE_WEB_LOGIN_V1',
      'https://tenant-a.example/api/v1/auth/google/callback',
  ARRAY['openid', 'email', 'profile']::text[],
  ARRAY[
    'GOOGLE_WEB_LOGIN_V1'::uptech.google_auth_configuration_key_v1
  ],
  'verify-kms-key-v1',
  true
)
ON CONFLICT DO NOTHING;

INSERT INTO uptech.workspaces (
  workspace_id, status, provisioning_policy, security_version,
  permission_epoch
) VALUES (
  'a3000000-0000-0000-0000-000000000003',
  'ACTIVE',
  'DOMAIN_AUTO_PROVISION',
  1,
  1
);

INSERT INTO uptech.workspace_domain_locators (
  normalized_domain, workspace_id, status, verified_at
) VALUES
  (
    'tenant-a.example',
    'a3000000-0000-0000-0000-000000000003',
    'VERIFIED',
    pg_catalog.clock_timestamp()
  ),
  (
    'unknown.example',
    'a3000000-0000-0000-0000-000000000003',
    'VERIFIED',
    pg_catalog.clock_timestamp()
  );

-- This identity intentionally shares the future login email.  A1 must still
-- create/resolve solely by issuer + case-sensitive subject.
INSERT INTO uptech.users (id, status, security_version)
VALUES ('b3000000-0000-0000-0000-000000000003', 'ACTIVE', 1);

INSERT INTO uptech.identities (
  id, user_id, provider, issuer, provider_subject, status, security_version,
  email_claim, email_verified, hosted_domain_claim, claims_observed_at
) VALUES (
  'c3000000-0000-0000-0000-000000000003',
  'b3000000-0000-0000-0000-000000000003',
  'GOOGLE',
  'https://accounts.google.com',
  'DifferentCaseSensitiveSubject',
  'ACTIVE',
  1,
    'member@tenant-a.example',
  true,
  'tenant-a.example',
  pg_catalog.clock_timestamp()
);

RESET ROLE;
SET LOCAL ROLE uptech_api_runtime;

DO $verify$
DECLARE
  begin_result uptech.google_login_begin_result_v1;
  consume_result uptech.google_web_login_consume_result_v1;
  completion_result record;
  replay_result record;
  expected_aad bytea;
BEGIN
  begin_result := uptech.begin_google_login_transaction_v1(
    'WEB_LOGIN'::uptech.google_login_purpose_v1,
    pg_catalog.decode(pg_catalog.repeat('10', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('12', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('13', 32), 'hex')::uptech.google_auth_hash32_v1,
    ROW(
      1,
      'AES-256-GCM'::uptech.google_auth_pkce_algorithm_v1,
      pg_catalog.decode(pg_catalog.repeat('14', 12), 'hex')::uptech.google_auth_nonce12_v1,
      pg_catalog.decode(pg_catalog.repeat('15', 36), 'hex')::uptech.google_auth_pkce_ciphertext_v1,
      pg_catalog.decode(pg_catalog.repeat('16', 16), 'hex')::uptech.google_auth_tag16_v1
    )::uptech.google_web_pkce_envelope_v1,
    '61000000-0000-0000-0000-000000000001'::uuid
  );

  IF (begin_result).outcome <> 'CREATED'
     OR (begin_result).expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'valid web transaction was not created';
  END IF;

  consume_result := uptech.consume_google_login_transaction_v1(
    'WEB_LOGIN'::uptech.google_login_purpose_v1,
    pg_catalog.decode(pg_catalog.repeat('10', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('13', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('17', 32), 'hex')::uptech.google_auth_hash32_v1,
    '61000000-0000-0000-0000-000000000002'::uuid
  );

  expected_aad := pg_catalog.convert_to(
    'verify' || pg_catalog.chr(31)
      || 'WEB_LOGIN' || pg_catalog.chr(31)
      || 'GOOGLE_WEB_LOGIN_V1' || pg_catalog.chr(31)
      || pg_catalog.repeat('11', 32),
    'UTF8'
  );

  IF (consume_result).outcome <> 'RESERVED'
     OR (consume_result).configuration_key <> 'GOOGLE_WEB_LOGIN_V1'
     OR (consume_result).expected_nonce_hash <>
       pg_catalog.decode(pg_catalog.repeat('12', 32), 'hex')
     OR (consume_result).pkce_kms_key_version <> 'verify-kms-key-v1'
     OR (consume_result).pkce_associated_data <> expected_aad
     OR ((consume_result).pkce_envelope).envelope_version <> 1
     OR ((consume_result).pkce_envelope).algorithm <> 'AES-256-GCM' THEN
    RAISE EXCEPTION 'web transaction reservation returned wrong binding';
  END IF;

  completion_result := uptech.complete_web_google_login_v1(
    pg_catalog.decode(pg_catalog.repeat('17', 32), 'hex')::uptech.google_auth_hash32_v1,
    ROW(
      'https://accounts.google.com'::uptech.google_auth_issuer_v1,
      'NewCaseSensitiveSubject'::uptech.google_provider_subject_v1,
      'member@tenant-a.example'::uptech.google_normalized_email_v1,
      true,
      'tenant-a.example'::uptech.google_normalized_domain_v1,
      pg_catalog.clock_timestamp(),
      pg_catalog.clock_timestamp() + interval '1 hour',
      'GOOGLE_WEB_LOGIN_V1'::uptech.google_auth_configuration_key_v1,
      NULL::uptech.google_auth_configuration_key_v1,
      pg_catalog.decode(pg_catalog.repeat('12', 32), 'hex')::uptech.google_auth_hash32_v1
    )::uptech.google_verified_claims_assertion_v1,
    pg_catalog.decode(pg_catalog.repeat('18', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('19', 32), 'hex')::uptech.google_auth_hash32_v1,
    NULL::uptech.google_auth_hash32_v1,
    '61000000-0000-0000-0000-000000000003'::uuid
  );

  IF (completion_result).outcome <> 'NORMAL'
     OR (completion_result).allowed_operations IS NOT NULL
     OR (completion_result).expires_at IS NOT NULL THEN
    RAISE EXCEPTION 'valid web completion did not return NORMAL';
  END IF;

  replay_result := uptech.complete_web_google_login_v1(
    pg_catalog.decode(pg_catalog.repeat('17', 32), 'hex')::uptech.google_auth_hash32_v1,
    ROW(
      'https://accounts.google.com'::uptech.google_auth_issuer_v1,
      'NewCaseSensitiveSubject'::uptech.google_provider_subject_v1,
      'member@tenant-a.example'::uptech.google_normalized_email_v1,
      true,
      'tenant-a.example'::uptech.google_normalized_domain_v1,
      pg_catalog.clock_timestamp(),
      pg_catalog.clock_timestamp() + interval '1 hour',
      'GOOGLE_WEB_LOGIN_V1'::uptech.google_auth_configuration_key_v1,
      NULL::uptech.google_auth_configuration_key_v1,
      pg_catalog.decode(pg_catalog.repeat('12', 32), 'hex')::uptech.google_auth_hash32_v1
    )::uptech.google_verified_claims_assertion_v1,
    pg_catalog.decode(pg_catalog.repeat('1a', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('1b', 32), 'hex')::uptech.google_auth_hash32_v1,
    NULL::uptech.google_auth_hash32_v1,
    '61000000-0000-0000-0000-000000000004'::uuid
  );

  IF (replay_result).outcome <> 'DENIED' THEN
    RAISE EXCEPTION 'completion handle replay was accepted';
  END IF;
END
$verify$;

DO $verify$
BEGIN
  IF (
    SELECT count(*)
    FROM uptech.authenticate_session(
      pg_catalog.decode(pg_catalog.repeat('18', 32), 'hex')
    ) AS authenticated
    WHERE authenticated.context_kind = 'SESSION'
      AND authenticated.workspace_id =
        'a3000000-0000-0000-0000-000000000003'::uuid
      AND authenticated.workspace_role = 'MEMBER'
  ) <> 1 THEN
    RAISE EXCEPTION 'committed web credential did not authenticate';
  END IF;

  BEGIN
    PERFORM count(*) FROM uptech.oauth_transactions;
    RAISE EXCEPTION 'API read OAuth transactions directly';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM count(*) FROM uptech.identities;
    RAISE EXCEPTION 'API read identities directly';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END
$verify$;

RESET ROLE;
SET LOCAL ROLE uptech_migration_owner;

DO $verify$
DECLARE
  new_identity_id uuid;
  new_user_id uuid;
  new_membership_id uuid;
  new_session_id uuid;
BEGIN
  SELECT identity_row.id, identity_row.user_id
  INTO new_identity_id, new_user_id
  FROM uptech.identities AS identity_row
  WHERE identity_row.provider = 'GOOGLE'
    AND identity_row.issuer = 'https://accounts.google.com'
    AND identity_row.provider_subject = 'NewCaseSensitiveSubject';

  IF new_identity_id IS NULL OR new_user_id IS NULL THEN
    RAISE EXCEPTION 'Google identity was not persisted';
  END IF;

  IF (
    SELECT count(DISTINCT identity_row.user_id)
    FROM uptech.identities AS identity_row
      WHERE identity_row.email_claim = 'member@tenant-a.example'
  ) <> 2 THEN
    RAISE EXCEPTION 'same-email Google subjects were merged';
  END IF;

  SELECT membership_row.id
  INTO new_membership_id
  FROM uptech.workspace_memberships AS membership_row
  WHERE membership_row.workspace_id =
      'a3000000-0000-0000-0000-000000000003'::uuid
    AND membership_row.user_id = new_user_id
    AND membership_row.role = 'MEMBER'
    AND membership_row.status = 'ACTIVE';

  SELECT session_row.id
  INTO new_session_id
  FROM uptech.sessions AS session_row
  JOIN uptech.session_tokens AS token_row
    ON token_row.workspace_id = session_row.workspace_id
   AND token_row.session_id = session_row.id
  WHERE token_row.token_hash =
      pg_catalog.decode(pg_catalog.repeat('18', 32), 'hex')
    AND token_row.csrf_token_hash =
      pg_catalog.decode(pg_catalog.repeat('19', 32), 'hex')
    AND session_row.user_id = new_user_id
    AND session_row.membership_id = new_membership_id;

  IF new_membership_id IS NULL OR new_session_id IS NULL THEN
    RAISE EXCEPTION 'identity/provisioning/session hashes did not commit atomically';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM uptech.oauth_transactions AS transaction_row
    WHERE transaction_row.locator_hash =
        pg_catalog.decode(pg_catalog.repeat('11', 32), 'hex')
      AND transaction_row.status = 'COMPLETED'
      AND transaction_row.completed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'OAuth transaction did not reach COMPLETED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM uptech.platform_audit_events AS audit_row
    WHERE audit_row.identity_id = new_identity_id
      AND audit_row.action = 'GOOGLE_AUTH_LOGIN_SUCCEEDED'
      AND audit_row.outcome = 'SUCCEEDED'
  ) OR NOT EXISTS (
    SELECT 1 FROM uptech.audit_events AS audit_row
    WHERE audit_row.workspace_id =
        'a3000000-0000-0000-0000-000000000003'::uuid
      AND audit_row.session_id = new_session_id
      AND audit_row.action = 'GOOGLE_AUTH_LOGIN_SUCCEEDED'
  ) OR NOT EXISTS (
    SELECT 1 FROM uptech.audit_events AS audit_row
    WHERE audit_row.workspace_id =
        'a3000000-0000-0000-0000-000000000003'::uuid
      AND audit_row.membership_id = new_membership_id
      AND audit_row.action = 'MEMBERSHIP_AUTO_PROVISIONED'
  ) THEN
    RAISE EXCEPTION 'required fixed platform/tenant audit did not commit';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM uptech.platform_audit_events AS audit_row
      WHERE audit_row.metadata::text ~* 'member@tenant-a|tenant-a[.]example'
  ) OR EXISTS (
    SELECT 1
    FROM uptech.audit_events AS audit_row
      WHERE audit_row.metadata::text ~* 'member@tenant-a|tenant-a[.]example'
  ) THEN
    RAISE EXCEPTION 'email or hosted domain leaked into audit metadata';
  END IF;

  IF (
    SELECT request_count
    FROM uptech.google_auth_rate_limit_buckets AS bucket_row
    WHERE bucket_row.network_hmac =
      pg_catalog.decode(pg_catalog.repeat('10', 32), 'hex')
  ) <> 2 THEN
    RAISE EXCEPTION 'begin and callback did not share one GOOGLE_AUTH bucket';
  END IF;
END
$verify$;

UPDATE uptech.users AS user_row
SET status = 'SUSPENDED', updated_at = pg_catalog.clock_timestamp()
FROM uptech.identities AS identity_row
WHERE identity_row.user_id = user_row.id
  AND identity_row.provider = 'GOOGLE'
  AND identity_row.issuer = 'https://accounts.google.com'
  AND identity_row.provider_subject = 'NewCaseSensitiveSubject';

RESET ROLE;
SET LOCAL ROLE uptech_api_runtime;

DO $verify$
DECLARE
  begin_result uptech.google_login_begin_result_v1;
  consume_result uptech.google_web_login_consume_result_v1;
  completion_result record;
BEGIN
  begin_result := uptech.begin_google_login_transaction_v1(
    'WEB_LOGIN'::uptech.google_login_purpose_v1,
    pg_catalog.decode(pg_catalog.repeat('70', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('71', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('72', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('73', 32), 'hex')::uptech.google_auth_hash32_v1,
    ROW(
      1, 'AES-256-GCM'::uptech.google_auth_pkce_algorithm_v1,
      pg_catalog.decode(pg_catalog.repeat('74', 12), 'hex')::uptech.google_auth_nonce12_v1,
      pg_catalog.decode(pg_catalog.repeat('75', 36), 'hex')::uptech.google_auth_pkce_ciphertext_v1,
      pg_catalog.decode(pg_catalog.repeat('76', 16), 'hex')::uptech.google_auth_tag16_v1
    )::uptech.google_web_pkce_envelope_v1,
    '67000000-0000-0000-0000-000000000001'::uuid
  );
  consume_result := uptech.consume_google_login_transaction_v1(
    'WEB_LOGIN'::uptech.google_login_purpose_v1,
    pg_catalog.decode(pg_catalog.repeat('70', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('71', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('73', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('77', 32), 'hex')::uptech.google_auth_hash32_v1,
    '67000000-0000-0000-0000-000000000002'::uuid
  );
  completion_result := uptech.complete_web_google_login_v1(
    pg_catalog.decode(pg_catalog.repeat('77', 32), 'hex')::uptech.google_auth_hash32_v1,
    ROW(
      'https://accounts.google.com'::uptech.google_auth_issuer_v1,
      'NewCaseSensitiveSubject'::uptech.google_provider_subject_v1,
      'member@tenant-a.example'::uptech.google_normalized_email_v1,
      true,
      'tenant-a.example'::uptech.google_normalized_domain_v1,
      pg_catalog.clock_timestamp(),
      pg_catalog.clock_timestamp() + interval '1 hour',
      'GOOGLE_WEB_LOGIN_V1'::uptech.google_auth_configuration_key_v1,
      NULL::uptech.google_auth_configuration_key_v1,
      pg_catalog.decode(pg_catalog.repeat('72', 32), 'hex')::uptech.google_auth_hash32_v1
    )::uptech.google_verified_claims_assertion_v1,
    pg_catalog.decode(pg_catalog.repeat('78', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('79', 32), 'hex')::uptech.google_auth_hash32_v1,
    NULL::uptech.google_auth_hash32_v1,
    '67000000-0000-0000-0000-000000000003'::uuid
  );

  IF (begin_result).outcome <> 'CREATED'
     OR (consume_result).outcome <> 'RESERVED'
     OR (completion_result).outcome <> 'DENIED' THEN
    RAISE EXCEPTION 'suspended user was not denied atomically';
  END IF;
END
$verify$;

RESET ROLE;
SET LOCAL ROLE uptech_migration_owner;

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM uptech.session_tokens AS token_row
    WHERE token_row.token_hash =
      pg_catalog.decode(pg_catalog.repeat('78', 32), 'hex')
  ) OR NOT EXISTS (
    SELECT 1 FROM uptech.oauth_transactions AS transaction_row
    WHERE transaction_row.locator_hash =
        pg_catalog.decode(pg_catalog.repeat('71', 32), 'hex')
      AND transaction_row.status = 'REJECTED'
  ) THEN
    RAISE EXCEPTION 'suspended-user denial issued a credential or stayed reusable';
  END IF;
END
$verify$;

CREATE FUNCTION uptech.verify_reject_google_login_success_audit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, uptech
AS $function$
BEGIN
  IF NEW.action = 'GOOGLE_AUTH_LOGIN_SUCCEEDED' THEN
    RAISE EXCEPTION 'verify forced login audit failure';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER verify_reject_google_login_success_audit
BEFORE INSERT ON uptech.platform_audit_events
FOR EACH ROW EXECUTE FUNCTION uptech.verify_reject_google_login_success_audit();

RESET ROLE;
SET LOCAL ROLE uptech_api_runtime;

DO $verify$
DECLARE
  begin_result uptech.google_login_begin_result_v1;
  consume_result uptech.google_web_login_consume_result_v1;
  completion_result record;
BEGIN
  begin_result := uptech.begin_google_login_transaction_v1(
    'WEB_LOGIN'::uptech.google_login_purpose_v1,
    pg_catalog.decode(pg_catalog.repeat('60', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('61', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('62', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('63', 32), 'hex')::uptech.google_auth_hash32_v1,
    ROW(
      1, 'AES-256-GCM'::uptech.google_auth_pkce_algorithm_v1,
      pg_catalog.decode(pg_catalog.repeat('64', 12), 'hex')::uptech.google_auth_nonce12_v1,
      pg_catalog.decode(pg_catalog.repeat('65', 36), 'hex')::uptech.google_auth_pkce_ciphertext_v1,
      pg_catalog.decode(pg_catalog.repeat('66', 16), 'hex')::uptech.google_auth_tag16_v1
    )::uptech.google_web_pkce_envelope_v1,
    '66000000-0000-0000-0000-000000000001'::uuid
  );
  consume_result := uptech.consume_google_login_transaction_v1(
    'WEB_LOGIN'::uptech.google_login_purpose_v1,
    pg_catalog.decode(pg_catalog.repeat('60', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('61', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('63', 32), 'hex')::uptech.google_auth_hash32_v1,
    pg_catalog.decode(pg_catalog.repeat('67', 32), 'hex')::uptech.google_auth_hash32_v1,
    '66000000-0000-0000-0000-000000000002'::uuid
  );

  IF (begin_result).outcome <> 'CREATED'
     OR (consume_result).outcome <> 'RESERVED' THEN
    RAISE EXCEPTION 'fault-injection fixture did not reserve transaction';
  END IF;

  BEGIN
    completion_result := uptech.complete_web_google_login_v1(
      pg_catalog.decode(pg_catalog.repeat('67', 32), 'hex')::uptech.google_auth_hash32_v1,
      ROW(
        'https://accounts.google.com'::uptech.google_auth_issuer_v1,
        'FaultInjectionSubject'::uptech.google_provider_subject_v1,
        'fault-user@unknown.example'::uptech.google_normalized_email_v1,
        true,
        'unknown.example'::uptech.google_normalized_domain_v1,
        pg_catalog.clock_timestamp(),
        pg_catalog.clock_timestamp() + interval '1 hour',
        'GOOGLE_WEB_LOGIN_V1'::uptech.google_auth_configuration_key_v1,
        NULL::uptech.google_auth_configuration_key_v1,
        pg_catalog.decode(pg_catalog.repeat('62', 32), 'hex')::uptech.google_auth_hash32_v1
      )::uptech.google_verified_claims_assertion_v1,
      pg_catalog.decode(pg_catalog.repeat('68', 32), 'hex')::uptech.google_auth_hash32_v1,
      pg_catalog.decode(pg_catalog.repeat('69', 32), 'hex')::uptech.google_auth_hash32_v1,
      NULL::uptech.google_auth_hash32_v1,
      '66000000-0000-0000-0000-000000000003'::uuid
    );
    RAISE EXCEPTION 'fault-injected completion unexpectedly returned %',
      (completion_result).outcome;
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'verify forced login audit failure' THEN
        RAISE;
      END IF;
  END;
END
$verify$;

RESET ROLE;
SET LOCAL ROLE uptech_migration_owner;

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM uptech.oauth_transactions AS transaction_row
    WHERE transaction_row.locator_hash =
        pg_catalog.decode(pg_catalog.repeat('61', 32), 'hex')
      AND transaction_row.status = 'EXCHANGE_RESERVED'
  ) OR EXISTS (
    SELECT 1 FROM uptech.identities AS identity_row
    WHERE identity_row.provider_subject = 'FaultInjectionSubject'
  ) OR EXISTS (
    SELECT 1 FROM uptech.session_tokens AS token_row
    WHERE token_row.token_hash =
      pg_catalog.decode(pg_catalog.repeat('68', 32), 'hex')
  ) OR EXISTS (
    SELECT 1 FROM uptech.platform_audit_events AS audit_row
    WHERE audit_row.request_id =
      '66000000-0000-0000-0000-000000000003'::uuid
  ) OR EXISTS (
    SELECT 1 FROM uptech.audit_events AS audit_row
    WHERE audit_row.request_id =
      '66000000-0000-0000-0000-000000000003'::uuid
  ) THEN
    RAISE EXCEPTION 'audit failure did not roll back completion atomically';
  END IF;
END
$verify$;

DROP TRIGGER verify_reject_google_login_success_audit
  ON uptech.platform_audit_events;
DROP FUNCTION uptech.verify_reject_google_login_success_audit();

ROLLBACK;

\echo 'SCKP-001-A1 PostgreSQL Google-auth verification passed (transaction rolled back).'
