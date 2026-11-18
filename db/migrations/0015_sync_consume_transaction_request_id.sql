\set ON_ERROR_STOP on

BEGIN;
SET LOCAL ROLE uptech_migration_owner;

-- Ensures pre-existing Production databases created before the request_id
-- propagation patch in 0002_google_auth_a1.sql update selected_transaction.request_id
-- during callback reservation so validate_web_google_login_completion_v1 succeeds.
CREATE OR REPLACE FUNCTION uptech.consume_google_login_transaction_v1(
  p_purpose uptech.google_login_purpose_v1,
  p_network_hmac uptech.google_auth_hash32_v1,
  p_state_hash uptech.google_auth_hash32_v1,
  p_browser_binding_hash uptech.google_auth_hash32_v1,
  p_completion_handle_hash uptech.google_auth_hash32_v1,
  p_request_id uuid
)
RETURNS uptech.google_web_login_consume_result_v1
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  observed_at timestamptz := pg_catalog.clock_timestamp();
  window_start timestamptz;
  active_environment uptech.google_auth_ascii_identifier_v1;
  audit_hmac_key uptech.google_auth_hash32_v1;
  audit_bucket_key uptech.google_auth_hash32_v1;
  bound_configuration uptech.google_auth_configuration_key_v1;
  selected_transaction uptech.oauth_transactions%ROWTYPE;
  reservation_expiry timestamptz;
  is_rate_limited boolean;
BEGIN
  SELECT environment_name, rate_limit_audit_hmac_key
  INTO STRICT active_environment, audit_hmac_key
  FROM uptech.google_auth_environment_registry
  WHERE is_active;

  window_start := pg_catalog.to_timestamp(
    pg_catalog.floor(pg_catalog.date_part('epoch', observed_at) / 60) * 60
  );

  INSERT INTO uptech.google_auth_rate_limit_buckets (
    environment_name, bucket_scope, network_hmac, window_started_at,
    request_count, over_limit_observed, expires_at, updated_at
  ) VALUES (
    active_environment, 'GOOGLE_AUTH', p_network_hmac, window_start,
    1, false, window_start + interval '1 minute', observed_at
  )
  ON CONFLICT (
    environment_name, bucket_scope, network_hmac, window_started_at
  ) DO UPDATE SET
    request_count = CASE
      WHEN uptech.google_auth_rate_limit_buckets.request_count < 10
        THEN uptech.google_auth_rate_limit_buckets.request_count + 1
      ELSE uptech.google_auth_rate_limit_buckets.request_count
    END,
    over_limit_observed =
      uptech.google_auth_rate_limit_buckets.over_limit_observed
      OR uptech.google_auth_rate_limit_buckets.request_count >= 10,
    updated_at = observed_at
  RETURNING over_limit_observed INTO is_rate_limited;

  IF is_rate_limited THEN
    audit_bucket_key := uptech.google_auth_hmac_sha256_v1(
      audit_hmac_key,
      pg_catalog.convert_to(
        'UPTECH_GOOGLE_AUTH_RATE_LIMIT_AUDIT_V1', 'UTF8'
      )
      || pg_catalog.int8send(
        pg_catalog.date_part('epoch', window_start)::bigint
      )
      || p_network_hmac
    );

    INSERT INTO uptech.platform_audit_events (
      id, action, target_type, outcome, request_id, metadata, occurred_at,
      google_auth_rate_limit_audit_key
    ) VALUES (
      pg_catalog.gen_random_uuid(), 'GOOGLE_AUTH_RATE_LIMITED',
      'GOOGLE_AUTH', 'DENIED', p_request_id,
      pg_catalog.jsonb_build_object('bucket_scope', 'GOOGLE_AUTH'),
      observed_at, audit_bucket_key
    )
    ON CONFLICT (google_auth_rate_limit_audit_key)
      WHERE google_auth_rate_limit_audit_key IS NOT NULL
    DO NOTHING;

    RETURN ROW(
      'RATE_LIMITED'::uptech.google_login_consume_outcome_v1,
      NULL::uptech.google_auth_configuration_key_v1,
      NULL::uptech.google_auth_hash32_v1,
      NULL::uptech.google_web_pkce_envelope_v1,
      NULL::uptech.google_auth_ascii_identifier_v1,
      NULL::bytea,
      NULL::timestamptz
    )::uptech.google_web_login_consume_result_v1;
  END IF;

  IF p_purpose = 'WEB_LOGIN' THEN
    SELECT configuration_key
    INTO bound_configuration
    FROM uptech.google_auth_configuration_registry
    WHERE environment_name = active_environment
      AND purpose = p_purpose
      AND is_enabled;
  END IF;

  IF p_purpose = 'WEB_LOGIN'
     AND bound_configuration IS NOT NULL
     AND p_state_hash IS NOT NULL
     AND p_browser_binding_hash IS NOT NULL
     AND p_completion_handle_hash IS NOT NULL
     AND p_completion_handle_hash <> p_state_hash
     AND p_completion_handle_hash <> p_browser_binding_hash
     AND p_request_id IS NOT NULL THEN
    SELECT transaction_row.*
    INTO selected_transaction
    FROM uptech.oauth_transactions AS transaction_row
    WHERE transaction_row.environment_name = active_environment
      AND transaction_row.purpose = p_purpose
      AND transaction_row.configuration_key = bound_configuration
      AND transaction_row.locator_hash = p_state_hash
      AND transaction_row.web_state_hash = p_state_hash
      AND transaction_row.web_browser_binding_hash = p_browser_binding_hash
      AND transaction_row.status = 'PENDING'
    FOR UPDATE;
  END IF;

  IF selected_transaction.id IS NOT NULL
     AND p_completion_handle_hash IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'UPTECH_GOOGLE_COMPLETION_V1'
          || pg_catalog.encode(p_completion_handle_hash, 'hex'),
        0
      )
    );
  END IF;
  observed_at := pg_catalog.clock_timestamp();

  IF selected_transaction.id IS NULL
     OR selected_transaction.expires_at <= observed_at
     OR EXISTS (
       SELECT 1
       FROM uptech.oauth_transactions AS existing_reservation
       WHERE existing_reservation.completion_handle_hash = p_completion_handle_hash
     ) THEN
    INSERT INTO uptech.platform_audit_events (
      id, action, target_type, outcome, request_id, metadata, occurred_at
    ) VALUES (
      pg_catalog.gen_random_uuid(), 'GOOGLE_AUTH_TRANSACTION_DENIED',
      'GOOGLE_AUTH_TRANSACTION', 'DENIED', p_request_id,
      pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'purpose', p_purpose::text,
          'configuration_key', bound_configuration::text,
          'rejection_class', 'PROTOCOL_INVALID'
        )
      ),
      observed_at
    );

    RETURN ROW(
      'DENIED'::uptech.google_login_consume_outcome_v1,
      NULL::uptech.google_auth_configuration_key_v1,
      NULL::uptech.google_auth_hash32_v1,
      NULL::uptech.google_web_pkce_envelope_v1,
      NULL::uptech.google_auth_ascii_identifier_v1,
      NULL::bytea,
      NULL::timestamptz
    )::uptech.google_web_login_consume_result_v1;
  END IF;

  reservation_expiry := observed_at + interval '2 minutes';
  UPDATE uptech.oauth_transactions
  SET status = 'EXCHANGE_RESERVED',
      consumed_at = observed_at,
      completion_handle_hash = p_completion_handle_hash,
      completion_expires_at = reservation_expiry,
      request_id = p_request_id
  WHERE id = selected_transaction.id
    AND status = 'PENDING'
    AND expires_at > observed_at;

  INSERT INTO uptech.platform_audit_events (
    id, action, target_type, outcome, request_id, metadata, occurred_at
  ) VALUES (
    pg_catalog.gen_random_uuid(), 'GOOGLE_AUTH_EXCHANGE_RESERVED',
    'GOOGLE_AUTH_TRANSACTION', 'SUCCEEDED', p_request_id,
    pg_catalog.jsonb_build_object(
      'purpose', p_purpose::text,
      'configuration_key', bound_configuration::text,
      'correlation_id', selected_transaction.id
    ),
    observed_at
  );

  RETURN ROW(
    'RESERVED'::uptech.google_login_consume_outcome_v1,
    bound_configuration,
    selected_transaction.web_nonce_hash,
    ROW(
      selected_transaction.web_pkce_envelope_version,
      selected_transaction.web_pkce_algorithm,
      selected_transaction.web_pkce_nonce,
      selected_transaction.web_pkce_ciphertext,
      selected_transaction.web_pkce_tag
    )::uptech.google_web_pkce_envelope_v1,
    selected_transaction.web_pkce_kms_key_version,
    selected_transaction.web_pkce_associated_data,
    reservation_expiry
  )::uptech.google_web_login_consume_result_v1;
END
$function$;

CREATE OR REPLACE FUNCTION uptech.consume_google_login_transaction_v1(
  p_purpose uptech.google_login_purpose_v1,
  p_network_hmac uptech.google_auth_hash32_v1,
  p_transaction_handle_hash uptech.google_native_transaction_handle_hash_v1,
  p_native_s256_verifier_hash uptech.google_native_s256_hash_v1,
  p_completion_handle_hash uptech.google_auth_hash32_v1,
  p_request_id uuid
)
RETURNS uptech.google_native_login_consume_result_v1
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  observed_at timestamptz := pg_catalog.clock_timestamp();
  window_start timestamptz;
  active_environment uptech.google_auth_ascii_identifier_v1;
  audit_hmac_key uptech.google_auth_hash32_v1;
  audit_bucket_key uptech.google_auth_hash32_v1;
  bound_configuration uptech.google_auth_configuration_key_v1;
  selected_transaction uptech.oauth_transactions%ROWTYPE;
  reservation_expiry timestamptz;
  is_rate_limited boolean;
BEGIN
  SELECT environment_name, rate_limit_audit_hmac_key
  INTO STRICT active_environment, audit_hmac_key
  FROM uptech.google_auth_environment_registry
  WHERE is_active;

  window_start := pg_catalog.to_timestamp(
    pg_catalog.floor(pg_catalog.date_part('epoch', observed_at) / 60) * 60
  );

  INSERT INTO uptech.google_auth_rate_limit_buckets (
    environment_name, bucket_scope, network_hmac, window_started_at,
    request_count, over_limit_observed, expires_at, updated_at
  ) VALUES (
    active_environment, 'GOOGLE_AUTH', p_network_hmac, window_start,
    1, false, window_start + interval '1 minute', observed_at
  )
  ON CONFLICT (
    environment_name, bucket_scope, network_hmac, window_started_at
  ) DO UPDATE SET
    request_count = CASE
      WHEN uptech.google_auth_rate_limit_buckets.request_count < 10
        THEN uptech.google_auth_rate_limit_buckets.request_count + 1
      ELSE uptech.google_auth_rate_limit_buckets.request_count
    END,
    over_limit_observed =
      uptech.google_auth_rate_limit_buckets.over_limit_observed
      OR uptech.google_auth_rate_limit_buckets.request_count >= 10,
    updated_at = observed_at
  RETURNING over_limit_observed INTO is_rate_limited;

  IF is_rate_limited THEN
    audit_bucket_key := uptech.google_auth_hmac_sha256_v1(
      audit_hmac_key,
      pg_catalog.convert_to(
        'UPTECH_GOOGLE_AUTH_RATE_LIMIT_AUDIT_V1', 'UTF8'
      )
      || pg_catalog.int8send(
        pg_catalog.date_part('epoch', window_start)::bigint
      )
      || p_network_hmac
    );

    INSERT INTO uptech.platform_audit_events (
      id, action, target_type, outcome, request_id, metadata, occurred_at,
      google_auth_rate_limit_audit_key
    ) VALUES (
      pg_catalog.gen_random_uuid(), 'GOOGLE_AUTH_RATE_LIMITED',
      'GOOGLE_AUTH', 'DENIED', p_request_id,
      pg_catalog.jsonb_build_object('bucket_scope', 'GOOGLE_AUTH'),
      observed_at, audit_bucket_key
    )
    ON CONFLICT (google_auth_rate_limit_audit_key)
      WHERE google_auth_rate_limit_audit_key IS NOT NULL
    DO NOTHING;

    RETURN ROW(
      'RATE_LIMITED'::uptech.google_login_consume_outcome_v1,
      NULL::uptech.google_auth_configuration_key_v1,
      NULL::timestamptz
    )::uptech.google_native_login_consume_result_v1;
  END IF;

  IF p_purpose IN ('NATIVE_ANDROID_LOGIN', 'NATIVE_IOS_LOGIN') THEN
    SELECT configuration_key
    INTO bound_configuration
    FROM uptech.google_auth_configuration_registry
    WHERE environment_name = active_environment
      AND purpose = p_purpose
      AND is_enabled;
  END IF;

  IF p_purpose IN ('NATIVE_ANDROID_LOGIN', 'NATIVE_IOS_LOGIN')
     AND bound_configuration IS NOT NULL
     AND p_transaction_handle_hash IS NOT NULL
     AND p_native_s256_verifier_hash IS NOT NULL
     AND p_completion_handle_hash IS NOT NULL
     AND p_completion_handle_hash <> p_transaction_handle_hash
     AND p_completion_handle_hash <> p_native_s256_verifier_hash
     AND p_request_id IS NOT NULL THEN
    SELECT transaction_row.*
    INTO selected_transaction
    FROM uptech.oauth_transactions AS transaction_row
    WHERE transaction_row.environment_name = active_environment
      AND transaction_row.purpose = p_purpose
      AND transaction_row.configuration_key = bound_configuration
      AND transaction_row.locator_hash = p_transaction_handle_hash
      AND transaction_row.native_exchange_challenge_hash =
        p_native_s256_verifier_hash
      AND transaction_row.status = 'PENDING'
    FOR UPDATE;
  END IF;

  IF selected_transaction.id IS NOT NULL
     AND p_completion_handle_hash IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'UPTECH_GOOGLE_COMPLETION_V1'
          || pg_catalog.encode(p_completion_handle_hash, 'hex'),
        0
      )
    );
  END IF;
  observed_at := pg_catalog.clock_timestamp();

  IF selected_transaction.id IS NULL
     OR selected_transaction.expires_at <= observed_at
     OR EXISTS (
       SELECT 1
       FROM uptech.oauth_transactions AS existing_reservation
       WHERE existing_reservation.completion_handle_hash = p_completion_handle_hash
     ) THEN
    INSERT INTO uptech.platform_audit_events (
      id, action, target_type, outcome, request_id, metadata, occurred_at
    ) VALUES (
      pg_catalog.gen_random_uuid(), 'GOOGLE_AUTH_TRANSACTION_DENIED',
      'GOOGLE_AUTH_TRANSACTION', 'DENIED', p_request_id,
      pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'purpose', p_purpose::text,
          'configuration_key', bound_configuration::text,
          'rejection_class', 'PROTOCOL_INVALID'
        )
      ),
      observed_at
    );

    RETURN ROW(
      'DENIED'::uptech.google_login_consume_outcome_v1,
      NULL::uptech.google_auth_configuration_key_v1,
      NULL::timestamptz
    )::uptech.google_native_login_consume_result_v1;
  END IF;

  reservation_expiry := observed_at + interval '2 minutes';
  UPDATE uptech.oauth_transactions
  SET status = 'EXCHANGE_RESERVED',
      consumed_at = observed_at,
      completion_handle_hash = p_completion_handle_hash,
      completion_expires_at = reservation_expiry,
      request_id = p_request_id
  WHERE id = selected_transaction.id
    AND status = 'PENDING'
    AND expires_at > observed_at;

  INSERT INTO uptech.platform_audit_events (
    id, action, target_type, outcome, request_id, metadata, occurred_at
  ) VALUES (
    pg_catalog.gen_random_uuid(), 'GOOGLE_AUTH_EXCHANGE_RESERVED',
    'GOOGLE_AUTH_TRANSACTION', 'SUCCEEDED', p_request_id,
    pg_catalog.jsonb_build_object(
      'purpose', p_purpose::text,
      'configuration_key', bound_configuration::text,
      'correlation_id', selected_transaction.id
    ),
    observed_at
  );

  RETURN ROW(
    'RESERVED'::uptech.google_login_consume_outcome_v1,
    bound_configuration,
    reservation_expiry
  )::uptech.google_native_login_consume_result_v1;
END
$function$;

REVOKE ALL ON FUNCTION uptech.consume_google_login_transaction_v1(
  uptech.google_login_purpose_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.consume_google_login_transaction_v1(
  uptech.google_login_purpose_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uuid
) TO uptech_api_runtime;

REVOKE ALL ON FUNCTION uptech.consume_google_login_transaction_v1(
  uptech.google_login_purpose_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_native_transaction_handle_hash_v1,
  uptech.google_native_s256_hash_v1,
  uptech.google_auth_hash32_v1,
  uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.consume_google_login_transaction_v1(
  uptech.google_login_purpose_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_native_transaction_handle_hash_v1,
  uptech.google_native_s256_hash_v1,
  uptech.google_auth_hash32_v1,
  uuid
) TO uptech_api_runtime;

COMMIT;
