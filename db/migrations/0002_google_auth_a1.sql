\set ON_ERROR_STOP on

BEGIN;
SET LOCAL ROLE uptech_migration_owner;

-- SCKP-001-A1 v0.1.0 is deliberately additive.  Production configuration is
-- inserted by a deployment-owned migration; an empty registry fails closed.
CREATE DOMAIN uptech.google_auth_hash32_v1 AS bytea
  CHECK (VALUE IS NULL OR pg_catalog.octet_length(VALUE) = 32);

CREATE DOMAIN uptech.google_native_transaction_handle_hash_v1 AS bytea
  CHECK (VALUE IS NULL OR pg_catalog.octet_length(VALUE) = 32);

CREATE DOMAIN uptech.google_native_s256_hash_v1 AS bytea
  CHECK (VALUE IS NULL OR pg_catalog.octet_length(VALUE) = 32);

CREATE DOMAIN uptech.google_auth_nonce12_v1 AS bytea
  CHECK (VALUE IS NULL OR pg_catalog.octet_length(VALUE) = 12);

CREATE DOMAIN uptech.google_auth_tag16_v1 AS bytea
  CHECK (VALUE IS NULL OR pg_catalog.octet_length(VALUE) = 16);

CREATE DOMAIN uptech.google_auth_pkce_ciphertext_v1 AS bytea
  CHECK (
    VALUE IS NULL
    OR pg_catalog.octet_length(VALUE) BETWEEN 36 AND 228
  );

CREATE DOMAIN uptech.google_auth_ascii_identifier_v1 AS text COLLATE "C"
  CHECK (
    VALUE IS NULL
    OR (
      pg_catalog.octet_length(VALUE) BETWEEN 1 AND 128
      AND VALUE ~ '^[!-~]+$'
    )
  );

CREATE DOMAIN uptech.google_auth_client_identifier_v1 AS text COLLATE "C"
  CHECK (
    VALUE IS NULL
    OR (
      pg_catalog.octet_length(VALUE) BETWEEN 1 AND 512
      AND VALUE = pg_catalog.btrim(VALUE)
      AND VALUE !~ '[[:space:]]'
    )
  );

CREATE DOMAIN uptech.google_auth_https_uri_v1 AS text COLLATE "C"
  CHECK (
    VALUE IS NULL
    OR (
      pg_catalog.octet_length(VALUE) BETWEEN 9 AND 2048
      AND VALUE ~ '^https://[^[:space:]]+$'
    )
  );

CREATE DOMAIN uptech.google_provider_subject_v1 AS text COLLATE "C"
  CHECK (
    VALUE IS NULL
    OR (
      pg_catalog.octet_length(VALUE) BETWEEN 1 AND 255
      AND VALUE = pg_catalog.btrim(VALUE)
    )
  );

CREATE DOMAIN uptech.google_normalized_email_v1 AS text COLLATE "C"
  CHECK (
    VALUE IS NULL
    OR (
      pg_catalog.octet_length(VALUE) BETWEEN 3 AND 320
      AND VALUE = pg_catalog.lower(VALUE COLLATE "C")
      AND VALUE = pg_catalog.btrim(VALUE)
      AND VALUE ~ '^[^[:space:]@]+@[^[:space:]@]+$'
    )
  );

CREATE DOMAIN uptech.google_normalized_domain_v1 AS text COLLATE "C"
  CHECK (
    VALUE IS NULL
    OR (
      pg_catalog.octet_length(VALUE) BETWEEN 3 AND 253
      AND VALUE = pg_catalog.lower(VALUE COLLATE "C")
      AND VALUE = pg_catalog.btrim(VALUE)
      AND VALUE !~ '[.]$'
      AND VALUE !~ '[.][.]'
      AND VALUE ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
    )
  );

CREATE TYPE uptech.google_login_purpose_v1 AS ENUM (
  'WEB_LOGIN',
  'NATIVE_ANDROID_LOGIN',
  'NATIVE_IOS_LOGIN'
);

CREATE TYPE uptech.google_auth_configuration_key_v1 AS ENUM (
  'GOOGLE_WEB_LOGIN_V1',
  'GOOGLE_NATIVE_ANDROID_LOGIN_V1',
  'GOOGLE_NATIVE_IOS_LOGIN_V1'
);

CREATE TYPE uptech.google_auth_issuer_v1 AS ENUM (
  'https://accounts.google.com',
  'accounts.google.com'
);

CREATE TYPE uptech.google_auth_pkce_algorithm_v1 AS ENUM ('AES-256-GCM');

CREATE TYPE uptech.google_auth_transaction_status_v1 AS ENUM (
  'PENDING',
  'EXCHANGE_RESERVED',
  'COMPLETED',
  'REJECTED'
);

CREATE TYPE uptech.google_auth_rejection_class_v1 AS ENUM (
  'PROTOCOL_INVALID',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_REJECTED',
  'CLAIMS_INVALID',
  'IDENTITY_INELIGIBLE',
  'INTERNAL_FAILURE'
);

CREATE TYPE uptech.google_login_begin_outcome_v1 AS ENUM (
  'CREATED',
  'RATE_LIMITED',
  'DENIED'
);

CREATE TYPE uptech.google_login_consume_outcome_v1 AS ENUM (
  'RESERVED',
  'RATE_LIMITED',
  'DENIED'
);

CREATE TYPE uptech.google_login_completion_outcome_v1 AS ENUM (
  'NORMAL',
  'ONBOARDING',
  'DENIED'
);

CREATE TYPE uptech.google_login_rejection_outcome_v1 AS ENUM (
  'RECORDED',
  'RATE_LIMITED'
);

CREATE TYPE uptech.google_workspace_domain_status_v1 AS ENUM (
  'PENDING',
  'VERIFIED'
);

CREATE TYPE uptech.google_web_pkce_envelope_v1 AS (
  envelope_version smallint,
  algorithm uptech.google_auth_pkce_algorithm_v1,
  nonce uptech.google_auth_nonce12_v1,
  ciphertext uptech.google_auth_pkce_ciphertext_v1,
  tag uptech.google_auth_tag16_v1
);

CREATE TYPE uptech.google_verified_claims_assertion_v1 AS (
  issuer uptech.google_auth_issuer_v1,
  provider_subject uptech.google_provider_subject_v1,
  normalized_email uptech.google_normalized_email_v1,
  email_verified boolean,
  normalized_hosted_domain uptech.google_normalized_domain_v1,
  issued_at timestamptz,
  expires_at timestamptz,
  audience_configuration_key uptech.google_auth_configuration_key_v1,
  authorized_party_configuration_key uptech.google_auth_configuration_key_v1,
  web_nonce_hash uptech.google_auth_hash32_v1
);

CREATE TYPE uptech.google_login_begin_result_v1 AS (
  outcome uptech.google_login_begin_outcome_v1,
  expires_at timestamptz
);

CREATE TYPE uptech.google_web_login_consume_result_v1 AS (
  outcome uptech.google_login_consume_outcome_v1,
  configuration_key uptech.google_auth_configuration_key_v1,
  expected_nonce_hash uptech.google_auth_hash32_v1,
  pkce_envelope uptech.google_web_pkce_envelope_v1,
  pkce_kms_key_version uptech.google_auth_ascii_identifier_v1,
  pkce_associated_data bytea,
  completion_expires_at timestamptz
);

CREATE TYPE uptech.google_native_login_consume_result_v1 AS (
  outcome uptech.google_login_consume_outcome_v1,
  configuration_key uptech.google_auth_configuration_key_v1,
  completion_expires_at timestamptz
);

CREATE TYPE uptech.google_login_completion_result_v1 AS (
  outcome uptech.google_login_completion_outcome_v1,
  allowed_operations text[],
  expires_at timestamptz
);

CREATE TABLE uptech.google_auth_environment_registry (
  environment_name uptech.google_auth_ascii_identifier_v1 PRIMARY KEY,
  rate_limit_audit_hmac_key uptech.google_auth_hash32_v1 NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  CONSTRAINT google_auth_environment_name_not_null
    CHECK (environment_name IS NOT NULL),
  CONSTRAINT google_auth_environment_audit_key_not_null
    CHECK (rate_limit_audit_hmac_key IS NOT NULL)
);

CREATE UNIQUE INDEX google_auth_one_active_environment
  ON uptech.google_auth_environment_registry (is_active)
  WHERE is_active;

CREATE TABLE uptech.google_auth_configuration_registry (
  configuration_key uptech.google_auth_configuration_key_v1 PRIMARY KEY,
  environment_name uptech.google_auth_ascii_identifier_v1 NOT NULL,
  purpose uptech.google_login_purpose_v1 NOT NULL UNIQUE,
  google_client_id uptech.google_auth_client_identifier_v1 NOT NULL,
  google_audience uptech.google_auth_client_identifier_v1 NOT NULL,
  audience_configuration_key uptech.google_auth_configuration_key_v1 NOT NULL,
  callback_uri uptech.google_auth_https_uri_v1 NOT NULL,
  scopes text[] NOT NULL,
  allowed_azp_configuration_keys uptech.google_auth_configuration_key_v1[] NOT NULL,
  web_pkce_kms_key_version uptech.google_auth_ascii_identifier_v1,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  CONSTRAINT google_auth_configuration_environment_fk
    FOREIGN KEY (environment_name)
    REFERENCES uptech.google_auth_environment_registry (environment_name)
    ON DELETE RESTRICT,
  CONSTRAINT google_auth_configuration_audience_fk
    FOREIGN KEY (audience_configuration_key)
    REFERENCES uptech.google_auth_configuration_registry (configuration_key)
    ON DELETE RESTRICT,
  CONSTRAINT google_auth_configuration_scopes_exact CHECK (
    scopes = ARRAY['openid', 'email', 'profile']::text[]
  ),
  CONSTRAINT google_auth_configuration_shape_check CHECK (
    (
      configuration_key = 'GOOGLE_WEB_LOGIN_V1'
      AND purpose = 'WEB_LOGIN'
      AND audience_configuration_key = 'GOOGLE_WEB_LOGIN_V1'
      AND allowed_azp_configuration_keys =
        ARRAY['GOOGLE_WEB_LOGIN_V1'::uptech.google_auth_configuration_key_v1]
      AND web_pkce_kms_key_version IS NOT NULL
    )
    OR (
      configuration_key = 'GOOGLE_NATIVE_ANDROID_LOGIN_V1'
      AND purpose = 'NATIVE_ANDROID_LOGIN'
      AND audience_configuration_key = 'GOOGLE_WEB_LOGIN_V1'
      AND allowed_azp_configuration_keys =
        ARRAY['GOOGLE_NATIVE_ANDROID_LOGIN_V1'::uptech.google_auth_configuration_key_v1]
      AND web_pkce_kms_key_version IS NULL
    )
    OR (
      configuration_key = 'GOOGLE_NATIVE_IOS_LOGIN_V1'
      AND purpose = 'NATIVE_IOS_LOGIN'
      AND audience_configuration_key = 'GOOGLE_WEB_LOGIN_V1'
      AND allowed_azp_configuration_keys =
        ARRAY['GOOGLE_NATIVE_IOS_LOGIN_V1'::uptech.google_auth_configuration_key_v1]
      AND web_pkce_kms_key_version IS NULL
    )
  ),
  CONSTRAINT google_auth_configuration_environment_key_purpose_unique
    UNIQUE (environment_name, configuration_key, purpose)
);

CREATE TABLE uptech.workspace_domain_locators (
  normalized_domain uptech.google_normalized_domain_v1 PRIMARY KEY,
  workspace_id uuid NOT NULL,
  status uptech.google_workspace_domain_status_v1 NOT NULL,
  security_version bigint NOT NULL DEFAULT 1,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  CONSTRAINT workspace_domain_locators_workspace_fk
    FOREIGN KEY (workspace_id)
    REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT,
  CONSTRAINT workspace_domain_locators_domain_not_null
    CHECK (normalized_domain IS NOT NULL),
  CONSTRAINT workspace_domain_locators_version_check
    CHECK (security_version > 0),
  CONSTRAINT workspace_domain_locators_state_check CHECK (
    (status = 'PENDING' AND verified_at IS NULL)
    OR (status = 'VERIFIED' AND verified_at IS NOT NULL)
  ),
  CONSTRAINT workspace_domain_locators_timestamps_check
    CHECK (updated_at >= created_at)
);

CREATE TABLE uptech.google_auth_rate_limit_buckets (
  environment_name uptech.google_auth_ascii_identifier_v1 NOT NULL,
  bucket_scope text NOT NULL DEFAULT 'GOOGLE_AUTH',
  network_hmac uptech.google_auth_hash32_v1 NOT NULL,
  window_started_at timestamptz NOT NULL,
  request_count smallint NOT NULL DEFAULT 1,
  over_limit_observed boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (
    environment_name,
    bucket_scope,
    network_hmac,
    window_started_at
  ),
  CONSTRAINT google_auth_rate_limit_environment_fk
    FOREIGN KEY (environment_name)
    REFERENCES uptech.google_auth_environment_registry (environment_name)
    ON DELETE RESTRICT,
  CONSTRAINT google_auth_rate_limit_scope_check
    CHECK (bucket_scope = 'GOOGLE_AUTH'),
  CONSTRAINT google_auth_rate_limit_network_not_null
    CHECK (network_hmac IS NOT NULL),
  CONSTRAINT google_auth_rate_limit_count_check CHECK (
    request_count BETWEEN 1 AND 10
    AND (NOT over_limit_observed OR request_count = 10)
  ),
  CONSTRAINT google_auth_rate_limit_window_check CHECK (
    expires_at = window_started_at + interval '1 minute'
    AND updated_at >= window_started_at
  )
);

CREATE INDEX google_auth_rate_limit_expiry_idx
  ON uptech.google_auth_rate_limit_buckets (expires_at);

CREATE TABLE uptech.oauth_transactions (
  id uuid PRIMARY KEY,
  environment_name uptech.google_auth_ascii_identifier_v1 NOT NULL,
  purpose uptech.google_login_purpose_v1 NOT NULL,
  configuration_key uptech.google_auth_configuration_key_v1 NOT NULL,
  locator_hash uptech.google_auth_hash32_v1 NOT NULL,
  web_state_hash uptech.google_auth_hash32_v1,
  web_nonce_hash uptech.google_auth_hash32_v1,
  web_browser_binding_hash uptech.google_auth_hash32_v1,
  native_exchange_challenge_hash uptech.google_auth_hash32_v1,
  web_pkce_envelope_version smallint,
  web_pkce_algorithm uptech.google_auth_pkce_algorithm_v1,
  web_pkce_nonce uptech.google_auth_nonce12_v1,
  web_pkce_ciphertext uptech.google_auth_pkce_ciphertext_v1,
  web_pkce_tag uptech.google_auth_tag16_v1,
  web_pkce_kms_key_version uptech.google_auth_ascii_identifier_v1,
  web_pkce_associated_data bytea,
  status uptech.google_auth_transaction_status_v1 NOT NULL DEFAULT 'PENDING',
  completion_handle_hash uptech.google_auth_hash32_v1,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  completion_expires_at timestamptz,
  completed_at timestamptz,
  rejected_at timestamptz,
  CONSTRAINT oauth_transactions_configuration_fk
    FOREIGN KEY (environment_name, configuration_key, purpose)
    REFERENCES uptech.google_auth_configuration_registry (
      environment_name,
      configuration_key,
      purpose
    ) ON DELETE RESTRICT,
  CONSTRAINT oauth_transactions_locator_not_null
    CHECK (locator_hash IS NOT NULL),
  CONSTRAINT oauth_transactions_purpose_shape_check CHECK (
    (
      purpose = 'WEB_LOGIN'
      AND locator_hash = web_state_hash
      AND web_state_hash IS NOT NULL
      AND web_nonce_hash IS NOT NULL
      AND web_browser_binding_hash IS NOT NULL
      AND native_exchange_challenge_hash IS NULL
      AND web_pkce_envelope_version = 1
      AND web_pkce_algorithm = 'AES-256-GCM'
      AND web_pkce_nonce IS NOT NULL
      AND web_pkce_ciphertext IS NOT NULL
      AND web_pkce_tag IS NOT NULL
      AND web_pkce_kms_key_version IS NOT NULL
      AND web_pkce_associated_data IS NOT NULL
      AND pg_catalog.octet_length(web_pkce_associated_data) BETWEEN 1 AND 512
      AND pg_catalog.octet_length(web_pkce_nonce)
        + pg_catalog.octet_length(web_pkce_ciphertext)
        + pg_catalog.octet_length(web_pkce_tag) BETWEEN 64 AND 256
    )
    OR (
      purpose IN ('NATIVE_ANDROID_LOGIN', 'NATIVE_IOS_LOGIN')
      AND web_state_hash IS NULL
      AND web_nonce_hash IS NULL
      AND web_browser_binding_hash IS NULL
      AND native_exchange_challenge_hash IS NOT NULL
      AND web_pkce_envelope_version IS NULL
      AND web_pkce_algorithm IS NULL
      AND web_pkce_nonce IS NULL
      AND web_pkce_ciphertext IS NULL
      AND web_pkce_tag IS NULL
      AND web_pkce_kms_key_version IS NULL
      AND web_pkce_associated_data IS NULL
    )
  ),
  CONSTRAINT oauth_transactions_initial_expiry_check CHECK (
    (purpose = 'WEB_LOGIN' AND expires_at = created_at + interval '10 minutes')
    OR (
      purpose IN ('NATIVE_ANDROID_LOGIN', 'NATIVE_IOS_LOGIN')
      AND expires_at = created_at + interval '5 minutes'
    )
  ),
  CONSTRAINT oauth_transactions_state_check CHECK (
    (
      status = 'PENDING'
      AND consumed_at IS NULL
      AND completion_handle_hash IS NULL
      AND completion_expires_at IS NULL
      AND completed_at IS NULL
      AND rejected_at IS NULL
    )
    OR (
      status = 'EXCHANGE_RESERVED'
      AND consumed_at IS NOT NULL
      AND completion_handle_hash IS NOT NULL
      AND completion_expires_at = consumed_at + interval '2 minutes'
      AND completed_at IS NULL
      AND rejected_at IS NULL
    )
    OR (
      status = 'COMPLETED'
      AND consumed_at IS NOT NULL
      AND completion_handle_hash IS NOT NULL
      AND completion_expires_at = consumed_at + interval '2 minutes'
      AND completed_at IS NOT NULL
      AND rejected_at IS NULL
    )
    OR (
      status = 'REJECTED'
      AND consumed_at IS NOT NULL
      AND completion_handle_hash IS NOT NULL
      AND completion_expires_at = consumed_at + interval '2 minutes'
      AND completed_at IS NULL
      AND rejected_at IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX oauth_transactions_locator_hash_unique
  ON uptech.oauth_transactions (locator_hash);
CREATE UNIQUE INDEX oauth_transactions_web_nonce_hash_unique
  ON uptech.oauth_transactions (web_nonce_hash)
  WHERE web_nonce_hash IS NOT NULL;
CREATE UNIQUE INDEX oauth_transactions_web_browser_hash_unique
  ON uptech.oauth_transactions (web_browser_binding_hash)
  WHERE web_browser_binding_hash IS NOT NULL;
CREATE UNIQUE INDEX oauth_transactions_native_challenge_hash_unique
  ON uptech.oauth_transactions (native_exchange_challenge_hash)
  WHERE native_exchange_challenge_hash IS NOT NULL;
CREATE UNIQUE INDEX oauth_transactions_completion_handle_hash_unique
  ON uptech.oauth_transactions (completion_handle_hash)
  WHERE completion_handle_hash IS NOT NULL;
CREATE INDEX oauth_transactions_expiry_idx
  ON uptech.oauth_transactions (expires_at);

ALTER TABLE uptech.platform_audit_events
  ADD COLUMN google_auth_rate_limit_audit_key uptech.google_auth_hash32_v1;

ALTER TABLE uptech.platform_audit_events
  ADD CONSTRAINT platform_audit_google_auth_rate_limit_shape_check CHECK (
    google_auth_rate_limit_audit_key IS NULL
    OR (
      action = 'GOOGLE_AUTH_RATE_LIMITED'
      AND target_type = 'GOOGLE_AUTH'
      AND outcome = 'DENIED'
      AND identity_id IS NULL
    )
  );

CREATE UNIQUE INDEX platform_audit_google_auth_rate_limit_key_unique
  ON uptech.platform_audit_events (google_auth_rate_limit_audit_key)
  WHERE google_auth_rate_limit_audit_key IS NOT NULL;

ALTER TABLE uptech.sessions
  ADD COLUMN device_binding_hash uptech.google_auth_hash32_v1;

CREATE FUNCTION uptech.reject_google_auth_registry_mutation_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, uptech
AS $function$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'google auth configuration registry is immutable';
END
$function$;

REVOKE ALL ON FUNCTION uptech.reject_google_auth_registry_mutation_v1()
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;

CREATE TRIGGER google_auth_environment_registry_immutable
BEFORE UPDATE OR DELETE ON uptech.google_auth_environment_registry
FOR EACH ROW EXECUTE FUNCTION uptech.reject_google_auth_registry_mutation_v1();

CREATE TRIGGER google_auth_configuration_registry_immutable
BEFORE UPDATE OR DELETE ON uptech.google_auth_configuration_registry
FOR EACH ROW EXECUTE FUNCTION uptech.reject_google_auth_registry_mutation_v1();

-- Private, invoker-rights HMAC primitive used only inside the A1 routines.  It
-- avoids granting a general limiter/audit operation or requiring pgcrypto.
CREATE FUNCTION uptech.google_auth_hmac_sha256_v1(
  p_key uptech.google_auth_hash32_v1,
  p_message bytea
)
RETURNS uptech.google_auth_hash32_v1
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  padded_key bytea;
  inner_pad bytea := pg_catalog.decode(pg_catalog.repeat('36', 64), 'hex');
  outer_pad bytea := pg_catalog.decode(pg_catalog.repeat('5c', 64), 'hex');
  byte_index integer;
BEGIN
  IF p_key IS NULL
     OR pg_catalog.octet_length(p_key) <> 32
     OR p_message IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'invalid google auth HMAC input';
  END IF;

  padded_key := p_key || pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex');
  FOR byte_index IN 0..63 LOOP
    inner_pad := pg_catalog.set_byte(
      inner_pad,
      byte_index,
      pg_catalog.get_byte(inner_pad, byte_index)
        # pg_catalog.get_byte(padded_key, byte_index)
    );
    outer_pad := pg_catalog.set_byte(
      outer_pad,
      byte_index,
      pg_catalog.get_byte(outer_pad, byte_index)
        # pg_catalog.get_byte(padded_key, byte_index)
    );
  END LOOP;

  RETURN pg_catalog.sha256(
    outer_pad || pg_catalog.sha256(inner_pad || p_message)
  );
END
$function$;

REVOKE ALL ON FUNCTION uptech.google_auth_hmac_sha256_v1(
  uptech.google_auth_hash32_v1,
  bytea
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;

CREATE FUNCTION uptech.begin_google_login_transaction_v1(
  p_purpose uptech.google_login_purpose_v1,
  p_network_hmac uptech.google_auth_hash32_v1,
  p_state_hash uptech.google_auth_hash32_v1,
  p_nonce_hash uptech.google_auth_hash32_v1,
  p_browser_binding_hash uptech.google_auth_hash32_v1,
  p_pkce_envelope uptech.google_web_pkce_envelope_v1,
  p_request_id uuid
)
RETURNS uptech.google_login_begin_result_v1
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
  bound_kms_key_version uptech.google_auth_ascii_identifier_v1;
  transaction_id uuid;
  transaction_expiry timestamptz;
  associated_data bytea;
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
    environment_name,
    bucket_scope,
    network_hmac,
    window_started_at,
    request_count,
    over_limit_observed,
    expires_at,
    updated_at
  ) VALUES (
    active_environment,
    'GOOGLE_AUTH',
    p_network_hmac,
    window_start,
    1,
    false,
    window_start + interval '1 minute',
    observed_at
  )
  ON CONFLICT (
    environment_name,
    bucket_scope,
    network_hmac,
    window_started_at
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
        'UPTECH_GOOGLE_AUTH_RATE_LIMIT_AUDIT_V1',
        'UTF8'
      )
      || pg_catalog.int8send(
        pg_catalog.date_part('epoch', window_start)::bigint
      )
      || p_network_hmac
    );

    INSERT INTO uptech.platform_audit_events (
      id,
      action,
      target_type,
      outcome,
      request_id,
      metadata,
      occurred_at,
      google_auth_rate_limit_audit_key
    ) VALUES (
      pg_catalog.gen_random_uuid(),
      'GOOGLE_AUTH_RATE_LIMITED',
      'GOOGLE_AUTH',
      'DENIED',
      p_request_id,
      pg_catalog.jsonb_build_object('bucket_scope', 'GOOGLE_AUTH'),
      observed_at,
      audit_bucket_key
    )
    ON CONFLICT (google_auth_rate_limit_audit_key)
      WHERE google_auth_rate_limit_audit_key IS NOT NULL
    DO NOTHING;

    RETURN ROW(
      'RATE_LIMITED'::uptech.google_login_begin_outcome_v1,
      NULL::timestamptz
    )::uptech.google_login_begin_result_v1;
  END IF;

  IF p_purpose = 'WEB_LOGIN' THEN
    SELECT configuration_key, web_pkce_kms_key_version
    INTO bound_configuration, bound_kms_key_version
    FROM uptech.google_auth_configuration_registry
    WHERE environment_name = active_environment
      AND purpose = p_purpose
      AND is_enabled;
  END IF;

  IF p_network_hmac IS NULL
     OR p_request_id IS NULL
     OR p_purpose <> 'WEB_LOGIN'
     OR bound_configuration IS NULL
     OR bound_kms_key_version IS NULL
     OR p_state_hash IS NULL
     OR p_nonce_hash IS NULL
     OR p_browser_binding_hash IS NULL
     OR p_state_hash = p_nonce_hash
     OR p_state_hash = p_browser_binding_hash
     OR p_nonce_hash = p_browser_binding_hash
     OR p_pkce_envelope IS NULL
     OR (p_pkce_envelope).envelope_version IS DISTINCT FROM 1
     OR (p_pkce_envelope).algorithm IS DISTINCT FROM 'AES-256-GCM'
     OR (p_pkce_envelope).nonce IS NULL
     OR (p_pkce_envelope).ciphertext IS NULL
     OR (p_pkce_envelope).tag IS NULL
     OR pg_catalog.octet_length((p_pkce_envelope).nonce)
        + pg_catalog.octet_length((p_pkce_envelope).ciphertext)
        + pg_catalog.octet_length((p_pkce_envelope).tag)
        NOT BETWEEN 64 AND 256 THEN
    INSERT INTO uptech.platform_audit_events (
      id, action, target_type, outcome, request_id, metadata, occurred_at
    ) VALUES (
      pg_catalog.gen_random_uuid(),
      'GOOGLE_AUTH_TRANSACTION_DENIED',
      'GOOGLE_AUTH_TRANSACTION',
      'DENIED',
      p_request_id,
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
      'DENIED'::uptech.google_login_begin_outcome_v1,
      NULL::timestamptz
    )::uptech.google_login_begin_result_v1;
  END IF;

  observed_at := pg_catalog.clock_timestamp();
  transaction_id := pg_catalog.gen_random_uuid();
  transaction_expiry := observed_at + interval '10 minutes';
  associated_data := pg_catalog.convert_to(
    active_environment::text
      || pg_catalog.chr(31)
      || p_purpose::text
      || pg_catalog.chr(31)
      || bound_configuration::text
      || pg_catalog.chr(31)
      || pg_catalog.encode(p_state_hash, 'hex'),
    'UTF8'
  );

  INSERT INTO uptech.oauth_transactions (
    id,
    environment_name,
    purpose,
    configuration_key,
    locator_hash,
    web_state_hash,
    web_nonce_hash,
    web_browser_binding_hash,
    web_pkce_envelope_version,
    web_pkce_algorithm,
    web_pkce_nonce,
    web_pkce_ciphertext,
    web_pkce_tag,
    web_pkce_kms_key_version,
    web_pkce_associated_data,
    status,
    request_id,
    created_at,
    expires_at
  ) VALUES (
    transaction_id,
    active_environment,
    p_purpose,
    bound_configuration,
    p_state_hash,
    p_state_hash,
    p_nonce_hash,
    p_browser_binding_hash,
    (p_pkce_envelope).envelope_version,
    (p_pkce_envelope).algorithm,
    (p_pkce_envelope).nonce,
    (p_pkce_envelope).ciphertext,
    (p_pkce_envelope).tag,
    bound_kms_key_version,
    associated_data,
    'PENDING',
    p_request_id,
    observed_at,
    transaction_expiry
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO transaction_id;

  IF transaction_id IS NULL THEN
    INSERT INTO uptech.platform_audit_events (
      id, action, target_type, outcome, request_id, metadata, occurred_at
    ) VALUES (
      pg_catalog.gen_random_uuid(),
      'GOOGLE_AUTH_TRANSACTION_DENIED',
      'GOOGLE_AUTH_TRANSACTION',
      'DENIED',
      p_request_id,
      pg_catalog.jsonb_build_object(
        'purpose', p_purpose::text,
        'configuration_key', bound_configuration::text,
        'rejection_class', 'PROTOCOL_INVALID'
      ),
      observed_at
    );

    RETURN ROW(
      'DENIED'::uptech.google_login_begin_outcome_v1,
      NULL::timestamptz
    )::uptech.google_login_begin_result_v1;
  END IF;

  INSERT INTO uptech.platform_audit_events (
    id,
    action,
    target_type,
    outcome,
    request_id,
    metadata,
    occurred_at
  ) VALUES (
    pg_catalog.gen_random_uuid(),
    'GOOGLE_AUTH_TRANSACTION_CREATED',
    'GOOGLE_AUTH_TRANSACTION',
    'SUCCEEDED',
    p_request_id,
    pg_catalog.jsonb_build_object(
      'purpose', p_purpose::text,
      'configuration_key', bound_configuration::text,
      'correlation_id', transaction_id
    ),
    observed_at
  );

  RETURN ROW(
    'CREATED'::uptech.google_login_begin_outcome_v1,
    transaction_expiry
  )::uptech.google_login_begin_result_v1;
END
$function$;

CREATE FUNCTION uptech.complete_native_google_login_v1(
  p_completion_handle_hash uptech.google_auth_hash32_v1,
  p_claims uptech.google_verified_claims_assertion_v1,
  p_access_token_hash uptech.google_auth_hash32_v1,
  p_refresh_token_hash uptech.google_auth_hash32_v1,
  p_device_binding_hash uptech.google_auth_hash32_v1,
  p_onboarding_token_hash uptech.google_auth_hash32_v1,
  p_request_id uuid
)
RETURNS uptech.google_login_completion_result_v1
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  observed_at timestamptz := pg_catalog.clock_timestamp();
  selected_transaction uptech.oauth_transactions%ROWTYPE;
  bound_configuration uptech.google_auth_configuration_registry%ROWTYPE;
  resolved_identity_id uuid;
  resolved_user_id uuid;
  resolved_user_status text;
  resolved_user_security_version bigint;
  resolved_identity_status text;
  resolved_identity_security_version bigint;
  resolved_workspace_id uuid;
  resolved_domain_status uptech.google_workspace_domain_status_v1;
  resolved_workspace_status text;
  resolved_provisioning_policy text;
  resolved_workspace_security_version bigint;
  resolved_membership_id uuid;
  resolved_membership_status text;
  resolved_membership_role text;
  resolved_membership_authz_version bigint;
  new_session_id uuid;
  new_access_token_id uuid;
  new_refresh_token_id uuid;
  new_onboarding_session_id uuid;
  onboarding_operations text[];
  onboarding_expiry timestamptz;
  issue_normal boolean := false;
  issue_onboarding boolean := false;
  insert_member boolean := false;
  reactivate_member boolean := false;
  claims_are_valid boolean;
  transitioned_rows integer;
BEGIN
  IF p_completion_handle_hash IS NOT NULL THEN
    SELECT transaction_row.*
    INTO selected_transaction
    FROM uptech.oauth_transactions AS transaction_row
    WHERE transaction_row.completion_handle_hash = p_completion_handle_hash
      AND transaction_row.purpose IN (
        'NATIVE_ANDROID_LOGIN', 'NATIVE_IOS_LOGIN'
      )
      AND transaction_row.status = 'EXCHANGE_RESERVED'
    FOR UPDATE;
  END IF;

  observed_at := pg_catalog.clock_timestamp();
  IF selected_transaction.id IS NULL
     OR selected_transaction.completion_expires_at <= observed_at THEN
    RETURN ROW(
      'DENIED'::uptech.google_login_completion_outcome_v1,
      NULL::text[], NULL::timestamptz
    )::uptech.google_login_completion_result_v1;
  END IF;

  SELECT configuration_row.*
  INTO bound_configuration
  FROM uptech.google_auth_configuration_registry AS configuration_row
  WHERE configuration_row.environment_name = selected_transaction.environment_name
    AND configuration_row.configuration_key =
      selected_transaction.configuration_key
    AND configuration_row.purpose = selected_transaction.purpose
    AND configuration_row.is_enabled;

  claims_are_valid :=
    bound_configuration.configuration_key IS NOT NULL
    AND p_request_id IS NOT NULL
    AND (p_claims).issuer IS NOT NULL
    AND (p_claims).provider_subject IS NOT NULL
    AND (p_claims).normalized_email IS NOT NULL
    AND (p_claims).email_verified IS TRUE
    AND (p_claims).normalized_hosted_domain IS NOT NULL
    AND (p_claims).issued_at IS NOT NULL
    AND (p_claims).expires_at IS NOT NULL
    AND (p_claims).issued_at >= observed_at - interval '5 minutes'
    AND (p_claims).issued_at <= observed_at + interval '2 minutes'
    AND (p_claims).expires_at > observed_at
    AND (p_claims).expires_at > (p_claims).issued_at
    AND (p_claims).expires_at <= (p_claims).issued_at + interval '2 hours'
    AND (p_claims).audience_configuration_key =
      bound_configuration.audience_configuration_key
    AND (
      (p_claims).authorized_party_configuration_key IS NULL
      OR (p_claims).authorized_party_configuration_key = ANY (
        bound_configuration.allowed_azp_configuration_keys
      )
    )
    AND (p_claims).web_nonce_hash IS NULL;

  IF claims_are_valid IS NOT TRUE THEN
    observed_at := pg_catalog.clock_timestamp();
    UPDATE uptech.oauth_transactions
    SET status = 'REJECTED', rejected_at = observed_at
    WHERE id = selected_transaction.id
      AND status = 'EXCHANGE_RESERVED'
      AND completion_expires_at > observed_at;
    GET DIAGNOSTICS transitioned_rows = ROW_COUNT;
    IF transitioned_rows <> 1 THEN
      RAISE EXCEPTION USING
        ERRCODE = 'PGA01', MESSAGE = 'google login reservation expired';
    END IF;

    INSERT INTO uptech.platform_audit_events (
      id, action, target_type, outcome, request_id, metadata, occurred_at
    ) VALUES (
      pg_catalog.gen_random_uuid(), 'GOOGLE_AUTH_LOGIN_DENIED',
      'GOOGLE_AUTH_TRANSACTION', 'DENIED', p_request_id,
      pg_catalog.jsonb_build_object(
        'purpose', selected_transaction.purpose::text,
        'configuration_key', selected_transaction.configuration_key::text,
        'correlation_id', selected_transaction.id,
        'rejection_class', 'CLAIMS_INVALID'
      ),
      observed_at
    );

    RETURN ROW(
      'DENIED'::uptech.google_login_completion_outcome_v1,
      NULL::text[], NULL::timestamptz
    )::uptech.google_login_completion_result_v1;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      (p_claims).issuer::text || pg_catalog.chr(31)
        || (p_claims).provider_subject::text,
      0
    )
  );

  SELECT
    identity_row.id, identity_row.user_id, user_row.status,
    user_row.security_version, identity_row.status,
    identity_row.security_version
  INTO
    resolved_identity_id, resolved_user_id, resolved_user_status,
    resolved_user_security_version, resolved_identity_status,
    resolved_identity_security_version
  FROM uptech.identities AS identity_row
  JOIN uptech.users AS user_row ON user_row.id = identity_row.user_id
  WHERE identity_row.provider = 'GOOGLE'
    AND identity_row.issuer = (p_claims).issuer::text
    AND identity_row.provider_subject = (p_claims).provider_subject::text
  FOR UPDATE OF identity_row, user_row;

  IF resolved_identity_id IS NULL THEN
    resolved_user_id := pg_catalog.gen_random_uuid();
    resolved_identity_id := pg_catalog.gen_random_uuid();
    resolved_user_status := 'ACTIVE';
    resolved_user_security_version := 1;
    resolved_identity_status := 'ACTIVE';
    resolved_identity_security_version := 1;

    INSERT INTO uptech.users (
      id, status, security_version, created_at, updated_at
    ) VALUES (
      resolved_user_id, 'ACTIVE', 1, observed_at, observed_at
    );

    INSERT INTO uptech.identities (
      id, user_id, provider, issuer, provider_subject, status,
      security_version, email_claim, email_verified, hosted_domain_claim,
      claims_observed_at, created_at, updated_at
    ) VALUES (
      resolved_identity_id, resolved_user_id, 'GOOGLE',
      (p_claims).issuer::text, (p_claims).provider_subject::text,
      'ACTIVE', 1, (p_claims).normalized_email::text, true,
      (p_claims).normalized_hosted_domain::text,
      observed_at, observed_at, observed_at
    );
  ELSIF resolved_user_status = 'ACTIVE'
        AND resolved_identity_status = 'ACTIVE' THEN
    UPDATE uptech.identities
    SET email_claim = (p_claims).normalized_email::text,
        email_verified = true,
        hosted_domain_claim = (p_claims).normalized_hosted_domain::text,
        claims_observed_at = observed_at,
        updated_at = observed_at
    WHERE id = resolved_identity_id;
  END IF;

  IF resolved_user_status <> 'ACTIVE'
     OR resolved_identity_status <> 'ACTIVE' THEN
    observed_at := pg_catalog.clock_timestamp();
    UPDATE uptech.oauth_transactions
    SET status = 'REJECTED', rejected_at = observed_at
    WHERE id = selected_transaction.id
      AND status = 'EXCHANGE_RESERVED'
      AND completion_expires_at > observed_at;
    GET DIAGNOSTICS transitioned_rows = ROW_COUNT;
    IF transitioned_rows <> 1 THEN
      RAISE EXCEPTION USING
        ERRCODE = 'PGA01', MESSAGE = 'google login reservation expired';
    END IF;

    INSERT INTO uptech.platform_audit_events (
      id, identity_id, action, target_type, outcome, request_id, metadata,
      occurred_at
    ) VALUES (
      pg_catalog.gen_random_uuid(), resolved_identity_id,
      'GOOGLE_AUTH_LOGIN_DENIED', 'GOOGLE_AUTH_TRANSACTION', 'DENIED',
      p_request_id,
      pg_catalog.jsonb_build_object(
        'purpose', selected_transaction.purpose::text,
        'configuration_key', selected_transaction.configuration_key::text,
        'correlation_id', selected_transaction.id,
        'identity_id', resolved_identity_id,
        'rejection_class', 'IDENTITY_INELIGIBLE'
      ),
      observed_at
    );

    RETURN ROW(
      'DENIED'::uptech.google_login_completion_outcome_v1,
      NULL::text[], NULL::timestamptz
    )::uptech.google_login_completion_result_v1;
  END IF;

  SELECT locator.workspace_id, locator.status
  INTO resolved_workspace_id, resolved_domain_status
  FROM uptech.workspace_domain_locators AS locator
  WHERE locator.normalized_domain = (p_claims).normalized_hosted_domain;

  IF resolved_workspace_id IS NULL OR resolved_domain_status = 'PENDING' THEN
    issue_onboarding := true;
    onboarding_operations := ARRAY[
      'FIRST_DOMAIN_CLAIM_READ',
      'FIRST_DOMAIN_CLAIM_RESERVE',
      'FIRST_DOMAIN_CLAIM_COMPLETE',
      'ACCESS_REQUEST_READ',
      'ACCESS_REQUEST_SUBMIT'
    ]::text[];
  ELSE
    SELECT workspace_row.status, workspace_row.provisioning_policy,
      workspace_row.security_version
    INTO resolved_workspace_status, resolved_provisioning_policy,
      resolved_workspace_security_version
    FROM uptech.workspaces AS workspace_row
    WHERE workspace_row.workspace_id = resolved_workspace_id
    FOR UPDATE;

    IF resolved_workspace_status = 'ACTIVE'
       AND resolved_provisioning_policy <> 'GOOGLE_GROUP_CONTROLLED' THEN
      SELECT membership_row.id, membership_row.status, membership_row.role,
        membership_row.authz_version
      INTO resolved_membership_id, resolved_membership_status,
        resolved_membership_role, resolved_membership_authz_version
      FROM uptech.workspace_memberships AS membership_row
      WHERE membership_row.workspace_id = resolved_workspace_id
        AND membership_row.user_id = resolved_user_id
      FOR UPDATE;

      IF resolved_membership_id IS NOT NULL
         AND resolved_membership_status = 'ACTIVE' THEN
        issue_normal := true;
      ELSIF resolved_provisioning_policy = 'DOMAIN_AUTO_PROVISION'
            AND resolved_membership_id IS NULL THEN
        issue_normal := true;
        insert_member := true;
      ELSIF resolved_provisioning_policy = 'DOMAIN_AUTO_PROVISION'
            AND resolved_membership_role = 'MEMBER'
            AND resolved_membership_status IN (
              'PENDING', 'DEPROVISIONED'
            ) THEN
        issue_normal := true;
        reactivate_member := true;
      ELSIF resolved_membership_id IS NOT NULL
            AND resolved_membership_status = 'SUSPENDED' THEN
        NULL;
      ELSE
        issue_onboarding := true;
        onboarding_operations := ARRAY[
          'ACCESS_REQUEST_READ', 'ACCESS_REQUEST_SUBMIT'
        ]::text[];
      END IF;
    END IF;
  END IF;

  IF NOT issue_normal AND NOT issue_onboarding THEN
    observed_at := pg_catalog.clock_timestamp();
    UPDATE uptech.oauth_transactions
    SET status = 'REJECTED', rejected_at = observed_at
    WHERE id = selected_transaction.id
      AND status = 'EXCHANGE_RESERVED'
      AND completion_expires_at > observed_at;
    GET DIAGNOSTICS transitioned_rows = ROW_COUNT;
    IF transitioned_rows <> 1 THEN
      RAISE EXCEPTION USING
        ERRCODE = 'PGA01', MESSAGE = 'google login reservation expired';
    END IF;

    INSERT INTO uptech.platform_audit_events (
      id, identity_id, action, target_type, outcome, request_id, metadata,
      occurred_at
    ) VALUES (
      pg_catalog.gen_random_uuid(), resolved_identity_id,
      'GOOGLE_AUTH_LOGIN_DENIED', 'GOOGLE_AUTH_TRANSACTION', 'DENIED',
      p_request_id,
      pg_catalog.jsonb_build_object(
        'purpose', selected_transaction.purpose::text,
        'configuration_key', selected_transaction.configuration_key::text,
        'correlation_id', selected_transaction.id,
        'identity_id', resolved_identity_id,
        'rejection_class', 'IDENTITY_INELIGIBLE'
      ),
      observed_at
    );

    RETURN ROW(
      'DENIED'::uptech.google_login_completion_outcome_v1,
      NULL::text[], NULL::timestamptz
    )::uptech.google_login_completion_result_v1;
  END IF;

  IF issue_normal THEN
    IF p_access_token_hash IS NOT NULL
       AND p_refresh_token_hash IS NOT NULL THEN
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          'UPTECH_CREDENTIAL_V1'
            || pg_catalog.least(
              pg_catalog.encode(p_access_token_hash, 'hex'),
              pg_catalog.encode(p_refresh_token_hash, 'hex')
            ),
          0
        )
      );
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          'UPTECH_CREDENTIAL_V1'
            || pg_catalog.greatest(
              pg_catalog.encode(p_access_token_hash, 'hex'),
              pg_catalog.encode(p_refresh_token_hash, 'hex')
            ),
          0
        )
      );
    END IF;

    IF p_access_token_hash IS NULL
       OR p_refresh_token_hash IS NULL
       OR p_device_binding_hash IS NULL
       OR p_access_token_hash = p_refresh_token_hash
       OR p_device_binding_hash = p_access_token_hash
       OR p_device_binding_hash = p_refresh_token_hash
       OR EXISTS (
         SELECT 1 FROM uptech.session_tokens AS existing_token
         WHERE existing_token.token_hash IN (
           p_access_token_hash, p_refresh_token_hash
         )
       )
       OR EXISTS (
         SELECT 1 FROM uptech.onboarding_sessions AS existing_onboarding
         WHERE existing_onboarding.token_hash IN (
           p_access_token_hash, p_refresh_token_hash
         )
       ) THEN
      observed_at := pg_catalog.clock_timestamp();
      UPDATE uptech.oauth_transactions
      SET status = 'REJECTED', rejected_at = observed_at
      WHERE id = selected_transaction.id
        AND status = 'EXCHANGE_RESERVED'
        AND completion_expires_at > observed_at;
      GET DIAGNOSTICS transitioned_rows = ROW_COUNT;
      IF transitioned_rows <> 1 THEN
        RAISE EXCEPTION USING
          ERRCODE = 'PGA01', MESSAGE = 'google login reservation expired';
      END IF;

      INSERT INTO uptech.platform_audit_events (
        id, identity_id, action, target_type, outcome, request_id, metadata,
        occurred_at
      ) VALUES (
        pg_catalog.gen_random_uuid(), resolved_identity_id,
        'GOOGLE_AUTH_LOGIN_DENIED', 'GOOGLE_AUTH_TRANSACTION', 'DENIED',
        p_request_id,
        pg_catalog.jsonb_build_object(
          'purpose', selected_transaction.purpose::text,
          'configuration_key', selected_transaction.configuration_key::text,
          'correlation_id', selected_transaction.id,
          'identity_id', resolved_identity_id,
          'rejection_class', 'INTERNAL_FAILURE'
        ),
        observed_at
      );

      RETURN ROW(
        'DENIED'::uptech.google_login_completion_outcome_v1,
        NULL::text[], NULL::timestamptz
      )::uptech.google_login_completion_result_v1;
    END IF;

    IF insert_member THEN
      resolved_membership_id := pg_catalog.gen_random_uuid();
      resolved_membership_role := 'MEMBER';
      resolved_membership_status := 'ACTIVE';
      resolved_membership_authz_version := 1;
      INSERT INTO uptech.workspace_memberships (
        workspace_id, id, user_id, role, status, authz_version,
        created_at, updated_at
      ) VALUES (
        resolved_workspace_id, resolved_membership_id, resolved_user_id,
        'MEMBER', 'ACTIVE', 1, observed_at, observed_at
      );
    ELSIF reactivate_member THEN
      UPDATE uptech.workspace_memberships
      SET status = 'ACTIVE', authz_version = authz_version + 1,
          updated_at = observed_at
      WHERE workspace_id = resolved_workspace_id
        AND id = resolved_membership_id
      RETURNING authz_version INTO resolved_membership_authz_version;
    END IF;

    new_session_id := pg_catalog.gen_random_uuid();
    new_access_token_id := pg_catalog.gen_random_uuid();
    new_refresh_token_id := pg_catalog.gen_random_uuid();

    INSERT INTO uptech.sessions (
      workspace_id, id, identity_id, user_id, membership_id, client_type,
      status, user_security_version, identity_security_version,
      workspace_security_version, membership_authz_version, security_version,
      current_rotation_version, created_at, last_seen_at, idle_expires_at,
      absolute_expires_at, device_binding_hash
    ) VALUES (
      resolved_workspace_id, new_session_id, resolved_identity_id,
      resolved_user_id, resolved_membership_id, 'NATIVE', 'ACTIVE',
      resolved_user_security_version, resolved_identity_security_version,
      resolved_workspace_security_version, resolved_membership_authz_version,
      1, 1, observed_at, observed_at, observed_at + interval '7 days',
      observed_at + interval '30 days', p_device_binding_hash
    );

    INSERT INTO uptech.session_tokens (
      workspace_id, id, session_id, client_type, token_kind, token_status,
      token_hash, session_security_version, rotation_version, issued_at,
      expires_at
    ) VALUES
      (
        resolved_workspace_id, new_access_token_id, new_session_id,
        'NATIVE', 'NATIVE_ACCESS', 'CURRENT', p_access_token_hash,
        1, 1, observed_at, observed_at + interval '15 minutes'
      ),
      (
        resolved_workspace_id, new_refresh_token_id, new_session_id,
        'NATIVE', 'NATIVE_REFRESH', 'CURRENT', p_refresh_token_hash,
        1, 1, observed_at, observed_at + interval '30 days'
      );

    IF insert_member OR reactivate_member THEN
      INSERT INTO uptech.audit_events (
        workspace_id, id, actor_kind, actor_id, membership_id, session_id,
        action, target_type, target_id, outcome, request_id, metadata,
        occurred_at
      ) VALUES (
        resolved_workspace_id, pg_catalog.gen_random_uuid(), 'USER',
        resolved_user_id, resolved_membership_id, new_session_id,
        'MEMBERSHIP_AUTO_PROVISIONED', 'WORKSPACE_MEMBERSHIP',
        resolved_membership_id, 'SUCCEEDED', p_request_id,
        pg_catalog.jsonb_build_object(
          'purpose', selected_transaction.purpose::text,
          'configuration_key', selected_transaction.configuration_key::text,
          'identity_id', resolved_identity_id
        ),
        observed_at
      );
    END IF;

    INSERT INTO uptech.platform_audit_events (
      id, identity_id, action, target_type, outcome, request_id, metadata,
      occurred_at
    ) VALUES (
      pg_catalog.gen_random_uuid(), resolved_identity_id,
      'GOOGLE_AUTH_LOGIN_SUCCEEDED', 'SESSION', 'SUCCEEDED', p_request_id,
      pg_catalog.jsonb_build_object(
        'purpose', selected_transaction.purpose::text,
        'configuration_key', selected_transaction.configuration_key::text,
        'correlation_id', selected_transaction.id,
        'identity_id', resolved_identity_id
      ),
      observed_at
    );

    INSERT INTO uptech.audit_events (
      workspace_id, id, actor_kind, actor_id, membership_id, session_id,
      action, target_type, target_id, outcome, request_id, metadata,
      occurred_at
    ) VALUES (
      resolved_workspace_id, pg_catalog.gen_random_uuid(), 'USER',
      resolved_user_id, resolved_membership_id, new_session_id,
      'GOOGLE_AUTH_LOGIN_SUCCEEDED', 'SESSION', new_session_id, 'SUCCEEDED',
      p_request_id,
      pg_catalog.jsonb_build_object(
        'purpose', selected_transaction.purpose::text,
        'configuration_key', selected_transaction.configuration_key::text,
        'identity_id', resolved_identity_id
      ),
      observed_at
    );

    observed_at := pg_catalog.clock_timestamp();
    UPDATE uptech.oauth_transactions
    SET status = 'COMPLETED', completed_at = observed_at
    WHERE id = selected_transaction.id
      AND status = 'EXCHANGE_RESERVED'
      AND completion_expires_at > observed_at
      AND (p_claims).issued_at >= observed_at - interval '5 minutes'
      AND (p_claims).issued_at <= observed_at + interval '2 minutes'
      AND (p_claims).expires_at > observed_at
      AND (p_claims).expires_at > (p_claims).issued_at
      AND (p_claims).expires_at <= (p_claims).issued_at + interval '2 hours';
    GET DIAGNOSTICS transitioned_rows = ROW_COUNT;
    IF transitioned_rows <> 1 THEN
      RAISE EXCEPTION USING
        ERRCODE = 'PGA01', MESSAGE = 'google login reservation expired';
    END IF;

    RETURN ROW(
      'NORMAL'::uptech.google_login_completion_outcome_v1,
      NULL::text[], NULL::timestamptz
    )::uptech.google_login_completion_result_v1;
  END IF;

  IF p_onboarding_token_hash IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'UPTECH_CREDENTIAL_V1'
          || pg_catalog.encode(p_onboarding_token_hash, 'hex'),
        0
      )
    );
  END IF;

  IF p_onboarding_token_hash IS NULL
     OR EXISTS (
       SELECT 1 FROM uptech.session_tokens AS existing_token
       WHERE existing_token.token_hash = p_onboarding_token_hash
     )
     OR EXISTS (
       SELECT 1 FROM uptech.onboarding_sessions AS existing_onboarding
       WHERE existing_onboarding.token_hash = p_onboarding_token_hash
     ) THEN
    observed_at := pg_catalog.clock_timestamp();
    UPDATE uptech.oauth_transactions
    SET status = 'REJECTED', rejected_at = observed_at
    WHERE id = selected_transaction.id
      AND status = 'EXCHANGE_RESERVED'
      AND completion_expires_at > observed_at;
    GET DIAGNOSTICS transitioned_rows = ROW_COUNT;
    IF transitioned_rows <> 1 THEN
      RAISE EXCEPTION USING
        ERRCODE = 'PGA01', MESSAGE = 'google login reservation expired';
    END IF;

    INSERT INTO uptech.platform_audit_events (
      id, identity_id, action, target_type, outcome, request_id, metadata,
      occurred_at
    ) VALUES (
      pg_catalog.gen_random_uuid(), resolved_identity_id,
      'GOOGLE_AUTH_LOGIN_DENIED', 'GOOGLE_AUTH_TRANSACTION', 'DENIED',
      p_request_id,
      pg_catalog.jsonb_build_object(
        'purpose', selected_transaction.purpose::text,
        'configuration_key', selected_transaction.configuration_key::text,
        'correlation_id', selected_transaction.id,
        'identity_id', resolved_identity_id,
        'rejection_class', 'INTERNAL_FAILURE'
      ),
      observed_at
    );

    RETURN ROW(
      'DENIED'::uptech.google_login_completion_outcome_v1,
      NULL::text[], NULL::timestamptz
    )::uptech.google_login_completion_result_v1;
  END IF;

  new_onboarding_session_id := pg_catalog.gen_random_uuid();
  onboarding_expiry := observed_at + interval '30 minutes';
  INSERT INTO uptech.onboarding_sessions (
    id, identity_id, token_hash, allowed_operations, status, created_at,
    expires_at
  ) VALUES (
    new_onboarding_session_id, resolved_identity_id, p_onboarding_token_hash,
    onboarding_operations, 'ACTIVE', observed_at, onboarding_expiry
  );

  INSERT INTO uptech.platform_audit_events (
    id, identity_id, action, target_type, outcome, request_id, metadata,
    occurred_at
  ) VALUES (
    pg_catalog.gen_random_uuid(), resolved_identity_id,
    'GOOGLE_AUTH_ONBOARDING_ISSUED', 'ONBOARDING_SESSION', 'SUCCEEDED',
    p_request_id,
    pg_catalog.jsonb_build_object(
      'purpose', selected_transaction.purpose::text,
      'configuration_key', selected_transaction.configuration_key::text,
      'correlation_id', selected_transaction.id,
      'identity_id', resolved_identity_id
    ),
    observed_at
  );

  observed_at := pg_catalog.clock_timestamp();
  UPDATE uptech.oauth_transactions
  SET status = 'COMPLETED', completed_at = observed_at
  WHERE id = selected_transaction.id
    AND status = 'EXCHANGE_RESERVED'
    AND completion_expires_at > observed_at
    AND (p_claims).issued_at >= observed_at - interval '5 minutes'
    AND (p_claims).issued_at <= observed_at + interval '2 minutes'
    AND (p_claims).expires_at > observed_at
    AND (p_claims).expires_at > (p_claims).issued_at
    AND (p_claims).expires_at <= (p_claims).issued_at + interval '2 hours';
  GET DIAGNOSTICS transitioned_rows = ROW_COUNT;
  IF transitioned_rows <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PGA01', MESSAGE = 'google login reservation expired';
  END IF;

  RETURN ROW(
    'ONBOARDING'::uptech.google_login_completion_outcome_v1,
    onboarding_operations,
    onboarding_expiry
  )::uptech.google_login_completion_result_v1;
EXCEPTION
  WHEN SQLSTATE 'PGA01' THEN
    RETURN ROW(
      'DENIED'::uptech.google_login_completion_outcome_v1,
      NULL::text[], NULL::timestamptz
    )::uptech.google_login_completion_result_v1;
END
$function$;

CREATE FUNCTION uptech.consume_google_login_transaction_v1(
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
      completion_expires_at = reservation_expiry
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

CREATE FUNCTION uptech.complete_web_google_login_v1(
  p_completion_handle_hash uptech.google_auth_hash32_v1,
  p_claims uptech.google_verified_claims_assertion_v1,
  p_session_token_hash uptech.google_auth_hash32_v1,
  p_csrf_token_hash uptech.google_auth_hash32_v1,
  p_onboarding_token_hash uptech.google_auth_hash32_v1,
  p_request_id uuid
)
RETURNS uptech.google_login_completion_result_v1
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  observed_at timestamptz := pg_catalog.clock_timestamp();
  selected_transaction uptech.oauth_transactions%ROWTYPE;
  bound_configuration uptech.google_auth_configuration_registry%ROWTYPE;
  resolved_identity_id uuid;
  resolved_user_id uuid;
  resolved_user_status text;
  resolved_user_security_version bigint;
  resolved_identity_status text;
  resolved_identity_security_version bigint;
  resolved_workspace_id uuid;
  resolved_domain_status uptech.google_workspace_domain_status_v1;
  resolved_workspace_status text;
  resolved_provisioning_policy text;
  resolved_workspace_security_version bigint;
  resolved_membership_id uuid;
  resolved_membership_status text;
  resolved_membership_role text;
  resolved_membership_authz_version bigint;
  new_session_id uuid;
  new_session_token_id uuid;
  new_onboarding_session_id uuid;
  credential_expiry timestamptz;
  onboarding_operations text[];
  issue_normal boolean := false;
  issue_onboarding boolean := false;
  insert_member boolean := false;
  reactivate_member boolean := false;
  claims_are_valid boolean;
  transitioned_rows integer;
BEGIN
  IF p_completion_handle_hash IS NOT NULL THEN
    SELECT transaction_row.*
    INTO selected_transaction
    FROM uptech.oauth_transactions AS transaction_row
    WHERE transaction_row.completion_handle_hash = p_completion_handle_hash
      AND transaction_row.purpose = 'WEB_LOGIN'
      AND transaction_row.status = 'EXCHANGE_RESERVED'
    FOR UPDATE;
  END IF;

  observed_at := pg_catalog.clock_timestamp();
  IF selected_transaction.id IS NULL
     OR selected_transaction.completion_expires_at <= observed_at THEN
    RETURN ROW(
      'DENIED'::uptech.google_login_completion_outcome_v1,
      NULL::text[],
      NULL::timestamptz
    )::uptech.google_login_completion_result_v1;
  END IF;

  SELECT configuration_row.*
  INTO bound_configuration
  FROM uptech.google_auth_configuration_registry AS configuration_row
  WHERE configuration_row.environment_name = selected_transaction.environment_name
    AND configuration_row.configuration_key =
      selected_transaction.configuration_key
    AND configuration_row.purpose = 'WEB_LOGIN'
    AND configuration_row.is_enabled;

  claims_are_valid :=
    bound_configuration.configuration_key IS NOT NULL
    AND p_request_id IS NOT NULL
    AND (p_claims).issuer IS NOT NULL
    AND (p_claims).provider_subject IS NOT NULL
    AND (p_claims).normalized_email IS NOT NULL
    AND (p_claims).email_verified IS TRUE
    AND (p_claims).normalized_hosted_domain IS NOT NULL
    AND (p_claims).issued_at IS NOT NULL
    AND (p_claims).expires_at IS NOT NULL
    AND (p_claims).issued_at >= observed_at - interval '5 minutes'
    AND (p_claims).issued_at <= observed_at + interval '2 minutes'
    AND (p_claims).expires_at > observed_at
    AND (p_claims).expires_at > (p_claims).issued_at
    AND (p_claims).expires_at <= (p_claims).issued_at + interval '2 hours'
    AND (p_claims).audience_configuration_key =
      bound_configuration.audience_configuration_key
    AND (
      (p_claims).authorized_party_configuration_key IS NULL
      OR (p_claims).authorized_party_configuration_key = ANY (
        bound_configuration.allowed_azp_configuration_keys
      )
    )
    AND (p_claims).web_nonce_hash IS NOT NULL
    AND (p_claims).web_nonce_hash = selected_transaction.web_nonce_hash;

  IF claims_are_valid IS NOT TRUE THEN
    observed_at := pg_catalog.clock_timestamp();
    UPDATE uptech.oauth_transactions
    SET status = 'REJECTED', rejected_at = observed_at
    WHERE id = selected_transaction.id
      AND status = 'EXCHANGE_RESERVED'
      AND completion_expires_at > observed_at;
    GET DIAGNOSTICS transitioned_rows = ROW_COUNT;
    IF transitioned_rows <> 1 THEN
      RAISE EXCEPTION USING
        ERRCODE = 'PGA01', MESSAGE = 'google login reservation expired';
    END IF;

    INSERT INTO uptech.platform_audit_events (
      id, action, target_type, outcome, request_id, metadata, occurred_at
    ) VALUES (
      pg_catalog.gen_random_uuid(), 'GOOGLE_AUTH_LOGIN_DENIED',
      'GOOGLE_AUTH_TRANSACTION', 'DENIED', p_request_id,
      pg_catalog.jsonb_build_object(
        'purpose', selected_transaction.purpose::text,
        'configuration_key', selected_transaction.configuration_key::text,
        'correlation_id', selected_transaction.id,
        'rejection_class', 'CLAIMS_INVALID'
      ),
      observed_at
    );

    RETURN ROW(
      'DENIED'::uptech.google_login_completion_outcome_v1,
      NULL::text[],
      NULL::timestamptz
    )::uptech.google_login_completion_result_v1;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      (p_claims).issuer::text
        || pg_catalog.chr(31)
        || (p_claims).provider_subject::text,
      0
    )
  );

  SELECT
    identity_row.id,
    identity_row.user_id,
    user_row.status,
    user_row.security_version,
    identity_row.status,
    identity_row.security_version
  INTO
    resolved_identity_id,
    resolved_user_id,
    resolved_user_status,
    resolved_user_security_version,
    resolved_identity_status,
    resolved_identity_security_version
  FROM uptech.identities AS identity_row
  JOIN uptech.users AS user_row ON user_row.id = identity_row.user_id
  WHERE identity_row.provider = 'GOOGLE'
    AND identity_row.issuer = (p_claims).issuer::text
    AND identity_row.provider_subject = (p_claims).provider_subject::text
  FOR UPDATE OF identity_row, user_row;

  IF resolved_identity_id IS NULL THEN
    resolved_user_id := pg_catalog.gen_random_uuid();
    resolved_identity_id := pg_catalog.gen_random_uuid();
    resolved_user_status := 'ACTIVE';
    resolved_user_security_version := 1;
    resolved_identity_status := 'ACTIVE';
    resolved_identity_security_version := 1;

    INSERT INTO uptech.users (
      id, status, security_version, created_at, updated_at
    ) VALUES (
      resolved_user_id, 'ACTIVE', 1, observed_at, observed_at
    );

    INSERT INTO uptech.identities (
      id,
      user_id,
      provider,
      issuer,
      provider_subject,
      status,
      security_version,
      email_claim,
      email_verified,
      hosted_domain_claim,
      claims_observed_at,
      created_at,
      updated_at
    ) VALUES (
      resolved_identity_id,
      resolved_user_id,
      'GOOGLE',
      (p_claims).issuer::text,
      (p_claims).provider_subject::text,
      'ACTIVE',
      1,
      (p_claims).normalized_email::text,
      true,
      (p_claims).normalized_hosted_domain::text,
      observed_at,
      observed_at,
      observed_at
    );
  ELSIF resolved_user_status = 'ACTIVE'
        AND resolved_identity_status = 'ACTIVE' THEN
    UPDATE uptech.identities
    SET email_claim = (p_claims).normalized_email::text,
        email_verified = true,
        hosted_domain_claim = (p_claims).normalized_hosted_domain::text,
        claims_observed_at = observed_at,
        updated_at = observed_at
    WHERE id = resolved_identity_id;
  END IF;

  IF resolved_user_status <> 'ACTIVE'
     OR resolved_identity_status <> 'ACTIVE' THEN
    observed_at := pg_catalog.clock_timestamp();
    UPDATE uptech.oauth_transactions
    SET status = 'REJECTED', rejected_at = observed_at
    WHERE id = selected_transaction.id
      AND status = 'EXCHANGE_RESERVED'
      AND completion_expires_at > observed_at;
    GET DIAGNOSTICS transitioned_rows = ROW_COUNT;
    IF transitioned_rows <> 1 THEN
      RAISE EXCEPTION USING
        ERRCODE = 'PGA01', MESSAGE = 'google login reservation expired';
    END IF;

    INSERT INTO uptech.platform_audit_events (
      id, identity_id, action, target_type, outcome, request_id, metadata,
      occurred_at
    ) VALUES (
      pg_catalog.gen_random_uuid(), resolved_identity_id,
      'GOOGLE_AUTH_LOGIN_DENIED', 'GOOGLE_AUTH_TRANSACTION', 'DENIED',
      p_request_id,
      pg_catalog.jsonb_build_object(
        'purpose', selected_transaction.purpose::text,
        'configuration_key', selected_transaction.configuration_key::text,
        'correlation_id', selected_transaction.id,
        'identity_id', resolved_identity_id,
        'rejection_class', 'IDENTITY_INELIGIBLE'
      ),
      observed_at
    );

    RETURN ROW(
      'DENIED'::uptech.google_login_completion_outcome_v1,
      NULL::text[],
      NULL::timestamptz
    )::uptech.google_login_completion_result_v1;
  END IF;

  SELECT locator.workspace_id, locator.status
  INTO resolved_workspace_id, resolved_domain_status
  FROM uptech.workspace_domain_locators AS locator
  WHERE locator.normalized_domain = (p_claims).normalized_hosted_domain;

  IF resolved_workspace_id IS NULL OR resolved_domain_status = 'PENDING' THEN
    issue_onboarding := true;
    onboarding_operations := ARRAY[
      'FIRST_DOMAIN_CLAIM_READ',
      'FIRST_DOMAIN_CLAIM_RESERVE',
      'FIRST_DOMAIN_CLAIM_COMPLETE',
      'ACCESS_REQUEST_READ',
      'ACCESS_REQUEST_SUBMIT'
    ]::text[];
  ELSE
    SELECT
      workspace_row.status,
      workspace_row.provisioning_policy,
      workspace_row.security_version
    INTO
      resolved_workspace_status,
      resolved_provisioning_policy,
      resolved_workspace_security_version
    FROM uptech.workspaces AS workspace_row
    WHERE workspace_row.workspace_id = resolved_workspace_id
    FOR UPDATE;

    IF resolved_workspace_status = 'ACTIVE'
       AND resolved_provisioning_policy <> 'GOOGLE_GROUP_CONTROLLED' THEN
      SELECT
        membership_row.id,
        membership_row.status,
        membership_row.role,
        membership_row.authz_version
      INTO
        resolved_membership_id,
        resolved_membership_status,
        resolved_membership_role,
        resolved_membership_authz_version
      FROM uptech.workspace_memberships AS membership_row
      WHERE membership_row.workspace_id = resolved_workspace_id
        AND membership_row.user_id = resolved_user_id
      FOR UPDATE;

      IF resolved_membership_id IS NOT NULL
         AND resolved_membership_status = 'ACTIVE' THEN
        issue_normal := true;
      ELSIF resolved_provisioning_policy = 'DOMAIN_AUTO_PROVISION'
            AND resolved_membership_id IS NULL THEN
        issue_normal := true;
        insert_member := true;
      ELSIF resolved_provisioning_policy = 'DOMAIN_AUTO_PROVISION'
            AND resolved_membership_role = 'MEMBER'
            AND resolved_membership_status IN (
              'PENDING', 'DEPROVISIONED'
            ) THEN
        issue_normal := true;
        reactivate_member := true;
      ELSIF resolved_membership_id IS NOT NULL
            AND resolved_membership_status = 'SUSPENDED' THEN
        NULL;
      ELSE
        issue_onboarding := true;
        onboarding_operations := ARRAY[
          'ACCESS_REQUEST_READ',
          'ACCESS_REQUEST_SUBMIT'
        ]::text[];
      END IF;
    END IF;
  END IF;

  IF NOT issue_normal AND NOT issue_onboarding THEN
    observed_at := pg_catalog.clock_timestamp();
    UPDATE uptech.oauth_transactions
    SET status = 'REJECTED', rejected_at = observed_at
    WHERE id = selected_transaction.id
      AND status = 'EXCHANGE_RESERVED'
      AND completion_expires_at > observed_at;
    GET DIAGNOSTICS transitioned_rows = ROW_COUNT;
    IF transitioned_rows <> 1 THEN
      RAISE EXCEPTION USING
        ERRCODE = 'PGA01', MESSAGE = 'google login reservation expired';
    END IF;

    INSERT INTO uptech.platform_audit_events (
      id, identity_id, action, target_type, outcome, request_id, metadata,
      occurred_at
    ) VALUES (
      pg_catalog.gen_random_uuid(), resolved_identity_id,
      'GOOGLE_AUTH_LOGIN_DENIED', 'GOOGLE_AUTH_TRANSACTION', 'DENIED',
      p_request_id,
      pg_catalog.jsonb_build_object(
        'purpose', selected_transaction.purpose::text,
        'configuration_key', selected_transaction.configuration_key::text,
        'correlation_id', selected_transaction.id,
        'identity_id', resolved_identity_id,
        'rejection_class', 'IDENTITY_INELIGIBLE'
      ),
      observed_at
    );

    RETURN ROW(
      'DENIED'::uptech.google_login_completion_outcome_v1,
      NULL::text[],
      NULL::timestamptz
    )::uptech.google_login_completion_result_v1;
  END IF;

  IF issue_normal THEN
    IF p_session_token_hash IS NOT NULL THEN
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          'UPTECH_CREDENTIAL_V1'
            || pg_catalog.encode(p_session_token_hash, 'hex'),
          0
        )
      );
    END IF;

    IF p_session_token_hash IS NULL
       OR p_csrf_token_hash IS NULL
       OR p_session_token_hash = p_csrf_token_hash
       OR EXISTS (
         SELECT 1 FROM uptech.session_tokens AS existing_token
         WHERE existing_token.token_hash = p_session_token_hash
       )
       OR EXISTS (
         SELECT 1 FROM uptech.onboarding_sessions AS existing_onboarding
         WHERE existing_onboarding.token_hash = p_session_token_hash
       ) THEN
      observed_at := pg_catalog.clock_timestamp();
      UPDATE uptech.oauth_transactions
      SET status = 'REJECTED', rejected_at = observed_at
      WHERE id = selected_transaction.id
        AND status = 'EXCHANGE_RESERVED'
        AND completion_expires_at > observed_at;
      GET DIAGNOSTICS transitioned_rows = ROW_COUNT;
      IF transitioned_rows <> 1 THEN
        RAISE EXCEPTION USING
          ERRCODE = 'PGA01', MESSAGE = 'google login reservation expired';
      END IF;

      INSERT INTO uptech.platform_audit_events (
        id, identity_id, action, target_type, outcome, request_id, metadata,
        occurred_at
      ) VALUES (
        pg_catalog.gen_random_uuid(), resolved_identity_id,
        'GOOGLE_AUTH_LOGIN_DENIED', 'GOOGLE_AUTH_TRANSACTION', 'DENIED',
        p_request_id,
        pg_catalog.jsonb_build_object(
          'purpose', selected_transaction.purpose::text,
          'configuration_key', selected_transaction.configuration_key::text,
          'correlation_id', selected_transaction.id,
          'identity_id', resolved_identity_id,
          'rejection_class', 'INTERNAL_FAILURE'
        ),
        observed_at
      );

      RETURN ROW(
        'DENIED'::uptech.google_login_completion_outcome_v1,
        NULL::text[],
        NULL::timestamptz
      )::uptech.google_login_completion_result_v1;
    END IF;

    IF insert_member THEN
      resolved_membership_id := pg_catalog.gen_random_uuid();
      resolved_membership_role := 'MEMBER';
      resolved_membership_status := 'ACTIVE';
      resolved_membership_authz_version := 1;
      INSERT INTO uptech.workspace_memberships (
        workspace_id, id, user_id, role, status, authz_version,
        created_at, updated_at
      ) VALUES (
        resolved_workspace_id, resolved_membership_id, resolved_user_id,
        'MEMBER', 'ACTIVE', 1, observed_at, observed_at
      );
    ELSIF reactivate_member THEN
      UPDATE uptech.workspace_memberships
      SET status = 'ACTIVE',
          authz_version = authz_version + 1,
          updated_at = observed_at
      WHERE workspace_id = resolved_workspace_id
        AND id = resolved_membership_id
      RETURNING authz_version INTO resolved_membership_authz_version;
    END IF;

    new_session_id := pg_catalog.gen_random_uuid();
    new_session_token_id := pg_catalog.gen_random_uuid();
    credential_expiry := observed_at + interval '7 days';

    INSERT INTO uptech.sessions (
      workspace_id,
      id,
      identity_id,
      user_id,
      membership_id,
      client_type,
      status,
      user_security_version,
      identity_security_version,
      workspace_security_version,
      membership_authz_version,
      security_version,
      current_rotation_version,
      created_at,
      last_seen_at,
      idle_expires_at,
      absolute_expires_at
    ) VALUES (
      resolved_workspace_id,
      new_session_id,
      resolved_identity_id,
      resolved_user_id,
      resolved_membership_id,
      'WEB',
      'ACTIVE',
      resolved_user_security_version,
      resolved_identity_security_version,
      resolved_workspace_security_version,
      resolved_membership_authz_version,
      1,
      1,
      observed_at,
      observed_at,
      observed_at + interval '8 hours',
      credential_expiry
    );

    INSERT INTO uptech.session_tokens (
      workspace_id,
      id,
      session_id,
      client_type,
      token_kind,
      token_status,
      token_hash,
      csrf_token_hash,
      session_security_version,
      rotation_version,
      issued_at,
      expires_at
    ) VALUES (
      resolved_workspace_id,
      new_session_token_id,
      new_session_id,
      'WEB',
      'WEB_SESSION',
      'CURRENT',
      p_session_token_hash,
      p_csrf_token_hash,
      1,
      1,
      observed_at,
      credential_expiry
    );

    IF insert_member OR reactivate_member THEN
      INSERT INTO uptech.audit_events (
        workspace_id, id, actor_kind, actor_id, membership_id, session_id,
        action, target_type, target_id, outcome, request_id, metadata,
        occurred_at
      ) VALUES (
        resolved_workspace_id, pg_catalog.gen_random_uuid(), 'USER',
        resolved_user_id, resolved_membership_id, new_session_id,
        'MEMBERSHIP_AUTO_PROVISIONED', 'WORKSPACE_MEMBERSHIP',
        resolved_membership_id, 'SUCCEEDED', p_request_id,
        pg_catalog.jsonb_build_object(
          'purpose', selected_transaction.purpose::text,
          'configuration_key', selected_transaction.configuration_key::text,
          'identity_id', resolved_identity_id
        ),
        observed_at
      );
    END IF;

    INSERT INTO uptech.platform_audit_events (
      id, identity_id, action, target_type, outcome, request_id, metadata,
      occurred_at
    ) VALUES (
      pg_catalog.gen_random_uuid(), resolved_identity_id,
      'GOOGLE_AUTH_LOGIN_SUCCEEDED', 'SESSION', 'SUCCEEDED', p_request_id,
      pg_catalog.jsonb_build_object(
        'purpose', selected_transaction.purpose::text,
        'configuration_key', selected_transaction.configuration_key::text,
        'correlation_id', selected_transaction.id,
        'identity_id', resolved_identity_id
      ),
      observed_at
    );

    INSERT INTO uptech.audit_events (
      workspace_id, id, actor_kind, actor_id, membership_id, session_id,
      action, target_type, target_id, outcome, request_id, metadata,
      occurred_at
    ) VALUES (
      resolved_workspace_id, pg_catalog.gen_random_uuid(), 'USER',
      resolved_user_id, resolved_membership_id, new_session_id,
      'GOOGLE_AUTH_LOGIN_SUCCEEDED', 'SESSION', new_session_id, 'SUCCEEDED',
      p_request_id,
      pg_catalog.jsonb_build_object(
        'purpose', selected_transaction.purpose::text,
        'configuration_key', selected_transaction.configuration_key::text,
        'identity_id', resolved_identity_id
      ),
      observed_at
    );

    observed_at := pg_catalog.clock_timestamp();
    UPDATE uptech.oauth_transactions
    SET status = 'COMPLETED', completed_at = observed_at
    WHERE id = selected_transaction.id
      AND status = 'EXCHANGE_RESERVED'
      AND completion_expires_at > observed_at
      AND (p_claims).issued_at >= observed_at - interval '5 minutes'
      AND (p_claims).issued_at <= observed_at + interval '2 minutes'
      AND (p_claims).expires_at > observed_at
      AND (p_claims).expires_at > (p_claims).issued_at
      AND (p_claims).expires_at <= (p_claims).issued_at + interval '2 hours';
    GET DIAGNOSTICS transitioned_rows = ROW_COUNT;
    IF transitioned_rows <> 1 THEN
      RAISE EXCEPTION USING
        ERRCODE = 'PGA01', MESSAGE = 'google login reservation expired';
    END IF;

    RETURN ROW(
      'NORMAL'::uptech.google_login_completion_outcome_v1,
      NULL::text[],
      NULL::timestamptz
    )::uptech.google_login_completion_result_v1;
  END IF;

  IF p_onboarding_token_hash IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'UPTECH_CREDENTIAL_V1'
          || pg_catalog.encode(p_onboarding_token_hash, 'hex'),
        0
      )
    );
  END IF;

  IF p_onboarding_token_hash IS NULL
     OR EXISTS (
       SELECT 1 FROM uptech.session_tokens AS existing_token
       WHERE existing_token.token_hash = p_onboarding_token_hash
     )
     OR EXISTS (
       SELECT 1 FROM uptech.onboarding_sessions AS existing_onboarding
       WHERE existing_onboarding.token_hash = p_onboarding_token_hash
     ) THEN
    observed_at := pg_catalog.clock_timestamp();
    UPDATE uptech.oauth_transactions
    SET status = 'REJECTED', rejected_at = observed_at
    WHERE id = selected_transaction.id
      AND status = 'EXCHANGE_RESERVED'
      AND completion_expires_at > observed_at;
    GET DIAGNOSTICS transitioned_rows = ROW_COUNT;
    IF transitioned_rows <> 1 THEN
      RAISE EXCEPTION USING
        ERRCODE = 'PGA01', MESSAGE = 'google login reservation expired';
    END IF;

    INSERT INTO uptech.platform_audit_events (
      id, identity_id, action, target_type, outcome, request_id, metadata,
      occurred_at
    ) VALUES (
      pg_catalog.gen_random_uuid(), resolved_identity_id,
      'GOOGLE_AUTH_LOGIN_DENIED', 'GOOGLE_AUTH_TRANSACTION', 'DENIED',
      p_request_id,
      pg_catalog.jsonb_build_object(
        'purpose', selected_transaction.purpose::text,
        'configuration_key', selected_transaction.configuration_key::text,
        'correlation_id', selected_transaction.id,
        'identity_id', resolved_identity_id,
        'rejection_class', 'INTERNAL_FAILURE'
      ),
      observed_at
    );

    RETURN ROW(
      'DENIED'::uptech.google_login_completion_outcome_v1,
      NULL::text[],
      NULL::timestamptz
    )::uptech.google_login_completion_result_v1;
  END IF;

  new_onboarding_session_id := pg_catalog.gen_random_uuid();
  credential_expiry := observed_at + interval '30 minutes';
  INSERT INTO uptech.onboarding_sessions (
    id, identity_id, token_hash, allowed_operations, status, created_at,
    expires_at
  ) VALUES (
    new_onboarding_session_id, resolved_identity_id, p_onboarding_token_hash,
    onboarding_operations, 'ACTIVE', observed_at, credential_expiry
  );

  INSERT INTO uptech.platform_audit_events (
    id, identity_id, action, target_type, outcome, request_id, metadata,
    occurred_at
  ) VALUES (
    pg_catalog.gen_random_uuid(), resolved_identity_id,
    'GOOGLE_AUTH_ONBOARDING_ISSUED', 'ONBOARDING_SESSION', 'SUCCEEDED',
    p_request_id,
    pg_catalog.jsonb_build_object(
      'purpose', selected_transaction.purpose::text,
      'configuration_key', selected_transaction.configuration_key::text,
      'correlation_id', selected_transaction.id,
      'identity_id', resolved_identity_id
    ),
    observed_at
  );

  observed_at := pg_catalog.clock_timestamp();
  UPDATE uptech.oauth_transactions
  SET status = 'COMPLETED', completed_at = observed_at
  WHERE id = selected_transaction.id
    AND status = 'EXCHANGE_RESERVED'
    AND completion_expires_at > observed_at
    AND (p_claims).issued_at >= observed_at - interval '5 minutes'
    AND (p_claims).issued_at <= observed_at + interval '2 minutes'
    AND (p_claims).expires_at > observed_at
    AND (p_claims).expires_at > (p_claims).issued_at
    AND (p_claims).expires_at <= (p_claims).issued_at + interval '2 hours';
  GET DIAGNOSTICS transitioned_rows = ROW_COUNT;
  IF transitioned_rows <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PGA01', MESSAGE = 'google login reservation expired';
  END IF;

  RETURN ROW(
    'ONBOARDING'::uptech.google_login_completion_outcome_v1,
    onboarding_operations,
    credential_expiry
  )::uptech.google_login_completion_result_v1;
EXCEPTION
  WHEN SQLSTATE 'PGA01' THEN
    RETURN ROW(
      'DENIED'::uptech.google_login_completion_outcome_v1,
      NULL::text[], NULL::timestamptz
    )::uptech.google_login_completion_result_v1;
END
$function$;

CREATE FUNCTION uptech.record_google_login_rejection_v1(
  p_purpose uptech.google_login_purpose_v1,
  p_network_hmac uptech.google_auth_hash32_v1,
  p_rejection_class uptech.google_auth_rejection_class_v1,
  p_request_id uuid
)
RETURNS uptech.google_login_rejection_outcome_v1
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

    RETURN 'RATE_LIMITED'::uptech.google_login_rejection_outcome_v1;
  END IF;

  SELECT configuration_key
  INTO bound_configuration
  FROM uptech.google_auth_configuration_registry
  WHERE environment_name = active_environment
    AND purpose = p_purpose
    AND is_enabled;

  INSERT INTO uptech.platform_audit_events (
    id, action, target_type, outcome, request_id, metadata, occurred_at
  ) VALUES (
    pg_catalog.gen_random_uuid(), 'GOOGLE_AUTH_TRANSACTION_DENIED',
    'GOOGLE_AUTH_TRANSACTION', 'DENIED', p_request_id,
    pg_catalog.jsonb_strip_nulls(
      pg_catalog.jsonb_build_object(
        'purpose', p_purpose::text,
        'configuration_key', bound_configuration::text,
        'rejection_class', p_rejection_class::text
      )
    ),
    observed_at
  );

  RETURN 'RECORDED'::uptech.google_login_rejection_outcome_v1;
END
$function$;

CREATE FUNCTION uptech.record_google_login_rejection_v1(
  p_completion_handle_hash uptech.google_auth_hash32_v1,
  p_rejection_class uptech.google_auth_rejection_class_v1,
  p_request_id uuid
)
RETURNS uptech.google_login_rejection_outcome_v1
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  observed_at timestamptz := pg_catalog.clock_timestamp();
  selected_transaction uptech.oauth_transactions%ROWTYPE;
BEGIN
  IF p_completion_handle_hash IS NOT NULL THEN
    SELECT transaction_row.*
    INTO selected_transaction
    FROM uptech.oauth_transactions AS transaction_row
    WHERE transaction_row.completion_handle_hash = p_completion_handle_hash
      AND transaction_row.status = 'EXCHANGE_RESERVED'
    FOR UPDATE;
  END IF;

  observed_at := pg_catalog.clock_timestamp();
  IF selected_transaction.id IS NOT NULL
     AND selected_transaction.completion_expires_at > observed_at THEN
    UPDATE uptech.oauth_transactions
    SET status = 'REJECTED', rejected_at = observed_at
    WHERE id = selected_transaction.id
      AND status = 'EXCHANGE_RESERVED'
      AND completion_expires_at > observed_at;

    INSERT INTO uptech.platform_audit_events (
      id, action, target_type, outcome, request_id, metadata, occurred_at
    ) VALUES (
      pg_catalog.gen_random_uuid(), 'GOOGLE_AUTH_EXCHANGE_REJECTED',
      'GOOGLE_AUTH_TRANSACTION', 'DENIED', p_request_id,
      pg_catalog.jsonb_build_object(
        'purpose', selected_transaction.purpose::text,
        'configuration_key', selected_transaction.configuration_key::text,
        'correlation_id', selected_transaction.id,
        'rejection_class', p_rejection_class::text
      ),
      observed_at
    );
  END IF;

  RETURN 'RECORDED'::uptech.google_login_rejection_outcome_v1;
END
$function$;

CREATE FUNCTION uptech.consume_google_login_transaction_v1(
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
      completion_expires_at = reservation_expiry
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

CREATE FUNCTION uptech.begin_google_login_transaction_v1(
  p_purpose uptech.google_login_purpose_v1,
  p_network_hmac uptech.google_auth_hash32_v1,
  p_transaction_handle_hash uptech.google_native_transaction_handle_hash_v1,
  p_native_s256_challenge_hash uptech.google_native_s256_hash_v1,
  p_request_id uuid
)
RETURNS uptech.google_login_begin_result_v1
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
  transaction_id uuid;
  transaction_expiry timestamptz;
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
      'RATE_LIMITED'::uptech.google_login_begin_outcome_v1,
      NULL::timestamptz
    )::uptech.google_login_begin_result_v1;
  END IF;

  IF p_purpose IN ('NATIVE_ANDROID_LOGIN', 'NATIVE_IOS_LOGIN') THEN
    SELECT configuration_key
    INTO bound_configuration
    FROM uptech.google_auth_configuration_registry
    WHERE environment_name = active_environment
      AND purpose = p_purpose
      AND is_enabled;
  END IF;

  IF p_network_hmac IS NULL
     OR p_request_id IS NULL
     OR p_purpose NOT IN ('NATIVE_ANDROID_LOGIN', 'NATIVE_IOS_LOGIN')
     OR bound_configuration IS NULL
     OR p_transaction_handle_hash IS NULL
     OR p_native_s256_challenge_hash IS NULL
     OR p_transaction_handle_hash = p_native_s256_challenge_hash THEN
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
      'DENIED'::uptech.google_login_begin_outcome_v1,
      NULL::timestamptz
    )::uptech.google_login_begin_result_v1;
  END IF;

  observed_at := pg_catalog.clock_timestamp();
  transaction_id := pg_catalog.gen_random_uuid();
  transaction_expiry := observed_at + interval '5 minutes';

  INSERT INTO uptech.oauth_transactions (
    id, environment_name, purpose, configuration_key, locator_hash,
    native_exchange_challenge_hash, status, request_id, created_at, expires_at
  ) VALUES (
    transaction_id, active_environment, p_purpose, bound_configuration,
    p_transaction_handle_hash, p_native_s256_challenge_hash, 'PENDING',
    p_request_id, observed_at, transaction_expiry
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO transaction_id;

  IF transaction_id IS NULL THEN
    INSERT INTO uptech.platform_audit_events (
      id, action, target_type, outcome, request_id, metadata, occurred_at
    ) VALUES (
      pg_catalog.gen_random_uuid(), 'GOOGLE_AUTH_TRANSACTION_DENIED',
      'GOOGLE_AUTH_TRANSACTION', 'DENIED', p_request_id,
      pg_catalog.jsonb_build_object(
        'purpose', p_purpose::text,
        'configuration_key', bound_configuration::text,
        'rejection_class', 'PROTOCOL_INVALID'
      ),
      observed_at
    );

    RETURN ROW(
      'DENIED'::uptech.google_login_begin_outcome_v1,
      NULL::timestamptz
    )::uptech.google_login_begin_result_v1;
  END IF;

  INSERT INTO uptech.platform_audit_events (
    id, action, target_type, outcome, request_id, metadata, occurred_at
  ) VALUES (
    pg_catalog.gen_random_uuid(), 'GOOGLE_AUTH_TRANSACTION_CREATED',
    'GOOGLE_AUTH_TRANSACTION', 'SUCCEEDED', p_request_id,
    pg_catalog.jsonb_build_object(
      'purpose', p_purpose::text,
      'configuration_key', bound_configuration::text,
      'correlation_id', transaction_id
    ),
    observed_at
  );

  RETURN ROW(
    'CREATED'::uptech.google_login_begin_outcome_v1,
    transaction_expiry
  )::uptech.google_login_begin_result_v1;
END
$function$;

REVOKE ALL ON FUNCTION uptech.begin_google_login_transaction_v1(
  uptech.google_login_purpose_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_web_pkce_envelope_v1,
  uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.begin_google_login_transaction_v1(
  uptech.google_login_purpose_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_web_pkce_envelope_v1,
  uuid
) TO uptech_api_runtime;

REVOKE ALL ON FUNCTION uptech.begin_google_login_transaction_v1(
  uptech.google_login_purpose_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_native_transaction_handle_hash_v1,
  uptech.google_native_s256_hash_v1,
  uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.begin_google_login_transaction_v1(
  uptech.google_login_purpose_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_native_transaction_handle_hash_v1,
  uptech.google_native_s256_hash_v1,
  uuid
) TO uptech_api_runtime;

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

REVOKE ALL ON FUNCTION uptech.complete_web_google_login_v1(
  uptech.google_auth_hash32_v1,
  uptech.google_verified_claims_assertion_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.complete_web_google_login_v1(
  uptech.google_auth_hash32_v1,
  uptech.google_verified_claims_assertion_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uuid
) TO uptech_api_runtime;

REVOKE ALL ON FUNCTION uptech.complete_native_google_login_v1(
  uptech.google_auth_hash32_v1,
  uptech.google_verified_claims_assertion_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.complete_native_google_login_v1(
  uptech.google_auth_hash32_v1,
  uptech.google_verified_claims_assertion_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uuid
) TO uptech_api_runtime;

REVOKE ALL ON FUNCTION uptech.record_google_login_rejection_v1(
  uptech.google_login_purpose_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_rejection_class_v1,
  uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.record_google_login_rejection_v1(
  uptech.google_login_purpose_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_rejection_class_v1,
  uuid
) TO uptech_api_runtime;

REVOKE ALL ON FUNCTION uptech.record_google_login_rejection_v1(
  uptech.google_auth_hash32_v1,
  uptech.google_auth_rejection_class_v1,
  uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.record_google_login_rejection_v1(
  uptech.google_auth_hash32_v1,
  uptech.google_auth_rejection_class_v1,
  uuid
) TO uptech_api_runtime;

REVOKE ALL ON uptech.google_auth_environment_registry,
  uptech.google_auth_configuration_registry,
  uptech.workspace_domain_locators,
  uptech.google_auth_rate_limit_buckets,
  uptech.oauth_transactions
FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;

-- Reassert the A1 pre-tenant boundary on the existing global relations.
REVOKE ALL ON uptech.users, uptech.identities, uptech.onboarding_sessions,
  uptech.platform_audit_events
FROM uptech_api_runtime, uptech_worker_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE uptech_migration_owner IN SCHEMA uptech
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE uptech_migration_owner IN SCHEMA uptech
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMIT;
