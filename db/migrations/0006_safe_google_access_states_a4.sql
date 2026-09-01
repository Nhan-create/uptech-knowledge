\set ON_ERROR_STOP on

BEGIN;
SET LOCAL ROLE uptech_migration_owner;

DO $types$
BEGIN
  IF pg_catalog.to_regtype('uptech.google_login_access_state_v1') IS NULL THEN
    CREATE TYPE uptech.google_login_access_state_v1 AS ENUM (
      'UNKNOWN_WORKSPACE',
      'USER_NOT_PROVISIONED',
      'USER_SUSPENDED',
      'WORKSPACE_SUSPENDED'
    );
  END IF;
  IF pg_catalog.to_regtype('uptech.google_login_completion_result_v2') IS NULL THEN
    CREATE TYPE uptech.google_login_completion_result_v2 AS (
      outcome uptech.google_login_completion_outcome_v1,
      access_state uptech.google_login_access_state_v1,
      allowed_operations text[],
      expires_at timestamptz
    );
  END IF;
END
$types$;

-- Google documents two issuer spellings for the same subject namespace. Store
-- one canonical spelling so issuer + sub remains a single immutable identity
-- and a spelling transition cannot evade the cross-workspace lock.
DO $canonical_google_issuer$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM uptech.identities AS legacy_identity
    JOIN uptech.identities AS canonical_identity
      ON canonical_identity.provider = legacy_identity.provider
     AND canonical_identity.provider_subject = legacy_identity.provider_subject
     AND canonical_identity.issuer = 'https://accounts.google.com'
     AND canonical_identity.id <> legacy_identity.id
    WHERE legacy_identity.provider = 'GOOGLE'
      AND legacy_identity.issuer = 'accounts.google.com'
  ) THEN
    RAISE EXCEPTION
      'cannot canonicalize duplicate Google issuer and subject identities';
  END IF;

  UPDATE uptech.identities
  SET issuer = 'https://accounts.google.com',
      security_version = security_version + 1,
      updated_at = pg_catalog.clock_timestamp()
  WHERE provider = 'GOOGLE'
    AND issuer = 'accounts.google.com';
END
$canonical_google_issuer$;

DO $rename_web$
BEGIN
  IF pg_catalog.to_regprocedure(
    'uptech.complete_web_google_login_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)'
  ) IS NOT NULL
  AND pg_catalog.to_regprocedure(
    'uptech.complete_web_google_login_a2_internal_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)'
  ) IS NULL THEN
    ALTER FUNCTION uptech.complete_web_google_login_v1(
      uptech.google_auth_hash32_v1,
      uptech.google_verified_claims_assertion_v1,
      uptech.google_auth_hash32_v1,
      uptech.google_auth_hash32_v1,
      uptech.google_auth_hash32_v1,
      uuid
    ) RENAME TO complete_web_google_login_a2_internal_v1;
  END IF;
END
$rename_web$;

-- A group-controlled workspace may authenticate a member only after the
-- backend has already materialized an ACTIVE membership from its verified
-- group authority. The A1 implementation incorrectly rejected even that
-- already-authorized member. Keep its JIT branches domain-only while allowing
-- an existing ACTIVE membership through the common session issuer.
DO $group_controlled_active_member$
DECLARE
  function_definition text;
  patched_definition text;
  legacy_guard constant text :=
    $legacy_guard$IF resolved_workspace_status = 'ACTIVE'
       AND resolved_provisioning_policy <> 'GOOGLE_GROUP_CONTROLLED' THEN$legacy_guard$;
  active_guard constant text :=
    $active_guard$IF resolved_workspace_status = 'ACTIVE' THEN$active_guard$;
  legacy_reactivation constant text :=
    $legacy_reactivation$AND resolved_membership_status IN (
              'PENDING', 'DEPROVISIONED'
            )$legacy_reactivation$;
  pending_reactivation constant text :=
    $pending_reactivation$AND resolved_membership_status = 'PENDING'$pending_reactivation$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'uptech.complete_web_google_login_a1_internal_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)'::regprocedure
  ) INTO function_definition;

  patched_definition := function_definition;
  IF pg_catalog.strpos(patched_definition, legacy_guard) > 0 THEN
    patched_definition := pg_catalog.replace(
      patched_definition,
      legacy_guard,
      active_guard
    );
  ELSIF pg_catalog.strpos(patched_definition, active_guard) = 0 THEN
    RAISE EXCEPTION 'unexpected web login policy guard';
  END IF;

  IF pg_catalog.strpos(patched_definition, legacy_reactivation) > 0 THEN
    patched_definition := pg_catalog.replace(
      patched_definition,
      legacy_reactivation,
      pending_reactivation
    );
  ELSIF pg_catalog.strpos(patched_definition, pending_reactivation) = 0 THEN
    RAISE EXCEPTION 'unexpected web membership reactivation guard';
  END IF;

  IF patched_definition <> function_definition THEN
    EXECUTE patched_definition;
  END IF;
END
$group_controlled_active_member$;

CREATE OR REPLACE FUNCTION uptech.complete_web_google_login_v1(
  p_completion_handle_hash uptech.google_auth_hash32_v1,
  p_claims uptech.google_verified_claims_assertion_v1,
  p_session_token_hash uptech.google_auth_hash32_v1,
  p_csrf_token_hash uptech.google_auth_hash32_v1,
  p_onboarding_token_hash uptech.google_auth_hash32_v1,
  p_request_id uuid
)
RETURNS uptech.google_login_completion_result_v2
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  observed_at timestamptz := pg_catalog.clock_timestamp();
  selected_transaction uptech.oauth_transactions%ROWTYPE;
  bound_configuration uptech.google_auth_configuration_registry%ROWTYPE;
  claims_are_valid boolean;
  selected_workspace_id uuid;
  selected_workspace_status text;
  selected_provisioning_policy text;
  selected_identity_id uuid;
  selected_user_id uuid;
  selected_user_status text;
  selected_identity_status text;
  selected_membership_id uuid;
  selected_membership_status text;
  selected_membership_role text;
  identity_has_other_workspace_membership boolean := false;
  rejection_committed boolean := false;
  raw_issuer_is_google boolean := false;
  canonical_claims uptech.google_verified_claims_assertion_v1;
  internal_result uptech.google_login_completion_result_v1;
BEGIN
  raw_issuer_is_google := (p_claims).issuer::text IN (
    'https://accounts.google.com', 'accounts.google.com'
  );
  canonical_claims := ROW(
    'https://accounts.google.com',
    (p_claims).provider_subject,
    (p_claims).normalized_email,
    (p_claims).email_verified,
    (p_claims).normalized_hosted_domain,
    (p_claims).issued_at,
    (p_claims).expires_at,
    (p_claims).audience_configuration_key,
    (p_claims).authorized_party_configuration_key,
    (p_claims).web_nonce_hash
  )::uptech.google_verified_claims_assertion_v1;

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
     OR selected_transaction.completion_expires_at IS NULL
     OR selected_transaction.completion_expires_at <= observed_at THEN
    RETURN ROW(
      'DENIED'::uptech.google_login_completion_outcome_v1,
      NULL::uptech.google_login_access_state_v1,
      NULL::text[], NULL::timestamptz
    )::uptech.google_login_completion_result_v2;
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
    AND raw_issuer_is_google IS TRUE
    AND p_request_id IS NOT NULL
    AND (canonical_claims).provider_subject IS NOT NULL
    AND (canonical_claims).normalized_email IS NOT NULL
    AND (canonical_claims).email_verified IS TRUE
    AND (canonical_claims).normalized_hosted_domain IS NOT NULL
    AND (canonical_claims).issued_at IS NOT NULL
    AND (canonical_claims).expires_at IS NOT NULL
    AND (canonical_claims).issued_at >= observed_at - interval '5 minutes'
    AND (canonical_claims).issued_at <= observed_at + interval '2 minutes'
    AND (canonical_claims).expires_at > observed_at
    AND (canonical_claims).expires_at > (canonical_claims).issued_at
    AND (canonical_claims).expires_at <=
      (canonical_claims).issued_at + interval '2 hours'
    AND (canonical_claims).audience_configuration_key =
      bound_configuration.audience_configuration_key
    AND (
      (canonical_claims).authorized_party_configuration_key IS NULL
      OR (canonical_claims).authorized_party_configuration_key = ANY (
        bound_configuration.allowed_azp_configuration_keys
      )
    )
    AND (canonical_claims).web_nonce_hash IS NOT NULL
    AND (canonical_claims).web_nonce_hash = selected_transaction.web_nonce_hash;

  IF claims_are_valid IS NOT TRUE THEN
    PERFORM uptech.record_google_login_rejection_v1(
      p_completion_handle_hash,
      'CLAIMS_INVALID'::uptech.google_auth_rejection_class_v1,
      COALESCE(p_request_id, selected_transaction.request_id)
    );
    RETURN ROW(
      'DENIED'::uptech.google_login_completion_outcome_v1,
      NULL::uptech.google_login_access_state_v1,
      NULL::text[], NULL::timestamptz
    )::uptech.google_login_completion_result_v2;
  END IF;

  -- The sole tenant locator is the verified domain claimed by the server-verified
  -- assertion. No configuration or client input selects a fallback workspace.
  SELECT locator.workspace_id
  INTO selected_workspace_id
  FROM uptech.workspace_domain_locators AS locator
  WHERE locator.normalized_domain = (canonical_claims).normalized_hosted_domain
    AND locator.status = 'VERIFIED';

  IF selected_workspace_id IS NULL THEN
    PERFORM uptech.record_google_login_rejection_v1(
      p_completion_handle_hash,
      'IDENTITY_INELIGIBLE'::uptech.google_auth_rejection_class_v1,
      p_request_id
    );
    SELECT transaction_row.status = 'REJECTED'
    INTO rejection_committed
    FROM uptech.oauth_transactions AS transaction_row
    WHERE transaction_row.id = selected_transaction.id;
    IF rejection_committed IS NOT TRUE THEN
      RETURN ROW(
        'DENIED'::uptech.google_login_completion_outcome_v1,
        NULL::uptech.google_login_access_state_v1,
        NULL::text[], NULL::timestamptz
      )::uptech.google_login_completion_result_v2;
    END IF;
    RETURN ROW(
      'ONBOARDING'::uptech.google_login_completion_outcome_v1,
      'UNKNOWN_WORKSPACE'::uptech.google_login_access_state_v1,
      ARRAY[
        'FIRST_DOMAIN_CLAIM_READ',
        'FIRST_DOMAIN_CLAIM_RESERVE',
        'FIRST_DOMAIN_CLAIM_COMPLETE',
        'ACCESS_REQUEST_READ',
        'ACCESS_REQUEST_SUBMIT'
      ]::text[],
      pg_catalog.clock_timestamp() + interval '30 minutes'
    )::uptech.google_login_completion_result_v2;
  END IF;

  SELECT workspace_row.status, workspace_row.provisioning_policy
  INTO selected_workspace_status, selected_provisioning_policy
  FROM uptech.workspaces AS workspace_row
  WHERE workspace_row.workspace_id = selected_workspace_id;

  IF selected_workspace_status IN ('SUSPENDED', 'DEPROVISIONED') THEN
    PERFORM uptech.record_google_login_rejection_v1(
      p_completion_handle_hash,
      'IDENTITY_INELIGIBLE'::uptech.google_auth_rejection_class_v1,
      p_request_id
    );
    SELECT transaction_row.status = 'REJECTED'
    INTO rejection_committed
    FROM uptech.oauth_transactions AS transaction_row
    WHERE transaction_row.id = selected_transaction.id;
    IF rejection_committed IS NOT TRUE THEN
      RETURN ROW(
        'DENIED'::uptech.google_login_completion_outcome_v1,
        NULL::uptech.google_login_access_state_v1,
        NULL::text[], NULL::timestamptz
      )::uptech.google_login_completion_result_v2;
    END IF;
    RETURN ROW(
      'DENIED'::uptech.google_login_completion_outcome_v1,
      'WORKSPACE_SUSPENDED'::uptech.google_login_access_state_v1,
      NULL::text[], NULL::timestamptz
    )::uptech.google_login_completion_result_v2;
  END IF;

  IF selected_workspace_status = 'ACTIVE' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        (canonical_claims).issuer::text || pg_catalog.chr(31)
          || (canonical_claims).provider_subject::text,
        0
      )
    );

      SELECT identity_row.id, identity_row.user_id, user_row.status, identity_row.status
      INTO selected_identity_id, selected_user_id, selected_user_status, selected_identity_status
    FROM uptech.identities AS identity_row
    JOIN uptech.users AS user_row ON user_row.id = identity_row.user_id
    WHERE identity_row.provider = 'GOOGLE'
      AND identity_row.issuer = (canonical_claims).issuer::text
      AND identity_row.provider_subject = (canonical_claims).provider_subject::text;

    IF selected_identity_id IS NOT NULL
       AND (selected_user_status <> 'ACTIVE' OR selected_identity_status <> 'ACTIVE') THEN
      PERFORM uptech.record_google_login_rejection_v1(
        p_completion_handle_hash,
        'IDENTITY_INELIGIBLE'::uptech.google_auth_rejection_class_v1,
        p_request_id
      );
      SELECT transaction_row.status = 'REJECTED'
      INTO rejection_committed
      FROM uptech.oauth_transactions AS transaction_row
      WHERE transaction_row.id = selected_transaction.id;
      IF rejection_committed IS NOT TRUE THEN
        RETURN ROW(
          'DENIED'::uptech.google_login_completion_outcome_v1,
          NULL::uptech.google_login_access_state_v1,
          NULL::text[], NULL::timestamptz
        )::uptech.google_login_completion_result_v2;
      END IF;
      RETURN ROW(
        'DENIED'::uptech.google_login_completion_outcome_v1,
        'USER_SUSPENDED'::uptech.google_login_access_state_v1,
        NULL::text[], NULL::timestamptz
      )::uptech.google_login_completion_result_v2;
    END IF;

    IF selected_identity_id IS NOT NULL THEN
      SELECT membership_row.id, membership_row.status, membership_row.role
      INTO selected_membership_id, selected_membership_status, selected_membership_role
      FROM uptech.workspace_memberships AS membership_row
      JOIN uptech.identities AS identity_row ON identity_row.user_id = membership_row.user_id
      WHERE membership_row.workspace_id = selected_workspace_id
        AND identity_row.id = selected_identity_id;

      SELECT EXISTS (
        SELECT 1
        FROM uptech.workspace_memberships AS membership_row
        WHERE membership_row.user_id = selected_user_id
          AND membership_row.workspace_id <> selected_workspace_id
      ) INTO identity_has_other_workspace_membership;
    END IF;

    IF selected_identity_id IS NOT NULL
       AND selected_membership_id IS NULL
       AND identity_has_other_workspace_membership THEN
      PERFORM uptech.record_google_login_rejection_v1(
        p_completion_handle_hash,
        'IDENTITY_INELIGIBLE'::uptech.google_auth_rejection_class_v1,
        p_request_id
      );
      RETURN ROW(
        'DENIED'::uptech.google_login_completion_outcome_v1,
        NULL::uptech.google_login_access_state_v1,
        NULL::text[], NULL::timestamptz
      )::uptech.google_login_completion_result_v2;
    END IF;

    IF selected_membership_status IN ('SUSPENDED', 'DEPROVISIONED') THEN
      PERFORM uptech.record_google_login_rejection_v1(
        p_completion_handle_hash,
        'IDENTITY_INELIGIBLE'::uptech.google_auth_rejection_class_v1,
        p_request_id
      );
      SELECT transaction_row.status = 'REJECTED'
      INTO rejection_committed
      FROM uptech.oauth_transactions AS transaction_row
      WHERE transaction_row.id = selected_transaction.id;
      IF rejection_committed IS NOT TRUE THEN
        RETURN ROW(
          'DENIED'::uptech.google_login_completion_outcome_v1,
          NULL::uptech.google_login_access_state_v1,
          NULL::text[], NULL::timestamptz
        )::uptech.google_login_completion_result_v2;
      END IF;
      RETURN ROW(
        'DENIED'::uptech.google_login_completion_outcome_v1,
        'USER_SUSPENDED'::uptech.google_login_access_state_v1,
        NULL::text[], NULL::timestamptz
      )::uptech.google_login_completion_result_v2;
    END IF;

    IF selected_membership_status IS DISTINCT FROM 'ACTIVE'
       AND (
         selected_provisioning_policy <> 'DOMAIN_AUTO_PROVISION'
         OR (
           selected_membership_id IS NOT NULL
           AND NOT (
             selected_membership_role = 'MEMBER'
             AND selected_membership_status = 'PENDING'
           )
         )
       ) THEN
      PERFORM uptech.record_google_login_rejection_v1(
        p_completion_handle_hash,
        'IDENTITY_INELIGIBLE'::uptech.google_auth_rejection_class_v1,
        p_request_id
      );
      SELECT transaction_row.status = 'REJECTED'
      INTO rejection_committed
      FROM uptech.oauth_transactions AS transaction_row
      WHERE transaction_row.id = selected_transaction.id;
      IF rejection_committed IS NOT TRUE THEN
        RETURN ROW(
          'DENIED'::uptech.google_login_completion_outcome_v1,
          NULL::uptech.google_login_access_state_v1,
          NULL::text[], NULL::timestamptz
        )::uptech.google_login_completion_result_v2;
      END IF;
      RETURN ROW(
        'ONBOARDING'::uptech.google_login_completion_outcome_v1,
        'USER_NOT_PROVISIONED'::uptech.google_login_access_state_v1,
        ARRAY['ACCESS_REQUEST_READ', 'ACCESS_REQUEST_SUBMIT']::text[],
        pg_catalog.clock_timestamp() + interval '30 minutes'
      )::uptech.google_login_completion_result_v2;
    END IF;
  END IF;

  internal_result := uptech.complete_web_google_login_a2_internal_v1(
    p_completion_handle_hash, canonical_claims, p_session_token_hash,
    p_csrf_token_hash, p_onboarding_token_hash, p_request_id
  );

  IF (internal_result).outcome = 'NORMAL' THEN
    RETURN ROW(
      'NORMAL'::uptech.google_login_completion_outcome_v1,
      NULL::uptech.google_login_access_state_v1,
      NULL::text[], NULL::timestamptz
    )::uptech.google_login_completion_result_v2;
  END IF;

  -- The A2 implementation can only reach ONBOARDING through an unexpected
  -- path after the explicit safe-state checks above. Revoke it before returning
  -- a generic denial so no opaque candidate can become usable authority.
  IF (internal_result).outcome = 'ONBOARDING' AND p_onboarding_token_hash IS NOT NULL THEN
    UPDATE uptech.onboarding_sessions
    SET status = 'REVOKED', revoked_at = pg_catalog.clock_timestamp()
    WHERE token_hash = p_onboarding_token_hash
      AND status = 'ACTIVE';
  END IF;

  RETURN ROW(
    'DENIED'::uptech.google_login_completion_outcome_v1,
    NULL::uptech.google_login_access_state_v1,
    NULL::text[], NULL::timestamptz
  )::uptech.google_login_completion_result_v2;
END
$function$;

REVOKE ALL ON FUNCTION uptech.complete_web_google_login_a2_internal_v1(
  uptech.google_auth_hash32_v1,
  uptech.google_verified_claims_assertion_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uuid
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

-- A3 is the only mobile Google completion boundary. Retain the A1 routine as
-- owned migration history, but remove every application/runtime execute path.
REVOKE ALL ON FUNCTION uptech.complete_native_google_login_v1(
  uptech.google_auth_hash32_v1,
  uptech.google_verified_claims_assertion_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;

COMMIT;

-- PostgreSQL makes a newly added enum value unusable until this transaction
-- commits, so the mobile wrapper is deliberately in a separate transaction.
BEGIN;
SET LOCAL ROLE uptech_migration_owner;

ALTER TYPE uptech.mobile_auth_ui_category_v1
  ADD VALUE IF NOT EXISTS 'WORKSPACE_SUSPENDED';
ALTER TYPE uptech.mobile_auth_ui_category_v1
  ADD VALUE IF NOT EXISTS 'GOOGLE_CANCELLED';
ALTER TYPE uptech.mobile_auth_ui_category_v1
  ADD VALUE IF NOT EXISTS 'PROVIDER_UNAVAILABLE';

COMMIT;

BEGIN;
SET LOCAL ROLE uptech_migration_owner;

ALTER TABLE uptech.mobile_handoffs
  ADD COLUMN IF NOT EXISTS denial_category uptech.mobile_auth_ui_category_v1;
ALTER TABLE uptech.mobile_handoffs
  ALTER COLUMN identity_id DROP NOT NULL,
  ALTER COLUMN user_id DROP NOT NULL,
  ALTER COLUMN workspace_id DROP NOT NULL,
  ALTER COLUMN membership_id DROP NOT NULL,
  ALTER COLUMN user_security_version DROP NOT NULL,
  ALTER COLUMN identity_security_version DROP NOT NULL,
  ALTER COLUMN workspace_security_version DROP NOT NULL,
  ALTER COLUMN membership_authz_version DROP NOT NULL;
DO $mobile_handoff_authority_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'uptech.mobile_handoffs'::regclass
      AND constraint_row.conname =
        'mobile_handoffs_authority_or_denial_v2_check'
  ) THEN
    ALTER TABLE uptech.mobile_handoffs
      ADD CONSTRAINT mobile_handoffs_authority_or_denial_v2_check CHECK (
        (
          denial_category IS NULL
          AND identity_id IS NOT NULL
          AND user_id IS NOT NULL
          AND workspace_id IS NOT NULL
          AND membership_id IS NOT NULL
          AND user_security_version IS NOT NULL
          AND identity_security_version IS NOT NULL
          AND workspace_security_version IS NOT NULL
          AND membership_authz_version IS NOT NULL
        ) OR (
          denial_category IS NOT NULL
          AND identity_id IS NULL
          AND user_id IS NULL
          AND workspace_id IS NULL
          AND membership_id IS NULL
          AND user_security_version IS NULL
          AND identity_security_version IS NULL
          AND workspace_security_version IS NULL
          AND membership_authz_version IS NULL
        )
      );
  END IF;
END
$mobile_handoff_authority_check$;

DO $mobile_handoff_exchange_result_type$
BEGIN
  IF pg_catalog.to_regtype(
    'uptech.mobile_handoff_exchange_result_v2'
  ) IS NULL THEN
    CREATE TYPE uptech.mobile_handoff_exchange_result_v2 AS (
      outcome text,
      session_id uuid,
      access_expires_at timestamptz,
      refresh_expires_at timestamptz,
      active_workspace_id uuid,
      memberships jsonb,
      denial_category uptech.mobile_auth_ui_category_v1
    );
  END IF;
END
$mobile_handoff_exchange_result_type$;

DO $rename_mobile$
BEGIN
  IF pg_catalog.to_regprocedure(
    'uptech.complete_mobile_google_callback_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uuid)'
  ) IS NOT NULL
  AND pg_catalog.to_regprocedure(
    'uptech.complete_mobile_google_callback_a3_internal_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uuid)'
  ) IS NULL THEN
    ALTER FUNCTION uptech.complete_mobile_google_callback_v1(
      uptech.google_auth_hash32_v1,
      uptech.google_verified_claims_assertion_v1,
      uptech.google_auth_hash32_v1,
      uuid
    ) RENAME TO complete_mobile_google_callback_a3_internal_v1;
  END IF;
END
$rename_mobile$;

-- A previously bound Google subject must never gain a second tenant merely by
-- presenting a different hosted-domain claim. Legitimate multi-workspace users
-- must already have an explicit membership in the target workspace.
DO $mobile_cross_tenant_guard$
DECLARE
  function_definition text;
  patched_definition text;
  legacy_identity_update constant text := $legacy_identity_update$
    IF ident.status<>'ACTIVE' OR usr.status<>'ACTIVE' THEN
      RETURN ROW('DENIED',NULL,'USER_SUSPENDED')::uptech.mobile_callback_result_v1;
    END IF;
    UPDATE uptech.identities SET email_claim=(p_claims).normalized_email::text,$legacy_identity_update$;
  guarded_identity_update constant text := $guarded_identity_update$
    IF ident.status<>'ACTIVE' OR usr.status<>'ACTIVE' THEN
      RETURN ROW('DENIED',NULL,'USER_SUSPENDED')::uptech.mobile_callback_result_v1;
    END IF;
    IF EXISTS (
      SELECT 1 FROM uptech.workspace_memberships AS target_membership
      WHERE target_membership.workspace_id = ws.workspace_id
        AND target_membership.user_id = usr.id
        AND target_membership.status IN ('SUSPENDED', 'DEPROVISIONED')
    ) THEN
      RETURN ROW('DENIED',NULL,'USER_SUSPENDED')::uptech.mobile_callback_result_v1;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM uptech.workspace_memberships AS target_membership
      WHERE target_membership.workspace_id = ws.workspace_id
        AND target_membership.user_id = usr.id
    ) AND EXISTS (
      SELECT 1 FROM uptech.workspace_memberships AS other_membership
      WHERE other_membership.workspace_id <> ws.workspace_id
        AND other_membership.user_id = usr.id
    ) THEN
      RETURN ROW('DENIED',NULL,'AUTH_ERROR')::uptech.mobile_callback_result_v1;
    END IF;
    UPDATE uptech.identities SET email_claim=(p_claims).normalized_email::text,$guarded_identity_update$;
  legacy_reactivation constant text :=
    $legacy_reactivation$ELSIF mem.role='MEMBER' AND mem.status IN ('PENDING','DEPROVISIONED') THEN$legacy_reactivation$;
  pending_reactivation constant text :=
    $pending_reactivation$ELSIF mem.role='MEMBER' AND mem.status='PENDING' THEN$pending_reactivation$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'uptech.complete_mobile_google_callback_a3_internal_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uuid)'::regprocedure
  ) INTO function_definition;

  patched_definition := function_definition;
  IF pg_catalog.strpos(patched_definition, legacy_identity_update) > 0 THEN
    patched_definition := pg_catalog.replace(
      patched_definition,
      legacy_identity_update,
      guarded_identity_update
    );
  ELSIF pg_catalog.strpos(patched_definition, guarded_identity_update) = 0 THEN
    RAISE EXCEPTION 'unexpected mobile identity update guard';
  END IF;

  IF pg_catalog.strpos(patched_definition, legacy_reactivation) > 0 THEN
    patched_definition := pg_catalog.replace(
      patched_definition,
      legacy_reactivation,
      pending_reactivation
    );
  ELSIF pg_catalog.strpos(patched_definition, pending_reactivation) = 0 THEN
    RAISE EXCEPTION 'unexpected mobile membership reactivation guard';
  END IF;

  IF patched_definition <> function_definition THEN
    EXECUTE patched_definition;
  END IF;
END
$mobile_cross_tenant_guard$;

CREATE OR REPLACE FUNCTION uptech.complete_mobile_google_denial_v1(
  p_completion_handle_hash uptech.google_auth_hash32_v1,
  p_handoff_hash uptech.google_auth_hash32_v1,
  p_rejection_class uptech.google_auth_rejection_class_v1,
  p_denial_category uptech.mobile_auth_ui_category_v1,
  p_request_id uuid
)
RETURNS uptech.mobile_callback_result_v1
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  observed_at timestamptz := pg_catalog.clock_timestamp();
  selected_transaction uptech.mobile_google_transactions%ROWTYPE;
  selected_configuration uptech.mobile_google_configuration_registry%ROWTYPE;
  transitioned_rows integer := 0;
BEGIN
  IF p_completion_handle_hash IS NOT NULL THEN
    SELECT transaction_row.*
    INTO selected_transaction
    FROM uptech.mobile_google_transactions AS transaction_row
    WHERE transaction_row.completion_handle_hash = p_completion_handle_hash
      AND transaction_row.status = 'EXCHANGE_RESERVED'
    FOR UPDATE;
  END IF;

  IF selected_transaction.id IS NOT NULL THEN
    SELECT configuration_row.*
    INTO selected_configuration
    FROM uptech.mobile_google_configuration_registry AS configuration_row
    WHERE configuration_row.environment_name = selected_transaction.environment_name
      AND configuration_row.platform = selected_transaction.platform
      AND configuration_row.configuration_key = selected_transaction.configuration_key
      AND configuration_row.is_enabled;
  END IF;

  IF selected_transaction.id IS NULL
     OR selected_transaction.completion_expires_at IS NULL
     OR selected_transaction.completion_expires_at <= observed_at
     OR selected_configuration.configuration_key IS NULL
     OR p_handoff_hash IS NULL
     OR p_rejection_class IS NULL
     OR p_denial_category IS NULL
     OR p_request_id IS NULL THEN
    RETURN ROW(
      'DENIED'::uptech.google_login_completion_outcome_v1,
      NULL::uptech.google_auth_https_uri_v1,
      'AUTH_ERROR'::uptech.mobile_auth_ui_category_v1
    )::uptech.mobile_callback_result_v1;
  END IF;

  INSERT INTO uptech.mobile_handoffs (
    id, transaction_id, handoff_hash, platform,
    installation_binding_hash, app_exchange_challenge,
    identity_id, user_id, workspace_id, membership_id,
    user_security_version, identity_security_version,
    workspace_security_version, membership_authz_version,
    denial_category, created_at, expires_at
  ) VALUES (
    pg_catalog.gen_random_uuid(), selected_transaction.id, p_handoff_hash,
    selected_transaction.platform, selected_transaction.installation_binding_hash,
    selected_transaction.app_exchange_challenge,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    p_denial_category, observed_at, observed_at + interval '60 seconds'
  );

  UPDATE uptech.mobile_google_transactions
  SET status = 'REJECTED', rejected_at = observed_at
  WHERE id = selected_transaction.id
    AND status = 'EXCHANGE_RESERVED';
  GET DIAGNOSTICS transitioned_rows = ROW_COUNT;
  IF transitioned_rows <> 1 THEN
    RAISE EXCEPTION 'mobile denial transaction transition lost';
  END IF;

  INSERT INTO uptech.platform_audit_events (
    id, action, target_type, outcome, request_id, metadata, occurred_at
  ) VALUES (
    pg_catalog.gen_random_uuid(), 'MOBILE_GOOGLE_CALLBACK_REJECTED',
    'MOBILE_GOOGLE_TRANSACTION', 'DENIED', p_request_id,
    pg_catalog.jsonb_build_object(
      'correlation_id', selected_transaction.id,
      'platform', selected_transaction.platform::text,
      'configuration_key', selected_transaction.configuration_key::text,
      'rejection_class', p_rejection_class::text,
      'denial_category', p_denial_category::text,
      'denial_handoff_created', true
    ),
    observed_at
  );

  RETURN ROW(
    'DENIED'::uptech.google_login_completion_outcome_v1,
    selected_configuration.app_return_uri,
    p_denial_category
  )::uptech.mobile_callback_result_v1;
EXCEPTION WHEN unique_violation THEN
  RETURN ROW(
    'DENIED'::uptech.google_login_completion_outcome_v1,
    NULL::uptech.google_auth_https_uri_v1,
    'AUTH_ERROR'::uptech.mobile_auth_ui_category_v1
  )::uptech.mobile_callback_result_v1;
END
$function$;

CREATE OR REPLACE FUNCTION uptech.complete_mobile_google_callback_v1(
  p_completion_handle_hash uptech.google_auth_hash32_v1,
  p_claims uptech.google_verified_claims_assertion_v1,
  p_handoff_hash uptech.google_auth_hash32_v1,
  p_request_id uuid
)
RETURNS uptech.mobile_callback_result_v1
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  observed_at timestamptz := pg_catalog.clock_timestamp();
  selected_transaction uptech.mobile_google_transactions%ROWTYPE;
  raw_issuer_is_google boolean := false;
  canonical_claims uptech.google_verified_claims_assertion_v1;
  internal_result uptech.mobile_callback_result_v1;
  denial_result uptech.mobile_callback_result_v1;
  final_denial_category uptech.mobile_auth_ui_category_v1;
  selected_workspace_status text;
BEGIN
  IF p_completion_handle_hash IS NOT NULL THEN
    SELECT transaction_row.*
    INTO selected_transaction
    FROM uptech.mobile_google_transactions AS transaction_row
    WHERE transaction_row.completion_handle_hash = p_completion_handle_hash
      AND transaction_row.status = 'EXCHANGE_RESERVED'
    FOR UPDATE;
  END IF;

  IF selected_transaction.id IS NULL THEN
    RETURN ROW(
      'DENIED'::uptech.google_login_completion_outcome_v1,
      NULL::uptech.google_auth_https_uri_v1,
      'AUTH_ERROR'::uptech.mobile_auth_ui_category_v1
    )::uptech.mobile_callback_result_v1;
  END IF;

  raw_issuer_is_google := (p_claims).issuer::text IN (
    'https://accounts.google.com', 'accounts.google.com'
  );
  canonical_claims := ROW(
    'https://accounts.google.com',
    (p_claims).provider_subject,
    (p_claims).normalized_email,
    (p_claims).email_verified,
    (p_claims).normalized_hosted_domain,
    (p_claims).issued_at,
    (p_claims).expires_at,
    (p_claims).audience_configuration_key,
    (p_claims).authorized_party_configuration_key,
    (p_claims).web_nonce_hash
  )::uptech.google_verified_claims_assertion_v1;

  IF raw_issuer_is_google IS TRUE
     AND selected_transaction.completion_expires_at IS NOT NULL
     AND selected_transaction.completion_expires_at > observed_at THEN
    internal_result := uptech.complete_mobile_google_callback_a3_internal_v1(
      p_completion_handle_hash, canonical_claims, p_handoff_hash, p_request_id
    );
  ELSE
    internal_result := ROW(
      'DENIED'::uptech.google_login_completion_outcome_v1,
      NULL::uptech.google_auth_https_uri_v1,
      'AUTH_ERROR'::uptech.mobile_auth_ui_category_v1
    )::uptech.mobile_callback_result_v1;
  END IF;

  IF (internal_result).outcome = 'DENIED'
     AND (internal_result).denial_category = 'USER_SUSPENDED' THEN
    SELECT workspace_row.status
    INTO selected_workspace_status
    FROM uptech.workspace_domain_locators AS locator
    JOIN uptech.workspaces AS workspace_row
      ON workspace_row.workspace_id = locator.workspace_id
    WHERE locator.normalized_domain = (canonical_claims).normalized_hosted_domain
      AND locator.status = 'VERIFIED';

    IF selected_workspace_status IN ('SUSPENDED', 'DEPROVISIONED') THEN
      final_denial_category := 'WORKSPACE_SUSPENDED';
    END IF;
  END IF;

  IF (internal_result).outcome = 'DENIED' THEN
    final_denial_category := COALESCE(
      final_denial_category,
      (internal_result).denial_category,
      'AUTH_ERROR'::uptech.mobile_auth_ui_category_v1
    );
    denial_result := uptech.complete_mobile_google_denial_v1(
      p_completion_handle_hash,
      p_handoff_hash,
      CASE
        WHEN raw_issuer_is_google IS TRUE
          THEN 'IDENTITY_INELIGIBLE'::uptech.google_auth_rejection_class_v1
        ELSE 'CLAIMS_INVALID'::uptech.google_auth_rejection_class_v1
      END,
      final_denial_category,
      COALESCE(p_request_id, selected_transaction.request_id)
    );
    RETURN denial_result;
  END IF;

  RETURN internal_result;
END
$function$;

CREATE OR REPLACE FUNCTION uptech.exchange_mobile_handoff_v2(
  p_network_hmac uptech.google_auth_hash32_v1,
  p_handoff_hash uptech.google_auth_hash32_v1,
  p_app_exchange_challenge uptech.google_auth_hash32_v1,
  p_installation_binding_hash uptech.google_auth_hash32_v1,
  p_access_hash uptech.google_auth_hash32_v1,
  p_refresh_hash uptech.google_auth_hash32_v1,
  p_request_id uuid
)
RETURNS uptech.mobile_handoff_exchange_result_v2
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  observed_at timestamptz := pg_catalog.clock_timestamp();
  denial_hint uptech.mobile_auth_ui_category_v1;
  selected_handoff uptech.mobile_handoffs%ROWTYPE;
  legacy_result uptech.mobile_issue_result_v1;
BEGIN
  IF p_handoff_hash IS NOT NULL THEN
    SELECT handoff_row.denial_category
    INTO denial_hint
    FROM uptech.mobile_handoffs AS handoff_row
    WHERE handoff_row.handoff_hash = p_handoff_hash;
  END IF;

  IF denial_hint IS NULL THEN
    legacy_result := uptech.exchange_mobile_handoff_v1(
      p_network_hmac,
      p_handoff_hash,
      p_app_exchange_challenge,
      p_installation_binding_hash,
      p_access_hash,
      p_refresh_hash,
      p_request_id
    );
    RETURN ROW(
      (legacy_result).outcome::text,
      (legacy_result).session_id,
      (legacy_result).access_expires_at,
      (legacy_result).refresh_expires_at,
      (legacy_result).active_workspace_id,
      (legacy_result).memberships,
      NULL::uptech.mobile_auth_ui_category_v1
    )::uptech.mobile_handoff_exchange_result_v2;
  END IF;

  IF p_network_hmac IS NULL OR p_request_id IS NULL THEN
    RETURN ROW(
      'DENIED', NULL, NULL, NULL, NULL, NULL,
      NULL::uptech.mobile_auth_ui_category_v1
    )::uptech.mobile_handoff_exchange_result_v2;
  END IF;
  IF NOT uptech.mobile_google_auth_admit_internal_v1(
    p_network_hmac, p_request_id
  ) THEN
    RETURN ROW(
      'RATE_LIMITED', NULL, NULL, NULL, NULL, NULL,
      NULL::uptech.mobile_auth_ui_category_v1
    )::uptech.mobile_handoff_exchange_result_v2;
  END IF;

  SELECT handoff_row.*
  INTO selected_handoff
  FROM uptech.mobile_handoffs AS handoff_row
  WHERE handoff_row.handoff_hash = p_handoff_hash
    AND handoff_row.status = 'ACTIVE'
  FOR UPDATE;

  IF selected_handoff.id IS NULL
     OR selected_handoff.denial_category IS NULL
     OR selected_handoff.expires_at <= observed_at
     OR selected_handoff.app_exchange_challenge <> p_app_exchange_challenge
     OR selected_handoff.installation_binding_hash <> p_installation_binding_hash THEN
    IF selected_handoff.id IS NOT NULL
       AND selected_handoff.expires_at <= observed_at THEN
      UPDATE uptech.mobile_handoffs
      SET status = 'EXPIRED'
      WHERE id = selected_handoff.id
        AND status = 'ACTIVE';
    END IF;
    INSERT INTO uptech.platform_audit_events (
      id, action, target_type, outcome, request_id, metadata, occurred_at
    ) VALUES (
      pg_catalog.gen_random_uuid(), 'MOBILE_HANDOFF_EXCHANGE_REJECTED',
      'MOBILE_HANDOFF', 'DENIED', p_request_id,
      pg_catalog.jsonb_build_object('rejection_class', 'PROTOCOL_INVALID'),
      observed_at
    );
    RETURN ROW(
      'DENIED', NULL, NULL, NULL, NULL, NULL,
      NULL::uptech.mobile_auth_ui_category_v1
    )::uptech.mobile_handoff_exchange_result_v2;
  END IF;

  UPDATE uptech.mobile_handoffs
  SET status = 'CONSUMED', consumed_at = observed_at
  WHERE id = selected_handoff.id
    AND status = 'ACTIVE';

  INSERT INTO uptech.platform_audit_events (
    id, action, target_type, outcome, request_id, metadata, occurred_at
  ) VALUES (
    pg_catalog.gen_random_uuid(), 'MOBILE_DENIAL_HANDOFF_CONSUMED',
    'MOBILE_HANDOFF', 'DENIED', p_request_id,
    pg_catalog.jsonb_build_object(
      'correlation_id', selected_handoff.transaction_id,
      'platform', selected_handoff.platform::text,
      'denial_category', selected_handoff.denial_category::text
    ),
    observed_at
  );
  RETURN ROW(
    'ACCESS_DENIED', NULL, NULL, NULL, NULL, NULL,
    selected_handoff.denial_category
  )::uptech.mobile_handoff_exchange_result_v2;
END
$function$;

REVOKE ALL ON FUNCTION uptech.complete_mobile_google_callback_a3_internal_v1(
  uptech.google_auth_hash32_v1,
  uptech.google_verified_claims_assertion_v1,
  uptech.google_auth_hash32_v1,
  uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.complete_mobile_google_callback_v1(
  uptech.google_auth_hash32_v1,
  uptech.google_verified_claims_assertion_v1,
  uptech.google_auth_hash32_v1,
  uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.complete_mobile_google_callback_v1(
  uptech.google_auth_hash32_v1,
  uptech.google_verified_claims_assertion_v1,
  uptech.google_auth_hash32_v1,
  uuid
) TO uptech_api_runtime;
REVOKE ALL ON FUNCTION uptech.complete_mobile_google_denial_v1(
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_rejection_class_v1,
  uptech.mobile_auth_ui_category_v1,
  uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.complete_mobile_google_denial_v1(
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_rejection_class_v1,
  uptech.mobile_auth_ui_category_v1,
  uuid
) TO uptech_api_runtime;
REVOKE ALL ON FUNCTION uptech.exchange_mobile_handoff_v2(
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.exchange_mobile_handoff_v2(
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,
  uuid
) TO uptech_api_runtime;

COMMIT;
