-- 0018_bigtech_enterprise_platform.sql
-- BigTech Enterprise Knowledge Platform Upgrades (Gói 3 & Gói 4):
-- 1. PostgreSQL Full-Text Search (tsvector + GIN) & DB-native Hybrid Search function
-- 2. Multi-version document snapshots (chunks_snapshot_json + binary per version) & rollback
-- 3. Knowledge Governance Freshness SLA (verified_by, verified_at, review_due_at, outdated flags)
-- 4. Collaborative Document Comments & Outdated Flags (uptech.knowledge_document_comments)
-- 5. Shared AI Chat Threads (is_shared, shared_by_label, shared_at on uptech.ai_chat_sessions)
-- 6. Real Knowledge Connectors (Web/Wiki URL Crawler + Enterprise Ingestion API Keys)

-- ============================================================================
-- 0. Ensure knowledge_document_versions & knowledge_document_chunks exist
-- ============================================================================
CREATE TABLE IF NOT EXISTS uptech.knowledge_document_versions (
  workspace_id uuid NOT NULL REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT,
  document_id text NOT NULL,
  version_id text NOT NULL,
  version_label text NOT NULL,
  note text NOT NULL DEFAULT '',
  updated_label text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  PRIMARY KEY (workspace_id, document_id, version_id)
);

CREATE TABLE IF NOT EXISTS uptech.knowledge_document_chunks (
  workspace_id uuid NOT NULL REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT,
  chunk_id text NOT NULL,
  document_id text NOT NULL,
  chunk_index integer NOT NULL,
  heading text NOT NULL DEFAULT '',
  locator text NOT NULL DEFAULT '',
  content text NOT NULL,
  embedding_json jsonb,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  PRIMARY KEY (workspace_id, chunk_id),
  CONSTRAINT knowledge_document_chunks_index_check CHECK (chunk_index >= 0)
);

ALTER TABLE uptech.knowledge_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.knowledge_document_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE uptech.knowledge_document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.knowledge_document_chunks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS knowledge_document_versions_migration_owner ON uptech.knowledge_document_versions;
CREATE POLICY knowledge_document_versions_migration_owner ON uptech.knowledge_document_versions
  TO uptech_migration_owner USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS knowledge_document_versions_tenant_policy ON uptech.knowledge_document_versions;
CREATE POLICY knowledge_document_versions_tenant_policy ON uptech.knowledge_document_versions
  TO uptech_api_runtime
  USING (workspace_id = COALESCE(
    NULLIF(current_setting('app.current_workspace_id', true), '')::uuid,
    NULLIF(current_setting('app.workspace_id', true), '')::uuid
  ))
  WITH CHECK (workspace_id = COALESCE(
    NULLIF(current_setting('app.current_workspace_id', true), '')::uuid,
    NULLIF(current_setting('app.workspace_id', true), '')::uuid
  ));

DROP POLICY IF EXISTS knowledge_document_chunks_migration_owner ON uptech.knowledge_document_chunks;
CREATE POLICY knowledge_document_chunks_migration_owner ON uptech.knowledge_document_chunks
  TO uptech_migration_owner USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS knowledge_document_chunks_tenant_policy ON uptech.knowledge_document_chunks;
CREATE POLICY knowledge_document_chunks_tenant_policy ON uptech.knowledge_document_chunks
  TO uptech_api_runtime
  USING (workspace_id = COALESCE(
    NULLIF(current_setting('app.current_workspace_id', true), '')::uuid,
    NULLIF(current_setting('app.workspace_id', true), '')::uuid
  ))
  WITH CHECK (workspace_id = COALESCE(
    NULLIF(current_setting('app.current_workspace_id', true), '')::uuid,
    NULLIF(current_setting('app.workspace_id', true), '')::uuid
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  uptech.knowledge_document_versions,
  uptech.knowledge_document_chunks
TO uptech_api_runtime;

-- ============================================================================
-- 1. Full-Text Search index on knowledge_document_chunks & DB-native search
-- ============================================================================
ALTER TABLE uptech.knowledge_document_chunks
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(heading, '') || ' ' || coalesce(content, ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS knowledge_document_chunks_search_tsv_idx
  ON uptech.knowledge_document_chunks
  USING GIN (search_tsv);

-- ============================================================================
-- 2. Multi-Version Document Snapshots & Governance Freshness SLA
-- ============================================================================
ALTER TABLE uptech.knowledge_document_versions
  ADD COLUMN IF NOT EXISTS chunks_snapshot_json jsonb,
  ADD COLUMN IF NOT EXISTS author_label text,
  ADD COLUMN IF NOT EXISTS byte_size bigint NOT NULL DEFAULT 0;

ALTER TABLE uptech.knowledge_documents
  ADD COLUMN IF NOT EXISTS verified_by_label text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS flagged_outdated_reason text,
  ADD COLUMN IF NOT EXISTS flagged_outdated_by text,
  ADD COLUMN IF NOT EXISTS flagged_outdated_at timestamptz;

ALTER TABLE uptech.knowledge_cards
  ADD COLUMN IF NOT EXISTS verified_by_label text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS flagged_outdated_reason text;

-- ============================================================================
-- 3. Collaborative Document Comments & Review Notes
-- ============================================================================
CREATE TABLE IF NOT EXISTS uptech.knowledge_document_comments (
  workspace_id uuid NOT NULL REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT,
  id text NOT NULL,
  document_id text NOT NULL,
  chunk_id text,
  author_membership_id uuid,
  author_label text NOT NULL,
  author_role text NOT NULL DEFAULT 'MEMBER',
  comment_kind text NOT NULL DEFAULT 'COMMENT',
  body text NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT knowledge_document_comments_kind_check
    CHECK (comment_kind IN ('COMMENT', 'OUTDATED_FLAG', 'APPROVAL_NOTE'))
);

CREATE INDEX IF NOT EXISTS knowledge_document_comments_doc_idx
  ON uptech.knowledge_document_comments (workspace_id, document_id, created_at DESC);

ALTER TABLE uptech.knowledge_document_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.knowledge_document_comments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS knowledge_document_comments_migration_owner ON uptech.knowledge_document_comments;
CREATE POLICY knowledge_document_comments_migration_owner ON uptech.knowledge_document_comments
  TO uptech_migration_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS knowledge_document_comments_tenant_isolation ON uptech.knowledge_document_comments;
CREATE POLICY knowledge_document_comments_tenant_isolation ON uptech.knowledge_document_comments
  TO uptech_api_runtime
  USING (
    workspace_id = COALESCE(
      NULLIF(current_setting('app.current_workspace_id', true), '')::uuid,
      NULLIF(current_setting('app.workspace_id', true), '')::uuid
    )
  )
  WITH CHECK (
    workspace_id = COALESCE(
      NULLIF(current_setting('app.current_workspace_id', true), '')::uuid,
      NULLIF(current_setting('app.workspace_id', true), '')::uuid
    )
  );

-- ============================================================================
-- 4. Shared AI Chat Threads across Workspace
-- ============================================================================
ALTER TABLE uptech.ai_chat_sessions
  ADD COLUMN IF NOT EXISTS is_shared boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shared_by_label text,
  ADD COLUMN IF NOT EXISTS shared_at timestamptz;

CREATE INDEX IF NOT EXISTS ai_chat_sessions_shared_idx
  ON uptech.ai_chat_sessions (workspace_id, is_shared, updated_at DESC);

-- ============================================================================
-- 5. Knowledge Source Connectors (Web/Docs Crawler) & Ingestion API Keys
-- ============================================================================
CREATE TABLE IF NOT EXISTS uptech.workspace_knowledge_connectors (
  workspace_id uuid NOT NULL REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT,
  id text NOT NULL,
  connector_kind text NOT NULL DEFAULT 'WEB_URL',
  title text NOT NULL,
  source_url text NOT NULL,
  space_id text NOT NULL,
  document_id text,
  status text NOT NULL DEFAULT 'ACTIVE',
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  chunk_count integer NOT NULL DEFAULT 0,
  created_by_label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT workspace_knowledge_connectors_kind_check
    CHECK (connector_kind IN ('WEB_URL', 'WEBHOOK_API'))
);

ALTER TABLE uptech.workspace_knowledge_connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.workspace_knowledge_connectors FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_knowledge_connectors_migration_owner ON uptech.workspace_knowledge_connectors;
CREATE POLICY workspace_knowledge_connectors_migration_owner ON uptech.workspace_knowledge_connectors
  TO uptech_migration_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS workspace_knowledge_connectors_tenant_isolation ON uptech.workspace_knowledge_connectors;
CREATE POLICY workspace_knowledge_connectors_tenant_isolation ON uptech.workspace_knowledge_connectors
  TO uptech_api_runtime
  USING (
    workspace_id = COALESCE(
      NULLIF(current_setting('app.current_workspace_id', true), '')::uuid,
      NULLIF(current_setting('app.workspace_id', true), '')::uuid
    )
  )
  WITH CHECK (
    workspace_id = COALESCE(
      NULLIF(current_setting('app.current_workspace_id', true), '')::uuid,
      NULLIF(current_setting('app.workspace_id', true), '')::uuid
    )
  );

CREATE TABLE IF NOT EXISTS uptech.workspace_ingestion_api_keys (
  workspace_id uuid NOT NULL REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  label text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL,
  default_space_id text NOT NULL DEFAULT 'spc_8f2a01',
  created_by_label text NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (key_hash)
);

ALTER TABLE uptech.workspace_ingestion_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.workspace_ingestion_api_keys FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_ingestion_api_keys_migration_owner ON uptech.workspace_ingestion_api_keys;
CREATE POLICY workspace_ingestion_api_keys_migration_owner ON uptech.workspace_ingestion_api_keys
  TO uptech_migration_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS workspace_ingestion_api_keys_tenant_isolation ON uptech.workspace_ingestion_api_keys;
CREATE POLICY workspace_ingestion_api_keys_tenant_isolation ON uptech.workspace_ingestion_api_keys
  TO uptech_api_runtime
  USING (
    workspace_id = COALESCE(
      NULLIF(current_setting('app.current_workspace_id', true), '')::uuid,
      NULLIF(current_setting('app.workspace_id', true), '')::uuid
    )
  )
  WITH CHECK (
    workspace_id = COALESCE(
      NULLIF(current_setting('app.current_workspace_id', true), '')::uuid,
      NULLIF(current_setting('app.workspace_id', true), '')::uuid
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  uptech.knowledge_document_comments,
  uptech.workspace_knowledge_connectors,
  uptech.workspace_ingestion_api_keys
TO uptech_api_runtime;

-- ============================================================================
-- 6. Upgrade complete_direct_workspace_signup_v1 to replace temporary
--    'test-customer-%' placeholder workspaces when a real Super Admin
--    completes self-service Google Workspace organization registration.
-- ============================================================================
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

  -- Clean up any temporary test-customer-* workspace placeholder created during manual testing
  DELETE FROM uptech.workspaces AS w
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
    );

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

GRANT EXECUTE ON FUNCTION uptech.complete_direct_workspace_signup_v1(
  text, text, text, text, uuid, text, text,
  uptech.google_workspace_verified_domain_v1[], text, text[], uuid
) TO uptech_api_runtime;
