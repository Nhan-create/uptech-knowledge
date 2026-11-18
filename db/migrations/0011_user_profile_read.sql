\set ON_ERROR_STOP on

BEGIN;
SET LOCAL ROLE uptech_migration_owner;

-- Reads the verified Google identity and synced Directory profile fields
-- bound to the caller's active Web or Onboarding credential hash without
-- granting runtime roles direct SELECT access to uptech.identities or
-- uptech.people_profiles.
CREATE OR REPLACE FUNCTION uptech.read_current_browser_profile_v1(p_token_hash bytea)
RETURNS TABLE (
  auth_source text,
  user_id uuid,
  workspace_id uuid,
  workspace_role text,
  full_name text,
  email text,
  email_verified boolean,
  hosted_domain text,
  picture_url text,
  department text,
  org_unit_path text,
  google_is_admin boolean,
  google_is_delegated_admin boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech, pg_temp
AS $function$
  WITH auth_time AS (
    SELECT pg_catalog.transaction_timestamp() AS observed_at
  ),
  web_candidate AS (
    SELECT
      'WEB_SESSION'::text AS auth_source,
      s.user_id,
      s.workspace_id,
      m.role AS workspace_role,
      COALESCE(
        NULLIF(pg_catalog.btrim(profile.full_name), ''),
        NULLIF(pg_catalog.btrim(i.display_name_claim), '')
      ) AS full_name,
      COALESCE(
        NULLIF(pg_catalog.btrim(profile.primary_email), ''),
        NULLIF(pg_catalog.btrim(i.email_claim), '')
      ) AS email,
      i.email_verified,
      NULLIF(pg_catalog.btrim(i.hosted_domain_claim), '') AS hosted_domain,
      NULLIF(pg_catalog.btrim(i.picture_url_claim), '') AS picture_url,
      COALESCE(
        NULLIF(pg_catalog.btrim(profile.department), ''),
        profile.effective_department_key
      ) AS department,
      NULLIF(pg_catalog.btrim(profile.org_unit_path), '') AS org_unit_path,
      profile.google_is_admin,
      profile.google_is_delegated_admin
    FROM uptech.session_tokens AS st
    JOIN uptech.sessions AS s
      ON s.workspace_id = st.workspace_id
     AND s.id = st.session_id
     AND s.client_type = st.client_type
    JOIN uptech.users AS u ON u.id = s.user_id
    JOIN uptech.identities AS i
      ON i.id = s.identity_id
     AND i.user_id = s.user_id
    JOIN uptech.workspaces AS w ON w.workspace_id = s.workspace_id
    JOIN uptech.workspace_memberships AS m
      ON m.workspace_id = s.workspace_id
     AND m.id = s.membership_id
     AND m.user_id = s.user_id
    LEFT JOIN LATERAL (
      SELECT
        p.full_name,
        p.primary_email,
        p.department,
        p.effective_department_key,
        p.org_unit_path,
        p.google_is_admin,
        p.google_is_delegated_admin
      FROM uptech.people_sync_generations AS g
      JOIN uptech.people_profiles AS p
        ON p.workspace_id = g.workspace_id
       AND p.generation_id = g.id
       AND p.google_subject = i.provider_subject
       AND p.lifecycle_state = 'ACTIVE'
      WHERE g.workspace_id = s.workspace_id
        AND g.status = 'PUBLISHED'
        AND g.traversal_complete
        AND g.completed_at IS NOT NULL
      ORDER BY g.completed_at DESC, g.id DESC
      LIMIT 1
    ) AS profile ON true
    CROSS JOIN auth_time AS t
    WHERE pg_catalog.octet_length(p_token_hash) = 32
      AND st.token_hash = p_token_hash
      AND st.token_kind = 'WEB_SESSION'
      AND st.expires_at > t.observed_at
      AND st.revoked_at IS NULL
      AND (
        (
          st.token_status = 'CURRENT'
          AND st.rotation_version = s.current_rotation_version
        )
        OR (
          st.token_status = 'PREVIOUS'
          AND st.rotation_version + 1 = s.current_rotation_version
          AND st.previous_valid_until > t.observed_at
        )
      )
      AND st.session_security_version = s.security_version
      AND s.status = 'ACTIVE'
      AND s.revoked_at IS NULL
      AND s.idle_expires_at > t.observed_at
      AND s.absolute_expires_at > t.observed_at
      AND u.status = 'ACTIVE'
      AND i.status = 'ACTIVE'
      AND w.status = 'ACTIVE'
      AND m.status = 'ACTIVE'
      AND s.user_security_version = u.security_version
      AND s.identity_security_version = i.security_version
      AND s.workspace_security_version = w.security_version
      AND s.membership_authz_version = m.authz_version
  ),
  onboarding_candidate AS (
    SELECT
      'ONBOARDING'::text AS auth_source,
      i.user_id,
      NULL::uuid AS workspace_id,
      NULL::text AS workspace_role,
      NULLIF(pg_catalog.btrim(i.display_name_claim), '') AS full_name,
      NULLIF(pg_catalog.btrim(i.email_claim), '') AS email,
      i.email_verified,
      NULLIF(pg_catalog.btrim(i.hosted_domain_claim), '') AS hosted_domain,
      NULLIF(pg_catalog.btrim(i.picture_url_claim), '') AS picture_url,
      NULL::text AS department,
      NULL::text AS org_unit_path,
      NULL::boolean AS google_is_admin,
      NULL::boolean AS google_is_delegated_admin
    FROM uptech.onboarding_sessions AS os
    JOIN uptech.identities AS i ON i.id = os.identity_id
    JOIN uptech.users AS u ON u.id = i.user_id
    CROSS JOIN auth_time AS t
    WHERE pg_catalog.octet_length(p_token_hash) = 32
      AND os.token_hash = p_token_hash
      AND os.status = 'ACTIVE'
      AND os.consumed_at IS NULL
      AND os.revoked_at IS NULL
      AND os.expires_at > t.observed_at
      AND i.status = 'ACTIVE'
      AND u.status = 'ACTIVE'
  ),
  candidates AS (
    SELECT * FROM web_candidate
    UNION ALL
    SELECT * FROM onboarding_candidate
  ),
  masked_unique_candidate AS (
    SELECT candidates.*, count(*) OVER () AS candidate_count
    FROM candidates
  )
  SELECT
    candidate.auth_source,
    candidate.user_id,
    candidate.workspace_id,
    candidate.workspace_role,
    candidate.full_name,
    candidate.email,
    candidate.email_verified,
    candidate.hosted_domain,
    candidate.picture_url,
    candidate.department,
    candidate.org_unit_path,
    candidate.google_is_admin,
    candidate.google_is_delegated_admin
  FROM masked_unique_candidate AS candidate
  WHERE candidate.candidate_count = 1
$function$;

-- Persists verified Google OIDC display metadata onto the active session's
-- identity row without modifying the A1/A4 login assertion type contract.
CREATE OR REPLACE FUNCTION uptech.sync_identity_google_profile_claims_v1(
  p_token_hash bytea,
  p_display_name text,
  p_picture_url text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech, pg_temp
AS $function$
DECLARE
  v_display_name text;
  v_picture_url text;
  v_identity_id uuid;
  v_observed_at timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_token_hash IS NULL OR pg_catalog.octet_length(p_token_hash) <> 32 THEN
    RETURN;
  END IF;

  v_display_name := NULLIF(pg_catalog.btrim(p_display_name), '');
  IF v_display_name IS NOT NULL AND (
    pg_catalog.length(v_display_name) > 200
    OR v_display_name ~ '[\x00-\x1f\x7f]'
  ) THEN
    v_display_name := NULL;
  END IF;

  v_picture_url := NULLIF(pg_catalog.btrim(p_picture_url), '');
  IF v_picture_url IS NOT NULL AND (
    pg_catalog.length(v_picture_url) > 2048
    OR v_picture_url !~ '^https://[^[:space:]@]+$'
    OR v_picture_url ~ '[\x00-\x1f\x7f]'
  ) THEN
    v_picture_url := NULL;
  END IF;

  IF v_display_name IS NULL AND v_picture_url IS NULL THEN
    RETURN;
  END IF;

  SELECT candidate.identity_id
  INTO v_identity_id
  FROM (
    SELECT s.identity_id
    FROM uptech.session_tokens AS st
    JOIN uptech.sessions AS s
      ON s.workspace_id = st.workspace_id
     AND s.id = st.session_id
     AND s.client_type = st.client_type
    JOIN uptech.users AS u ON u.id = s.user_id
    JOIN uptech.identities AS i
      ON i.id = s.identity_id
     AND i.user_id = s.user_id
    WHERE st.token_hash = p_token_hash
      AND st.token_kind = 'WEB_SESSION'
      AND st.token_status = 'CURRENT'
      AND st.revoked_at IS NULL
      AND st.expires_at > v_observed_at
      AND s.status = 'ACTIVE'
      AND s.revoked_at IS NULL
      AND s.idle_expires_at > v_observed_at
      AND s.absolute_expires_at > v_observed_at
      AND u.status = 'ACTIVE'
      AND i.status = 'ACTIVE'
    UNION ALL
    SELECT os.identity_id
    FROM uptech.onboarding_sessions AS os
    JOIN uptech.identities AS i ON i.id = os.identity_id
    JOIN uptech.users AS u ON u.id = i.user_id
    WHERE os.token_hash = p_token_hash
      AND os.status = 'ACTIVE'
      AND os.consumed_at IS NULL
      AND os.revoked_at IS NULL
      AND os.expires_at > v_observed_at
      AND i.status = 'ACTIVE'
      AND u.status = 'ACTIVE'
  ) AS candidate
  LIMIT 1;

  IF v_identity_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE uptech.identities
  SET display_name_claim = COALESCE(v_display_name, display_name_claim),
      picture_url_claim = COALESCE(v_picture_url, picture_url_claim),
      updated_at = v_observed_at
  WHERE id = v_identity_id;
END
$function$;

REVOKE ALL ON FUNCTION uptech.read_current_browser_profile_v1(bytea)
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.read_current_browser_profile_v1(bytea)
  TO uptech_api_runtime;

REVOKE ALL ON FUNCTION uptech.sync_identity_google_profile_claims_v1(bytea, text, text)
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.sync_identity_google_profile_claims_v1(bytea, text, text)
  TO uptech_api_runtime;

COMMIT;
