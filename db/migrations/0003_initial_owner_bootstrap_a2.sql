\set ON_ERROR_STOP on

BEGIN;
SET LOCAL ROLE uptech_migration_owner;

-- Approved SCKP-001-A2 v0.1.0. This is deliberately limited to the
-- deployment-time first-Owner bootstrap consumed by the existing Web login.
CREATE TYPE uptech.initial_owner_bootstrap_status_v1 AS ENUM (
  'PENDING',
  'CONSUMED',
  'REVOKED',
  'EXPIRED'
);

ALTER TABLE uptech.workspace_domain_locators
  ADD CONSTRAINT workspace_domain_locators_domain_workspace_unique
  UNIQUE (normalized_domain, workspace_id);

CREATE TABLE uptech.initial_owner_bootstrap_intents (
  bootstrap_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  normalized_domain uptech.google_normalized_domain_v1 NOT NULL,
  normalized_target_email uptech.google_normalized_email_v1 NOT NULL,
  status uptech.initial_owner_bootstrap_status_v1 NOT NULL DEFAULT 'PENDING',
  deployment_change_id uuid NOT NULL,
  resolved_identity_id uuid,
  resolved_user_id uuid,
  resolved_membership_id uuid,
  verified_issuer uptech.google_auth_issuer_v1,
  verified_provider_subject uptech.google_provider_subject_v1,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  expired_at timestamptz,
  CONSTRAINT initial_owner_bootstrap_workspace_fk
    FOREIGN KEY (workspace_id)
    REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT,
  CONSTRAINT initial_owner_bootstrap_domain_workspace_fk
    FOREIGN KEY (normalized_domain, workspace_id)
    REFERENCES uptech.workspace_domain_locators (normalized_domain, workspace_id)
    ON DELETE RESTRICT,
  CONSTRAINT initial_owner_bootstrap_identity_user_fk
    FOREIGN KEY (resolved_identity_id, resolved_user_id)
    REFERENCES uptech.identities (id, user_id) ON DELETE RESTRICT,
  CONSTRAINT initial_owner_bootstrap_membership_user_fk
    FOREIGN KEY (workspace_id, resolved_membership_id, resolved_user_id)
    REFERENCES uptech.workspace_memberships (workspace_id, id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT initial_owner_bootstrap_expiry_check CHECK (
    expires_at > created_at
    AND expires_at <= created_at + interval '24 hours'
  ),
  CONSTRAINT initial_owner_bootstrap_email_domain_check CHECK (
    pg_catalog.split_part(normalized_target_email::text, '@', 2) =
      normalized_domain::text
  ),
  CONSTRAINT initial_owner_bootstrap_terminal_shape_check CHECK (
    (
      status = 'PENDING'
      AND consumed_at IS NULL AND revoked_at IS NULL AND expired_at IS NULL
      AND resolved_identity_id IS NULL AND resolved_user_id IS NULL
      AND resolved_membership_id IS NULL AND verified_issuer IS NULL
      AND verified_provider_subject IS NULL
    )
    OR (
      status = 'CONSUMED'
      AND consumed_at IS NOT NULL AND revoked_at IS NULL AND expired_at IS NULL
      AND resolved_identity_id IS NOT NULL AND resolved_user_id IS NOT NULL
      AND resolved_membership_id IS NOT NULL AND verified_issuer IS NOT NULL
      AND verified_provider_subject IS NOT NULL
    )
    OR (
      status = 'REVOKED'
      AND consumed_at IS NULL AND revoked_at IS NOT NULL AND expired_at IS NULL
      AND resolved_identity_id IS NULL AND resolved_user_id IS NULL
      AND resolved_membership_id IS NULL AND verified_issuer IS NULL
      AND verified_provider_subject IS NULL
    )
    OR (
      status = 'EXPIRED'
      AND consumed_at IS NULL AND revoked_at IS NULL AND expired_at IS NOT NULL
      AND resolved_identity_id IS NULL AND resolved_user_id IS NULL
      AND resolved_membership_id IS NULL AND verified_issuer IS NULL
      AND verified_provider_subject IS NULL
    )
  )
);

CREATE UNIQUE INDEX initial_owner_bootstrap_one_live_per_workspace
  ON uptech.initial_owner_bootstrap_intents (workspace_id)
  WHERE status = 'PENDING';

CREATE UNIQUE INDEX initial_owner_bootstrap_one_consumed_per_workspace
  ON uptech.initial_owner_bootstrap_intents (workspace_id)
  WHERE status = 'CONSUMED';

CREATE FUNCTION uptech.create_initial_owner_bootstrap_v1(
  p_bootstrap_id uuid,
  p_workspace_id uuid,
  p_normalized_domain uptech.google_normalized_domain_v1,
  p_normalized_target_email uptech.google_normalized_email_v1,
  p_expires_at timestamptz,
  p_deployment_change_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  observed_at timestamptz := pg_catalog.clock_timestamp();
  selected_workspace_status text;
  selected_domain_status uptech.google_workspace_domain_status_v1;
  stale_intent_id uuid;
BEGIN
  IF p_bootstrap_id IS NULL
     OR p_workspace_id IS NULL
     OR p_normalized_domain IS NULL
     OR p_normalized_target_email IS NULL
     OR p_expires_at IS NULL
     OR p_deployment_change_id IS NULL
     OR p_expires_at <= observed_at
     OR p_expires_at > observed_at + interval '24 hours'
     OR pg_catalog.split_part(p_normalized_target_email::text, '@', 2) <>
       p_normalized_domain::text THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023', MESSAGE = 'invalid initial owner bootstrap intent';
  END IF;

  SELECT workspace_row.status
  INTO selected_workspace_status
  FROM uptech.workspaces AS workspace_row
  WHERE workspace_row.workspace_id = p_workspace_id
  FOR UPDATE;

  SELECT locator.status
  INTO selected_domain_status
  FROM uptech.workspace_domain_locators AS locator
  WHERE locator.normalized_domain = p_normalized_domain
    AND locator.workspace_id = p_workspace_id
  FOR UPDATE;

  SELECT intent.bootstrap_id
  INTO stale_intent_id
  FROM uptech.initial_owner_bootstrap_intents AS intent
  WHERE intent.workspace_id = p_workspace_id
    AND intent.status = 'PENDING'
    AND intent.expires_at <= observed_at
  FOR UPDATE;

  IF stale_intent_id IS NOT NULL THEN
    UPDATE uptech.initial_owner_bootstrap_intents
    SET status = 'EXPIRED', expired_at = observed_at
    WHERE bootstrap_id = stale_intent_id AND status = 'PENDING';

    INSERT INTO uptech.platform_audit_events (
      id, action, target_type, outcome, request_id, metadata,
      occurred_at
    ) VALUES (
      pg_catalog.gen_random_uuid(), 'INITIAL_OWNER_BOOTSTRAP_EXPIRED',
      'INITIAL_OWNER_BOOTSTRAP', 'SUCCEEDED',
      p_deployment_change_id,
      pg_catalog.jsonb_build_object(
        'bootstrap_id', stale_intent_id,
        'workspace_id', p_workspace_id,
        'deployment_change_id', p_deployment_change_id
      ),
      observed_at
    );
  END IF;

  IF selected_workspace_status <> 'PENDING'
     OR selected_domain_status <> 'VERIFIED'
     OR EXISTS (
       SELECT 1 FROM uptech.workspace_memberships AS membership_row
       WHERE membership_row.workspace_id = p_workspace_id
     )
     OR EXISTS (
       SELECT 1 FROM uptech.initial_owner_bootstrap_intents AS intent
       WHERE intent.workspace_id = p_workspace_id
         AND intent.status = 'CONSUMED'
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000', MESSAGE = 'workspace is not bootstrap eligible';
  END IF;

  INSERT INTO uptech.initial_owner_bootstrap_intents (
    bootstrap_id, workspace_id, normalized_domain, normalized_target_email,
    status, deployment_change_id, created_at, expires_at
  ) VALUES (
    p_bootstrap_id, p_workspace_id, p_normalized_domain,
    p_normalized_target_email, 'PENDING', p_deployment_change_id,
    observed_at, p_expires_at
  );

  INSERT INTO uptech.platform_audit_events (
    id, action, target_type, outcome, request_id, metadata,
    occurred_at
  ) VALUES (
    pg_catalog.gen_random_uuid(), 'INITIAL_OWNER_BOOTSTRAP_CREATED',
    'INITIAL_OWNER_BOOTSTRAP', 'SUCCEEDED',
    p_deployment_change_id,
    pg_catalog.jsonb_build_object(
      'bootstrap_id', p_bootstrap_id,
      'workspace_id', p_workspace_id,
      'deployment_change_id', p_deployment_change_id
    ),
    observed_at
  );

  RETURN p_bootstrap_id;
END
$function$;

-- Preserve A1 as a private implementation. The public runtime boundary remains
-- the original complete_web_google_login_v1 signature below.
ALTER FUNCTION uptech.complete_web_google_login_v1(
  uptech.google_auth_hash32_v1,
  uptech.google_verified_claims_assertion_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uuid
) RENAME TO complete_web_google_login_a1_internal_v1;

REVOKE ALL ON FUNCTION uptech.complete_web_google_login_a1_internal_v1(
  uptech.google_auth_hash32_v1,
  uptech.google_verified_claims_assertion_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;

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
<<a2_completion>>
DECLARE
  observed_at timestamptz := pg_catalog.clock_timestamp();
  selected_transaction uptech.oauth_transactions%ROWTYPE;
  bound_configuration uptech.google_auth_configuration_registry%ROWTYPE;
  selected_workspace_status text;
  selected_domain_status uptech.google_workspace_domain_status_v1;
  selected_workspace_id uuid;
  selected_workspace_security_version bigint;
  selected_bootstrap uptech.initial_owner_bootstrap_intents%ROWTYPE;
  existing_relevant_bootstrap boolean := false;
  resolved_identity_id uuid;
  resolved_user_id uuid;
  resolved_user_status text;
  resolved_user_security_version bigint;
  resolved_identity_status text;
  resolved_identity_security_version bigint;
  resolved_membership_id uuid;
  resolved_session_id uuid;
  completion_result uptech.google_login_completion_result_v1;
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
    AND configuration_row.configuration_key = selected_transaction.configuration_key
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
    RETURN uptech.complete_web_google_login_a1_internal_v1(
      p_completion_handle_hash, p_claims, p_session_token_hash,
      p_csrf_token_hash, p_onboarding_token_hash, p_request_id
    );
  END IF;

  SELECT locator.workspace_id, locator.status
  INTO selected_workspace_id, selected_domain_status
  FROM uptech.workspace_domain_locators AS locator
  WHERE locator.normalized_domain = (p_claims).normalized_hosted_domain
  FOR UPDATE;

  IF selected_workspace_id IS NULL OR selected_domain_status <> 'VERIFIED' THEN
    RETURN uptech.complete_web_google_login_a1_internal_v1(
      p_completion_handle_hash, p_claims, p_session_token_hash,
      p_csrf_token_hash, p_onboarding_token_hash, p_request_id
    );
  END IF;

  SELECT workspace_row.status, workspace_row.security_version
  INTO selected_workspace_status, selected_workspace_security_version
  FROM uptech.workspaces AS workspace_row
  WHERE workspace_row.workspace_id = selected_workspace_id
  FOR UPDATE;

  SELECT EXISTS (
    SELECT 1
    FROM uptech.initial_owner_bootstrap_intents AS intent
    WHERE intent.workspace_id = selected_workspace_id
  ) INTO existing_relevant_bootstrap;

  SELECT intent.*
  INTO selected_bootstrap
  FROM uptech.initial_owner_bootstrap_intents AS intent
  WHERE intent.workspace_id = selected_workspace_id
    AND intent.normalized_domain = (p_claims).normalized_hosted_domain
    AND intent.normalized_target_email = (p_claims).normalized_email
    AND intent.status = 'PENDING'
  FOR UPDATE;

  IF selected_workspace_status <> 'PENDING'
     OR selected_bootstrap.bootstrap_id IS NULL THEN
    IF selected_workspace_status = 'PENDING' AND existing_relevant_bootstrap THEN
      UPDATE uptech.oauth_transactions
      SET status = 'REJECTED', rejected_at = observed_at
      WHERE id = selected_transaction.id
        AND status = 'EXCHANGE_RESERVED'
        AND completion_expires_at > observed_at;
      RETURN ROW(
        'DENIED'::uptech.google_login_completion_outcome_v1,
        NULL::text[], NULL::timestamptz
      )::uptech.google_login_completion_result_v1;
    END IF;

    RETURN uptech.complete_web_google_login_a1_internal_v1(
      p_completion_handle_hash, p_claims, p_session_token_hash,
      p_csrf_token_hash, p_onboarding_token_hash, p_request_id
    );
  END IF;

  IF selected_bootstrap.expires_at <= observed_at THEN
    UPDATE uptech.initial_owner_bootstrap_intents
    SET status = 'EXPIRED', expired_at = observed_at
    WHERE bootstrap_id = selected_bootstrap.bootstrap_id
      AND status = 'PENDING';

    INSERT INTO uptech.platform_audit_events (
      id, action, target_type, outcome, request_id, metadata,
      occurred_at
    ) VALUES (
      pg_catalog.gen_random_uuid(), 'INITIAL_OWNER_BOOTSTRAP_EXPIRED',
      'INITIAL_OWNER_BOOTSTRAP', 'SUCCEEDED', p_request_id,
      pg_catalog.jsonb_build_object(
        'bootstrap_id', selected_bootstrap.bootstrap_id,
        'workspace_id', selected_workspace_id
      ),
      observed_at
    );

    UPDATE uptech.oauth_transactions
    SET status = 'REJECTED', rejected_at = observed_at
    WHERE id = selected_transaction.id
      AND status = 'EXCHANGE_RESERVED'
      AND completion_expires_at > observed_at;

    RETURN ROW(
      'DENIED'::uptech.google_login_completion_outcome_v1,
      NULL::text[], NULL::timestamptz
    )::uptech.google_login_completion_result_v1;
  END IF;

  IF EXISTS (
       SELECT 1 FROM uptech.workspace_memberships AS membership_row
       WHERE membership_row.workspace_id = selected_workspace_id
     )
     OR EXISTS (
       SELECT 1 FROM uptech.initial_owner_bootstrap_intents AS intent
       WHERE intent.workspace_id = selected_workspace_id
         AND intent.status = 'CONSUMED'
     )
     OR EXISTS (
       SELECT 1 FROM uptech.identities AS identity_row
       WHERE identity_row.provider = 'GOOGLE'
         AND identity_row.email_claim = (p_claims).normalized_email::text
         AND (
           identity_row.issuer <> (p_claims).issuer::text
           OR identity_row.provider_subject <> (p_claims).provider_subject::text
         )
     ) THEN
    UPDATE uptech.oauth_transactions
    SET status = 'REJECTED', rejected_at = observed_at
    WHERE id = selected_transaction.id
      AND status = 'EXCHANGE_RESERVED'
      AND completion_expires_at > observed_at;
    RETURN ROW(
      'DENIED'::uptech.google_login_completion_outcome_v1,
      NULL::text[], NULL::timestamptz
    )::uptech.google_login_completion_result_v1;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      (p_claims).issuer::text || pg_catalog.chr(31) ||
        (p_claims).provider_subject::text,
      0
    )
  );

  SELECT identity_row.id, identity_row.user_id, user_row.status,
    user_row.security_version, identity_row.status,
    identity_row.security_version
  INTO resolved_identity_id, resolved_user_id, resolved_user_status,
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

    INSERT INTO uptech.users (id, status, security_version, created_at, updated_at)
    VALUES (resolved_user_id, 'ACTIVE', 1, observed_at, observed_at);

    INSERT INTO uptech.identities (
      id, user_id, provider, issuer, provider_subject, status,
      security_version, email_claim, email_verified, hosted_domain_claim,
      claims_observed_at, created_at, updated_at
    ) VALUES (
      resolved_identity_id, resolved_user_id, 'GOOGLE',
      (p_claims).issuer::text, (p_claims).provider_subject::text, 'ACTIVE',
      1, (p_claims).normalized_email::text, true,
      (p_claims).normalized_hosted_domain::text, observed_at, observed_at,
      observed_at
    );
  ELSIF resolved_user_status <> 'ACTIVE'
        OR resolved_identity_status <> 'ACTIVE' THEN
    UPDATE uptech.oauth_transactions
    SET status = 'REJECTED', rejected_at = observed_at
    WHERE id = selected_transaction.id
      AND status = 'EXCHANGE_RESERVED'
      AND completion_expires_at > observed_at;
    RETURN ROW(
      'DENIED'::uptech.google_login_completion_outcome_v1,
      NULL::text[], NULL::timestamptz
    )::uptech.google_login_completion_result_v1;
  ELSE
    UPDATE uptech.identities
    SET email_claim = (p_claims).normalized_email::text,
        email_verified = true,
        hosted_domain_claim = (p_claims).normalized_hosted_domain::text,
        claims_observed_at = observed_at,
        updated_at = observed_at
    WHERE id = resolved_identity_id;
  END IF;

  resolved_membership_id := pg_catalog.gen_random_uuid();
  INSERT INTO uptech.workspace_memberships (
    workspace_id, id, user_id, role, status, authz_version,
    created_at, updated_at
  ) VALUES (
    selected_workspace_id, resolved_membership_id, resolved_user_id,
    'OWNER', 'ACTIVE', 1, observed_at, observed_at
  );

  UPDATE uptech.workspaces
  SET status = 'ACTIVE', security_version = security_version + 1,
      updated_at = observed_at
  WHERE workspace_id = selected_workspace_id AND status = 'PENDING'
  RETURNING security_version INTO selected_workspace_security_version;
  IF selected_workspace_security_version IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PGA02', MESSAGE = 'initial owner workspace race lost';
  END IF;

  UPDATE uptech.initial_owner_bootstrap_intents
  SET status = 'CONSUMED', consumed_at = observed_at,
      resolved_identity_id = a2_completion.resolved_identity_id,
      resolved_user_id = a2_completion.resolved_user_id,
      resolved_membership_id = a2_completion.resolved_membership_id,
      verified_issuer = (p_claims).issuer,
      verified_provider_subject = (p_claims).provider_subject
  WHERE bootstrap_id = selected_bootstrap.bootstrap_id
    AND status = 'PENDING' AND expires_at > observed_at;
  GET DIAGNOSTICS transitioned_rows = ROW_COUNT;
  IF transitioned_rows <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PGA02', MESSAGE = 'initial owner intent race lost';
  END IF;

  completion_result := uptech.complete_web_google_login_a1_internal_v1(
    p_completion_handle_hash, p_claims, p_session_token_hash,
    p_csrf_token_hash, p_onboarding_token_hash, p_request_id
  );

  IF (completion_result).outcome <> 'NORMAL' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PGA02', MESSAGE = 'initial owner bootstrap completion failed';
  END IF;

  SELECT token_row.session_id
  INTO STRICT resolved_session_id
  FROM uptech.session_tokens AS token_row
  WHERE token_row.workspace_id = selected_workspace_id
    AND token_row.token_hash = p_session_token_hash
    AND token_row.token_kind = 'WEB_SESSION'
    AND token_row.token_status = 'CURRENT';

  INSERT INTO uptech.platform_audit_events (
    id, identity_id, action, target_type, outcome, request_id,
    metadata, occurred_at
  ) VALUES (
    pg_catalog.gen_random_uuid(), resolved_identity_id,
    'INITIAL_OWNER_BOOTSTRAP_CONSUMED', 'INITIAL_OWNER_BOOTSTRAP',
    'SUCCEEDED', p_request_id,
    pg_catalog.jsonb_build_object(
      'bootstrap_id', selected_bootstrap.bootstrap_id,
      'workspace_id', selected_workspace_id,
      'identity_id', resolved_identity_id,
      'membership_id', resolved_membership_id,
      'session_id', resolved_session_id
    ),
    observed_at
  );

  INSERT INTO uptech.audit_events (
    workspace_id, id, actor_kind, actor_id, membership_id, session_id,
    action, target_type, target_id, outcome, request_id, metadata, occurred_at
  ) VALUES (
    selected_workspace_id, pg_catalog.gen_random_uuid(), 'USER',
    resolved_user_id, resolved_membership_id, resolved_session_id,
    'INITIAL_OWNER_BOOTSTRAP_CONSUMED', 'INITIAL_OWNER_BOOTSTRAP',
    selected_bootstrap.bootstrap_id, 'SUCCEEDED', p_request_id,
    pg_catalog.jsonb_build_object(
      'bootstrap_id', selected_bootstrap.bootstrap_id,
      'workspace_id', selected_workspace_id,
      'identity_id', resolved_identity_id,
      'membership_id', resolved_membership_id,
      'session_id', resolved_session_id
    ),
    observed_at
  );

  RETURN completion_result;
EXCEPTION
  WHEN SQLSTATE 'PGA02' THEN
    RETURN ROW(
      'DENIED'::uptech.google_login_completion_outcome_v1,
      NULL::text[], NULL::timestamptz
    )::uptech.google_login_completion_result_v1;
END
$function$;

REVOKE ALL ON FUNCTION uptech.create_initial_owner_bootstrap_v1(
  uuid, uuid, uptech.google_normalized_domain_v1,
  uptech.google_normalized_email_v1, timestamptz, uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;

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

REVOKE ALL ON uptech.initial_owner_bootstrap_intents
FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE uptech_migration_owner IN SCHEMA uptech
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE uptech_migration_owner IN SCHEMA uptech
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMIT;
