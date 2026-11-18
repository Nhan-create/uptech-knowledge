CREATE TYPE uptech.direct_workspace_signup_result_v1 AS (
  outcome text,
  workspace_id uuid,
  identity_id uuid,
  user_id uuid,
  membership_id uuid,
  connector_id uuid
);

REVOKE ALL ON TYPE uptech.direct_workspace_signup_result_v1
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;

CREATE FUNCTION uptech.complete_direct_workspace_signup_v1(
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

  IF EXISTS (SELECT 1 FROM uptech.workspaces WHERE google_customer_id = p_customer_id)
    OR EXISTS (
      SELECT 1 FROM pg_catalog.unnest(normalized_domains) AS supplied
      JOIN uptech.workspace_domain_locators AS locator
        ON locator.normalized_domain::text = supplied.normalized_domain
    )
    OR EXISTS (
      SELECT 1 FROM uptech.workspace_memberships AS m
      WHERE m.user_id = selected_user_id
    )
  THEN
    RETURN ROW('ALREADY_REGISTERED', NULL, NULL, NULL, NULL, NULL)::uptech.direct_workspace_signup_result_v1;
  END IF;

  BEGIN
    INSERT INTO uptech.workspaces (
      workspace_id, status, provisioning_policy, google_customer_id,
      created_at, updated_at
    ) VALUES (
      p_candidate_workspace_id, 'ACTIVE',
      'GOOGLE_GROUP_CONTROLLED', p_customer_id, committed_time, committed_time
    );

    INSERT INTO uptech.workspace_domain_locators (
      normalized_domain, workspace_id, status, verified_at, created_at, updated_at,
      google_customer_id, domain_kind, provider_parent_domain
    )
    SELECT supplied.normalized_domain::uptech.google_normalized_domain_v1,
      p_candidate_workspace_id, 'VERIFIED', committed_time,
      committed_time, committed_time, p_customer_id, supplied.domain_kind,
      supplied.provider_parent_domain::uptech.google_normalized_domain_v1
    FROM pg_catalog.unnest(normalized_domains) AS supplied;

    INSERT INTO uptech.workspace_memberships (
      workspace_id, id, user_id, role, status, created_at, updated_at
    ) VALUES (
      p_candidate_workspace_id, selected_membership_id,
      selected_user_id, 'OWNER', 'ACTIVE', committed_time, committed_time
    );

    INSERT INTO uptech.service_actors (
      workspace_id, id, actor_kind, status, created_at, updated_at
    ) VALUES (
      p_candidate_workspace_id, selected_actor_id,
      'SYNC_WORKER', 'ACTIVE', committed_time, committed_time
    );

    INSERT INTO uptech.connectors (
      workspace_id, id, purpose, status, created_at, updated_at,
      provider_customer_id, credential_reference,
      directory_authorized_by_identity_id, directory_authorized_scopes
    ) VALUES (
      p_candidate_workspace_id, selected_connector_id,
      'DIRECTORY', 'ACTIVE', committed_time, committed_time, p_customer_id,
      p_credential_reference, selected_identity_id, p_authorized_scopes
    );

    INSERT INTO uptech.sync_jobs (
      workspace_id, id, service_actor_id, connector_id, job_kind, status,
      dedupe_key, payload, available_at, created_at, updated_at
    ) VALUES (
      p_candidate_workspace_id, pg_catalog.gen_random_uuid(),
      selected_actor_id, selected_connector_id, 'DIRECTORY_SYNC', 'QUEUED',
      'initial-directory-sync',
      pg_catalog.jsonb_build_object('direct_signup_request_id', p_request_id),
      committed_time, committed_time, committed_time
    );

    INSERT INTO uptech.audit_events (
      workspace_id, id, actor_kind, action, target_type, target_id,
      outcome, request_id, metadata, occurred_at
    ) VALUES (
      p_candidate_workspace_id, pg_catalog.gen_random_uuid(),
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
        'workspace_id', p_candidate_workspace_id
      ), committed_time
    );
  EXCEPTION WHEN unique_violation THEN
    RETURN ROW('ALREADY_REGISTERED', NULL, NULL, NULL, NULL, NULL)::uptech.direct_workspace_signup_result_v1;
  END;

  SET CONSTRAINTS uptech.workspace_domain_locators_alias_parent_check IMMEDIATE;
  SET CONSTRAINTS uptech.workspace_domain_locators_alias_parent_check DEFERRED;

  RETURN ROW(
    'CREATED',
    p_candidate_workspace_id,
    selected_identity_id,
    selected_user_id,
    selected_membership_id,
    selected_connector_id
  )::uptech.direct_workspace_signup_result_v1;
END
$function$;

CREATE FUNCTION uptech.issue_direct_signup_web_session_v1(
  p_workspace_id uuid,
  p_user_id uuid,
  p_identity_id uuid,
  p_membership_id uuid,
  p_session_token_hash uptech.google_auth_hash32_v1,
  p_csrf_token_hash uptech.google_auth_hash32_v1,
  p_request_id uuid
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  selected_workspace uptech.workspaces%ROWTYPE;
  selected_user uptech.users%ROWTYPE;
  selected_identity uptech.identities%ROWTYPE;
  selected_membership uptech.workspace_memberships%ROWTYPE;
  selected_generation_id uuid;
  selected_session_id uuid := pg_catalog.gen_random_uuid();
  observed_at timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_workspace_id IS NULL OR p_user_id IS NULL OR p_identity_id IS NULL
    OR p_membership_id IS NULL OR p_session_token_hash IS NULL
    OR p_csrf_token_hash IS NULL OR p_request_id IS NULL
  THEN
    RETURN 'DENIED';
  END IF;

  SELECT * INTO selected_workspace
  FROM uptech.workspaces
  WHERE workspace_id = p_workspace_id AND status = 'ACTIVE'
    AND provisioning_policy = 'GOOGLE_GROUP_CONTROLLED'
  FOR UPDATE;

  SELECT * INTO selected_user
  FROM uptech.users
  WHERE id = p_user_id AND status = 'ACTIVE'
  FOR UPDATE;

  SELECT * INTO selected_identity
  FROM uptech.identities
  WHERE id = p_identity_id AND user_id = p_user_id AND status = 'ACTIVE'
  FOR UPDATE;

  SELECT * INTO selected_membership
  FROM uptech.workspace_memberships
  WHERE workspace_id = p_workspace_id AND id = p_membership_id
    AND user_id = p_user_id AND role = 'OWNER' AND status = 'ACTIVE'
  FOR UPDATE;

  IF selected_workspace.workspace_id IS NULL OR selected_user.id IS NULL
    OR selected_identity.id IS NULL OR selected_membership.id IS NULL
  THEN
    RETURN 'DENIED';
  END IF;

  SELECT generation.id INTO selected_generation_id
  FROM uptech.people_sync_generations AS generation
  JOIN uptech.people_profiles AS profile
    ON profile.workspace_id = generation.workspace_id
   AND profile.generation_id = generation.id
   AND profile.google_subject = selected_identity.provider_subject
   AND profile.lifecycle_state = 'ACTIVE'
  WHERE generation.workspace_id = p_workspace_id
    AND generation.google_customer_id = selected_workspace.google_customer_id
    AND generation.status = 'PUBLISHED'
    AND generation.traversal_complete
    AND generation.completed_at IS NOT NULL
    AND generation.fresh_until > observed_at
  ORDER BY generation.completed_at DESC, generation.id DESC
  LIMIT 1;

  IF selected_generation_id IS NULL THEN
    RETURN 'DENIED';
  END IF;

  INSERT INTO uptech.sessions (
    workspace_id, id, identity_id, user_id, membership_id, client_type, status,
    user_security_version, identity_security_version, workspace_security_version,
    membership_authz_version, security_version, current_rotation_version,
    created_at, last_seen_at, idle_expires_at, absolute_expires_at
  ) VALUES (
    p_workspace_id, selected_session_id, p_identity_id, p_user_id, p_membership_id,
    'WEB', 'ACTIVE', selected_user.security_version, selected_identity.security_version,
    selected_workspace.security_version, selected_membership.authz_version,
    1, 1, observed_at, observed_at,
    observed_at + interval '8 hours', observed_at + interval '24 hours'
  );

  INSERT INTO uptech.session_tokens (
    workspace_id, id, session_id, client_type, token_kind, token_status,
    token_hash, csrf_token_hash, session_security_version, rotation_version,
    issued_at, expires_at
  ) VALUES (
    p_workspace_id, pg_catalog.gen_random_uuid(), selected_session_id,
    'WEB', 'WEB_SESSION', 'CURRENT',
    p_session_token_hash, p_csrf_token_hash, 1, 1,
    observed_at, observed_at + interval '24 hours'
  );

  INSERT INTO uptech.platform_audit_events (
    id, identity_id, action, target_type, outcome, request_id, metadata, occurred_at
  ) VALUES (
    pg_catalog.gen_random_uuid(), p_identity_id,
    'GOOGLE_AUTH_LOGIN_SUCCEEDED', 'SESSION', 'SUCCEEDED', p_request_id,
    pg_catalog.jsonb_build_object('direct_signup', true, 'identity_id', p_identity_id),
    observed_at
  );

  INSERT INTO uptech.audit_events (
    workspace_id, id, actor_kind, actor_id, membership_id, session_id,
    action, target_type, target_id, outcome, request_id, metadata, occurred_at
  ) VALUES (
    p_workspace_id, pg_catalog.gen_random_uuid(), 'USER', p_user_id,
    p_membership_id, selected_session_id,
    'GOOGLE_AUTH_LOGIN_SUCCEEDED', 'SESSION', selected_session_id,
    'SUCCEEDED', p_request_id,
    pg_catalog.jsonb_build_object('direct_signup', true, 'identity_id', p_identity_id),
    observed_at
  );

  RETURN 'SESSION_ISSUED';
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

REVOKE ALL ON FUNCTION uptech.issue_direct_signup_web_session_v1(
  uuid, uuid, uuid, uuid, uptech.google_auth_hash32_v1, uptech.google_auth_hash32_v1, uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.issue_direct_signup_web_session_v1(
  uuid, uuid, uuid, uuid, uptech.google_auth_hash32_v1, uptech.google_auth_hash32_v1, uuid
) TO uptech_api_runtime;
