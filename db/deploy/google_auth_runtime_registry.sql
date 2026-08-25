\set ON_ERROR_STOP on
\set ECHO none

-- First-seed/idempotency boundary for the immutable production registry.
-- Supply non-secret configuration values with psql -v.  The separate 32-byte
-- audit-HMAC key is generated inside PostgreSQL on the first seed and is never
-- returned to psql.  Values are sent with \bind so SQL text remains fixed.
\if :{?runtime_environment_id}
\else
  \echo 'runtime_environment_id is required'
  \quit 3
\endif
\if :{?runtime_google_client_id}
\else
  \echo 'runtime_google_client_id is required'
  \quit 3
\endif
\if :{?runtime_google_redirect_uri}
\else
  \echo 'runtime_google_redirect_uri is required'
  \quit 3
\endif
\if :{?runtime_google_scopes}
\else
  \echo 'runtime_google_scopes is required'
  \quit 3
\endif
\if :{?runtime_pkce_key_version}
\else
  \echo 'runtime_pkce_key_version is required'
  \quit 3
\endif

BEGIN;
SET LOCAL ROLE uptech_migration_owner;

CREATE TEMPORARY TABLE expected_google_auth_registry_seed (
  environment_name uptech.google_auth_ascii_identifier_v1 NOT NULL,
  google_client_id uptech.google_auth_client_identifier_v1 NOT NULL,
  redirect_uri uptech.google_auth_https_uri_v1 NOT NULL,
  scopes text NOT NULL,
  pkce_key_version uptech.google_auth_ascii_identifier_v1 NOT NULL
) ON COMMIT DROP;

INSERT INTO expected_google_auth_registry_seed (
  environment_name,
  google_client_id,
  redirect_uri,
  scopes,
  pkce_key_version
) VALUES (
  $1::uptech.google_auth_ascii_identifier_v1,
  $2::uptech.google_auth_client_identifier_v1,
  $3::uptech.google_auth_https_uri_v1,
  $4::text,
  $5::uptech.google_auth_ascii_identifier_v1
)
\bind :runtime_environment_id :runtime_google_client_id :runtime_google_redirect_uri :runtime_google_scopes :runtime_pkce_key_version
\g

DO $seed$
DECLARE
  expected_environment uptech.google_auth_ascii_identifier_v1;
  expected_client_id uptech.google_auth_client_identifier_v1;
  expected_redirect_uri uptech.google_auth_https_uri_v1;
  expected_scopes text;
  expected_pkce_key_version uptech.google_auth_ascii_identifier_v1;
BEGIN
  SELECT
    expected.environment_name,
    expected.google_client_id,
    expected.redirect_uri,
    expected.scopes,
    expected.pkce_key_version
  INTO STRICT
    expected_environment,
    expected_client_id,
    expected_redirect_uri,
    expected_scopes,
    expected_pkce_key_version
  FROM pg_temp.expected_google_auth_registry_seed AS expected;

  IF expected_scopes <> 'openid email profile' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'runtime Google login scopes differ from the approved A1 scope set';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM uptech.google_auth_environment_registry AS environment_row
    WHERE environment_row.is_active
      AND environment_row.environment_name <> expected_environment
  ) OR EXISTS (
    SELECT 1
    FROM uptech.google_auth_environment_registry AS environment_row
    WHERE environment_row.environment_name = expected_environment
      AND NOT environment_row.is_active
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'immutable Google auth environment registry conflicts with deployment input';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM uptech.google_auth_configuration_registry AS configuration_row
    WHERE configuration_row.configuration_key = 'GOOGLE_WEB_LOGIN_V1'
      AND NOT (
        configuration_row.environment_name = expected_environment
        AND configuration_row.purpose = 'WEB_LOGIN'
        AND configuration_row.google_client_id = expected_client_id
        AND configuration_row.google_audience = expected_client_id
        AND configuration_row.audience_configuration_key =
          'GOOGLE_WEB_LOGIN_V1'
        AND configuration_row.callback_uri = expected_redirect_uri
        AND configuration_row.scopes =
          ARRAY['openid', 'email', 'profile']::text[]
        AND configuration_row.allowed_azp_configuration_keys = ARRAY[
          'GOOGLE_WEB_LOGIN_V1'::uptech.google_auth_configuration_key_v1
        ]
        AND configuration_row.web_pkce_kms_key_version =
          expected_pkce_key_version
        AND configuration_row.is_enabled
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'immutable Google web configuration conflicts with deployment input';
  END IF;
END
$seed$;

INSERT INTO uptech.google_auth_environment_registry (
  environment_name,
  rate_limit_audit_hmac_key,
  is_active
)
SELECT
  expected.environment_name,
  pg_catalog.sha256(
    pg_catalog.uuid_send(pg_catalog.gen_random_uuid())
      || pg_catalog.uuid_send(pg_catalog.gen_random_uuid())
  )::uptech.google_auth_hash32_v1,
  true
FROM pg_temp.expected_google_auth_registry_seed AS expected
WHERE NOT EXISTS (
  SELECT 1
  FROM uptech.google_auth_environment_registry AS environment_row
  WHERE environment_row.environment_name = expected.environment_name
);

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
)
SELECT
  'GOOGLE_WEB_LOGIN_V1',
  expected.environment_name,
  'WEB_LOGIN',
  expected.google_client_id,
  expected.google_client_id,
  'GOOGLE_WEB_LOGIN_V1',
  expected.redirect_uri,
  ARRAY['openid', 'email', 'profile']::text[],
  ARRAY[
    'GOOGLE_WEB_LOGIN_V1'::uptech.google_auth_configuration_key_v1
  ],
  expected.pkce_key_version,
  true
FROM pg_temp.expected_google_auth_registry_seed AS expected
WHERE NOT EXISTS (
  SELECT 1
  FROM uptech.google_auth_configuration_registry AS configuration_row
  WHERE configuration_row.configuration_key = 'GOOGLE_WEB_LOGIN_V1'
);

DO $verify$
DECLARE
  matching_rows integer;
BEGIN
  SELECT count(*)
  INTO matching_rows
  FROM pg_temp.expected_google_auth_registry_seed AS expected
  JOIN uptech.google_auth_environment_registry AS environment_row
    ON environment_row.environment_name = expected.environment_name
   AND environment_row.is_active
  JOIN uptech.google_auth_configuration_registry AS configuration_row
    ON configuration_row.environment_name = expected.environment_name
   AND configuration_row.configuration_key = 'GOOGLE_WEB_LOGIN_V1'
   AND configuration_row.purpose = 'WEB_LOGIN'
   AND configuration_row.google_client_id = expected.google_client_id
   AND configuration_row.google_audience = expected.google_client_id
   AND configuration_row.audience_configuration_key =
     'GOOGLE_WEB_LOGIN_V1'
   AND configuration_row.callback_uri = expected.redirect_uri
   AND configuration_row.scopes =
     ARRAY['openid', 'email', 'profile']::text[]
   AND configuration_row.allowed_azp_configuration_keys = ARRAY[
     'GOOGLE_WEB_LOGIN_V1'::uptech.google_auth_configuration_key_v1
   ]
   AND configuration_row.web_pkce_kms_key_version =
     expected.pkce_key_version
   AND configuration_row.is_enabled;

  IF matching_rows <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Google auth registry seed did not commit the exact deployment configuration';
  END IF;
END
$verify$;

COMMIT;

\echo 'Immutable Google web login registry seed is present and exact.'
