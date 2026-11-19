\set ON_ERROR_STOP on

BEGIN;
SET LOCAL ROLE uptech_migration_owner;

-- =============================================================================
-- 1. Fix / Ensure AI Chat Sessions & Turns tables (correct FK to workspace_memberships(workspace_id, id))
-- =============================================================================

CREATE TABLE IF NOT EXISTS uptech.ai_chat_sessions (
  workspace_id uuid NOT NULL REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT,
  id text NOT NULL,
  membership_id uuid NOT NULL,
  title text NOT NULL,
  scope text NOT NULL DEFAULT 'workspace',
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, membership_id)
    REFERENCES uptech.workspace_memberships (workspace_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS uptech.ai_chat_turns (
  workspace_id uuid NOT NULL,
  session_id text NOT NULL,
  id text NOT NULL,
  turn_order integer NOT NULL,
  prompt text NOT NULL,
  scope text NOT NULL DEFAULT 'workspace',
  evidence_state text NOT NULL,
  answer_paragraphs jsonb NOT NULL DEFAULT '[]'::jsonb,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  excluded_count integer NOT NULL DEFAULT 0,
  model_name text,
  feedback text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  PRIMARY KEY (workspace_id, session_id, id),
  FOREIGN KEY (workspace_id, session_id)
    REFERENCES uptech.ai_chat_sessions (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT ai_chat_turns_evidence_check
    CHECK (evidence_state IN ('grounded', 'caution', 'empty')),
  CONSTRAINT ai_chat_turns_feedback_check
    CHECK (feedback IS NULL OR feedback IN ('up', 'down'))
);

ALTER TABLE uptech.ai_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.ai_chat_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE uptech.ai_chat_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.ai_chat_turns FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_chat_sessions_migration_owner ON uptech.ai_chat_sessions;
CREATE POLICY ai_chat_sessions_migration_owner ON uptech.ai_chat_sessions
  TO uptech_migration_owner USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS ai_chat_sessions_tenant_policy ON uptech.ai_chat_sessions;
CREATE POLICY ai_chat_sessions_tenant_policy ON uptech.ai_chat_sessions
  TO uptech_api_runtime
  USING (workspace_id = COALESCE(
    NULLIF(pg_catalog.current_setting('app.current_workspace_id', true), '')::uuid,
    NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
  ))
  WITH CHECK (workspace_id = COALESCE(
    NULLIF(pg_catalog.current_setting('app.current_workspace_id', true), '')::uuid,
    NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
  ));

DROP POLICY IF EXISTS ai_chat_turns_migration_owner ON uptech.ai_chat_turns;
CREATE POLICY ai_chat_turns_migration_owner ON uptech.ai_chat_turns
  TO uptech_migration_owner USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS ai_chat_turns_tenant_policy ON uptech.ai_chat_turns;
CREATE POLICY ai_chat_turns_tenant_policy ON uptech.ai_chat_turns
  TO uptech_api_runtime
  USING (workspace_id = COALESCE(
    NULLIF(pg_catalog.current_setting('app.current_workspace_id', true), '')::uuid,
    NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
  ))
  WITH CHECK (workspace_id = COALESCE(
    NULLIF(pg_catalog.current_setting('app.current_workspace_id', true), '')::uuid,
    NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON
  uptech.ai_chat_sessions,
  uptech.ai_chat_turns
TO uptech_api_runtime;

-- =============================================================================
-- 2. Space ACL (Department / Admin Isolation) & Per-user Notifications
-- =============================================================================

ALTER TABLE uptech.knowledge_spaces
  ADD COLUMN IF NOT EXISTS access_scope text NOT NULL DEFAULT 'WORKSPACE',
  ADD COLUMN IF NOT EXISTS allowed_department_key text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_spaces_access_scope_check'
  ) THEN
    ALTER TABLE uptech.knowledge_spaces
      ADD CONSTRAINT knowledge_spaces_access_scope_check CHECK (
        (access_scope = 'WORKSPACE' AND allowed_department_key IS NULL)
        OR (access_scope = 'ADMIN_ONLY' AND allowed_department_key IS NULL)
        OR (access_scope = 'DEPARTMENT' AND allowed_department_key IN ('SALES', 'HR', 'IT', 'FINANCE'))
      );
  END IF;
END $$;

ALTER TABLE uptech.workspace_notifications
  ADD COLUMN IF NOT EXISTS recipient_membership_id uuid;

-- =============================================================================
-- 3. Persistent Original Document Blobs (Production Serverless Safe)
-- =============================================================================

CREATE TABLE IF NOT EXISTS uptech.knowledge_document_blobs (
  workspace_id uuid NOT NULL REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT,
  document_id text NOT NULL,
  file_extension text NOT NULL,
  content_type text NOT NULL,
  byte_size bigint NOT NULL,
  content_bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  PRIMARY KEY (workspace_id, document_id),
  CONSTRAINT knowledge_document_blobs_size_check CHECK (byte_size > 0)
);

ALTER TABLE uptech.knowledge_document_blobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.knowledge_document_blobs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS knowledge_document_blobs_migration_owner ON uptech.knowledge_document_blobs;
CREATE POLICY knowledge_document_blobs_migration_owner ON uptech.knowledge_document_blobs
  TO uptech_migration_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS knowledge_document_blobs_tenant_policy ON uptech.knowledge_document_blobs;
CREATE POLICY knowledge_document_blobs_tenant_policy ON uptech.knowledge_document_blobs
  TO uptech_api_runtime
  USING (workspace_id = COALESCE(
    NULLIF(pg_catalog.current_setting('app.current_workspace_id', true), '')::uuid,
    NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
  ))
  WITH CHECK (workspace_id = COALESCE(
    NULLIF(pg_catalog.current_setting('app.current_workspace_id', true), '')::uuid,
    NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON uptech.knowledge_document_blobs TO uptech_api_runtime;

-- =============================================================================
-- 4. Persistent AI Utility History
-- =============================================================================

CREATE TABLE IF NOT EXISTS uptech.workspace_utility_runs (
  workspace_id uuid NOT NULL REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT,
  id text NOT NULL,
  membership_id uuid NOT NULL,
  task text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  sections_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  sources_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT workspace_utility_runs_task_check
    CHECK (task IN ('summary', 'translate', 'checklist', 'report', 'email'))
);

ALTER TABLE uptech.workspace_utility_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.workspace_utility_runs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_utility_runs_migration_owner ON uptech.workspace_utility_runs;
CREATE POLICY workspace_utility_runs_migration_owner ON uptech.workspace_utility_runs
  TO uptech_migration_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS workspace_utility_runs_tenant_policy ON uptech.workspace_utility_runs;
CREATE POLICY workspace_utility_runs_tenant_policy ON uptech.workspace_utility_runs
  TO uptech_api_runtime
  USING (workspace_id = COALESCE(
    NULLIF(pg_catalog.current_setting('app.current_workspace_id', true), '')::uuid,
    NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
  ))
  WITH CHECK (workspace_id = COALESCE(
    NULLIF(pg_catalog.current_setting('app.current_workspace_id', true), '')::uuid,
    NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON uptech.workspace_utility_runs TO uptech_api_runtime;

-- =============================================================================
-- 5. Persisted User Profile Preferences & Self-Service Session Security
-- =============================================================================

CREATE TABLE IF NOT EXISTS uptech.workspace_user_profiles (
  workspace_id uuid NOT NULL REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES uptech.users (id) ON DELETE RESTRICT,
  display_name text,
  job_title text,
  phone text,
  department_override text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  PRIMARY KEY (workspace_id, user_id),
  CONSTRAINT workspace_user_profiles_timestamps_check CHECK (updated_at >= created_at)
);

ALTER TABLE uptech.workspace_user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.workspace_user_profiles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_user_profiles_migration_owner ON uptech.workspace_user_profiles;
CREATE POLICY workspace_user_profiles_migration_owner ON uptech.workspace_user_profiles
  TO uptech_migration_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS workspace_user_profiles_api_scope ON uptech.workspace_user_profiles;
CREATE POLICY workspace_user_profiles_api_scope ON uptech.workspace_user_profiles
  TO uptech_api_runtime
  USING (workspace_id = COALESCE(
    NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid,
    NULLIF(pg_catalog.current_setting('app.current_workspace_id', true), '')::uuid
  ))
  WITH CHECK (workspace_id = COALESCE(
    NULLIF(pg_catalog.current_setting('app.workspace_id', true), '')::uuid,
    NULLIF(pg_catalog.current_setting('app.current_workspace_id', true), '')::uuid
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON uptech.workspace_user_profiles TO uptech_api_runtime;

CREATE OR REPLACE FUNCTION uptech.user_read_profile_and_sessions_v1()
RETURNS TABLE (
  display_name text,
  job_title text,
  phone text,
  department_override text,
  updated_at timestamptz,
  sessions_json jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech, pg_temp
AS $function$
DECLARE
  v_workspace_id uuid;
  v_actor_id uuid;
  v_session_id uuid;
  v_profile uptech.workspace_user_profiles%ROWTYPE;
  v_sessions jsonb;
BEGIN
  SELECT ctx.workspace_id INTO v_workspace_id
  FROM uptech.load_people_permission_context_v1() AS ctx
  LIMIT 1;

  v_actor_id := NULLIF(pg_catalog.current_setting('app.actor_id', true), '')::uuid;
  v_session_id := NULLIF(pg_catalog.current_setting('app.session_id', true), '')::uuid;

  IF v_workspace_id IS NULL OR v_actor_id IS NULL OR v_session_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authenticated session required';
  END IF;

  SELECT * INTO v_profile
  FROM uptech.workspace_user_profiles
  WHERE workspace_id = v_workspace_id
    AND user_id = v_actor_id;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'sessionId', s.id,
      'clientType', s.client_type,
      'createdAt', s.created_at,
      'lastSeenAt', s.last_seen_at,
      'idleExpiresAt', s.idle_expires_at,
      'absoluteExpiresAt', s.absolute_expires_at,
      'isCurrent', (s.id = v_session_id)
    )
    ORDER BY (s.id = v_session_id) DESC, s.last_seen_at DESC
  ), '[]'::jsonb)
  INTO v_sessions
  FROM uptech.sessions AS s
  WHERE s.workspace_id = v_workspace_id
    AND s.user_id = v_actor_id
    AND s.status = 'ACTIVE'
    AND s.revoked_at IS NULL
    AND s.idle_expires_at > pg_catalog.statement_timestamp()
    AND s.absolute_expires_at > pg_catalog.statement_timestamp();

  RETURN QUERY SELECT
    v_profile.display_name,
    v_profile.job_title,
    v_profile.phone,
    v_profile.department_override,
    v_profile.updated_at,
    v_sessions;
END
$function$;

REVOKE ALL ON FUNCTION uptech.user_read_profile_and_sessions_v1()
  FROM PUBLIC, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.user_read_profile_and_sessions_v1()
  TO uptech_api_runtime;

CREATE OR REPLACE FUNCTION uptech.user_update_profile_v1(
  p_display_name text,
  p_job_title text,
  p_phone text,
  p_department_override text
)
RETURNS TABLE (
  display_name text,
  job_title text,
  phone text,
  department_override text,
  updated_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech, pg_temp
AS $function$
DECLARE
  v_workspace_id uuid;
  v_actor_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_name text := NULLIF(pg_catalog.left(pg_catalog.btrim(COALESCE(p_display_name, '')), 120), '');
  v_title text := NULLIF(pg_catalog.left(pg_catalog.btrim(COALESCE(p_job_title, '')), 120), '');
  v_phone text := NULLIF(pg_catalog.left(pg_catalog.btrim(COALESCE(p_phone, '')), 40), '');
  v_dept text := NULLIF(pg_catalog.left(pg_catalog.btrim(COALESCE(p_department_override, '')), 80), '');
BEGIN
  SELECT ctx.workspace_id INTO v_workspace_id
  FROM uptech.load_people_permission_context_v1() AS ctx
  LIMIT 1;
  v_actor_id := NULLIF(pg_catalog.current_setting('app.actor_id', true), '')::uuid;

  IF v_workspace_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authenticated session required';
  END IF;

  INSERT INTO uptech.workspace_user_profiles (
    workspace_id, user_id, display_name, job_title, phone, department_override, created_at, updated_at
  ) VALUES (
    v_workspace_id, v_actor_id, v_name, v_title, v_phone, v_dept, v_now, v_now
  )
  ON CONFLICT (workspace_id, user_id)
  DO UPDATE SET
    display_name = EXCLUDED.display_name,
    job_title = EXCLUDED.job_title,
    phone = EXCLUDED.phone,
    department_override = EXCLUDED.department_override,
    updated_at = v_now;

  RETURN QUERY SELECT v_name, v_title, v_phone, v_dept, v_now;
END
$function$;

REVOKE ALL ON FUNCTION uptech.user_update_profile_v1(text, text, text, text)
  FROM PUBLIC, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.user_update_profile_v1(text, text, text, text)
  TO uptech_api_runtime;

CREATE OR REPLACE FUNCTION uptech.user_revoke_sessions_v1(
  p_target_session_id uuid,
  p_revoke_all_others boolean,
  p_request_id uuid
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech, pg_temp
AS $function$
DECLARE
  v_workspace_id uuid;
  v_actor_id uuid;
  v_membership_id uuid;
  v_current_session_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_revoked integer := 0;
BEGIN
  SELECT ctx.workspace_id INTO v_workspace_id
  FROM uptech.load_people_permission_context_v1() AS ctx
  LIMIT 1;
  v_actor_id := NULLIF(pg_catalog.current_setting('app.actor_id', true), '')::uuid;
  v_membership_id := NULLIF(pg_catalog.current_setting('app.membership_id', true), '')::uuid;
  v_current_session_id := NULLIF(pg_catalog.current_setting('app.session_id', true), '')::uuid;

  IF v_workspace_id IS NULL OR v_actor_id IS NULL OR v_membership_id IS NULL OR v_current_session_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authenticated session required';
  END IF;

  IF p_revoke_all_others THEN
    UPDATE uptech.sessions
    SET status = 'REVOKED', revoked_at = v_now
    WHERE workspace_id = v_workspace_id
      AND user_id = v_actor_id
      AND id <> v_current_session_id
      AND status = 'ACTIVE'
      AND revoked_at IS NULL;
    GET DIAGNOSTICS v_revoked = ROW_COUNT;
  ELSIF p_target_session_id IS NOT NULL AND p_target_session_id <> v_current_session_id THEN
    UPDATE uptech.sessions
    SET status = 'REVOKED', revoked_at = v_now
    WHERE workspace_id = v_workspace_id
      AND user_id = v_actor_id
      AND id = p_target_session_id
      AND status = 'ACTIVE'
      AND revoked_at IS NULL;
    GET DIAGNOSTICS v_revoked = ROW_COUNT;
  END IF;

  IF v_revoked > 0 THEN
    INSERT INTO uptech.audit_events (
      workspace_id, id, actor_kind, actor_id, membership_id, session_id,
      action, target_type, target_id, outcome, request_id, metadata, occurred_at
    ) VALUES (
      v_workspace_id, pg_catalog.gen_random_uuid(), 'USER', v_actor_id,
      v_membership_id, v_current_session_id, 'USER_SESSIONS_REVOKED',
      'SESSION', p_target_session_id, 'SUCCEEDED',
      COALESCE(p_request_id, pg_catalog.gen_random_uuid()),
      pg_catalog.jsonb_build_object('revoked_count', v_revoked, 'revoke_all_others', p_revoke_all_others),
      v_now
    );
  END IF;

  RETURN v_revoked;
END
$function$;

REVOKE ALL ON FUNCTION uptech.user_revoke_sessions_v1(uuid, boolean, uuid)
  FROM PUBLIC, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.user_revoke_sessions_v1(uuid, boolean, uuid)
  TO uptech_api_runtime;

-- =============================================================================
-- 6. Auto-Accept Pending Workspace Invites on First Corporate Google Login
-- =============================================================================

CREATE OR REPLACE FUNCTION uptech.auto_accept_pending_invite_v1(
  p_issuer text,
  p_provider_subject text,
  p_email text,
  p_hosted_domain text,
  p_request_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech, pg_temp
AS $function$
DECLARE
  v_email text := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_email, '')));
  v_domain text := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_hosted_domain, '')));
  v_workspace_id uuid;
  v_policy text;
  v_invite uptech.workspace_member_invites%ROWTYPE;
  v_user_id uuid;
  v_identity_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF v_email = '' OR v_domain = '' OR p_issuer IS NULL OR p_provider_subject IS NULL THEN
    RETURN false;
  END IF;

  SELECT loc.workspace_id, w.provisioning_policy
  INTO v_workspace_id, v_policy
  FROM uptech.workspace_domain_locators AS loc
  JOIN uptech.workspaces AS w ON w.workspace_id = loc.workspace_id
  WHERE loc.normalized_domain::text = v_domain
    AND loc.status = 'VERIFIED'
    AND w.status = 'ACTIVE'
    AND w.provisioning_policy = 'INVITE_ONLY';

  IF v_workspace_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_invite
  FROM uptech.workspace_member_invites
  WHERE workspace_id = v_workspace_id
    AND normalized_email = v_email
    AND status = 'PENDING'
    AND expires_at > v_now
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT i.id, i.user_id INTO v_identity_id, v_user_id
  FROM uptech.identities AS i
  WHERE i.provider = 'GOOGLE'
    AND i.issuer = p_issuer
    AND i.provider_subject = p_provider_subject
  FOR UPDATE;

  IF v_identity_id IS NULL THEN
    v_user_id := pg_catalog.gen_random_uuid();
    v_identity_id := pg_catalog.gen_random_uuid();
    INSERT INTO uptech.users (id, status, security_version, created_at, updated_at)
    VALUES (v_user_id, 'ACTIVE', 1, v_now, v_now);
    INSERT INTO uptech.identities (
      id, user_id, provider, issuer, provider_subject, status, security_version,
      email_claim, email_verified, hosted_domain_claim, claims_observed_at, created_at, updated_at
    ) VALUES (
      v_identity_id, v_user_id, 'GOOGLE', p_issuer, p_provider_subject, 'ACTIVE', 1,
      v_email, true, v_domain, v_now, v_now, v_now
    );
  END IF;

  -- Never cross-bind a user already belonging to another workspace.
  IF EXISTS (
    SELECT 1 FROM uptech.workspace_memberships AS m
    WHERE m.user_id = v_user_id AND m.workspace_id <> v_workspace_id
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO uptech.workspace_memberships (
    workspace_id, id, user_id, role, status, created_at, updated_at
  ) VALUES (
    v_workspace_id, pg_catalog.gen_random_uuid(), v_user_id, v_invite.role, 'ACTIVE', v_now, v_now
  )
  ON CONFLICT (workspace_id, user_id)
  DO UPDATE SET
    role = CASE WHEN uptech.workspace_memberships.role = 'OWNER' THEN 'OWNER' ELSE EXCLUDED.role END,
    status = 'ACTIVE',
    authz_version = uptech.workspace_memberships.authz_version + 1,
    updated_at = v_now;

  UPDATE uptech.workspace_member_invites
  SET status = 'ACCEPTED', accepted_at = v_now
  WHERE workspace_id = v_workspace_id
    AND id = v_invite.id;

  INSERT INTO uptech.audit_events (
    workspace_id, id, actor_kind, actor_id, membership_id, session_id,
    action, target_type, target_id, outcome, request_id, metadata, occurred_at
  ) VALUES (
    v_workspace_id, pg_catalog.gen_random_uuid(), 'SYSTEM', NULL, NULL, NULL,
    'INVITE_AUTO_ACCEPTED_ON_LOGIN', 'WORKSPACE_INVITE', v_invite.id, 'SUCCEEDED',
    COALESCE(p_request_id, pg_catalog.gen_random_uuid()),
    pg_catalog.jsonb_build_object('email', v_email, 'role', v_invite.role),
    v_now
  );

  RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION uptech.auto_accept_pending_invite_v1(text, text, text, text, uuid)
  FROM PUBLIC, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.auto_accept_pending_invite_v1(text, text, text, text, uuid)
  TO uptech_api_runtime;

CREATE OR REPLACE FUNCTION uptech.identities_auto_accept_invite_trg_fn_v1()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech, pg_temp
AS $function$
BEGIN
  IF NEW.provider = 'GOOGLE'
     AND NEW.status = 'ACTIVE'
     AND NEW.email_verified IS TRUE
     AND NEW.email_claim IS NOT NULL
     AND NEW.hosted_domain_claim IS NOT NULL THEN
    PERFORM uptech.auto_accept_pending_invite_v1(
      NEW.issuer,
      NEW.provider_subject,
      NEW.email_claim,
      NEW.hosted_domain_claim,
      pg_catalog.gen_random_uuid()
    );
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION uptech.identities_auto_accept_invite_trg_fn_v1()
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;

DROP TRIGGER IF EXISTS identities_auto_accept_invite_trg ON uptech.identities;
CREATE TRIGGER identities_auto_accept_invite_trg
  AFTER INSERT OR UPDATE OF email_claim, hosted_domain_claim, status ON uptech.identities
  FOR EACH ROW
  EXECUTE FUNCTION uptech.identities_auto_accept_invite_trg_fn_v1();

-- =============================================================================
-- 7. Admin Knowledge Analytics & Content Gaps (SECURITY DEFINER)
-- =============================================================================

CREATE OR REPLACE FUNCTION uptech.admin_get_knowledge_analytics_v1()
RETURNS TABLE (
  turns_30d integer,
  grounded_turns_30d integer,
  caution_turns_30d integer,
  empty_turns_30d integer,
  positive_feedback_30d integer,
  negative_feedback_30d integer,
  verified_cards_count integer,
  draft_cards_count integer,
  content_gaps_json jsonb,
  top_cited_docs_json jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech, pg_temp
AS $function$
DECLARE
  caller record;
  v_since timestamptz := pg_catalog.statement_timestamp() - interval '30 days';
  v_turns integer := 0;
  v_grounded integer := 0;
  v_caution integer := 0;
  v_empty integer := 0;
  v_up integer := 0;
  v_down integer := 0;
  v_verified_cards integer := 0;
  v_draft_cards integer := 0;
  v_gaps jsonb := '[]'::jsonb;
  v_top_docs jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO caller FROM uptech.require_admin_caller_v1();

  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) FILTER (WHERE t.evidence_state = 'grounded')::integer,
    pg_catalog.count(*) FILTER (WHERE t.evidence_state = 'caution')::integer,
    pg_catalog.count(*) FILTER (WHERE t.evidence_state = 'empty')::integer,
    pg_catalog.count(*) FILTER (WHERE t.feedback = 'up')::integer,
    pg_catalog.count(*) FILTER (WHERE t.feedback = 'down')::integer
  INTO v_turns, v_grounded, v_caution, v_empty, v_up, v_down
  FROM uptech.ai_chat_turns AS t
  WHERE t.workspace_id = caller.workspace_id
    AND t.created_at >= v_since;

  SELECT
    pg_catalog.count(*) FILTER (WHERE c.status = 'verified')::integer,
    pg_catalog.count(*) FILTER (WHERE c.status = 'draft')::integer
  INTO v_verified_cards, v_draft_cards
  FROM uptech.knowledge_cards AS c
  WHERE c.workspace_id = caller.workspace_id;

  SELECT COALESCE(pg_catalog.jsonb_agg(gap_row), '[]'::jsonb)
  INTO v_gaps
  FROM (
    SELECT
      t.prompt,
      t.scope,
      t.evidence_state AS "evidenceState",
      t.feedback,
      pg_catalog.count(*)::integer AS "askCount",
      pg_catalog.max(t.created_at) AS "lastAskedAt"
    FROM uptech.ai_chat_turns AS t
    WHERE t.workspace_id = caller.workspace_id
      AND t.created_at >= v_since
      AND (t.evidence_state = 'empty' OR t.feedback = 'down')
    GROUP BY t.prompt, t.scope, t.evidence_state, t.feedback
    ORDER BY pg_catalog.count(*) DESC, pg_catalog.max(t.created_at) DESC
    LIMIT 15
  ) AS gap_row;

  SELECT COALESCE(pg_catalog.jsonb_agg(doc_row), '[]'::jsonb)
  INTO v_top_docs
  FROM (
    SELECT
      cit->>'documentId' AS "documentId",
      COALESCE(MAX(cit->>'title'), cit->>'documentId') AS "title",
      COALESCE(MAX(cit->>'knowledgeSpace'), '') AS "spaceName",
      pg_catalog.count(*)::integer AS "citationCount"
    FROM uptech.ai_chat_turns AS t,
         pg_catalog.jsonb_array_elements(t.citations) AS cit
    WHERE t.workspace_id = caller.workspace_id
      AND t.created_at >= v_since
      AND cit->>'documentId' IS NOT NULL
    GROUP BY cit->>'documentId'
    ORDER BY pg_catalog.count(*) DESC
    LIMIT 10
  ) AS doc_row;

  RETURN QUERY SELECT
    v_turns, v_grounded, v_caution, v_empty, v_up, v_down,
    v_verified_cards, v_draft_cards, v_gaps, v_top_docs;
END
$function$;

REVOKE ALL ON FUNCTION uptech.admin_get_knowledge_analytics_v1()
  FROM PUBLIC, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.admin_get_knowledge_analytics_v1()
  TO uptech_api_runtime;

COMMIT;
