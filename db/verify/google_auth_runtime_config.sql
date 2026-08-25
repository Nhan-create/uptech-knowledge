\set ON_ERROR_STOP on

-- Deployment-time only. Pass values from the exact runtime configuration:
--   -v runtime_environment_id=...
--   -v runtime_google_client_id=...
--   -v runtime_google_redirect_uri=...
--   -v runtime_google_scopes='openid email profile'
--   -v runtime_pkce_key_version=...
-- This script grants no runtime lookup capability and persists no data.
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

CREATE TEMPORARY TABLE expected_google_auth_runtime_config (
  environment_name uptech.google_auth_ascii_identifier_v1 NOT NULL,
  google_client_id uptech.google_auth_client_identifier_v1 NOT NULL,
  redirect_uri uptech.google_auth_https_uri_v1 NOT NULL,
  scopes text NOT NULL,
  pkce_key_version uptech.google_auth_ascii_identifier_v1 NOT NULL
) ON COMMIT DROP;

INSERT INTO expected_google_auth_runtime_config (
  environment_name,
  google_client_id,
  redirect_uri,
  scopes,
  pkce_key_version
) VALUES (
  :'runtime_environment_id',
  :'runtime_google_client_id',
  :'runtime_google_redirect_uri',
  :'runtime_google_scopes',
  :'runtime_pkce_key_version'
);

DO $verify$
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
  FROM pg_temp.expected_google_auth_runtime_config AS expected;

  IF expected_scopes <> 'openid email profile' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'runtime Google login scopes differ from the approved A1 scope set';
  END IF;

  IF (
    SELECT count(*)
    FROM uptech.google_auth_environment_registry AS environment_row
    JOIN uptech.google_auth_configuration_registry AS configuration_row
      ON configuration_row.environment_name = environment_row.environment_name
    WHERE environment_row.environment_name = expected_environment
      AND environment_row.is_active
      AND configuration_row.configuration_key = 'GOOGLE_WEB_LOGIN_V1'
      AND configuration_row.purpose = 'WEB_LOGIN'
      AND configuration_row.is_enabled
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
  ) <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'runtime Google login configuration differs from the immutable database registry';
  END IF;
END
$verify$;

COMMIT;

\echo 'Google login runtime configuration matches the immutable database registry.'
