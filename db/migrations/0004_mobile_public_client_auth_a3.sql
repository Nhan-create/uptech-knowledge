\set ON_ERROR_STOP on

BEGIN;
SET LOCAL ROLE uptech_migration_owner;

CREATE TYPE uptech.mobile_platform_v1 AS ENUM ('ANDROID', 'IOS');
CREATE TYPE uptech.mobile_transaction_status_v1 AS ENUM (
  'PENDING', 'EXCHANGE_RESERVED', 'COMPLETED', 'REJECTED'
);
CREATE TYPE uptech.mobile_handoff_status_v1 AS ENUM ('ACTIVE', 'CONSUMED', 'EXPIRED');
CREATE TYPE uptech.mobile_issue_outcome_v1 AS ENUM ('ISSUED', 'RATE_LIMITED', 'DENIED');
CREATE TYPE uptech.mobile_refresh_outcome_v1 AS ENUM (
  'ROTATED', 'REPLAY', 'FAMILY_REVOKED', 'SESSION_REVOKED', 'SESSION_EXPIRED', 'DENIED'
);
CREATE TYPE uptech.mobile_auth_outcome_v1 AS ENUM (
  'AUTHORIZED', 'DENIED', 'ACCESS_TOKEN_EXPIRED', 'SESSION_REVOKED', 'SESSION_EXPIRED'
);
CREATE TYPE uptech.mobile_rotation_outcome_v1 AS ENUM ('ROTATED', 'REPLAY', 'DENIED');
CREATE TYPE uptech.mobile_auth_ui_category_v1 AS ENUM (
  'PERSONAL_GOOGLE_ACCOUNT', 'UNKNOWN_WORKSPACE', 'USER_NOT_PROVISIONED',
  'USER_SUSPENDED', 'SESSION_REVOKED', 'SESSION_EXPIRED',
  'POLICY_OR_DEVICE_BLOCKED', 'OFFLINE', 'AUTH_ERROR'
);
CREATE TYPE uptech.mobile_invitation_status_v1 AS ENUM (
  'ACCEPTED', 'CONSUMED', 'REVOKED', 'EXPIRED'
);

CREATE TYPE uptech.mobile_google_consume_result_v1 AS (
  outcome uptech.google_login_consume_outcome_v1,
  platform uptech.mobile_platform_v1,
  configuration_key uptech.google_auth_ascii_identifier_v1,
  expected_nonce_hash uptech.google_auth_hash32_v1,
  pkce_envelope uptech.google_web_pkce_envelope_v1,
  pkce_kms_key_version uptech.google_auth_ascii_identifier_v1,
  pkce_associated_data bytea,
  completion_expires_at timestamptz
);
CREATE TYPE uptech.mobile_callback_result_v1 AS (
  outcome uptech.google_login_completion_outcome_v1,
  app_return_uri uptech.google_auth_https_uri_v1,
  denial_category uptech.mobile_auth_ui_category_v1
);
CREATE TYPE uptech.mobile_issue_result_v1 AS (
  outcome uptech.mobile_issue_outcome_v1,
  session_id uuid,
  access_expires_at timestamptz,
  refresh_expires_at timestamptz,
  active_workspace_id uuid,
  memberships jsonb
);
CREATE TYPE uptech.mobile_refresh_result_v1 AS (
  outcome uptech.mobile_refresh_outcome_v1,
  replay_capsule bytea,
  access_expires_at timestamptz,
  refresh_expires_at timestamptz
);
CREATE TYPE uptech.mobile_auth_result_v1 AS (
  outcome uptech.mobile_auth_outcome_v1,
  session_id uuid,
  user_id uuid,
  identity_id uuid,
  workspace_id uuid,
  membership_id uuid,
  workspace_role text
);
CREATE TYPE uptech.mobile_membership_list_result_v1 AS (
  outcome uptech.mobile_auth_outcome_v1,
  memberships jsonb
);
CREATE TYPE uptech.mobile_rotation_result_v1 AS (
  outcome uptech.mobile_rotation_outcome_v1,
  replay_capsule bytea,
  access_expires_at timestamptz,
  refresh_expires_at timestamptz
);

CREATE TABLE uptech.mobile_google_configuration_registry (
  environment_name uptech.google_auth_ascii_identifier_v1 NOT NULL,
  platform uptech.mobile_platform_v1 NOT NULL,
  configuration_key uptech.google_auth_ascii_identifier_v1 NOT NULL,
  google_client_id uptech.google_auth_client_identifier_v1 NOT NULL,
  google_audience uptech.google_auth_client_identifier_v1 NOT NULL,
  callback_uri uptech.google_auth_https_uri_v1 NOT NULL,
  app_return_uri uptech.google_auth_https_uri_v1 NOT NULL,
  scopes text[] NOT NULL,
  allowed_azp_configuration_keys uptech.google_auth_configuration_key_v1[] NOT NULL,
  pkce_kms_key_version uptech.google_auth_ascii_identifier_v1 NOT NULL,
  android_application_id uptech.google_auth_ascii_identifier_v1,
  android_release_cert_sha256 uptech.google_auth_ascii_identifier_v1,
  ios_bundle_id uptech.google_auth_ascii_identifier_v1,
  ios_team_id uptech.google_auth_ascii_identifier_v1,
  is_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (environment_name, platform),
  UNIQUE (configuration_key),
  FOREIGN KEY (environment_name)
    REFERENCES uptech.google_auth_environment_registry (environment_name)
    ON DELETE RESTRICT,
  CHECK (configuration_key IN ('GOOGLE_MOBILE_ANDROID_V1', 'GOOGLE_MOBILE_IOS_V1')),
  CHECK (callback_uri =
    'https://uptech-knowledge-sigma.vercel.app/api/v1/auth/mobile/google/callback'),
  CHECK (app_return_uri =
    'https://uptech-knowledge-sigma.vercel.app/auth/mobile/callback'),
  CHECK (scopes = ARRAY['openid', 'email', 'profile']::text[]),
  CHECK (cardinality(allowed_azp_configuration_keys) BETWEEN 1 AND 3),
  CHECK (
    (platform = 'ANDROID' AND configuration_key = 'GOOGLE_MOBILE_ANDROID_V1'
      AND android_application_id IS NOT NULL AND android_release_cert_sha256 IS NOT NULL
      AND ios_bundle_id IS NULL AND ios_team_id IS NULL) OR
    (platform = 'IOS' AND configuration_key = 'GOOGLE_MOBILE_IOS_V1'
      AND ios_bundle_id IS NOT NULL AND ios_team_id IS NOT NULL
      AND android_application_id IS NULL AND android_release_cert_sha256 IS NULL)
  )
);

CREATE TABLE uptech.mobile_google_transactions (
  id uuid PRIMARY KEY,
  environment_name uptech.google_auth_ascii_identifier_v1 NOT NULL,
  platform uptech.mobile_platform_v1 NOT NULL,
  configuration_key uptech.google_auth_ascii_identifier_v1 NOT NULL,
  state_hash uptech.google_auth_hash32_v1 NOT NULL UNIQUE,
  nonce_hash uptech.google_auth_hash32_v1 NOT NULL UNIQUE,
  installation_binding_hash uptech.google_auth_hash32_v1 NOT NULL,
  app_exchange_challenge uptech.google_auth_hash32_v1 NOT NULL,
  pkce_envelope uptech.google_web_pkce_envelope_v1 NOT NULL,
  pkce_kms_key_version uptech.google_auth_ascii_identifier_v1 NOT NULL,
  pkce_associated_data bytea NOT NULL,
  status uptech.mobile_transaction_status_v1 NOT NULL DEFAULT 'PENDING',
  completion_handle_hash uptech.google_auth_hash32_v1 UNIQUE,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  reserved_at timestamptz,
  completion_expires_at timestamptz,
  completed_at timestamptz,
  rejected_at timestamptz,
  FOREIGN KEY (environment_name, platform)
    REFERENCES uptech.mobile_google_configuration_registry (environment_name, platform)
    ON DELETE RESTRICT,
  CHECK (expires_at = created_at + interval '5 minutes'),
  CHECK (octet_length(pkce_associated_data) BETWEEN 1 AND 512),
  CHECK (
    (status = 'PENDING' AND completion_handle_hash IS NULL AND reserved_at IS NULL AND
      completion_expires_at IS NULL AND completed_at IS NULL AND rejected_at IS NULL) OR
    (status = 'EXCHANGE_RESERVED' AND completion_handle_hash IS NOT NULL AND
      completion_expires_at = reserved_at + interval '2 minutes' AND completed_at IS NULL AND rejected_at IS NULL) OR
    (status = 'COMPLETED' AND completed_at IS NOT NULL AND rejected_at IS NULL) OR
    (status = 'REJECTED' AND rejected_at IS NOT NULL AND completed_at IS NULL)
  )
);
CREATE INDEX mobile_google_transactions_expiry_idx
  ON uptech.mobile_google_transactions (expires_at);

CREATE TABLE uptech.mobile_handoffs (
  id uuid PRIMARY KEY,
  transaction_id uuid NOT NULL UNIQUE REFERENCES uptech.mobile_google_transactions (id),
  handoff_hash uptech.google_auth_hash32_v1 NOT NULL UNIQUE,
  platform uptech.mobile_platform_v1 NOT NULL,
  installation_binding_hash uptech.google_auth_hash32_v1 NOT NULL,
  app_exchange_challenge uptech.google_auth_hash32_v1 NOT NULL,
  identity_id uuid NOT NULL,
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  user_security_version bigint NOT NULL,
  identity_security_version bigint NOT NULL,
  workspace_security_version bigint NOT NULL,
  membership_authz_version bigint NOT NULL,
  status uptech.mobile_handoff_status_v1 NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  FOREIGN KEY (identity_id, user_id) REFERENCES uptech.identities (id, user_id),
  FOREIGN KEY (workspace_id, membership_id, user_id)
    REFERENCES uptech.workspace_memberships (workspace_id, id, user_id),
  CHECK (expires_at = created_at + interval '60 seconds'),
  CHECK ((status = 'ACTIVE' AND consumed_at IS NULL) OR
    (status = 'CONSUMED' AND consumed_at IS NOT NULL) OR status = 'EXPIRED')
);
CREATE INDEX mobile_handoffs_expiry_idx ON uptech.mobile_handoffs (expires_at);

CREATE TABLE uptech.mobile_refresh_replay_receipts (
  workspace_id uuid NOT NULL,
  session_id uuid NOT NULL,
  predecessor_refresh_hash uptech.google_auth_hash32_v1 NOT NULL,
  installation_binding_hash uptech.google_auth_hash32_v1 NOT NULL,
  idempotency_key uptech.google_auth_ascii_identifier_v1 NOT NULL,
  successor_access_hash uptech.google_auth_hash32_v1 NOT NULL,
  successor_refresh_hash uptech.google_auth_hash32_v1 NOT NULL,
  replay_capsule bytea NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, session_id, predecessor_refresh_hash),
  FOREIGN KEY (workspace_id, session_id)
    REFERENCES uptech.sessions (workspace_id, id),
  CHECK (octet_length(replay_capsule) = 115),
  CHECK (expires_at = created_at + interval '30 seconds')
);

CREATE TABLE uptech.mobile_workspace_switch_replay_receipts (
  predecessor_access_hash uptech.google_auth_hash32_v1 PRIMARY KEY,
  target_workspace_id uuid NOT NULL,
  successor_session_id uuid NOT NULL,
  installation_binding_hash uptech.google_auth_hash32_v1 NOT NULL,
  idempotency_key uptech.google_auth_ascii_identifier_v1 NOT NULL,
  successor_access_hash uptech.google_auth_hash32_v1 NOT NULL,
  successor_refresh_hash uptech.google_auth_hash32_v1 NOT NULL,
  replay_capsule bytea NOT NULL,
  access_expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (target_workspace_id,successor_session_id)
    REFERENCES uptech.sessions(workspace_id,id),
  CHECK (octet_length(replay_capsule)=115),
  CHECK (expires_at=created_at+interval '30 seconds')
);

-- Invitations reaching ACCEPTED have already proven their 256-bit token through
-- the shared invitation lifecycle. Mobile completion may only consume that
-- accepted, hash-only, unexpired authority after current Google claims match.
CREATE TABLE uptech.invitations (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  normalized_email uptech.google_normalized_email_v1 NOT NULL,
  token_hash uptech.google_auth_hash32_v1 NOT NULL UNIQUE,
  role text NOT NULL DEFAULT 'MEMBER',
  status uptech.mobile_invitation_status_v1 NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  consumed_at timestamptz,
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id) REFERENCES uptech.workspaces(workspace_id) ON DELETE RESTRICT,
  CHECK (role = 'MEMBER'),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '7 days'),
  CHECK ((status = 'ACCEPTED' AND accepted_at IS NOT NULL AND consumed_at IS NULL)
    OR (status = 'CONSUMED' AND accepted_at IS NOT NULL AND consumed_at IS NOT NULL)
    OR (status IN ('REVOKED','EXPIRED') AND consumed_at IS NULL))
);
CREATE UNIQUE INDEX invitations_one_accepted_email_idx
  ON uptech.invitations(workspace_id,normalized_email) WHERE status='ACCEPTED';

-- Refresh/switch receipts and invitations are workspace-owned state. They keep
-- the Phase 1 invariant even though runtime access is only through owner-bound
-- SECURITY DEFINER routines. Handoffs remain a short-lived pre-tenant opaque
-- secret store: they are selected by a 256-bit proof and have no direct grants.
ALTER TABLE uptech.mobile_refresh_replay_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.mobile_refresh_replay_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE uptech.mobile_workspace_switch_replay_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.mobile_workspace_switch_replay_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE uptech.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY mobile_refresh_replay_receipts_migration_owner
  ON uptech.mobile_refresh_replay_receipts TO uptech_migration_owner
  USING (true) WITH CHECK (true);
CREATE POLICY mobile_workspace_switch_replay_receipts_migration_owner
  ON uptech.mobile_workspace_switch_replay_receipts TO uptech_migration_owner
  USING (true) WITH CHECK (true);
CREATE POLICY invitations_migration_owner ON uptech.invitations
  TO uptech_migration_owner USING (true) WITH CHECK (true);

CREATE FUNCTION uptech.mobile_google_auth_admit_internal_v1(
  p_network_hmac uptech.google_auth_hash32_v1,
  p_request_id uuid
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path TO pg_catalog, uptech AS $function$
DECLARE
  now_at timestamptz := clock_timestamp();
  window_at timestamptz;
  env uptech.google_auth_ascii_identifier_v1;
  audit_key uptech.google_auth_hash32_v1;
  bucket_key uptech.google_auth_hash32_v1;
  limited boolean;
BEGIN
  SELECT environment_name, rate_limit_audit_hmac_key
  INTO STRICT env, audit_key
  FROM uptech.google_auth_environment_registry WHERE is_active;
  window_at := to_timestamp(floor(date_part('epoch', now_at) / 60) * 60);
  INSERT INTO uptech.google_auth_rate_limit_buckets(environment_name,bucket_scope,network_hmac,
    window_started_at,request_count,over_limit_observed,expires_at,updated_at)
  VALUES(env,'GOOGLE_AUTH',p_network_hmac,window_at,1,false,window_at+interval '1 minute',now_at)
  ON CONFLICT(environment_name,bucket_scope,network_hmac,window_started_at) DO UPDATE SET
    request_count=LEAST(10,uptech.google_auth_rate_limit_buckets.request_count+1),
    over_limit_observed=uptech.google_auth_rate_limit_buckets.over_limit_observed
      OR uptech.google_auth_rate_limit_buckets.request_count>=10,
    updated_at=now_at
  RETURNING over_limit_observed INTO limited;
  IF limited THEN
    bucket_key := uptech.google_auth_hmac_sha256_v1(audit_key,
      convert_to('UPTECH_GOOGLE_AUTH_RATE_LIMIT_AUDIT_V1','UTF8')
      || int8send(date_part('epoch',window_at)::bigint) || p_network_hmac);
    INSERT INTO uptech.platform_audit_events(id,action,target_type,outcome,request_id,metadata,
      occurred_at,google_auth_rate_limit_audit_key)
    VALUES(gen_random_uuid(),'GOOGLE_AUTH_RATE_LIMITED','GOOGLE_AUTH','DENIED',p_request_id,
      jsonb_build_object('bucket_scope','GOOGLE_AUTH'),now_at,bucket_key)
    ON CONFLICT (google_auth_rate_limit_audit_key)
      WHERE google_auth_rate_limit_audit_key IS NOT NULL DO NOTHING;
    RETURN false;
  END IF;
  RETURN true;
END $function$;

CREATE FUNCTION uptech.mobile_memberships_json_v1(p_user_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO pg_catalog, uptech AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'workspace_id', m.workspace_id, 'membership_id', m.id, 'role', m.role
  ) ORDER BY m.workspace_id), '[]'::jsonb)
  FROM uptech.workspace_memberships m JOIN uptech.workspaces w USING (workspace_id)
  WHERE m.user_id = p_user_id AND m.status = 'ACTIVE' AND w.status = 'ACTIVE'
$function$;

-- Typed mobile overload: admission uses the same GOOGLE_AUTH bucket.
CREATE FUNCTION uptech.begin_google_login_transaction_v1(
  p_platform uptech.mobile_platform_v1,
  p_network_hmac uptech.google_auth_hash32_v1,
  p_state_hash uptech.google_auth_hash32_v1,
  p_nonce_hash uptech.google_auth_hash32_v1,
  p_installation_binding_hash uptech.google_auth_hash32_v1,
  p_app_exchange_challenge uptech.google_auth_hash32_v1,
  p_pkce_envelope uptech.google_web_pkce_envelope_v1,
  p_request_id uuid
) RETURNS uptech.google_login_begin_result_v1
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO pg_catalog, uptech AS $function$
DECLARE
  now_at timestamptz := clock_timestamp(); env uptech.google_auth_ascii_identifier_v1;
  cfg uptech.mobile_google_configuration_registry%ROWTYPE;
  tx_id uuid := gen_random_uuid(); aad bytea;
BEGIN
  SELECT environment_name INTO STRICT env FROM uptech.google_auth_environment_registry WHERE is_active;
  IF NOT uptech.mobile_google_auth_admit_internal_v1(p_network_hmac,p_request_id) THEN
    RETURN ROW('RATE_LIMITED',NULL)::uptech.google_login_begin_result_v1;
  END IF;
  SELECT * INTO cfg FROM uptech.mobile_google_configuration_registry
    WHERE environment_name=env AND platform=p_platform AND is_enabled;
  IF cfg.configuration_key IS NULL OR p_state_hash IS NULL OR p_nonce_hash IS NULL OR
     p_installation_binding_hash IS NULL OR p_app_exchange_challenge IS NULL OR
     p_request_id IS NULL OR (p_pkce_envelope).envelope_version <> 1 THEN
    INSERT INTO uptech.platform_audit_events(id,action,target_type,outcome,request_id,metadata,occurred_at)
    VALUES(gen_random_uuid(),'MOBILE_GOOGLE_AUTH_REJECTED','GOOGLE_AUTH_TRANSACTION','DENIED',
      p_request_id,jsonb_build_object('platform',p_platform,'rejection_class','PROTOCOL_INVALID'),now_at);
    RETURN ROW('DENIED',NULL)::uptech.google_login_begin_result_v1;
  END IF;
  aad := convert_to(env::text||chr(31)||p_platform::text||chr(31)||cfg.configuration_key::text||chr(31)||encode(p_state_hash,'hex'),'UTF8');
  INSERT INTO uptech.mobile_google_transactions(id,environment_name,platform,configuration_key,
    state_hash,nonce_hash,installation_binding_hash,app_exchange_challenge,pkce_envelope,
    pkce_kms_key_version,pkce_associated_data,request_id,created_at,expires_at)
  VALUES(tx_id,env,p_platform,cfg.configuration_key,p_state_hash,p_nonce_hash,
    p_installation_binding_hash,p_app_exchange_challenge,p_pkce_envelope,cfg.pkce_kms_key_version,
    aad,p_request_id,now_at,now_at+interval '5 minutes');
  RETURN ROW('CREATED',now_at+interval '5 minutes')::uptech.google_login_begin_result_v1;
EXCEPTION WHEN unique_violation OR no_data_found THEN
  RETURN ROW('DENIED',NULL)::uptech.google_login_begin_result_v1;
END $function$;

CREATE FUNCTION uptech.consume_google_login_transaction_v1(
  p_network_hmac uptech.google_auth_hash32_v1,
  p_state_hash uptech.google_auth_hash32_v1,
  p_completion_handle_hash uptech.google_auth_hash32_v1,
  p_request_id uuid
) RETURNS uptech.mobile_google_consume_result_v1
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO pg_catalog, uptech AS $function$
DECLARE now_at timestamptz:=clock_timestamp(); tx uptech.mobile_google_transactions%ROWTYPE;
BEGIN
  IF NOT uptech.mobile_google_auth_admit_internal_v1(p_network_hmac,p_request_id) THEN
    RETURN ROW('RATE_LIMITED',NULL,NULL,NULL,NULL,NULL,NULL,NULL)::uptech.mobile_google_consume_result_v1;
  END IF;
  SELECT * INTO tx FROM uptech.mobile_google_transactions WHERE state_hash=p_state_hash
    AND status='PENDING' FOR UPDATE;
  IF tx.id IS NULL OR tx.expires_at<=now_at OR p_completion_handle_hash IS NULL OR p_request_id IS NULL THEN
    INSERT INTO uptech.platform_audit_events(id,action,target_type,outcome,request_id,metadata,occurred_at)
    VALUES(gen_random_uuid(),'MOBILE_GOOGLE_AUTH_REJECTED','GOOGLE_AUTH_TRANSACTION','DENIED',
      p_request_id,jsonb_build_object('rejection_class','PROTOCOL_INVALID'),now_at);
    RETURN ROW('DENIED',NULL,NULL,NULL,NULL,NULL,NULL,NULL)::uptech.mobile_google_consume_result_v1;
  END IF;
  UPDATE uptech.mobile_google_transactions SET status='EXCHANGE_RESERVED',reserved_at=now_at,
    completion_handle_hash=p_completion_handle_hash,completion_expires_at=now_at+interval '2 minutes'
    WHERE id=tx.id AND status='PENDING';
  RETURN ROW('RESERVED',tx.platform,tx.configuration_key,tx.nonce_hash,tx.pkce_envelope,
    tx.pkce_kms_key_version,tx.pkce_associated_data,now_at+interval '2 minutes')::uptech.mobile_google_consume_result_v1;
EXCEPTION WHEN unique_violation THEN
  RETURN ROW('DENIED',NULL,NULL,NULL,NULL,NULL,NULL,NULL)::uptech.mobile_google_consume_result_v1;
END $function$;

CREATE FUNCTION uptech.complete_mobile_google_callback_v1(
  p_completion_handle_hash uptech.google_auth_hash32_v1,
  p_claims uptech.google_verified_claims_assertion_v1,
  p_handoff_hash uptech.google_auth_hash32_v1,
  p_request_id uuid
) RETURNS uptech.mobile_callback_result_v1
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO pg_catalog, uptech AS $function$
DECLARE now_at timestamptz:=clock_timestamp(); tx uptech.mobile_google_transactions%ROWTYPE;
  cfg uptech.mobile_google_configuration_registry%ROWTYPE; ident uptech.identities%ROWTYPE;
  usr uptech.users%ROWTYPE; mem uptech.workspace_memberships%ROWTYPE; ws uptech.workspaces%ROWTYPE;
  locator uptech.workspace_domain_locators%ROWTYPE; invitation uptech.invitations%ROWTYPE;
  insert_member boolean:=false; reactivate_member boolean:=false;
BEGIN
  SELECT * INTO tx FROM uptech.mobile_google_transactions WHERE completion_handle_hash=p_completion_handle_hash
    AND status='EXCHANGE_RESERVED' FOR UPDATE;
  SELECT * INTO cfg FROM uptech.mobile_google_configuration_registry WHERE environment_name=tx.environment_name
    AND platform=tx.platform AND configuration_key=tx.configuration_key AND is_enabled;
  IF tx.id IS NULL OR tx.completion_expires_at<=now_at OR cfg.configuration_key IS NULL OR
     p_handoff_hash IS NULL OR p_request_id IS NULL OR (p_claims).email_verified IS NOT TRUE OR
     (p_claims).normalized_hosted_domain IS NULL OR (p_claims).web_nonce_hash<>tx.nonce_hash OR
     (p_claims).expires_at<=now_at OR (p_claims).issued_at<now_at-interval '5 minutes' OR
     (p_claims).audience_configuration_key<>'GOOGLE_WEB_LOGIN_V1' OR
     ((p_claims).authorized_party_configuration_key IS NOT NULL AND NOT
       (p_claims).authorized_party_configuration_key=ANY(cfg.allowed_azp_configuration_keys)) THEN
    RETURN ROW('DENIED',NULL,'AUTH_ERROR')::uptech.mobile_callback_result_v1;
  END IF;

  SELECT * INTO locator FROM uptech.workspace_domain_locators
    WHERE normalized_domain=(p_claims).normalized_hosted_domain FOR SHARE;
  IF locator.workspace_id IS NULL OR locator.status<>'VERIFIED' THEN
    RETURN ROW('DENIED',NULL,'UNKNOWN_WORKSPACE')::uptech.mobile_callback_result_v1;
  END IF;
  SELECT * INTO ws FROM uptech.workspaces WHERE workspace_id=locator.workspace_id FOR UPDATE;
  IF ws.workspace_id IS NULL THEN
    RETURN ROW('DENIED',NULL,'UNKNOWN_WORKSPACE')::uptech.mobile_callback_result_v1;
  ELSIF ws.status<>'ACTIVE' THEN
    RETURN ROW('DENIED',NULL,'USER_SUSPENDED')::uptech.mobile_callback_result_v1;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    (p_claims).issuer::text||pg_catalog.chr(31)||(p_claims).provider_subject::text,0));
  SELECT * INTO ident FROM uptech.identities WHERE provider='GOOGLE' AND issuer=(p_claims).issuer::text
    AND provider_subject=(p_claims).provider_subject::text FOR UPDATE;
  IF ident.id IS NOT NULL THEN
    SELECT * INTO usr FROM uptech.users WHERE id=ident.user_id FOR UPDATE;
    IF ident.status<>'ACTIVE' OR usr.status<>'ACTIVE' THEN
      RETURN ROW('DENIED',NULL,'USER_SUSPENDED')::uptech.mobile_callback_result_v1;
    END IF;
    UPDATE uptech.identities SET email_claim=(p_claims).normalized_email::text,
      email_verified=true,hosted_domain_claim=(p_claims).normalized_hosted_domain::text,
      claims_observed_at=now_at,updated_at=now_at WHERE id=ident.id;
    SELECT * INTO mem FROM uptech.workspace_memberships
      WHERE workspace_id=ws.workspace_id AND user_id=usr.id FOR UPDATE;
    IF mem.id IS NOT NULL AND mem.status='SUSPENDED' THEN
      RETURN ROW('DENIED',NULL,'USER_SUSPENDED')::uptech.mobile_callback_result_v1;
    END IF;
  END IF;

  IF mem.id IS NULL OR mem.status<>'ACTIVE' THEN
    IF ws.provisioning_policy='GOOGLE_GROUP_CONTROLLED' THEN
      RETURN ROW('DENIED',NULL,'POLICY_OR_DEVICE_BLOCKED')::uptech.mobile_callback_result_v1;
    END IF;
    SELECT * INTO invitation FROM uptech.invitations
      WHERE workspace_id=ws.workspace_id AND normalized_email=(p_claims).normalized_email
        AND role='MEMBER' AND status='ACCEPTED' AND expires_at>now_at
      FOR UPDATE;
    IF ws.provisioning_policy<>'DOMAIN_AUTO_PROVISION' AND invitation.id IS NULL THEN
      RETURN ROW('DENIED',NULL,'USER_NOT_PROVISIONED')::uptech.mobile_callback_result_v1;
    END IF;
    IF ident.id IS NULL THEN
      usr.id:=gen_random_uuid(); ident.id:=gen_random_uuid();
      usr.security_version:=1; ident.security_version:=1;
      INSERT INTO uptech.users(id,status,security_version,created_at,updated_at)
        VALUES(usr.id,'ACTIVE',1,now_at,now_at);
      INSERT INTO uptech.identities(id,user_id,provider,issuer,provider_subject,status,
        security_version,email_claim,email_verified,hosted_domain_claim,claims_observed_at,created_at,updated_at)
      VALUES(ident.id,usr.id,'GOOGLE',(p_claims).issuer::text,(p_claims).provider_subject::text,
        'ACTIVE',1,(p_claims).normalized_email::text,true,(p_claims).normalized_hosted_domain::text,
        now_at,now_at,now_at);
    END IF;
    IF mem.id IS NULL THEN
      mem.id:=gen_random_uuid(); mem.role:='MEMBER'; mem.status:='ACTIVE'; mem.authz_version:=1;
      INSERT INTO uptech.workspace_memberships(workspace_id,id,user_id,role,status,authz_version,created_at,updated_at)
      VALUES(ws.workspace_id,mem.id,usr.id,'MEMBER','ACTIVE',1,now_at,now_at);
      insert_member:=true;
    ELSIF mem.role='MEMBER' AND mem.status IN ('PENDING','DEPROVISIONED') THEN
      UPDATE uptech.workspace_memberships SET status='ACTIVE',authz_version=authz_version+1,updated_at=now_at
        WHERE workspace_id=ws.workspace_id AND id=mem.id RETURNING * INTO mem;
      reactivate_member:=true;
    ELSE
      RETURN ROW('DENIED',NULL,'USER_NOT_PROVISIONED')::uptech.mobile_callback_result_v1;
    END IF;
    IF invitation.id IS NOT NULL THEN
      UPDATE uptech.invitations SET status='CONSUMED',consumed_at=now_at
        WHERE workspace_id=invitation.workspace_id AND id=invitation.id AND status='ACCEPTED';
      INSERT INTO uptech.audit_events(workspace_id,id,actor_kind,actor_id,membership_id,action,
        target_type,target_id,outcome,request_id,metadata,occurred_at)
      VALUES(ws.workspace_id,gen_random_uuid(),'SYSTEM',NULL,NULL,'INVITATION_CONSUMED',
        'INVITATION',invitation.id,'SUCCEEDED',p_request_id,'{}',now_at);
    END IF;
    IF insert_member OR reactivate_member THEN
      INSERT INTO uptech.audit_events(workspace_id,id,actor_kind,actor_id,membership_id,action,
        target_type,target_id,outcome,request_id,metadata,occurred_at)
      VALUES(ws.workspace_id,gen_random_uuid(),'SYSTEM',NULL,NULL,'MEMBERSHIP_PROVISIONED',
        'WORKSPACE_MEMBERSHIP',mem.id,'SUCCEEDED',p_request_id,'{}',now_at);
    END IF;
  END IF;
  INSERT INTO uptech.mobile_handoffs(id,transaction_id,handoff_hash,platform,
    installation_binding_hash,app_exchange_challenge,identity_id,user_id,workspace_id,membership_id,
    user_security_version,identity_security_version,workspace_security_version,membership_authz_version,
    created_at,expires_at)
  VALUES(gen_random_uuid(),tx.id,p_handoff_hash,tx.platform,tx.installation_binding_hash,
    tx.app_exchange_challenge,ident.id,usr.id,ws.workspace_id,mem.id,usr.security_version,
    ident.security_version,ws.security_version,mem.authz_version,now_at,now_at+interval '60 seconds');
  UPDATE uptech.mobile_google_transactions SET status='COMPLETED',completed_at=now_at WHERE id=tx.id;
  INSERT INTO uptech.platform_audit_events(id,identity_id,action,target_type,outcome,request_id,metadata,occurred_at)
    VALUES(gen_random_uuid(),ident.id,'MOBILE_GOOGLE_HANDOFF_CREATED','MOBILE_HANDOFF','SUCCEEDED',
      p_request_id,jsonb_build_object('correlation_id',tx.id,'platform',tx.platform),now_at);
  RETURN ROW('NORMAL',cfg.app_return_uri,NULL)::uptech.mobile_callback_result_v1;
END $function$;

CREATE FUNCTION uptech.exchange_mobile_handoff_v1(
  p_network_hmac uptech.google_auth_hash32_v1,
  p_handoff_hash uptech.google_auth_hash32_v1,
  p_app_exchange_challenge uptech.google_auth_hash32_v1,
  p_installation_binding_hash uptech.google_auth_hash32_v1,
  p_access_hash uptech.google_auth_hash32_v1,
  p_refresh_hash uptech.google_auth_hash32_v1,
  p_request_id uuid
) RETURNS uptech.mobile_issue_result_v1
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO pg_catalog, uptech AS $function$
DECLARE now_at timestamptz:=clock_timestamp(); h uptech.mobile_handoffs%ROWTYPE;
  session_id uuid:=gen_random_uuid(); access_id uuid:=gen_random_uuid(); refresh_id uuid:=gen_random_uuid();
  access_exp timestamptz:=now_at+interval '15 minutes'; refresh_exp timestamptz:=now_at+interval '30 days';
BEGIN
  IF NOT uptech.mobile_google_auth_admit_internal_v1(p_network_hmac,p_request_id) THEN
    RETURN ROW('RATE_LIMITED',NULL,NULL,NULL,NULL,NULL)::uptech.mobile_issue_result_v1;
  END IF;
  SELECT * INTO h FROM uptech.mobile_handoffs WHERE handoff_hash=p_handoff_hash AND status='ACTIVE' FOR UPDATE;
  IF h.id IS NULL OR h.expires_at<=now_at OR h.app_exchange_challenge<>p_app_exchange_challenge OR
     h.installation_binding_hash<>p_installation_binding_hash OR p_request_id IS NULL OR NOT EXISTS(
       SELECT 1 FROM uptech.identities i JOIN uptech.users u ON u.id=i.user_id
       JOIN uptech.workspace_memberships m ON m.workspace_id=h.workspace_id AND m.id=h.membership_id AND m.user_id=u.id
       JOIN uptech.workspaces w ON w.workspace_id=m.workspace_id
       WHERE i.id=h.identity_id AND i.status='ACTIVE' AND u.status='ACTIVE' AND m.status='ACTIVE' AND w.status='ACTIVE'
       AND i.security_version=h.identity_security_version AND u.security_version=h.user_security_version
       AND m.authz_version=h.membership_authz_version AND w.security_version=h.workspace_security_version
     ) THEN
    INSERT INTO uptech.platform_audit_events(id,action,target_type,outcome,request_id,metadata,occurred_at)
    VALUES(gen_random_uuid(),'MOBILE_HANDOFF_EXCHANGE_REJECTED','MOBILE_HANDOFF','DENIED',
      p_request_id,jsonb_build_object('rejection_class','PROTOCOL_INVALID'),now_at);
    RETURN ROW('DENIED',NULL,NULL,NULL,NULL,NULL)::uptech.mobile_issue_result_v1;
  END IF;
  UPDATE uptech.mobile_handoffs SET status='CONSUMED',consumed_at=now_at WHERE id=h.id AND status='ACTIVE';
  INSERT INTO uptech.sessions(workspace_id,id,identity_id,user_id,membership_id,client_type,status,
    user_security_version,identity_security_version,workspace_security_version,membership_authz_version,
    device_binding_hash,created_at,last_seen_at,idle_expires_at,absolute_expires_at)
  VALUES(h.workspace_id,session_id,h.identity_id,h.user_id,h.membership_id,'NATIVE','ACTIVE',
    h.user_security_version,h.identity_security_version,h.workspace_security_version,h.membership_authz_version,
    h.installation_binding_hash,now_at,now_at,now_at+interval '7 days',refresh_exp);
  INSERT INTO uptech.session_tokens(workspace_id,id,session_id,client_type,token_kind,token_hash,
    session_security_version,rotation_version,issued_at,expires_at)
  VALUES(h.workspace_id,access_id,session_id,'NATIVE','NATIVE_ACCESS',p_access_hash,1,1,now_at,access_exp),
        (h.workspace_id,refresh_id,session_id,'NATIVE','NATIVE_REFRESH',p_refresh_hash,1,1,now_at,refresh_exp);
  INSERT INTO uptech.audit_events(workspace_id,id,actor_kind,actor_id,membership_id,session_id,action,
    target_type,target_id,outcome,request_id,metadata,occurred_at)
  VALUES(h.workspace_id,gen_random_uuid(),'USER',h.user_id,h.membership_id,session_id,
    'MOBILE_SESSION_ISSUED','SESSION',session_id,'SUCCEEDED',p_request_id,'{}',now_at);
  INSERT INTO uptech.platform_audit_events(id,identity_id,action,target_type,outcome,request_id,metadata,occurred_at)
  VALUES(gen_random_uuid(),h.identity_id,'MOBILE_SESSION_ISSUED','SESSION','SUCCEEDED',p_request_id,
    jsonb_build_object('session_id',session_id,'workspace_id',h.workspace_id),now_at);
  RETURN ROW('ISSUED',session_id,access_exp,refresh_exp,h.workspace_id,
    uptech.mobile_memberships_json_v1(h.user_id))::uptech.mobile_issue_result_v1;
EXCEPTION WHEN unique_violation THEN
  RETURN ROW('DENIED',NULL,NULL,NULL,NULL,NULL)::uptech.mobile_issue_result_v1;
END $function$;

CREATE FUNCTION uptech.authenticate_mobile_access_v1(p_access_hash uptech.google_auth_hash32_v1)
RETURNS uptech.mobile_auth_result_v1 LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO pg_catalog, uptech AS $function$
DECLARE now_at timestamptz:=clock_timestamp(); r record;
BEGIN
  SELECT s.*,m.role,m.status membership_status,
    t.session_security_version token_session_version,t.rotation_version token_rotation_version,
    t.token_status,t.expires_at token_expires_at,
    u.status user_status,i.status identity_status,w.status workspace_status,
    u.security_version current_user_version,i.security_version current_identity_version,
    w.security_version current_workspace_version,m.authz_version current_membership_version
  INTO r FROM uptech.session_tokens t JOIN uptech.sessions s ON s.workspace_id=t.workspace_id AND s.id=t.session_id
    JOIN uptech.users u ON u.id=s.user_id JOIN uptech.identities i ON i.id=s.identity_id
    JOIN uptech.workspaces w ON w.workspace_id=s.workspace_id
    JOIN uptech.workspace_memberships m ON m.workspace_id=s.workspace_id AND m.id=s.membership_id
  WHERE t.token_hash=p_access_hash AND t.token_kind='NATIVE_ACCESS' AND t.client_type='NATIVE'
    AND s.client_type='NATIVE' FOR UPDATE OF s;
  IF r.id IS NULL THEN
    RETURN ROW('SESSION_REVOKED',NULL,NULL,NULL,NULL,NULL,NULL)::uptech.mobile_auth_result_v1;
  ELSIF r.idle_expires_at<=now_at OR r.absolute_expires_at<=now_at THEN
    RETURN ROW('SESSION_EXPIRED',NULL,NULL,NULL,NULL,NULL,NULL)::uptech.mobile_auth_result_v1;
  ELSIF r.status<>'ACTIVE' OR r.user_status<>'ACTIVE' OR r.identity_status<>'ACTIVE' OR
     r.workspace_status<>'ACTIVE' OR r.membership_status<>'ACTIVE' OR
     r.token_status<>'CURRENT' OR
     r.token_session_version<>r.security_version OR r.token_rotation_version<>r.current_rotation_version OR
     r.current_user_version<>r.user_security_version OR
     r.current_identity_version<>r.identity_security_version OR r.current_workspace_version<>r.workspace_security_version OR
     r.current_membership_version<>r.membership_authz_version THEN
    RETURN ROW('SESSION_REVOKED',NULL,NULL,NULL,NULL,NULL,NULL)::uptech.mobile_auth_result_v1;
  ELSIF r.token_expires_at<=now_at THEN
    RETURN ROW('ACCESS_TOKEN_EXPIRED',NULL,NULL,NULL,NULL,NULL,NULL)::uptech.mobile_auth_result_v1;
  END IF;
  RETURN ROW('AUTHORIZED',r.id,r.user_id,r.identity_id,r.workspace_id,r.membership_id,r.role)::uptech.mobile_auth_result_v1;
END $function$;

CREATE FUNCTION uptech.list_mobile_workspaces_v1(p_access_hash uptech.google_auth_hash32_v1)
RETURNS uptech.mobile_membership_list_result_v1
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO pg_catalog, uptech AS $function$
DECLARE auth uptech.mobile_auth_result_v1;
BEGIN auth:=uptech.authenticate_mobile_access_v1(p_access_hash);
  IF (auth).outcome<>'AUTHORIZED' THEN
    RETURN ROW((auth).outcome,NULL)::uptech.mobile_membership_list_result_v1;
  END IF;
  RETURN ROW('AUTHORIZED',uptech.mobile_memberships_json_v1((auth).user_id))
    ::uptech.mobile_membership_list_result_v1;
END $function$;

CREATE FUNCTION uptech.rotate_mobile_refresh_v1(
  p_predecessor_hash uptech.google_auth_hash32_v1,p_installation_hash uptech.google_auth_hash32_v1,
  p_access_hash uptech.google_auth_hash32_v1,p_refresh_hash uptech.google_auth_hash32_v1,
  p_replay_capsule bytea,p_idempotency_key uptech.google_auth_ascii_identifier_v1,p_request_id uuid
) RETURNS uptech.mobile_refresh_result_v1 LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO pg_catalog, uptech AS $function$
DECLARE now_at timestamptz:=clock_timestamp(); s uptech.sessions%ROWTYPE; t uptech.session_tokens%ROWTYPE;
  receipt uptech.mobile_refresh_replay_receipts%ROWTYPE; access_exp timestamptz:=now_at+interval '15 minutes';
  refresh_exp timestamptz; next_rotation bigint; current_state record; state_is_current boolean:=false;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RETURN ROW('DENIED',NULL,NULL,NULL)::uptech.mobile_refresh_result_v1;
  END IF;
  SELECT * INTO t FROM uptech.session_tokens WHERE token_hash=p_predecessor_hash AND token_kind='NATIVE_REFRESH' FOR UPDATE;
  SELECT * INTO s FROM uptech.sessions WHERE workspace_id=t.workspace_id AND id=t.session_id FOR UPDATE;
  SELECT u.status user_status,i.status identity_status,w.status workspace_status,m.status membership_status,
    u.security_version user_version,i.security_version identity_version,
    w.security_version workspace_version,m.authz_version membership_version
  INTO current_state FROM uptech.users u JOIN uptech.identities i ON i.id=s.identity_id AND i.user_id=u.id
    JOIN uptech.workspaces w ON w.workspace_id=s.workspace_id
    JOIN uptech.workspace_memberships m ON m.workspace_id=s.workspace_id AND m.id=s.membership_id AND m.user_id=s.user_id
  WHERE u.id=s.user_id;
  state_is_current := s.id IS NOT NULL AND s.client_type='NATIVE' AND s.status='ACTIVE'
    AND s.idle_expires_at>now_at AND s.absolute_expires_at>now_at
    AND current_state.user_status='ACTIVE' AND current_state.identity_status='ACTIVE'
    AND current_state.workspace_status='ACTIVE' AND current_state.membership_status='ACTIVE'
    AND current_state.user_version=s.user_security_version
    AND current_state.identity_version=s.identity_security_version
    AND current_state.workspace_version=s.workspace_security_version
    AND current_state.membership_version=s.membership_authz_version;
  SELECT * INTO receipt FROM uptech.mobile_refresh_replay_receipts WHERE workspace_id=t.workspace_id
    AND session_id=t.session_id AND predecessor_refresh_hash=p_predecessor_hash;
  IF receipt.session_id IS NOT NULL AND receipt.idempotency_key=p_idempotency_key AND
     receipt.installation_binding_hash=p_installation_hash AND receipt.expires_at>now_at
     AND state_is_current AND EXISTS(
       SELECT 1 FROM uptech.session_tokens successor
       WHERE successor.workspace_id=s.workspace_id AND successor.session_id=s.id
         AND successor.token_hash IN (receipt.successor_access_hash,receipt.successor_refresh_hash)
         AND successor.token_status='CURRENT' AND successor.expires_at>now_at
         AND successor.session_security_version=s.security_version
         AND successor.rotation_version=s.current_rotation_version
       GROUP BY successor.workspace_id,successor.session_id HAVING count(*)=2
     ) THEN
    RETURN ROW('REPLAY',receipt.replay_capsule,LEAST(receipt.created_at+interval '15 minutes',s.absolute_expires_at),
      s.absolute_expires_at)::uptech.mobile_refresh_result_v1;
  END IF;
  IF t.id IS NULL OR s.id IS NULL OR p_request_id IS NULL THEN
    RETURN ROW('SESSION_REVOKED',NULL,NULL,NULL)::uptech.mobile_refresh_result_v1;
  END IF;
  IF t.expires_at<=now_at OR s.idle_expires_at<=now_at OR s.absolute_expires_at<=now_at THEN
    UPDATE uptech.sessions SET status='REVOKED',revoked_at=now_at,
      revocation_reason='SESSION_EXPIRED',security_version=security_version+1
      WHERE workspace_id=s.workspace_id AND id=s.id AND status='ACTIVE';
    UPDATE uptech.session_tokens SET token_status='REVOKED',revoked_at=now_at,
      became_previous_at=NULL,previous_valid_until=NULL
      WHERE workspace_id=s.workspace_id AND session_id=s.id AND token_status<>'REVOKED';
    INSERT INTO uptech.platform_audit_events(id,identity_id,action,target_type,outcome,request_id,metadata,occurred_at)
    VALUES(gen_random_uuid(),s.identity_id,'MOBILE_SESSION_EXPIRED','SESSION','DENIED',p_request_id,
      jsonb_build_object('session_id',s.id,'workspace_id',s.workspace_id),now_at);
    INSERT INTO uptech.audit_events(workspace_id,id,actor_kind,actor_id,membership_id,session_id,
      action,target_type,target_id,outcome,request_id,metadata,occurred_at)
    VALUES(s.workspace_id,gen_random_uuid(),'USER',s.user_id,s.membership_id,s.id,
      'MOBILE_SESSION_EXPIRED','SESSION',s.id,'DENIED',p_request_id,'{}',now_at);
    RETURN ROW('SESSION_EXPIRED',NULL,NULL,NULL)::uptech.mobile_refresh_result_v1;
  END IF;
  IF t.token_status<>'CURRENT' OR NOT state_is_current OR
     t.client_type<>'NATIVE' OR t.session_security_version<>s.security_version OR
     t.rotation_version<>s.current_rotation_version OR s.device_binding_hash<>p_installation_hash OR
     p_access_hash IS NULL OR p_refresh_hash IS NULL OR p_replay_capsule IS NULL OR
     octet_length(p_replay_capsule)<>115 THEN
    IF s.id IS NOT NULL THEN UPDATE uptech.sessions SET status='REVOKED',revoked_at=now_at,
      revocation_reason=CASE WHEN t.token_status<>'CURRENT' THEN 'REFRESH_REUSE' ELSE 'SECURITY_STATE_CHANGED' END,
      security_version=security_version+1 WHERE workspace_id=s.workspace_id AND id=s.id AND status='ACTIVE';
      UPDATE uptech.session_tokens SET token_status='REVOKED',revoked_at=now_at,became_previous_at=NULL,previous_valid_until=NULL
        WHERE workspace_id=s.workspace_id AND session_id=s.id AND token_status<>'REVOKED';
      INSERT INTO uptech.platform_audit_events(id,identity_id,action,target_type,outcome,request_id,metadata,occurred_at)
      VALUES(gen_random_uuid(),s.identity_id,'MOBILE_REFRESH_FAMILY_REVOKED','SESSION','DENIED',p_request_id,
        jsonb_build_object('session_id',s.id,'workspace_id',s.workspace_id),now_at);
      INSERT INTO uptech.audit_events(workspace_id,id,actor_kind,actor_id,membership_id,session_id,
        action,target_type,target_id,outcome,request_id,metadata,occurred_at)
      VALUES(s.workspace_id,gen_random_uuid(),'USER',s.user_id,s.membership_id,s.id,
        'MOBILE_REFRESH_FAMILY_REVOKED','SESSION',s.id,'DENIED',p_request_id,'{}',now_at);
      RETURN ROW('FAMILY_REVOKED',NULL,NULL,NULL)::uptech.mobile_refresh_result_v1;
    END IF;
  END IF;
  next_rotation:=s.current_rotation_version+1; refresh_exp:=s.absolute_expires_at;
  access_exp:=LEAST(access_exp,s.absolute_expires_at);
  UPDATE uptech.session_tokens SET token_status='REVOKED',revoked_at=now_at WHERE workspace_id=s.workspace_id
    AND session_id=s.id AND token_status='CURRENT';
  INSERT INTO uptech.session_tokens(workspace_id,id,session_id,client_type,token_kind,token_hash,
    session_security_version,rotation_version,issued_at,expires_at)
  VALUES(s.workspace_id,gen_random_uuid(),s.id,'NATIVE','NATIVE_ACCESS',p_access_hash,s.security_version,next_rotation,now_at,access_exp),
        (s.workspace_id,gen_random_uuid(),s.id,'NATIVE','NATIVE_REFRESH',p_refresh_hash,s.security_version,next_rotation,now_at,refresh_exp);
  UPDATE uptech.sessions SET current_rotation_version=next_rotation,last_seen_at=now_at,
    idle_expires_at=LEAST(now_at+interval '7 days',absolute_expires_at) WHERE workspace_id=s.workspace_id AND id=s.id;
  INSERT INTO uptech.mobile_refresh_replay_receipts VALUES(s.workspace_id,s.id,p_predecessor_hash,
    p_installation_hash,p_idempotency_key,p_access_hash,p_refresh_hash,p_replay_capsule,now_at,now_at+interval '30 seconds');
  RETURN ROW('ROTATED',NULL,access_exp,refresh_exp)::uptech.mobile_refresh_result_v1;
END $function$;

CREATE FUNCTION uptech.switch_mobile_workspace_v1(
  p_access_hash uptech.google_auth_hash32_v1,p_target_workspace_id uuid,
  p_installation_hash uptech.google_auth_hash32_v1,p_new_access_hash uptech.google_auth_hash32_v1,
  p_new_refresh_hash uptech.google_auth_hash32_v1,p_replay_capsule bytea,
  p_idempotency_key uptech.google_auth_ascii_identifier_v1,p_request_id uuid
) RETURNS uptech.mobile_rotation_result_v1 LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO pg_catalog, uptech AS $function$
DECLARE now_at timestamptz:=clock_timestamp(); auth uptech.mobile_auth_result_v1; m uptech.workspace_memberships%ROWTYPE;
  old uptech.sessions%ROWTYPE; new_session uuid:=gen_random_uuid(); access_exp timestamptz:=now_at+interval '15 minutes';
  refresh_exp timestamptz; ws uptech.workspaces%ROWTYPE; source_ws uptech.workspaces%ROWTYPE;
  usr uptech.users%ROWTYPE; ident uptech.identities%ROWTYPE; source_mem uptech.workspace_memberships%ROWTYPE;
  receipt uptech.mobile_workspace_switch_replay_receipts%ROWTYPE;
BEGIN
  SELECT * INTO receipt FROM uptech.mobile_workspace_switch_replay_receipts
    WHERE predecessor_access_hash=p_access_hash FOR UPDATE;
  IF receipt.predecessor_access_hash IS NOT NULL THEN
    IF receipt.target_workspace_id=p_target_workspace_id
       AND receipt.installation_binding_hash=p_installation_hash
       AND receipt.idempotency_key=p_idempotency_key AND receipt.expires_at>now_at
       AND EXISTS(SELECT 1 FROM uptech.sessions replay_session
         JOIN uptech.users replay_user ON replay_user.id=replay_session.user_id
         JOIN uptech.identities replay_identity ON replay_identity.id=replay_session.identity_id
           AND replay_identity.user_id=replay_session.user_id
         JOIN uptech.workspaces replay_workspace ON replay_workspace.workspace_id=replay_session.workspace_id
         JOIN uptech.workspace_memberships replay_membership
           ON replay_membership.workspace_id=replay_session.workspace_id
           AND replay_membership.id=replay_session.membership_id
           AND replay_membership.user_id=replay_session.user_id
         WHERE replay_session.workspace_id=receipt.target_workspace_id
           AND replay_session.id=receipt.successor_session_id AND replay_session.status='ACTIVE'
           AND replay_session.idle_expires_at>now_at AND replay_session.absolute_expires_at>now_at
           AND replay_session.device_binding_hash=receipt.installation_binding_hash
           AND replay_user.status='ACTIVE' AND replay_identity.status='ACTIVE'
           AND replay_workspace.status='ACTIVE' AND replay_membership.status='ACTIVE'
           AND replay_user.security_version=replay_session.user_security_version
           AND replay_identity.security_version=replay_session.identity_security_version
           AND replay_workspace.security_version=replay_session.workspace_security_version
           AND replay_membership.authz_version=replay_session.membership_authz_version)
       AND (SELECT count(*) FROM uptech.session_tokens replay_token
         WHERE replay_token.workspace_id=receipt.target_workspace_id
           AND replay_token.session_id=receipt.successor_session_id
           AND replay_token.token_hash IN (receipt.successor_access_hash,receipt.successor_refresh_hash)
           AND replay_token.token_status='CURRENT' AND replay_token.expires_at>now_at)=2 THEN
      RETURN ROW('REPLAY',receipt.replay_capsule,receipt.access_expires_at,receipt.refresh_expires_at)
        ::uptech.mobile_rotation_result_v1;
    END IF;
    RETURN ROW('DENIED',NULL,NULL,NULL)::uptech.mobile_rotation_result_v1;
  END IF;
  auth:=uptech.authenticate_mobile_access_v1(p_access_hash);
  IF (auth).outcome<>'AUTHORIZED' THEN RETURN ROW('DENIED',NULL,NULL,NULL)::uptech.mobile_rotation_result_v1; END IF;
  SELECT * INTO old FROM uptech.sessions WHERE workspace_id=(auth).workspace_id AND id=(auth).session_id FOR UPDATE;
  SELECT * INTO usr FROM uptech.users WHERE id=old.user_id FOR UPDATE;
  SELECT * INTO ident FROM uptech.identities WHERE id=old.identity_id AND user_id=old.user_id FOR UPDATE;
  SELECT * INTO source_ws FROM uptech.workspaces WHERE workspace_id=old.workspace_id FOR UPDATE;
  SELECT * INTO source_mem FROM uptech.workspace_memberships
    WHERE workspace_id=old.workspace_id AND id=old.membership_id AND user_id=old.user_id FOR UPDATE;
  SELECT * INTO m FROM uptech.workspace_memberships WHERE workspace_id=p_target_workspace_id
    AND user_id=(auth).user_id AND status='ACTIVE' FOR UPDATE;
  SELECT * INTO ws FROM uptech.workspaces WHERE workspace_id=p_target_workspace_id FOR UPDATE;
  IF m.id IS NULL OR ws.workspace_id IS NULL OR ws.status<>'ACTIVE' OR old.status<>'ACTIVE'
     OR old.idle_expires_at<=now_at OR old.absolute_expires_at<=now_at
     OR old.device_binding_hash<>p_installation_hash OR usr.status<>'ACTIVE' OR ident.status<>'ACTIVE'
     OR source_ws.status<>'ACTIVE' OR source_mem.status<>'ACTIVE'
     OR usr.security_version<>old.user_security_version
     OR ident.security_version<>old.identity_security_version
     OR source_ws.security_version<>old.workspace_security_version
     OR source_mem.authz_version<>old.membership_authz_version
     OR p_replay_capsule IS NULL OR octet_length(p_replay_capsule)<>115 OR p_idempotency_key IS NULL THEN
    RETURN ROW('DENIED',NULL,NULL,NULL)::uptech.mobile_rotation_result_v1; END IF;
  refresh_exp:=old.absolute_expires_at; access_exp:=LEAST(access_exp,refresh_exp);
  UPDATE uptech.sessions SET status='REVOKED',revoked_at=now_at,revocation_reason='WORKSPACE_SWITCH',security_version=security_version+1
    WHERE workspace_id=old.workspace_id AND id=old.id;
  UPDATE uptech.session_tokens SET token_status='REVOKED',revoked_at=now_at WHERE workspace_id=old.workspace_id
    AND session_id=old.id AND token_status<>'REVOKED';
  INSERT INTO uptech.sessions(workspace_id,id,identity_id,user_id,membership_id,client_type,status,user_security_version,
    identity_security_version,workspace_security_version,membership_authz_version,device_binding_hash,created_at,last_seen_at,
    idle_expires_at,absolute_expires_at)
  SELECT p_target_workspace_id,new_session,old.identity_id,old.user_id,m.id,'NATIVE','ACTIVE',u.security_version,
    i.security_version,ws.security_version,m.authz_version,p_installation_hash,now_at,now_at,
    LEAST(now_at+interval '7 days',refresh_exp),refresh_exp
    FROM uptech.users u JOIN uptech.identities i ON i.id=old.identity_id WHERE u.id=old.user_id;
  INSERT INTO uptech.session_tokens(workspace_id,id,session_id,client_type,token_kind,token_hash,session_security_version,
    rotation_version,issued_at,expires_at)
  VALUES(p_target_workspace_id,gen_random_uuid(),new_session,'NATIVE','NATIVE_ACCESS',p_new_access_hash,1,1,now_at,access_exp),
        (p_target_workspace_id,gen_random_uuid(),new_session,'NATIVE','NATIVE_REFRESH',p_new_refresh_hash,1,1,now_at,refresh_exp);
  INSERT INTO uptech.audit_events(workspace_id,id,actor_kind,actor_id,membership_id,session_id,
    action,target_type,target_id,outcome,request_id,metadata,occurred_at)
  VALUES(p_target_workspace_id,gen_random_uuid(),'USER',old.user_id,m.id,new_session,
    'MOBILE_WORKSPACE_SWITCHED','SESSION',new_session,'SUCCEEDED',p_request_id,'{}',now_at);
  INSERT INTO uptech.platform_audit_events(id,identity_id,action,target_type,outcome,request_id,metadata,occurred_at)
  VALUES(gen_random_uuid(),old.identity_id,'MOBILE_WORKSPACE_SWITCHED','SESSION','SUCCEEDED',p_request_id,
    jsonb_build_object('session_id',new_session,'workspace_id',p_target_workspace_id),now_at);
  INSERT INTO uptech.mobile_workspace_switch_replay_receipts VALUES(
    p_access_hash,p_target_workspace_id,new_session,p_installation_hash,p_idempotency_key,
    p_new_access_hash,p_new_refresh_hash,p_replay_capsule,access_exp,refresh_exp,now_at,now_at+interval '30 seconds');
  RETURN ROW('ROTATED',NULL,access_exp,refresh_exp)::uptech.mobile_rotation_result_v1;
END $function$;

CREATE FUNCTION uptech.revoke_mobile_session_v1(p_access_hash uptech.google_auth_hash32_v1,p_request_id uuid)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO pg_catalog, uptech AS $function$
DECLARE now_at timestamptz:=clock_timestamp(); auth uptech.mobile_auth_result_v1;
BEGIN auth:=uptech.authenticate_mobile_access_v1(p_access_hash);
  IF (auth).outcome<>'AUTHORIZED' THEN RETURN 'DENIED'; END IF;
  UPDATE uptech.sessions SET status='REVOKED',revoked_at=now_at,revocation_reason='USER_LOGOUT',security_version=security_version+1
    WHERE workspace_id=(auth).workspace_id AND id=(auth).session_id;
  UPDATE uptech.session_tokens SET token_status='REVOKED',revoked_at=now_at WHERE workspace_id=(auth).workspace_id
    AND session_id=(auth).session_id AND token_status<>'REVOKED';
  INSERT INTO uptech.audit_events(workspace_id,id,actor_kind,actor_id,membership_id,session_id,action,target_type,
    target_id,outcome,request_id,metadata,occurred_at)
  VALUES((auth).workspace_id,gen_random_uuid(),'USER',(auth).user_id,(auth).membership_id,(auth).session_id,
    'MOBILE_SESSION_REVOKED','SESSION',(auth).session_id,'SUCCEEDED',p_request_id,'{}',now_at);
  RETURN 'REVOKED';
END $function$;

CREATE FUNCTION uptech.record_google_login_rejection_v1(
  p_platform uptech.mobile_platform_v1,p_network_hmac uptech.google_auth_hash32_v1,
  p_completion_handle_hash uptech.google_auth_hash32_v1,
  p_rejection_class uptech.google_auth_rejection_class_v1,p_request_id uuid
) RETURNS uptech.google_login_rejection_outcome_v1 LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO pg_catalog, uptech AS $function$
DECLARE now_at timestamptz:=clock_timestamp(); tx uptech.mobile_google_transactions%ROWTYPE;
BEGIN
  IF p_completion_handle_hash IS NULL AND
     NOT uptech.mobile_google_auth_admit_internal_v1(p_network_hmac,p_request_id) THEN
    RETURN 'RATE_LIMITED';
  END IF;
  IF p_completion_handle_hash IS NOT NULL THEN
    SELECT * INTO tx FROM uptech.mobile_google_transactions
      WHERE completion_handle_hash=p_completion_handle_hash AND status='EXCHANGE_RESERVED' FOR UPDATE;
    IF tx.id IS NOT NULL THEN
      UPDATE uptech.mobile_google_transactions SET status='REJECTED',rejected_at=now_at
        WHERE id=tx.id AND status='EXCHANGE_RESERVED';
    END IF;
  END IF;
  INSERT INTO uptech.platform_audit_events(id,action,target_type,outcome,request_id,metadata)
  VALUES(gen_random_uuid(),'MOBILE_GOOGLE_AUTH_REJECTED','GOOGLE_AUTH_TRANSACTION','DENIED',p_request_id,
    jsonb_strip_nulls(jsonb_build_object('platform',p_platform,'rejection_class',p_rejection_class,
      'correlation_id',tx.id)));
  RETURN 'RECORDED';
END $function$;

REVOKE ALL ON FUNCTION uptech.mobile_memberships_json_v1(uuid) FROM PUBLIC,uptech_api_runtime,uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.mobile_google_auth_admit_internal_v1(
  uptech.google_auth_hash32_v1,uuid
) FROM PUBLIC,uptech_api_runtime,uptech_worker_runtime;

DO $grants$
DECLARE signature regprocedure;
BEGIN
  FOR signature IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='uptech' AND p.proname IN (
      'begin_google_login_transaction_v1','consume_google_login_transaction_v1',
      'complete_mobile_google_callback_v1','exchange_mobile_handoff_v1',
      'record_google_login_rejection_v1','rotate_mobile_refresh_v1','authenticate_mobile_access_v1',
      'list_mobile_workspaces_v1','switch_mobile_workspace_v1','revoke_mobile_session_v1'
    ) AND pg_get_userbyid(p.proowner)='uptech_migration_owner'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime',signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO uptech_api_runtime',signature);
  END LOOP;
END $grants$;

REVOKE ALL ON uptech.mobile_google_configuration_registry,uptech.mobile_google_transactions,
  uptech.mobile_handoffs,uptech.mobile_refresh_replay_receipts,
  uptech.mobile_workspace_switch_replay_receipts,uptech.invitations
FROM PUBLIC,uptech_api_runtime,uptech_worker_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE uptech_migration_owner IN SCHEMA uptech
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE uptech_migration_owner IN SCHEMA uptech
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMIT;
