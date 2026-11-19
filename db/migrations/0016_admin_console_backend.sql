\set ON_ERROR_STOP on

BEGIN;
SET LOCAL ROLE uptech_migration_owner;

-- =============================================================================
-- 1. Tenant-scoped Admin Console Tables (RLS-enforced on app.workspace_id)
-- =============================================================================

CREATE TABLE IF NOT EXISTS uptech.workspace_settings (
  workspace_id uuid PRIMARY KEY REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT,
  organization_name text NOT NULL,
  default_locale text NOT NULL DEFAULT 'vi',
  retention_days integer NOT NULL DEFAULT 365,
  max_upload_mb integer NOT NULL DEFAULT 25,
  allow_member_uploads boolean NOT NULL DEFAULT true,
  require_verified_cards_in_chat boolean NOT NULL DEFAULT false,
  audit_export_enabled boolean NOT NULL DEFAULT true,
  updated_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  CONSTRAINT workspace_settings_org_name_check CHECK (pg_catalog.length(pg_catalog.btrim(organization_name)) BETWEEN 1 AND 120),
  CONSTRAINT workspace_settings_locale_check CHECK (default_locale IN ('vi', 'en')),
  CONSTRAINT workspace_settings_retention_check CHECK (retention_days BETWEEN 30 AND 3650),
  CONSTRAINT workspace_settings_max_upload_check CHECK (max_upload_mb BETWEEN 1 AND 100),
  CONSTRAINT workspace_settings_timestamps_check CHECK (updated_at >= created_at)
);

ALTER TABLE uptech.workspace_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.workspace_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_settings_migration_owner ON uptech.workspace_settings;
CREATE POLICY workspace_settings_migration_owner ON uptech.workspace_settings
  TO uptech_migration_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS workspace_settings_api_scope ON uptech.workspace_settings;
CREATE POLICY workspace_settings_api_scope ON uptech.workspace_settings
  TO uptech_api_runtime
  USING (workspace_id = NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON uptech.workspace_settings TO uptech_api_runtime;

CREATE TABLE IF NOT EXISTS uptech.workspace_billing_profiles (
  workspace_id uuid PRIMARY KEY REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT,
  plan_code text NOT NULL DEFAULT 'STARTER',
  billing_cycle text NOT NULL DEFAULT 'MONTHLY',
  seat_limit integer NOT NULL DEFAULT 25,
  storage_limit_mb integer NOT NULL DEFAULT 5120,
  monthly_ai_turn_limit integer NOT NULL DEFAULT 2000,
  billing_contact_email text,
  company_legal_name text,
  tax_id text,
  updated_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  CONSTRAINT workspace_billing_plan_check CHECK (plan_code IN ('STARTER', 'GROWTH', 'ENTERPRISE')),
  CONSTRAINT workspace_billing_cycle_check CHECK (billing_cycle IN ('MONTHLY', 'ANNUAL')),
  CONSTRAINT workspace_billing_seat_limit_check CHECK (seat_limit BETWEEN 1 AND 100000),
  CONSTRAINT workspace_billing_storage_limit_check CHECK (storage_limit_mb BETWEEN 100 AND 1048576),
  CONSTRAINT workspace_billing_ai_turn_limit_check CHECK (monthly_ai_turn_limit BETWEEN 100 AND 1000000),
  CONSTRAINT workspace_billing_timestamps_check CHECK (updated_at >= created_at)
);

ALTER TABLE uptech.workspace_billing_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.workspace_billing_profiles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_billing_profiles_migration_owner ON uptech.workspace_billing_profiles;
CREATE POLICY workspace_billing_profiles_migration_owner ON uptech.workspace_billing_profiles
  TO uptech_migration_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS workspace_billing_profiles_api_scope ON uptech.workspace_billing_profiles;
CREATE POLICY workspace_billing_profiles_api_scope ON uptech.workspace_billing_profiles
  TO uptech_api_runtime
  USING (workspace_id = NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON uptech.workspace_billing_profiles TO uptech_api_runtime;

CREATE TABLE IF NOT EXISTS uptech.workspace_member_invites (
  workspace_id uuid NOT NULL REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT,
  id uuid NOT NULL,
  normalized_email text COLLATE "C" NOT NULL,
  role text NOT NULL DEFAULT 'MEMBER',
  department_key text,
  status text NOT NULL DEFAULT 'PENDING',
  invited_by_user_id uuid NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT workspace_member_invites_email_check CHECK (
    pg_catalog.length(normalized_email) BETWEEN 3 AND 320
    AND normalized_email = pg_catalog.lower(pg_catalog.btrim(normalized_email))
    AND pg_catalog.position('@' IN normalized_email) > 1
  ),
  CONSTRAINT workspace_member_invites_role_check CHECK (role IN ('ADMIN', 'MEMBER')),
  CONSTRAINT workspace_member_invites_department_check CHECK (
    department_key IS NULL OR department_key IN ('SALES', 'HR', 'IT', 'FINANCE')
  ),
  CONSTRAINT workspace_member_invites_status_check CHECK (
    status IN ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')
  ),
  CONSTRAINT workspace_member_invites_expiry_check CHECK (
    expires_at > created_at AND expires_at <= created_at + interval '30 days'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_member_invites_one_pending_email_idx
  ON uptech.workspace_member_invites (workspace_id, normalized_email)
  WHERE status = 'PENDING';

ALTER TABLE uptech.workspace_member_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.workspace_member_invites FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_member_invites_migration_owner ON uptech.workspace_member_invites;
CREATE POLICY workspace_member_invites_migration_owner ON uptech.workspace_member_invites
  TO uptech_migration_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS workspace_member_invites_api_scope ON uptech.workspace_member_invites;
CREATE POLICY workspace_member_invites_api_scope ON uptech.workspace_member_invites
  TO uptech_api_runtime
  USING (workspace_id = NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON uptech.workspace_member_invites TO uptech_api_runtime;

-- =============================================================================
-- 2. Internal Admin Caller Authority Helper (SECURITY DEFINER)
-- =============================================================================

CREATE OR REPLACE FUNCTION uptech.require_admin_caller_v1()
RETURNS TABLE (
  workspace_id uuid,
  caller_role text,
  actor_id uuid,
  membership_id uuid,
  session_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech, pg_temp
AS $function$
DECLARE
  v_workspace_id uuid;
  v_role text;
  v_actor_id uuid;
  v_membership_id uuid;
  v_session_id uuid;
BEGIN
  SELECT ctx.workspace_id, ctx.membership_role
  INTO v_workspace_id, v_role
  FROM uptech.load_people_permission_context_v1() AS ctx
  LIMIT 1;

  v_actor_id := NULLIF(pg_catalog.current_setting('app.actor_id', true), '')::uuid;
  v_membership_id := NULLIF(pg_catalog.current_setting('app.membership_id', true), '')::uuid;
  v_session_id := NULLIF(pg_catalog.current_setting('app.session_id', true), '')::uuid;

  IF v_workspace_id IS NULL
     OR v_role NOT IN ('OWNER', 'ADMIN')
     OR v_actor_id IS NULL
     OR v_membership_id IS NULL
     OR v_session_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'admin authority required';
  END IF;

  RETURN QUERY SELECT v_workspace_id, v_role, v_actor_id, v_membership_id, v_session_id;
END
$function$;

REVOKE ALL ON FUNCTION uptech.require_admin_caller_v1()
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;

-- =============================================================================
-- 3. Admin Audit Event Writer (SECURITY DEFINER)
-- =============================================================================

CREATE OR REPLACE FUNCTION uptech.admin_write_audit_event_v1(
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_outcome text,
  p_request_id uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech, pg_temp
AS $function$
DECLARE
  caller record;
  v_event_id uuid := pg_catalog.gen_random_uuid();
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  SELECT * INTO caller FROM uptech.require_admin_caller_v1();

  INSERT INTO uptech.audit_events (
    workspace_id, id, actor_kind, actor_id, membership_id, session_id,
    action, target_type, target_id, outcome, request_id, metadata, occurred_at
  ) VALUES (
    caller.workspace_id,
    v_event_id,
    'USER',
    caller.actor_id,
    caller.membership_id,
    caller.session_id,
    pg_catalog.left(pg_catalog.btrim(p_action), 120),
    pg_catalog.left(pg_catalog.btrim(p_target_type), 80),
    p_target_id,
    CASE WHEN p_outcome IN ('SUCCEEDED', 'DENIED', 'FAILED') THEN p_outcome ELSE 'SUCCEEDED' END,
    COALESCE(p_request_id, pg_catalog.gen_random_uuid()),
    CASE WHEN p_metadata IS NOT NULL AND pg_catalog.jsonb_typeof(p_metadata) = 'object'
         THEN p_metadata ELSE '{}'::jsonb END,
    v_now
  );

  RETURN v_event_id;
END
$function$;

REVOKE ALL ON FUNCTION uptech.admin_write_audit_event_v1(text, text, uuid, text, uuid, jsonb)
  FROM PUBLIC, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.admin_write_audit_event_v1(text, text, uuid, text, uuid, jsonb)
  TO uptech_api_runtime;

-- =============================================================================
-- 4. Users, Invites, Access Requests & Directory Groups (SECURITY DEFINER)
-- =============================================================================

CREATE OR REPLACE FUNCTION uptech.admin_list_members_v1()
RETURNS TABLE (
  membership_id uuid,
  user_id uuid,
  role text,
  status text,
  email text,
  full_name text,
  picture_url text,
  hosted_domain text,
  department text,
  org_unit_path text,
  google_is_admin boolean,
  active_session_count integer,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech, pg_temp
AS $function$
DECLARE
  caller record;
BEGIN
  SELECT * INTO caller FROM uptech.require_admin_caller_v1();

  RETURN QUERY
  WITH latest_gen AS (
    SELECT g.id
    FROM uptech.people_sync_generations AS g
    WHERE g.workspace_id = caller.workspace_id
      AND g.status = 'PUBLISHED'
      AND g.traversal_complete
      AND g.completed_at IS NOT NULL
    ORDER BY g.completed_at DESC, g.id DESC
    LIMIT 1
  )
  SELECT
    m.id AS membership_id,
    m.user_id,
    m.role,
    m.status,
    COALESCE(
      NULLIF(pg_catalog.btrim(pp.primary_email), ''),
      NULLIF(pg_catalog.btrim(ident.email_claim), '')
    ) AS email,
    COALESCE(
      NULLIF(pg_catalog.btrim(pp.full_name), ''),
      NULLIF(pg_catalog.btrim(ident.display_name_claim), '')
    ) AS full_name,
    NULLIF(pg_catalog.btrim(ident.picture_url_claim), '') AS picture_url,
    NULLIF(pg_catalog.btrim(ident.hosted_domain_claim), '') AS hosted_domain,
    COALESCE(
      NULLIF(pg_catalog.btrim(pp.department), ''),
      pp.effective_department_key
    ) AS department,
    NULLIF(pg_catalog.btrim(pp.org_unit_path), '') AS org_unit_path,
    pp.google_is_admin,
    COALESCE((
      SELECT pg_catalog.count(*)::integer
      FROM uptech.sessions AS s
      WHERE s.workspace_id = caller.workspace_id
        AND s.membership_id = m.id
        AND s.status = 'ACTIVE'
        AND s.revoked_at IS NULL
        AND s.idle_expires_at > pg_catalog.statement_timestamp()
        AND s.absolute_expires_at > pg_catalog.statement_timestamp()
    ), 0) AS active_session_count,
    m.created_at,
    m.updated_at
  FROM uptech.workspace_memberships AS m
  LEFT JOIN LATERAL (
    SELECT i.provider_subject, i.email_claim, i.display_name_claim, i.picture_url_claim, i.hosted_domain_claim
    FROM uptech.identities AS i
    WHERE i.user_id = m.user_id
      AND i.provider = 'GOOGLE'
    ORDER BY (i.status = 'ACTIVE') DESC, i.updated_at DESC
    LIMIT 1
  ) AS ident ON true
  LEFT JOIN latest_gen AS lg ON true
  LEFT JOIN uptech.people_profiles AS pp
    ON pp.workspace_id = caller.workspace_id
   AND pp.generation_id = lg.id
   AND pp.google_subject = ident.provider_subject
  WHERE m.workspace_id = caller.workspace_id
  ORDER BY
    CASE m.role WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 ELSE 2 END,
    CASE m.status WHEN 'ACTIVE' THEN 0 WHEN 'PENDING' THEN 1 WHEN 'SUSPENDED' THEN 2 ELSE 3 END,
    m.created_at ASC;
END
$function$;

REVOKE ALL ON FUNCTION uptech.admin_list_members_v1()
  FROM PUBLIC, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.admin_list_members_v1()
  TO uptech_api_runtime;

CREATE OR REPLACE FUNCTION uptech.admin_list_directory_groups_v1()
RETURNS TABLE (
  google_group_id text,
  group_name text,
  member_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech, pg_temp
AS $function$
DECLARE
  caller record;
BEGIN
  SELECT * INTO caller FROM uptech.require_admin_caller_v1();

  RETURN QUERY
  WITH latest_gen AS (
    SELECT g.id
    FROM uptech.people_sync_generations AS g
    WHERE g.workspace_id = caller.workspace_id
      AND g.status = 'PUBLISHED'
      AND g.traversal_complete
      AND g.completed_at IS NOT NULL
    ORDER BY g.completed_at DESC, g.id DESC
    LIMIT 1
  )
  SELECT
    pg.google_group_id,
    pg.group_name,
    COALESCE((
      SELECT pg_catalog.count(*)::integer
      FROM uptech.people_group_memberships AS gm
      WHERE gm.workspace_id = caller.workspace_id
        AND gm.generation_id = lg.id
        AND gm.google_group_id = pg.google_group_id
    ), 0) AS member_count
  FROM latest_gen AS lg
  JOIN uptech.people_groups AS pg
    ON pg.workspace_id = caller.workspace_id
   AND pg.generation_id = lg.id
  ORDER BY pg.group_name ASC;
END
$function$;

REVOKE ALL ON FUNCTION uptech.admin_list_directory_groups_v1()
  FROM PUBLIC, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.admin_list_directory_groups_v1()
  TO uptech_api_runtime;

CREATE OR REPLACE FUNCTION uptech.admin_list_directory_org_units_v1()
RETURNS TABLE (
  google_org_unit_id text,
  org_unit_path text,
  parent_org_unit_id text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech, pg_temp
AS $function$
DECLARE
  caller record;
BEGIN
  SELECT * INTO caller FROM uptech.require_admin_caller_v1();

  RETURN QUERY
  WITH latest_gen AS (
    SELECT g.id
    FROM uptech.people_sync_generations AS g
    WHERE g.workspace_id = caller.workspace_id
      AND g.status = 'PUBLISHED'
      AND g.traversal_complete
      AND g.completed_at IS NOT NULL
    ORDER BY g.completed_at DESC, g.id DESC
    LIMIT 1
  )
  SELECT
    ou.google_org_unit_id,
    ou.org_unit_path,
    ou.parent_org_unit_id
  FROM latest_gen AS lg
  JOIN uptech.people_org_units AS ou
    ON ou.workspace_id = caller.workspace_id
   AND ou.generation_id = lg.id
  ORDER BY ou.org_unit_path ASC;
END
$function$;

REVOKE ALL ON FUNCTION uptech.admin_list_directory_org_units_v1()
  FROM PUBLIC, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.admin_list_directory_org_units_v1()
  TO uptech_api_runtime;

CREATE OR REPLACE FUNCTION uptech.admin_list_access_requests_v1()
RETURNS TABLE (
  request_row_id uuid,
  identity_id uuid,
  email text,
  full_name text,
  reason_class text,
  status text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech, pg_temp
AS $function$
DECLARE
  caller record;
BEGIN
  SELECT * INTO caller FROM uptech.require_admin_caller_v1();

  RETURN QUERY
  SELECT
    ar.id AS request_row_id,
    ar.identity_id,
    NULLIF(pg_catalog.btrim(i.email_claim), '') AS email,
    NULLIF(pg_catalog.btrim(i.display_name_claim), '') AS full_name,
    ar.reason_class,
    ar.status::text,
    ar.created_at,
    ar.updated_at
  FROM uptech.workspace_access_requests AS ar
  JOIN uptech.identities AS i ON i.id = ar.identity_id
  WHERE ar.workspace_id = caller.workspace_id
  ORDER BY
    CASE ar.status::text WHEN 'PENDING' THEN 0 WHEN 'FULFILLED' THEN 1 ELSE 2 END,
    ar.created_at DESC
  LIMIT 100;
END
$function$;

REVOKE ALL ON FUNCTION uptech.admin_list_access_requests_v1()
  FROM PUBLIC, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.admin_list_access_requests_v1()
  TO uptech_api_runtime;

CREATE OR REPLACE FUNCTION uptech.admin_update_member_v1(
  p_target_membership_id uuid,
  p_new_role text,
  p_new_status text,
  p_request_id uuid
)
RETURNS TABLE (
  membership_id uuid,
  role text,
  status text,
  updated_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech, pg_temp
AS $function$
DECLARE
  caller record;
  target_row uptech.workspace_memberships%ROWTYPE;
  v_active_owner_count integer;
  v_next_role text;
  v_next_status text;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  SELECT * INTO caller FROM uptech.require_admin_caller_v1();

  SELECT * INTO target_row
  FROM uptech.workspace_memberships
  WHERE workspace_id = caller.workspace_id
    AND id = p_target_membership_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'member not found';
  END IF;

  v_next_role := COALESCE(NULLIF(pg_catalog.btrim(p_new_role), ''), target_row.role);
  v_next_status := COALESCE(NULLIF(pg_catalog.btrim(p_new_status), ''), target_row.status);

  IF v_next_role NOT IN ('OWNER', 'ADMIN', 'MEMBER') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid role';
  END IF;

  IF v_next_status NOT IN ('ACTIVE', 'SUSPENDED', 'DEPROVISIONED') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid status';
  END IF;

  -- Only OWNER may modify an OWNER or promote another user to OWNER.
  IF caller.caller_role <> 'OWNER' AND (target_row.role = 'OWNER' OR v_next_role = 'OWNER') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'owner authority required';
  END IF;

  -- Never allow removing or suspending the last active OWNER.
  IF target_row.role = 'OWNER' AND target_row.status = 'ACTIVE'
     AND (v_next_role <> 'OWNER' OR v_next_status <> 'ACTIVE') THEN
    SELECT pg_catalog.count(*)::integer
    INTO v_active_owner_count
    FROM uptech.workspace_memberships
    WHERE workspace_id = caller.workspace_id
      AND role = 'OWNER'
      AND status = 'ACTIVE';

    IF v_active_owner_count <= 1 THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'cannot remove last active owner';
    END IF;
  END IF;

  UPDATE uptech.workspace_memberships
  SET role = v_next_role,
      status = v_next_status,
      authz_version = authz_version + CASE
        WHEN role IS DISTINCT FROM v_next_role OR status IS DISTINCT FROM v_next_status THEN 1
        ELSE 0
      END,
      updated_at = v_now
  WHERE workspace_id = caller.workspace_id
    AND id = p_target_membership_id;

  IF v_next_status <> 'ACTIVE' THEN
    UPDATE uptech.sessions
    SET status = 'REVOKED',
        revoked_at = v_now
    WHERE workspace_id = caller.workspace_id
      AND membership_id = p_target_membership_id
      AND status = 'ACTIVE'
      AND revoked_at IS NULL;
  END IF;

  PERFORM uptech.admin_write_audit_event_v1(
    'ADMIN_MEMBER_UPDATED',
    'WORKSPACE_MEMBERSHIP',
    p_target_membership_id,
    'SUCCEEDED',
    p_request_id,
    pg_catalog.jsonb_build_object(
      'old_role', target_row.role,
      'new_role', v_next_role,
      'old_status', target_row.status,
      'new_status', v_next_status
    )
  );

  RETURN QUERY SELECT p_target_membership_id, v_next_role, v_next_status, v_now;
END
$function$;

REVOKE ALL ON FUNCTION uptech.admin_update_member_v1(uuid, text, text, uuid)
  FROM PUBLIC, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.admin_update_member_v1(uuid, text, text, uuid)
  TO uptech_api_runtime;

CREATE OR REPLACE FUNCTION uptech.admin_invite_member_v1(
  p_email text,
  p_role text,
  p_department_key text,
  p_note text,
  p_request_id uuid
)
RETURNS TABLE (
  invite_id uuid,
  normalized_email text,
  role text,
  department_key text,
  status text,
  provisioned_immediately boolean,
  expires_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech, pg_temp
AS $function$
DECLARE
  caller record;
  v_email text := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_email, '')));
  v_domain text;
  v_role text := COALESCE(NULLIF(pg_catalog.btrim(p_role), ''), 'MEMBER');
  v_dept text := NULLIF(pg_catalog.btrim(COALESCE(p_department_key, '')), '');
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_expires timestamptz := v_now + interval '7 days';
  v_invite_id uuid := pg_catalog.gen_random_uuid();
  v_existing_user_id uuid;
  v_provisioned boolean := false;
  v_invite_status text := 'PENDING';
BEGIN
  SELECT * INTO caller FROM uptech.require_admin_caller_v1();

  IF v_email = '' OR pg_catalog.position('@' IN v_email) <= 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid email';
  END IF;

  IF v_role NOT IN ('ADMIN', 'MEMBER') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid role';
  END IF;

  IF v_dept IS NOT NULL AND v_dept NOT IN ('SALES', 'HR', 'IT', 'FINANCE') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid department';
  END IF;

  v_domain := pg_catalog.split_part(v_email, '@', 2);
  IF NOT EXISTS (
    SELECT 1
    FROM uptech.workspace_domain_locators AS loc
    WHERE loc.workspace_id = caller.workspace_id
      AND loc.normalized_domain::text = v_domain
      AND loc.status = 'VERIFIED'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'email domain is not verified for this workspace';
  END IF;

  -- Check if this verified corporate email already has an identity in the system.
  SELECT i.user_id INTO v_existing_user_id
  FROM uptech.identities AS i
  WHERE i.provider = 'GOOGLE'
    AND pg_catalog.lower(i.email_claim) = v_email
    AND i.status = 'ACTIVE'
  ORDER BY i.updated_at DESC
  LIMIT 1;

  IF v_existing_user_id IS NOT NULL THEN
    -- Ensure user is not already bound to a different workspace.
    IF EXISTS (
      SELECT 1 FROM uptech.workspace_memberships AS other_m
      WHERE other_m.user_id = v_existing_user_id
        AND other_m.workspace_id <> caller.workspace_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'user belongs to another workspace';
    END IF;

    INSERT INTO uptech.workspace_memberships (
      workspace_id, id, user_id, role, status, created_at, updated_at
    ) VALUES (
      caller.workspace_id, pg_catalog.gen_random_uuid(), v_existing_user_id, v_role, 'ACTIVE', v_now, v_now
    )
    ON CONFLICT (workspace_id, user_id)
    DO UPDATE SET
      role = CASE WHEN uptech.workspace_memberships.role = 'OWNER' THEN 'OWNER' ELSE EXCLUDED.role END,
      status = 'ACTIVE',
      authz_version = uptech.workspace_memberships.authz_version + 1,
      updated_at = v_now;

    v_provisioned := true;
    v_invite_status := 'ACCEPTED';
  END IF;

  -- Revoke any prior pending invite for the same email before inserting the new one.
  UPDATE uptech.workspace_member_invites
  SET status = 'REVOKED', revoked_at = v_now
  WHERE workspace_id = caller.workspace_id
    AND normalized_email = v_email
    AND status = 'PENDING';

  INSERT INTO uptech.workspace_member_invites (
    workspace_id, id, normalized_email, role, department_key, status,
    invited_by_user_id, note, created_at, expires_at, accepted_at
  ) VALUES (
    caller.workspace_id,
    v_invite_id,
    v_email,
    v_role,
    v_dept,
    v_invite_status,
    caller.actor_id,
    NULLIF(pg_catalog.left(pg_catalog.btrim(COALESCE(p_note, '')), 240), ''),
    v_now,
    v_expires,
    CASE WHEN v_provisioned THEN v_now ELSE NULL END
  );

  PERFORM uptech.admin_write_audit_event_v1(
    'ADMIN_MEMBER_INVITED',
    'WORKSPACE_INVITE',
    v_invite_id,
    'SUCCEEDED',
    p_request_id,
    pg_catalog.jsonb_build_object(
      'email', v_email,
      'role', v_role,
      'department_key', v_dept,
      'provisioned_immediately', v_provisioned
    )
  );

  RETURN QUERY SELECT v_invite_id, v_email, v_role, v_dept, v_invite_status, v_provisioned, v_expires;
END
$function$;

REVOKE ALL ON FUNCTION uptech.admin_invite_member_v1(text, text, text, text, uuid)
  FROM PUBLIC, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.admin_invite_member_v1(text, text, text, text, uuid)
  TO uptech_api_runtime;

CREATE OR REPLACE FUNCTION uptech.admin_resolve_access_request_v1(
  p_request_row_id uuid,
  p_decision text,
  p_role text,
  p_request_id uuid
)
RETURNS TABLE (
  request_row_id uuid,
  status text,
  membership_created boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech, pg_temp
AS $function$
DECLARE
  caller record;
  req_row uptech.workspace_access_requests%ROWTYPE;
  v_user_id uuid;
  v_role text := COALESCE(NULLIF(pg_catalog.btrim(p_role), ''), 'MEMBER');
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_created boolean := false;
BEGIN
  SELECT * INTO caller FROM uptech.require_admin_caller_v1();

  IF p_decision NOT IN ('APPROVE', 'REJECT') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid decision';
  END IF;

  IF v_role NOT IN ('ADMIN', 'MEMBER') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid role';
  END IF;

  SELECT * INTO req_row
  FROM uptech.workspace_access_requests
  WHERE workspace_id = caller.workspace_id
    AND id = p_request_row_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'access request not found';
  END IF;

  IF req_row.status::text <> 'PENDING' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'access request already resolved';
  END IF;

  IF p_decision = 'APPROVE' THEN
    SELECT i.user_id INTO v_user_id
    FROM uptech.identities AS i
    WHERE i.id = req_row.identity_id;

    IF v_user_id IS NOT NULL THEN
      INSERT INTO uptech.workspace_memberships (
        workspace_id, id, user_id, role, status, created_at, updated_at
      ) VALUES (
        caller.workspace_id, pg_catalog.gen_random_uuid(), v_user_id, v_role, 'ACTIVE', v_now, v_now
      )
      ON CONFLICT (workspace_id, user_id)
      DO UPDATE SET
        role = CASE WHEN uptech.workspace_memberships.role = 'OWNER' THEN 'OWNER' ELSE EXCLUDED.role END,
        status = 'ACTIVE',
        authz_version = uptech.workspace_memberships.authz_version + 1,
        updated_at = v_now;
      v_created := true;
    END IF;

    UPDATE uptech.workspace_access_requests
    SET status = 'FULFILLED'::uptech.workspace_access_request_status_v1,
        fulfilled_at = v_now,
        updated_at = v_now
    WHERE workspace_id = caller.workspace_id
      AND id = p_request_row_id;

    PERFORM uptech.admin_write_audit_event_v1(
      'ADMIN_ACCESS_REQUEST_APPROVED',
      'WORKSPACE_ACCESS_REQUEST',
      p_request_row_id,
      'SUCCEEDED',
      p_request_id,
      pg_catalog.jsonb_build_object('assigned_role', v_role, 'membership_created', v_created)
    );

    RETURN QUERY SELECT p_request_row_id, 'FULFILLED'::text, v_created;
  ELSE
    UPDATE uptech.workspace_access_requests
    SET status = 'CANCELLED'::uptech.workspace_access_request_status_v1,
        cancelled_at = v_now,
        updated_at = v_now
    WHERE workspace_id = caller.workspace_id
      AND id = p_request_row_id;

    PERFORM uptech.admin_write_audit_event_v1(
      'ADMIN_ACCESS_REQUEST_REJECTED',
      'WORKSPACE_ACCESS_REQUEST',
      p_request_row_id,
      'SUCCEEDED',
      p_request_id,
      '{}'::jsonb
    );

    RETURN QUERY SELECT p_request_row_id, 'CANCELLED'::text, false;
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION uptech.admin_resolve_access_request_v1(uuid, text, text, uuid)
  FROM PUBLIC, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.admin_resolve_access_request_v1(uuid, text, text, uuid)
  TO uptech_api_runtime;

-- =============================================================================
-- 5. Permission Mappings (SECURITY DEFINER)
-- =============================================================================

CREATE OR REPLACE FUNCTION uptech.admin_list_permission_mappings_v1()
RETURNS TABLE (
  mapping_id uuid,
  source_kind text,
  source_value text,
  target_role text,
  target_department_key text,
  status text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech, pg_temp
AS $function$
DECLARE
  caller record;
BEGIN
  SELECT * INTO caller FROM uptech.require_admin_caller_v1();

  RETURN QUERY
  SELECT
    m.id AS mapping_id,
    m.source_kind,
    m.source_value,
    m.target_role,
    m.target_department_key,
    m.status,
    m.created_at,
    m.updated_at
  FROM uptech.people_permission_mappings AS m
  WHERE m.workspace_id = caller.workspace_id
  ORDER BY
    CASE m.source_kind WHEN 'ADMIN_GROUP' THEN 0 WHEN 'GROUP' THEN 1 WHEN 'ORG_UNIT' THEN 2 ELSE 3 END,
    m.source_value ASC;
END
$function$;

REVOKE ALL ON FUNCTION uptech.admin_list_permission_mappings_v1()
  FROM PUBLIC, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.admin_list_permission_mappings_v1()
  TO uptech_api_runtime;

CREATE OR REPLACE FUNCTION uptech.admin_upsert_permission_mapping_v1(
  p_source_kind text,
  p_source_value text,
  p_target_department_key text,
  p_status text,
  p_request_id uuid
)
RETURNS TABLE (
  mapping_id uuid,
  source_kind text,
  source_value text,
  target_role text,
  target_department_key text,
  status text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech, pg_temp
AS $function$
DECLARE
  caller record;
  v_kind text := pg_catalog.upper(pg_catalog.btrim(COALESCE(p_source_kind, '')));
  v_value text := pg_catalog.btrim(COALESCE(p_source_value, ''));
  v_role text;
  v_dept text;
  v_status text := COALESCE(NULLIF(pg_catalog.upper(pg_catalog.btrim(p_status)), ''), 'ACTIVE');
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_id uuid;
BEGIN
  SELECT * INTO caller FROM uptech.require_admin_caller_v1();

  IF v_kind NOT IN ('ADMIN_GROUP', 'GROUP', 'DEPARTMENT', 'ORG_UNIT') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid source_kind';
  END IF;

  IF v_kind = 'DEPARTMENT' THEN
    v_value := pg_catalog.lower(v_value);
  END IF;

  IF v_value = '' OR pg_catalog.length(v_value) > 512 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid source_value';
  END IF;

  IF v_kind = 'ORG_UNIT' AND v_value ~ '^/' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'org_unit source_value must be Google OrgUnit ID (not path starting with /)';
  END IF;

  IF v_status NOT IN ('ACTIVE', 'DISABLED') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid mapping status';
  END IF;

  IF v_kind = 'ADMIN_GROUP' THEN
    v_role := 'ADMIN';
    v_dept := NULL;
  ELSE
    v_role := 'MEMBER';
    v_dept := pg_catalog.upper(pg_catalog.btrim(COALESCE(p_target_department_key, '')));
    IF v_dept NOT IN ('SALES', 'HR', 'IT', 'FINANCE') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid target_department_key';
    END IF;
  END IF;

  INSERT INTO uptech.people_permission_mappings (
    workspace_id, id, source_kind, source_value, target_role, target_department_key,
    status, created_at, updated_at
  ) VALUES (
    caller.workspace_id, pg_catalog.gen_random_uuid(), v_kind, v_value, v_role, v_dept,
    v_status, v_now, v_now
  )
  ON CONFLICT (workspace_id, source_kind, source_value)
  DO UPDATE SET
    target_role = EXCLUDED.target_role,
    target_department_key = EXCLUDED.target_department_key,
    status = EXCLUDED.status,
    updated_at = v_now
  RETURNING id INTO v_id;

  PERFORM uptech.admin_write_audit_event_v1(
    'ADMIN_PERMISSION_MAPPING_SAVED',
    'PEOPLE_PERMISSION_MAPPING',
    v_id,
    'SUCCEEDED',
    p_request_id,
    pg_catalog.jsonb_build_object(
      'source_kind', v_kind,
      'source_value', v_value,
      'target_role', v_role,
      'target_department_key', v_dept,
      'status', v_status
    )
  );

  RETURN QUERY SELECT v_id, v_kind, v_value, v_role, v_dept, v_status;
END
$function$;

REVOKE ALL ON FUNCTION uptech.admin_upsert_permission_mapping_v1(text, text, text, text, uuid)
  FROM PUBLIC, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.admin_upsert_permission_mapping_v1(text, text, text, text, uuid)
  TO uptech_api_runtime;

CREATE OR REPLACE FUNCTION uptech.admin_delete_permission_mapping_v1(
  p_mapping_id uuid,
  p_request_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech, pg_temp
AS $function$
DECLARE
  caller record;
  v_deleted integer := 0;
BEGIN
  SELECT * INTO caller FROM uptech.require_admin_caller_v1();

  DELETE FROM uptech.people_permission_mappings
  WHERE workspace_id = caller.workspace_id
    AND id = p_mapping_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted > 0 THEN
    PERFORM uptech.admin_write_audit_event_v1(
      'ADMIN_PERMISSION_MAPPING_DELETED',
      'PEOPLE_PERMISSION_MAPPING',
      p_mapping_id,
      'SUCCEEDED',
      p_request_id,
      '{}'::jsonb
    );
    RETURN true;
  END IF;

  RETURN false;
END
$function$;

REVOKE ALL ON FUNCTION uptech.admin_delete_permission_mapping_v1(uuid, uuid)
  FROM PUBLIC, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.admin_delete_permission_mapping_v1(uuid, uuid)
  TO uptech_api_runtime;

-- =============================================================================
-- 6. Connectors, Sync Generations, Jobs & Audit Logs (SECURITY DEFINER)
-- =============================================================================

CREATE OR REPLACE FUNCTION uptech.admin_list_connectors_v1()
RETURNS TABLE (
  connector_id uuid,
  purpose text,
  status text,
  provider_customer_id text,
  authorized_scopes text[],
  has_credential boolean,
  created_at timestamptz,
  updated_at timestamptz,
  latest_generation_status text,
  latest_generation_completed_at timestamptz,
  latest_generation_fresh_until timestamptz,
  synced_user_count integer,
  synced_group_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech, pg_temp
AS $function$
DECLARE
  caller record;
BEGIN
  SELECT * INTO caller FROM uptech.require_admin_caller_v1();

  RETURN QUERY
  SELECT
    c.id AS connector_id,
    c.purpose,
    c.status,
    c.provider_customer_id,
    COALESCE(c.directory_authorized_scopes, ARRAY[]::text[]) AS authorized_scopes,
    (c.credential_reference IS NOT NULL) AS has_credential,
    c.created_at,
    c.updated_at,
    gen.status AS latest_generation_status,
    gen.completed_at AS latest_generation_completed_at,
    gen.fresh_until AS latest_generation_fresh_until,
    COALESCE(gen.user_count, 0) AS synced_user_count,
    COALESCE(gen.group_count, 0) AS synced_group_count
  FROM uptech.connectors AS c
  LEFT JOIN LATERAL (
    SELECT
      g.id,
      g.status,
      g.completed_at,
      g.fresh_until,
      (
        SELECT pg_catalog.count(*)::integer
        FROM uptech.people_profiles AS p
        WHERE p.workspace_id = caller.workspace_id
          AND p.generation_id = g.id
      ) AS user_count,
      (
        SELECT pg_catalog.count(*)::integer
        FROM uptech.people_groups AS gr
        WHERE gr.workspace_id = caller.workspace_id
          AND gr.generation_id = g.id
      ) AS group_count
    FROM uptech.people_sync_generations AS g
    WHERE g.workspace_id = caller.workspace_id
      AND g.connector_id = c.id
    ORDER BY COALESCE(g.completed_at, g.started_at) DESC, g.id DESC
    LIMIT 1
  ) AS gen ON true
  WHERE c.workspace_id = caller.workspace_id
  ORDER BY c.purpose ASC, c.updated_at DESC;
END
$function$;

REVOKE ALL ON FUNCTION uptech.admin_list_connectors_v1()
  FROM PUBLIC, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.admin_list_connectors_v1()
  TO uptech_api_runtime;

CREATE OR REPLACE FUNCTION uptech.admin_list_sync_jobs_v1(p_limit integer DEFAULT 30)
RETURNS TABLE (
  job_id uuid,
  connector_id uuid,
  job_kind text,
  status text,
  attempt_count integer,
  max_attempts integer,
  last_error_code text,
  created_at timestamptz,
  completed_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech, pg_temp
AS $function$
DECLARE
  caller record;
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 30), 100));
BEGIN
  SELECT * INTO caller FROM uptech.require_admin_caller_v1();

  RETURN QUERY
  SELECT
    j.id AS job_id,
    j.connector_id,
    j.job_kind,
    j.status,
    j.attempt_count,
    j.max_attempts,
    j.last_error_code,
    j.created_at,
    j.completed_at
  FROM uptech.sync_jobs AS j
  WHERE j.workspace_id = caller.workspace_id
  ORDER BY j.created_at DESC
  LIMIT v_limit;
END
$function$;

REVOKE ALL ON FUNCTION uptech.admin_list_sync_jobs_v1(integer)
  FROM PUBLIC, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.admin_list_sync_jobs_v1(integer)
  TO uptech_api_runtime;

CREATE OR REPLACE FUNCTION uptech.admin_list_audit_events_v1(
  p_limit integer DEFAULT 100,
  p_outcome text DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS TABLE (
  event_id uuid,
  actor_kind text,
  actor_id uuid,
  actor_email text,
  actor_name text,
  action text,
  target_type text,
  target_id uuid,
  outcome text,
  request_id uuid,
  metadata jsonb,
  occurred_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech, pg_temp
AS $function$
DECLARE
  caller record;
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_outcome text := NULLIF(pg_catalog.upper(pg_catalog.btrim(COALESCE(p_outcome, ''))), '');
  v_search text := NULLIF(pg_catalog.lower(pg_catalog.btrim(COALESCE(p_search, ''))), '');
BEGIN
  SELECT * INTO caller FROM uptech.require_admin_caller_v1();

  RETURN QUERY
  SELECT
    e.id AS event_id,
    e.actor_kind,
    e.actor_id,
    NULLIF(pg_catalog.btrim(ident.email_claim), '') AS actor_email,
    NULLIF(pg_catalog.btrim(ident.display_name_claim), '') AS actor_name,
    e.action,
    e.target_type,
    e.target_id,
    e.outcome,
    e.request_id,
    e.metadata,
    e.occurred_at
  FROM uptech.audit_events AS e
  LEFT JOIN LATERAL (
    SELECT i.email_claim, i.display_name_claim
    FROM uptech.identities AS i
    WHERE e.actor_kind = 'USER'
      AND i.user_id = e.actor_id
      AND i.provider = 'GOOGLE'
    ORDER BY (i.status = 'ACTIVE') DESC, i.updated_at DESC
    LIMIT 1
  ) AS ident ON true
  WHERE e.workspace_id = caller.workspace_id
    AND (v_outcome IS NULL OR e.outcome = v_outcome)
    AND (
      v_search IS NULL
      OR pg_catalog.lower(e.action) LIKE '%' || v_search || '%'
      OR pg_catalog.lower(e.target_type) LIKE '%' || v_search || '%'
      OR pg_catalog.lower(COALESCE(ident.email_claim, '')) LIKE '%' || v_search || '%'
      OR e.request_id::text LIKE '%' || v_search || '%'
    )
  ORDER BY e.occurred_at DESC
  LIMIT v_limit;
END
$function$;

REVOKE ALL ON FUNCTION uptech.admin_list_audit_events_v1(integer, text, text)
  FROM PUBLIC, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.admin_list_audit_events_v1(integer, text, text)
  TO uptech_api_runtime;

-- =============================================================================
-- 7. Workspace Overview, Domains & Provisioning Policy (SECURITY DEFINER)
-- =============================================================================

CREATE OR REPLACE FUNCTION uptech.admin_get_workspace_overview_v1()
RETURNS TABLE (
  workspace_id uuid,
  workspace_status text,
  provisioning_policy text,
  google_customer_id text,
  created_at timestamptz,
  updated_at timestamptz,
  caller_role text,
  active_member_count integer,
  admin_member_count integer,
  pending_invite_count integer,
  pending_access_request_count integer,
  active_session_count integer,
  space_count integer,
  document_count integer,
  ready_document_count integer,
  chunk_count integer,
  storage_bytes bigint,
  knowledge_card_count integer,
  ai_turns_30d integer,
  domains_json jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech, pg_temp
AS $function$
DECLARE
  caller record;
BEGIN
  SELECT * INTO caller FROM uptech.require_admin_caller_v1();

  RETURN QUERY
  SELECT
    w.workspace_id,
    w.status AS workspace_status,
    w.provisioning_policy,
    w.google_customer_id,
    w.created_at,
    w.updated_at,
    caller.caller_role,
    COALESCE((
      SELECT pg_catalog.count(*)::integer
      FROM uptech.workspace_memberships AS m
      WHERE m.workspace_id = w.workspace_id AND m.status = 'ACTIVE'
    ), 0),
    COALESCE((
      SELECT pg_catalog.count(*)::integer
      FROM uptech.workspace_memberships AS m
      WHERE m.workspace_id = w.workspace_id AND m.status = 'ACTIVE' AND m.role IN ('OWNER', 'ADMIN')
    ), 0),
    COALESCE((
      SELECT pg_catalog.count(*)::integer
      FROM uptech.workspace_member_invites AS inv
      WHERE inv.workspace_id = w.workspace_id AND inv.status = 'PENDING'
        AND inv.expires_at > pg_catalog.statement_timestamp()
    ), 0),
    COALESCE((
      SELECT pg_catalog.count(*)::integer
      FROM uptech.workspace_access_requests AS ar
      WHERE ar.workspace_id = w.workspace_id AND ar.status::text = 'PENDING'
    ), 0),
    COALESCE((
      SELECT pg_catalog.count(*)::integer
      FROM uptech.sessions AS s
      WHERE s.workspace_id = w.workspace_id AND s.status = 'ACTIVE'
        AND s.revoked_at IS NULL
        AND s.idle_expires_at > pg_catalog.statement_timestamp()
        AND s.absolute_expires_at > pg_catalog.statement_timestamp()
    ), 0),
    COALESCE((
      SELECT pg_catalog.count(*)::integer
      FROM uptech.knowledge_spaces AS ks
      WHERE ks.workspace_id = w.workspace_id
    ), 0),
    COALESCE((
      SELECT pg_catalog.count(*)::integer
      FROM uptech.knowledge_documents AS kd
      WHERE kd.workspace_id = w.workspace_id
    ), 0),
    COALESCE((
      SELECT pg_catalog.count(*)::integer
      FROM uptech.knowledge_documents AS kd
      WHERE kd.workspace_id = w.workspace_id AND kd.processing_kind = 'ready'
    ), 0),
    COALESCE((
      SELECT pg_catalog.count(*)::integer
      FROM uptech.knowledge_document_chunks AS kc
      WHERE kc.workspace_id = w.workspace_id
    ), 0),
    COALESCE((
      SELECT pg_catalog.sum(kd.byte_size)::bigint
      FROM uptech.knowledge_documents AS kd
      WHERE kd.workspace_id = w.workspace_id
    ), 0::bigint),
    COALESCE((
      SELECT pg_catalog.count(*)::integer
      FROM uptech.knowledge_cards AS card
      WHERE card.workspace_id = w.workspace_id AND card.status <> 'archived'
    ), 0),
    COALESCE((
      SELECT pg_catalog.count(*)::integer
      FROM uptech.ai_chat_turns AS turn
      WHERE turn.workspace_id = w.workspace_id
        AND turn.created_at >= pg_catalog.statement_timestamp() - interval '30 days'
    ), 0),
    COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'domain', loc.normalized_domain::text,
          'status', loc.status::text,
          'domainKind', COALESCE(loc.domain_kind::text, 'PRIMARY'),
          'verifiedAt', loc.verified_at
        )
        ORDER BY (loc.domain_kind::text = 'PRIMARY') DESC, loc.normalized_domain::text ASC
      )
      FROM uptech.workspace_domain_locators AS loc
      WHERE loc.workspace_id = w.workspace_id
    ), '[]'::jsonb)
  FROM uptech.workspaces AS w
  WHERE w.workspace_id = caller.workspace_id;
END
$function$;

REVOKE ALL ON FUNCTION uptech.admin_get_workspace_overview_v1()
  FROM PUBLIC, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.admin_get_workspace_overview_v1()
  TO uptech_api_runtime;

CREATE OR REPLACE FUNCTION uptech.admin_update_provisioning_policy_v1(
  p_policy text,
  p_request_id uuid
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech, pg_temp
AS $function$
DECLARE
  caller record;
  v_policy text := pg_catalog.upper(pg_catalog.btrim(COALESCE(p_policy, '')));
  v_old_policy text;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  SELECT * INTO caller FROM uptech.require_admin_caller_v1();

  IF caller.caller_role <> 'OWNER' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'owner authority required';
  END IF;

  IF v_policy NOT IN ('INVITE_ONLY', 'GOOGLE_GROUP_CONTROLLED') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'unsupported provisioning policy';
  END IF;

  IF v_policy = 'GOOGLE_GROUP_CONTROLLED' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM uptech.people_sync_generations AS g
      WHERE g.workspace_id = caller.workspace_id
        AND g.status = 'PUBLISHED'
        AND g.traversal_complete
        AND g.fresh_until > v_now
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'fresh published Google Directory sync is required before enabling GOOGLE_GROUP_CONTROLLED';
    END IF;
  END IF;

  SELECT w.provisioning_policy INTO v_old_policy
  FROM uptech.workspaces AS w
  WHERE w.workspace_id = caller.workspace_id
  FOR UPDATE;

  UPDATE uptech.workspaces
  SET provisioning_policy = v_policy,
      updated_at = v_now
  WHERE workspace_id = caller.workspace_id;

  PERFORM uptech.admin_write_audit_event_v1(
    'ADMIN_PROVISIONING_POLICY_UPDATED',
    'WORKSPACE',
    caller.workspace_id,
    'SUCCEEDED',
    p_request_id,
    pg_catalog.jsonb_build_object('old_policy', v_old_policy, 'new_policy', v_policy)
  );

  RETURN v_policy;
END
$function$;

REVOKE ALL ON FUNCTION uptech.admin_update_provisioning_policy_v1(text, uuid)
  FROM PUBLIC, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.admin_update_provisioning_policy_v1(text, uuid)
  TO uptech_api_runtime;

COMMIT;
