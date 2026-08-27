\set ON_ERROR_STOP on
\set ECHO none

\if :{?runtime_environment_id}
\else
  \echo 'runtime_environment_id is required'
  \quit 3
\endif
\if :{?runtime_mobile_google_client_id}
\else
  \echo 'runtime_mobile_google_client_id is required'
  \quit 3
\endif
\if :{?runtime_mobile_google_audience}
\else
  \echo 'runtime_mobile_google_audience is required'
  \quit 3
\endif
\if :{?runtime_mobile_pkce_key_version}
\else
  \echo 'runtime_mobile_pkce_key_version is required'
  \quit 3
\endif
\if :{?runtime_android_application_id}
\else
  \echo 'runtime_android_application_id is required'
  \quit 3
\endif
\if :{?runtime_android_release_cert_sha256}
\else
  \echo 'runtime_android_release_cert_sha256 is required'
  \quit 3
\endif
\if :{?runtime_ios_bundle_id}
\else
  \echo 'runtime_ios_bundle_id is required'
  \quit 3
\endif
\if :{?runtime_ios_team_id}
\else
  \echo 'runtime_ios_team_id is required'
  \quit 3
\endif

BEGIN;
SET LOCAL ROLE uptech_migration_owner;

CREATE TEMPORARY TABLE expected_mobile_registry_seed (
  environment_name uptech.google_auth_ascii_identifier_v1,
  client_id uptech.google_auth_client_identifier_v1,
  audience uptech.google_auth_client_identifier_v1,
  pkce_key_version uptech.google_auth_ascii_identifier_v1,
  android_application_id uptech.google_auth_ascii_identifier_v1,
  android_release_cert_sha256 uptech.google_auth_ascii_identifier_v1,
  ios_bundle_id uptech.google_auth_ascii_identifier_v1,
  ios_team_id uptech.google_auth_ascii_identifier_v1
) ON COMMIT DROP;

INSERT INTO expected_mobile_registry_seed VALUES (
  $1::uptech.google_auth_ascii_identifier_v1,
  $2::uptech.google_auth_client_identifier_v1,
  $3::uptech.google_auth_client_identifier_v1,
  $4::uptech.google_auth_ascii_identifier_v1,
  $5::uptech.google_auth_ascii_identifier_v1,
  $6::uptech.google_auth_ascii_identifier_v1,
  $7::uptech.google_auth_ascii_identifier_v1,
  $8::uptech.google_auth_ascii_identifier_v1
)
\bind :runtime_environment_id :runtime_mobile_google_client_id :runtime_mobile_google_audience :runtime_mobile_pkce_key_version :runtime_android_application_id :runtime_android_release_cert_sha256 :runtime_ios_bundle_id :runtime_ios_team_id
\g

DO $seed$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM uptech.google_auth_environment_registry e
    JOIN pg_temp.expected_mobile_registry_seed x ON x.environment_name=e.environment_name
    WHERE e.is_active) THEN
    RAISE EXCEPTION 'mobile registry environment is not the active approved environment';
  END IF;
  IF EXISTS (SELECT 1 FROM uptech.mobile_google_configuration_registry c
    JOIN pg_temp.expected_mobile_registry_seed x ON true
    WHERE NOT (c.environment_name=x.environment_name
      AND c.google_client_id=x.client_id AND c.google_audience=x.audience
      AND c.callback_uri='https://uptech-knowledge-sigma.vercel.app/api/v1/auth/mobile/google/callback'
      AND c.app_return_uri='https://uptech-knowledge-sigma.vercel.app/auth/mobile/callback'
      AND c.scopes=ARRAY['openid','email','profile']::text[]
      AND c.pkce_kms_key_version=x.pkce_key_version
      AND ((c.platform='ANDROID' AND c.configuration_key='GOOGLE_MOBILE_ANDROID_V1'
        AND c.android_application_id=x.android_application_id
        AND c.android_release_cert_sha256=x.android_release_cert_sha256)
       OR (c.platform='IOS' AND c.configuration_key='GOOGLE_MOBILE_IOS_V1'
        AND c.ios_bundle_id=x.ios_bundle_id AND c.ios_team_id=x.ios_team_id))
      AND c.is_enabled)) THEN
    RAISE EXCEPTION 'immutable mobile Google registry conflicts with deployment input';
  END IF;
END $seed$;

INSERT INTO uptech.mobile_google_configuration_registry(
  environment_name,platform,configuration_key,google_client_id,google_audience,
  callback_uri,app_return_uri,scopes,allowed_azp_configuration_keys,pkce_kms_key_version,
  android_application_id,android_release_cert_sha256,is_enabled)
SELECT x.environment_name,'ANDROID','GOOGLE_MOBILE_ANDROID_V1',x.client_id,x.audience,
  'https://uptech-knowledge-sigma.vercel.app/api/v1/auth/mobile/google/callback',
  'https://uptech-knowledge-sigma.vercel.app/auth/mobile/callback',
  ARRAY['openid','email','profile']::text[],
  ARRAY['GOOGLE_WEB_LOGIN_V1'::uptech.google_auth_configuration_key_v1],x.pkce_key_version,
  x.android_application_id,x.android_release_cert_sha256,true
FROM pg_temp.expected_mobile_registry_seed x
ON CONFLICT (environment_name,platform) DO NOTHING;

INSERT INTO uptech.mobile_google_configuration_registry(
  environment_name,platform,configuration_key,google_client_id,google_audience,
  callback_uri,app_return_uri,scopes,allowed_azp_configuration_keys,pkce_kms_key_version,
  ios_bundle_id,ios_team_id,is_enabled)
SELECT x.environment_name,'IOS','GOOGLE_MOBILE_IOS_V1',x.client_id,x.audience,
  'https://uptech-knowledge-sigma.vercel.app/api/v1/auth/mobile/google/callback',
  'https://uptech-knowledge-sigma.vercel.app/auth/mobile/callback',
  ARRAY['openid','email','profile']::text[],
  ARRAY['GOOGLE_WEB_LOGIN_V1'::uptech.google_auth_configuration_key_v1],x.pkce_key_version,
  x.ios_bundle_id,x.ios_team_id,true
FROM pg_temp.expected_mobile_registry_seed x
ON CONFLICT (environment_name,platform) DO NOTHING;

DO $verify$
BEGIN
  IF (SELECT count(*) FROM uptech.mobile_google_configuration_registry c
    JOIN pg_temp.expected_mobile_registry_seed x ON c.environment_name=x.environment_name
    WHERE c.is_enabled) <> 2 THEN
    RAISE EXCEPTION 'exact Android and iOS mobile registry rows were not seeded';
  END IF;
END $verify$;

COMMIT;
\echo 'Immutable Android and iOS mobile Google registry rows are present and exact.'
