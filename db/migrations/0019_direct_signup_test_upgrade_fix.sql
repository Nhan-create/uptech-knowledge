\set ON_ERROR_STOP on

BEGIN;
SET LOCAL ROLE uptech_migration_owner;

-- =============================================================================
-- 0019: Upgrade test-customer-* placeholder workspaces in-place during
--       complete_direct_workspace_signup_v1 instead of deleting them, because
--       ON DELETE RESTRICT foreign keys and append-only audit_events block
--       DELETE FROM uptech.workspaces with SQLSTATE 23503.
-- =============================================================================

CREATE OR REPLACE FUNCTION uptech.complete_direct_workspace_signup_v1(
  p_issuer text,
  p_provider_subject text,
  p_normalized_email text,
  p_hosted_domain text,
  p_candidate_workspace_id uuid,
  p_customer_id text,
  p_customer_domain text,
  p_verified_domains uptech.google_workspace_verified_domain_v1[],
  p_credential_reference text,
  p_authorized_scopes text[],
  p_request_id uuid
)
RETURNS uptech.direct_workspace_signup_result_v1
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  selected_identity_id uuid;
  selected_user_id uuid;
  selected_user_status text;
  selected_identity_status text;
  placeholder_workspace_id uuid;
  target_workspace_id uuid := p_candidate_workspace_id;
  selected_membership_id uuid := pg_catalog.gen_random_uuid();
  selected_actor_id uuid := pg_catalog.gen_random_uuid();
  selected_connector_id uuid := pg_catalog.gen_random_uuid();
  normalized_domains uptech.google_workspace_verified_domain_v1[];
  normalized_customer_domain uptech.google_normalized_domain_v1;
  normalized_hosted_domain uptech.google_normalized_domain_v1;
  normalized_email uptech.google_normalized_email_v1;
  committed_time timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_issuer NOT IN ('https://accounts.google.com', 'accounts.google.com')
    OR p_provider_subject IS NULL OR pg_catalog.length(p_provider_subject) NOT BETWEEN 1 AND 255
    OR p_provider_subject <> pg_catalog.btrim(p_provider_subject)
    OR p_candidate_workspace_id IS NULL
    OR p_request_id IS NULL
    OR p_customer_id IS NULL OR pg_catalog.length(p_customer_id) NOT BETWEEN 1 AND 512
    OR p_customer_id <> pg_catalog.btrim(p_customer_id)
    OR p_credential_reference IS NULL
    OR pg_catalog.length(p_credential_reference) NOT BETWEEN 1 AND 1024
    OR p_credential_reference <> pg_catalog.btrim(p_credential_reference)
    OR pg_catalog.cardinality(p_authorized_scopes) <> 5
    OR pg_catalog.array_position(p_authorized_scopes, NULL) IS NOT NULL
    OR (SELECT pg_catalog.count(DISTINCT scope_name) FROM pg_catalog.unnest(p_authorized_scopes) AS scope_name) <> 5
    OR NOT p_authorized_scopes @> ARRAY[
      'https://www.googleapis.com/auth/admin.directory.customer.readonly',
      'https://www.googleapis.com/auth/admin.directory.user.readonly',
      'https://www.googleapis.com/auth/admin.directory.group.readonly',
      'https://www.googleapis.com/auth/admin.directory.orgunit.readonly',
      'https://www.googleapis.com/auth/admin.directory.domain.readonly'
    ]::text[]
  THEN
    RETURN ROW('DENIED', NULL, NULL, NULL, NULL, NULL)::uptech.direct_workspace_signup_result_v1;
  END IF;

  BEGIN
    normalized_customer_domain := pg_catalog.lower(pg_catalog.btrim(p_customer_domain))::uptech.google_normalized_domain_v1;
    normalized_hosted_domain := pg_catalog.lower(pg_catalog.btrim(p_hosted_domain))::uptech.google_normalized_domain_v1;
    normalized_email := pg_catalog.lower(pg_catalog.btrim(p_normalized_email))::uptech.google_normalized_email_v1;
    normalized_domains := uptech.normalize_google_workspace_verified_domains_v1(
      normalized_customer_domain::text, p_verified_domains
    );
  EXCEPTION WHEN invalid_parameter_value OR check_violation OR not_null_violation THEN
    RETURN ROW('DENIED', NULL, NULL, NULL, NULL, NULL)::uptech.direct_workspace_signup_result_v1;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(normalized_domains) AS supplied
    WHERE supplied.normalized_domain = normalized_hosted_domain::text
  ) THEN
    RETURN ROW('DENIED', NULL, NULL, NULL, NULL, NULL)::uptech.direct_workspace_signup_result_v1;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'https://accounts.google.com' || pg_catalog.chr(31) || p_provider_subject, 0
  ));

  SELECT i.id, i.user_id, u.status, i.status
    INTO selected_identity_id, selected_user_id, selected_user_status, selected_identity_status
  FROM uptech.identities AS i
  JOIN uptech.users AS u ON u.id = i.user_id
  WHERE i.provider = 'GOOGLE'
    AND i.issuer IN ('https://accounts.google.com', 'accounts.google.com')
    AND i.provider_subject = p_provider_subject
  FOR UPDATE OF i, u;

  IF selected_identity_id IS NULL THEN
    selected_user_id := pg_catalog.gen_random_uuid();
    selected_identity_id := pg_catalog.gen_random_uuid();
    INSERT INTO uptech.users (id, status, security_version, created_at, updated_at)
    VALUES (selected_user_id, 'ACTIVE', 1, committed_time, committed_time);
    INSERT INTO uptech.identities (
      id, user_id, provider, issuer, provider_subject, status, security_version,
      email_claim, email_verified, hosted_domain_claim, claims_observed_at, created_at, updated_at
    ) VALUES (
      selected_identity_id, selected_user_id, 'GOOGLE', 'https://accounts.google.com',
      p_provider_subject, 'ACTIVE', 1, normalized_email::text, true,
      normalized_hosted_domain::text, committed_time, committed_time, committed_time
    );
  ELSIF selected_user_status = 'ACTIVE' AND selected_identity_status = 'ACTIVE' THEN
    UPDATE uptech.identities
    SET email_claim = normalized_email::text,
        email_verified = true,
        hosted_domain_claim = normalized_hosted_domain::text,
        claims_observed_at = committed_time,
        updated_at = committed_time
    WHERE id = selected_identity_id;
  ELSE
    RETURN ROW('DENIED', NULL, NULL, NULL, NULL, NULL)::uptech.direct_workspace_signup_result_v1;
  END IF;

  -- Locate an eligible temporary test-customer-* placeholder workspace to upgrade in-place.
  SELECT w.workspace_id
    INTO placeholder_workspace_id
  FROM uptech.workspaces AS w
  WHERE w.google_customer_id LIKE 'test-customer-%'
    AND (
      EXISTS (
        SELECT 1
        FROM pg_catalog.unnest(normalized_domains) AS supplied
        JOIN uptech.workspace_domain_locators AS locator
          ON locator.workspace_id = w.workspace_id
         AND locator.normalized_domain::text = supplied.normalized_domain
      )
      OR EXISTS (
        SELECT 1
        FROM uptech.workspace_memberships AS m
        WHERE m.workspace_id = w.workspace_id
          AND m.user_id = selected_user_id
      )
    )
  ORDER BY w.created_at ASC
  LIMIT 1
  FOR UPDATE OF w;

  IF EXISTS (
    SELECT 1
    FROM uptech.workspaces AS w
    WHERE w.google_customer_id = p_customer_id
      AND (placeholder_workspace_id IS NULL OR w.workspace_id <> placeholder_workspace_id)
  )
  OR EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(normalized_domains) AS supplied
    JOIN uptech.workspace_domain_locators AS locator
      ON locator.normalized_domain::text = supplied.normalized_domain
    WHERE placeholder_workspace_id IS NULL OR locator.workspace_id <> placeholder_workspace_id
  )
  OR EXISTS (
    SELECT 1
    FROM uptech.workspace_memberships AS m
    WHERE m.user_id = selected_user_id
      AND (placeholder_workspace_id IS NULL OR m.workspace_id <> placeholder_workspace_id)
  )
  THEN
    RETURN ROW('ALREADY_REGISTERED', NULL, NULL, NULL, NULL, NULL)::uptech.direct_workspace_signup_result_v1;
  END IF;

  BEGIN
    IF placeholder_workspace_id IS NOT NULL THEN
      target_workspace_id := placeholder_workspace_id;

      DELETE FROM uptech.initial_owner_bootstrap_intents
      WHERE workspace_id = target_workspace_id;

      DELETE FROM uptech.workspace_domain_locators
      WHERE workspace_id = target_workspace_id;

      UPDATE uptech.connectors
      SET provider_customer_id = NULL,
          credential_reference = NULL,
          directory_authorized_by_identity_id = NULL,
          directory_authorized_scopes = NULL,
          status = 'DISCONNECTED',
          updated_at = committed_time
      WHERE workspace_id = target_workspace_id
        AND provider_customer_id IS NOT NULL;

      UPDATE uptech.workspaces
      SET status = 'ACTIVE',
          provisioning_policy = 'GOOGLE_GROUP_CONTROLLED',
          google_customer_id = p_customer_id,
          updated_at = committed_time
      WHERE workspace_id = target_workspace_id;
    ELSE
      INSERT INTO uptech.workspaces (
        workspace_id, status, provisioning_policy, google_customer_id,
        created_at, updated_at
      ) VALUES (
        target_workspace_id, 'ACTIVE',
        'GOOGLE_GROUP_CONTROLLED', p_customer_id, committed_time, committed_time
      );
    END IF;

    INSERT INTO uptech.workspace_domain_locators (
      normalized_domain, workspace_id, status, verified_at, created_at, updated_at,
      google_customer_id, domain_kind, provider_parent_domain
    )
    SELECT supplied.normalized_domain::uptech.google_normalized_domain_v1,
      target_workspace_id, 'VERIFIED', committed_time,
      committed_time, committed_time, p_customer_id, supplied.domain_kind,
      supplied.provider_parent_domain::uptech.google_normalized_domain_v1
    FROM pg_catalog.unnest(normalized_domains) AS supplied;

    INSERT INTO uptech.workspace_memberships (
      workspace_id, id, user_id, role, status, created_at, updated_at
    ) VALUES (
      target_workspace_id, selected_membership_id,
      selected_user_id, 'OWNER', 'ACTIVE', committed_time, committed_time
    )
    ON CONFLICT (workspace_id, user_id) DO UPDATE
      SET role = 'OWNER',
          status = 'ACTIVE',
          updated_at = committed_time
    RETURNING id INTO selected_membership_id;

    INSERT INTO uptech.service_actors (
      workspace_id, id, actor_kind, status, created_at, updated_at
    ) VALUES (
      target_workspace_id, selected_actor_id,
      'SYNC_WORKER', 'ACTIVE', committed_time, committed_time
    );

    INSERT INTO uptech.connectors (
      workspace_id, id, purpose, status, created_at, updated_at,
      provider_customer_id, credential_reference,
      directory_authorized_by_identity_id, directory_authorized_scopes
    ) VALUES (
      target_workspace_id, selected_connector_id,
      'DIRECTORY', 'ACTIVE', committed_time, committed_time, p_customer_id,
      p_credential_reference, selected_identity_id, p_authorized_scopes
    );

    INSERT INTO uptech.sync_jobs (
      workspace_id, id, service_actor_id, connector_id, job_kind, status,
      dedupe_key, payload, available_at, created_at, updated_at
    ) VALUES (
      target_workspace_id, pg_catalog.gen_random_uuid(),
      selected_actor_id, selected_connector_id, 'DIRECTORY_SYNC', 'QUEUED',
      'initial-directory-sync',
      pg_catalog.jsonb_build_object('direct_signup_request_id', p_request_id),
      committed_time, committed_time, committed_time
    );

    INSERT INTO uptech.audit_events (
      workspace_id, id, actor_kind, action, target_type, target_id,
      outcome, request_id, metadata, occurred_at
    ) VALUES (
      target_workspace_id, pg_catalog.gen_random_uuid(),
      'SYSTEM', 'GOOGLE_WORKSPACE_BOOTSTRAP_COMMITTED', 'CONNECTOR',
      selected_connector_id, 'SUCCEEDED', p_request_id,
      pg_catalog.jsonb_build_object('direct_signup', true), committed_time
    );

    INSERT INTO uptech.platform_audit_events (
      id, identity_id, action, target_type, outcome, request_id, metadata, occurred_at
    ) VALUES (
      pg_catalog.gen_random_uuid(), selected_identity_id,
      'GOOGLE_WORKSPACE_BOOTSTRAP_COMMITTED', 'GOOGLE_WORKSPACE_BOOTSTRAP',
      'SUCCEEDED', p_request_id,
      pg_catalog.jsonb_build_object(
        'direct_signup', true,
        'workspace_id', target_workspace_id
      ), committed_time
    );
  EXCEPTION WHEN unique_violation THEN
    RETURN ROW('ALREADY_REGISTERED', NULL, NULL, NULL, NULL, NULL)::uptech.direct_workspace_signup_result_v1;
  END;

  SET CONSTRAINTS uptech.workspace_domain_locators_alias_parent_check IMMEDIATE;
  SET CONSTRAINTS uptech.workspace_domain_locators_alias_parent_check DEFERRED;

  RETURN ROW(
    'CREATED',
    target_workspace_id,
    selected_identity_id,
    selected_user_id,
    selected_membership_id,
    selected_connector_id
  )::uptech.direct_workspace_signup_result_v1;
END
$function$;

REVOKE ALL ON FUNCTION uptech.complete_direct_workspace_signup_v1(
  text, text, text, text, uuid, text, text,
  uptech.google_workspace_verified_domain_v1[], text, text[], uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.complete_direct_workspace_signup_v1(
  text, text, text, text, uuid, text, text,
  uptech.google_workspace_verified_domain_v1[], text, text[], uuid
) TO uptech_api_runtime;

COMMIT;
