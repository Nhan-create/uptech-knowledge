\set ON_ERROR_STOP on

BEGIN;
SET LOCAL ROLE uptech_migration_owner;

-- Global identity anchors. Runtime roles receive no direct privileges on these
-- relations; pre-tenant lookup is limited to the explicitly granted routines.
CREATE TABLE uptech.users (
  id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'ACTIVE',
  security_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT users_status_check
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DEPROVISIONED')),
  CONSTRAINT users_security_version_check CHECK (security_version > 0),
  CONSTRAINT users_timestamps_check CHECK (updated_at >= created_at)
);

CREATE TABLE uptech.identities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES uptech.users (id) ON DELETE RESTRICT,
  provider text NOT NULL,
  issuer text NOT NULL,
  provider_subject text COLLATE "C" NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  security_version bigint NOT NULL DEFAULT 1,
  email_claim text,
  email_verified boolean NOT NULL DEFAULT false,
  hosted_domain_claim text,
  display_name_claim text,
  picture_url_claim text,
  claims_observed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT identities_provider_check CHECK (provider = 'GOOGLE'),
  CONSTRAINT identities_issuer_check CHECK (length(issuer) > 0),
  CONSTRAINT identities_subject_check CHECK (length(provider_subject) > 0),
  CONSTRAINT identities_status_check CHECK (status IN ('ACTIVE', 'REVOKED')),
  CONSTRAINT identities_security_version_check CHECK (security_version > 0),
  CONSTRAINT identities_timestamps_check CHECK (updated_at >= created_at),
  CONSTRAINT identities_id_user_unique UNIQUE (id, user_id),
  CONSTRAINT identities_provider_subject_unique
    UNIQUE (provider, issuer, provider_subject)
);

CREATE TABLE uptech.onboarding_sessions (
  id uuid PRIMARY KEY,
  identity_id uuid NOT NULL REFERENCES uptech.identities (id) ON DELETE RESTRICT,
  token_hash bytea NOT NULL,
  allowed_operations text[] NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT onboarding_sessions_token_hash_length
    CHECK (octet_length(token_hash) = 32),
  CONSTRAINT onboarding_sessions_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT onboarding_sessions_operations_check CHECK (
    cardinality(allowed_operations) BETWEEN 1 AND 5
    AND allowed_operations <@ ARRAY[
      'FIRST_DOMAIN_CLAIM_READ',
      'FIRST_DOMAIN_CLAIM_RESERVE',
      'FIRST_DOMAIN_CLAIM_COMPLETE',
      'ACCESS_REQUEST_READ',
      'ACCESS_REQUEST_SUBMIT'
    ]::text[]
  ),
  CONSTRAINT onboarding_sessions_status_check
    CHECK (status IN ('ACTIVE', 'CONSUMED', 'REVOKED', 'EXPIRED')),
  CONSTRAINT onboarding_sessions_expiry_check CHECK (
    expires_at > created_at
    AND expires_at <= created_at + interval '30 minutes'
  ),
  CONSTRAINT onboarding_sessions_terminal_time_check CHECK (
    (status = 'ACTIVE' AND consumed_at IS NULL AND revoked_at IS NULL)
    OR (status = 'CONSUMED' AND consumed_at IS NOT NULL AND revoked_at IS NULL)
    OR (status = 'REVOKED' AND revoked_at IS NOT NULL)
    OR status = 'EXPIRED'
  )
);

-- Tenant anchors. workspace_id is present on every organization-owned row and
-- every tenant parent/child reference below carries workspace_id.
CREATE TABLE uptech.workspaces (
  workspace_id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'PENDING',
  provisioning_policy text NOT NULL DEFAULT 'INVITE_ONLY',
  google_customer_id text,
  security_version bigint NOT NULL DEFAULT 1,
  permission_epoch bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT workspaces_status_check
    CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'DEPROVISIONED')),
  CONSTRAINT workspaces_provisioning_policy_check CHECK (
    provisioning_policy IN (
      'INVITE_ONLY',
      'DOMAIN_AUTO_PROVISION',
      'GOOGLE_GROUP_CONTROLLED'
    )
  ),
  CONSTRAINT workspaces_versions_check
    CHECK (security_version > 0 AND permission_epoch > 0),
  CONSTRAINT workspaces_timestamps_check CHECK (updated_at >= created_at),
  CONSTRAINT workspaces_customer_nonempty_check
    CHECK (google_customer_id IS NULL OR length(google_customer_id) > 0)
);

CREATE UNIQUE INDEX workspaces_google_customer_unique
  ON uptech.workspaces (google_customer_id)
  WHERE google_customer_id IS NOT NULL;

CREATE TABLE uptech.workspace_memberships (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES uptech.users (id) ON DELETE RESTRICT,
  role text NOT NULL,
  status text NOT NULL,
  authz_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT workspace_memberships_workspace_fk
    FOREIGN KEY (workspace_id)
    REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT,
  CONSTRAINT workspace_memberships_workspace_user_unique
    UNIQUE (workspace_id, user_id),
  CONSTRAINT workspace_memberships_id_user_unique
    UNIQUE (workspace_id, id, user_id),
  CONSTRAINT workspace_memberships_role_check
    CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER')),
  CONSTRAINT workspace_memberships_status_check
    CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'DEPROVISIONED')),
  CONSTRAINT workspace_memberships_authz_version_check CHECK (authz_version > 0),
  CONSTRAINT workspace_memberships_timestamps_check CHECK (updated_at >= created_at)
);

CREATE TABLE uptech.service_actors (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  actor_kind text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  security_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT service_actors_workspace_fk
    FOREIGN KEY (workspace_id)
    REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT,
  CONSTRAINT service_actors_kind_check CHECK (actor_kind = 'SYNC_WORKER'),
  CONSTRAINT service_actors_status_check CHECK (status IN ('ACTIVE', 'REVOKED')),
  CONSTRAINT service_actors_security_version_check CHECK (security_version > 0),
  CONSTRAINT service_actors_timestamps_check CHECK (updated_at >= created_at)
);

-- Minimal connector/source anchors exist only so job context is tenant-bound by
-- composite foreign keys. Connector OAuth and provider credentials are later phases.
CREATE TABLE uptech.connectors (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  purpose text NOT NULL,
  status text NOT NULL DEFAULT 'AUTHORIZING',
  security_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT connectors_workspace_fk
    FOREIGN KEY (workspace_id)
    REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT,
  CONSTRAINT connectors_purpose_check CHECK (purpose IN ('DIRECTORY', 'DRIVE')),
  CONSTRAINT connectors_status_check CHECK (
    status IN ('AUTHORIZING', 'ACTIVE', 'DEGRADED', 'REVOKED', 'DISCONNECTED')
  ),
  CONSTRAINT connectors_security_version_check CHECK (security_version > 0),
  CONSTRAINT connectors_timestamps_check CHECK (updated_at >= created_at)
);

CREATE TABLE uptech.sources (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  connector_id uuid NOT NULL,
  source_kind text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  security_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT sources_connector_fk
    FOREIGN KEY (workspace_id, connector_id)
    REFERENCES uptech.connectors (workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT sources_id_connector_unique UNIQUE (workspace_id, id, connector_id),
  CONSTRAINT sources_kind_check CHECK (source_kind = 'GOOGLE_DRIVE'),
  CONSTRAINT sources_status_check
    CHECK (status IN ('ACTIVE', 'DEGRADED', 'DISCONNECTED')),
  CONSTRAINT sources_security_version_check CHECK (security_version > 0),
  CONSTRAINT sources_timestamps_check CHECK (updated_at >= created_at)
);

CREATE TABLE uptech.sessions (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  identity_id uuid NOT NULL,
  user_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  client_type text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  user_security_version bigint NOT NULL,
  identity_security_version bigint NOT NULL,
  workspace_security_version bigint NOT NULL,
  membership_authz_version bigint NOT NULL,
  security_version bigint NOT NULL DEFAULT 1,
  current_rotation_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revocation_reason text,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT sessions_workspace_fk
    FOREIGN KEY (workspace_id)
    REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT,
  CONSTRAINT sessions_identity_user_fk
    FOREIGN KEY (identity_id, user_id)
    REFERENCES uptech.identities (id, user_id) ON DELETE RESTRICT,
  CONSTRAINT sessions_membership_user_fk
    FOREIGN KEY (workspace_id, membership_id, user_id)
    REFERENCES uptech.workspace_memberships (workspace_id, id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT sessions_id_client_unique UNIQUE (workspace_id, id, client_type),
  CONSTRAINT sessions_client_type_check CHECK (client_type IN ('WEB', 'NATIVE')),
  CONSTRAINT sessions_status_check CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
  CONSTRAINT sessions_versions_check CHECK (
    user_security_version > 0
    AND identity_security_version > 0
    AND workspace_security_version > 0
    AND membership_authz_version > 0
    AND security_version > 0
    AND current_rotation_version > 0
  ),
  CONSTRAINT sessions_expiry_check CHECK (
    last_seen_at >= created_at
    AND idle_expires_at > created_at
    AND absolute_expires_at > created_at
    AND idle_expires_at <= absolute_expires_at
  ),
  CONSTRAINT sessions_revocation_check CHECK (
    (status = 'ACTIVE' AND revoked_at IS NULL AND revocation_reason IS NULL)
    OR (status = 'REVOKED' AND revoked_at IS NOT NULL AND revocation_reason IS NOT NULL)
    OR status = 'EXPIRED'
  )
);

CREATE TABLE uptech.session_tokens (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  session_id uuid NOT NULL,
  client_type text NOT NULL,
  token_kind text NOT NULL,
  token_status text NOT NULL DEFAULT 'CURRENT',
  token_hash bytea NOT NULL,
  csrf_token_hash bytea,
  session_security_version bigint NOT NULL,
  rotation_version bigint NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  expires_at timestamptz NOT NULL,
  became_previous_at timestamptz,
  previous_valid_until timestamptz,
  revoked_at timestamptz,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT session_tokens_session_fk
    FOREIGN KEY (workspace_id, session_id, client_type)
    REFERENCES uptech.sessions (workspace_id, id, client_type) ON DELETE RESTRICT,
  CONSTRAINT session_tokens_hash_length CHECK (octet_length(token_hash) = 32),
  CONSTRAINT session_tokens_hash_unique UNIQUE (token_hash),
  CONSTRAINT session_tokens_csrf_hash_length
    CHECK (csrf_token_hash IS NULL OR octet_length(csrf_token_hash) = 32),
  CONSTRAINT session_tokens_client_type_check CHECK (client_type IN ('WEB', 'NATIVE')),
  CONSTRAINT session_tokens_kind_check CHECK (
    (client_type = 'WEB' AND token_kind = 'WEB_SESSION' AND csrf_token_hash IS NOT NULL)
    OR (
      client_type = 'NATIVE'
      AND token_kind IN ('NATIVE_ACCESS', 'NATIVE_REFRESH')
      AND csrf_token_hash IS NULL
    )
  ),
  CONSTRAINT session_tokens_status_check
    CHECK (token_status IN ('CURRENT', 'PREVIOUS', 'REVOKED')),
  CONSTRAINT session_tokens_versions_check
    CHECK (session_security_version > 0 AND rotation_version > 0),
  CONSTRAINT session_tokens_expiry_check CHECK (expires_at > issued_at),
  CONSTRAINT session_tokens_previous_window_check CHECK (
    (
      token_status = 'CURRENT'
      AND became_previous_at IS NULL
      AND previous_valid_until IS NULL
      AND revoked_at IS NULL
    )
    OR (
      token_status = 'PREVIOUS'
      AND became_previous_at IS NOT NULL
      AND previous_valid_until > became_previous_at
      AND previous_valid_until <= became_previous_at + interval '30 seconds'
      AND revoked_at IS NULL
    )
    OR (token_status = 'REVOKED' AND revoked_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX session_tokens_one_current_kind
  ON uptech.session_tokens (workspace_id, session_id, token_kind)
  WHERE token_status = 'CURRENT';

CREATE UNIQUE INDEX session_tokens_one_previous_kind
  ON uptech.session_tokens (workspace_id, session_id, token_kind)
  WHERE token_status = 'PREVIOUS';

CREATE TABLE uptech.sync_jobs (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  service_actor_id uuid NOT NULL,
  connector_id uuid NOT NULL,
  source_id uuid,
  job_kind text NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED',
  priority smallint NOT NULL DEFAULT 0,
  dedupe_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  available_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  leased_at timestamptz,
  lease_expires_at timestamptz,
  lease_owner text,
  lease_fence uuid,
  completed_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT sync_jobs_workspace_fk
    FOREIGN KEY (workspace_id)
    REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT,
  CONSTRAINT sync_jobs_service_actor_fk
    FOREIGN KEY (workspace_id, service_actor_id)
    REFERENCES uptech.service_actors (workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT sync_jobs_connector_fk
    FOREIGN KEY (workspace_id, connector_id)
    REFERENCES uptech.connectors (workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT sync_jobs_source_connector_fk
    FOREIGN KEY (workspace_id, source_id, connector_id)
    REFERENCES uptech.sources (workspace_id, id, connector_id) ON DELETE RESTRICT,
  CONSTRAINT sync_jobs_kind_check CHECK (
    job_kind IN ('DIRECTORY_SYNC', 'DRIVE_SYNC', 'DRIVE_CHANGES', 'DRIVE_RECONCILE')
  ),
  CONSTRAINT sync_jobs_source_kind_check CHECK (
    (job_kind = 'DIRECTORY_SYNC' AND source_id IS NULL)
    OR (job_kind <> 'DIRECTORY_SYNC' AND source_id IS NOT NULL)
  ),
  CONSTRAINT sync_jobs_status_check
    CHECK (status IN ('QUEUED', 'LEASED', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  CONSTRAINT sync_jobs_priority_check CHECK (priority BETWEEN -100 AND 100),
  CONSTRAINT sync_jobs_dedupe_key_check CHECK (length(dedupe_key) BETWEEN 1 AND 200),
  CONSTRAINT sync_jobs_payload_check CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT sync_jobs_attempts_check CHECK (
    attempt_count >= 0 AND max_attempts BETWEEN 1 AND 100 AND attempt_count <= max_attempts
  ),
  CONSTRAINT sync_jobs_lease_state_check CHECK (
    (
      status = 'LEASED'
      AND leased_at IS NOT NULL
      AND lease_expires_at > leased_at
      AND lease_owner IS NOT NULL
      AND lease_fence IS NOT NULL
    )
    OR status <> 'LEASED'
  ),
  CONSTRAINT sync_jobs_completion_check CHECK (
    (status IN ('SUCCEEDED', 'FAILED', 'CANCELLED') AND completed_at IS NOT NULL)
    OR status IN ('QUEUED', 'LEASED')
  ),
  CONSTRAINT sync_jobs_timestamps_check CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX sync_jobs_active_dedupe_unique
  ON uptech.sync_jobs (workspace_id, job_kind, dedupe_key)
  WHERE status IN ('QUEUED', 'LEASED');

CREATE INDEX sync_jobs_lease_candidate_idx
  ON uptech.sync_jobs (priority DESC, available_at, created_at, workspace_id, id)
  WHERE status IN ('QUEUED', 'LEASED');

CREATE TABLE uptech.audit_events (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  actor_kind text NOT NULL,
  actor_id uuid,
  membership_id uuid,
  session_id uuid,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  outcome text NOT NULL,
  request_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT audit_events_workspace_fk
    FOREIGN KEY (workspace_id)
    REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT,
  CONSTRAINT audit_events_membership_fk
    FOREIGN KEY (workspace_id, membership_id)
    REFERENCES uptech.workspace_memberships (workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT audit_events_session_fk
    FOREIGN KEY (workspace_id, session_id)
    REFERENCES uptech.sessions (workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT audit_events_actor_kind_check
    CHECK (actor_kind IN ('USER', 'SERVICE', 'SYSTEM')),
  CONSTRAINT audit_events_actor_shape_check CHECK (
    (
      actor_kind = 'USER'
      AND actor_id IS NOT NULL
      AND membership_id IS NOT NULL
      AND session_id IS NOT NULL
    )
    OR (
      actor_kind = 'SERVICE'
      AND actor_id IS NOT NULL
      AND membership_id IS NULL
      AND session_id IS NULL
    )
    OR (
      actor_kind = 'SYSTEM'
      AND actor_id IS NULL
      AND membership_id IS NULL
      AND session_id IS NULL
    )
  ),
  CONSTRAINT audit_events_action_check CHECK (length(action) BETWEEN 1 AND 120),
  CONSTRAINT audit_events_target_type_check CHECK (length(target_type) BETWEEN 1 AND 80),
  CONSTRAINT audit_events_outcome_check
    CHECK (outcome IN ('SUCCEEDED', 'DENIED', 'FAILED')),
  CONSTRAINT audit_events_metadata_check CHECK (jsonb_typeof(metadata) = 'object')
);

-- This global sink is intentionally inaccessible to runtime roles. GAP-012
-- forbids adding a general pre-auth append routine until a later approval.
CREATE TABLE uptech.platform_audit_events (
  id uuid PRIMARY KEY,
  identity_id uuid REFERENCES uptech.identities (id) ON DELETE RESTRICT,
  action text NOT NULL,
  target_type text NOT NULL,
  outcome text NOT NULL,
  request_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT platform_audit_events_action_check CHECK (length(action) BETWEEN 1 AND 120),
  CONSTRAINT platform_audit_events_target_type_check CHECK (length(target_type) BETWEEN 1 AND 80),
  CONSTRAINT platform_audit_events_outcome_check
    CHECK (outcome IN ('SUCCEEDED', 'DENIED', 'FAILED')),
  CONSTRAINT platform_audit_events_metadata_check CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE TABLE uptech.security_outbox (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  audit_event_id uuid NOT NULL,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PENDING',
  available_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 12,
  leased_at timestamptz,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT security_outbox_workspace_fk
    FOREIGN KEY (workspace_id)
    REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT,
  CONSTRAINT security_outbox_audit_event_fk
    FOREIGN KEY (workspace_id, audit_event_id)
    REFERENCES uptech.audit_events (workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT security_outbox_event_type_check CHECK (length(event_type) BETWEEN 1 AND 120),
  CONSTRAINT security_outbox_aggregate_type_check
    CHECK (length(aggregate_type) BETWEEN 1 AND 80),
  CONSTRAINT security_outbox_payload_check CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT security_outbox_status_check
    CHECK (status IN ('PENDING', 'LEASED', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  CONSTRAINT security_outbox_attempts_check CHECK (
    attempt_count >= 0 AND max_attempts BETWEEN 1 AND 100 AND attempt_count <= max_attempts
  ),
  CONSTRAINT security_outbox_lease_state_check CHECK (
    (
      status = 'LEASED'
      AND leased_at IS NOT NULL
      AND lease_expires_at > leased_at
    )
    OR status <> 'LEASED'
  ),
  CONSTRAINT security_outbox_completion_check CHECK (
    (status IN ('SUCCEEDED', 'FAILED', 'CANCELLED') AND completed_at IS NOT NULL)
    OR status IN ('PENDING', 'LEASED')
  ),
  CONSTRAINT security_outbox_timestamps_check CHECK (updated_at >= created_at)
);

-- Tenant-authenticated limits can use this relation under RLS. It deliberately
-- exposes no pre-auth operation while GAP-012 remains open.
CREATE TABLE uptech.rate_limit_buckets (
  workspace_id uuid NOT NULL,
  scope_kind text NOT NULL,
  scope_hash bytea NOT NULL,
  route_class text NOT NULL,
  window_started_at timestamptz NOT NULL,
  window_seconds integer NOT NULL,
  request_count integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (
    workspace_id,
    scope_kind,
    scope_hash,
    route_class,
    window_started_at
  ),
  CONSTRAINT rate_limit_buckets_workspace_fk
    FOREIGN KEY (workspace_id)
    REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT,
  CONSTRAINT rate_limit_buckets_scope_kind_check CHECK (
    scope_kind IN ('IDENTITY', 'MEMBERSHIP', 'WORKSPACE')
  ),
  CONSTRAINT rate_limit_buckets_scope_hash_check CHECK (octet_length(scope_hash) = 32),
  CONSTRAINT rate_limit_buckets_route_class_check
    CHECK (length(route_class) BETWEEN 1 AND 80),
  CONSTRAINT rate_limit_buckets_window_check CHECK (
    window_seconds BETWEEN 1 AND 86400
    AND expires_at = window_started_at + window_seconds * interval '1 second'
  ),
  CONSTRAINT rate_limit_buckets_policy_check CHECK (
    (
      route_class = 'CONNECTOR_MUTATION'
      AND scope_kind = 'MEMBERSHIP'
      AND window_seconds = 600
      AND request_count BETWEEN 1 AND 10
    )
    OR (
      route_class = 'SEARCH'
      AND scope_kind = 'MEMBERSHIP'
      AND window_seconds = 60
      AND request_count BETWEEN 1 AND 60
    )
    OR (
      route_class = 'RAG'
      AND scope_kind = 'MEMBERSHIP'
      AND window_seconds = 60
      AND request_count BETWEEN 1 AND 10
    )
    OR (
      route_class = 'RAG'
      AND scope_kind = 'WORKSPACE'
      AND window_seconds = 60
      AND request_count BETWEEN 1 AND 100
    )
  )
);

CREATE INDEX rate_limit_buckets_expiry_idx
  ON uptech.rate_limit_buckets (expires_at);

-- The API role can perform only the exact atomic increment used by the
-- tenant-authenticated limiter. This invoker-rights trigger prevents direct
-- SQL from forging a scope, backdating a window, or decreasing a counter.
CREATE FUNCTION uptech.enforce_tenant_rate_bucket_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, uptech, pg_temp
AS $function$
DECLARE
  context_workspace uuid;
  context_membership uuid;
  expected_scope_hash bytea;
  expected_window_start timestamptz;
BEGIN
  BEGIN
    context_workspace := NULLIF(current_setting('app.workspace_id', true), '')::uuid;
    context_membership := NULLIF(current_setting('app.membership_id', true), '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'tenant rate-limit mutation denied';
  END;

  IF context_workspace IS NULL
     OR context_membership IS NULL
     OR NEW.workspace_id IS DISTINCT FROM context_workspace
     OR NOT EXISTS (
       SELECT 1
       FROM uptech.workspace_memberships AS context_member
       WHERE context_member.workspace_id = context_workspace
         AND context_member.id = context_membership
         AND context_member.user_id::text =
           NULLIF(current_setting('app.actor_id', true), '')
         AND context_member.status = 'ACTIVE'
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'tenant rate-limit mutation denied';
  END IF;

  IF NOT (
    (NEW.route_class = 'CONNECTOR_MUTATION'
      AND NEW.scope_kind = 'MEMBERSHIP' AND NEW.window_seconds = 600)
    OR (NEW.route_class = 'SEARCH'
      AND NEW.scope_kind = 'MEMBERSHIP' AND NEW.window_seconds = 60)
    OR (NEW.route_class = 'RAG'
      AND NEW.scope_kind IN ('MEMBERSHIP', 'WORKSPACE')
      AND NEW.window_seconds = 60)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'tenant rate-limit mutation denied';
  END IF;

  expected_scope_hash := pg_catalog.sha256(
    pg_catalog.convert_to(
      CASE NEW.scope_kind
        WHEN 'MEMBERSHIP' THEN context_membership::text
        WHEN 'WORKSPACE' THEN context_workspace::text
        ELSE NULL
      END,
      'UTF8'
    )
  );
  expected_window_start := pg_catalog.to_timestamp(
    pg_catalog.floor(
      extract(epoch FROM pg_catalog.statement_timestamp()) / NEW.window_seconds
    ) * NEW.window_seconds
  );

  IF NEW.scope_hash IS DISTINCT FROM expected_scope_hash
     OR NEW.window_started_at IS DISTINCT FROM expected_window_start
     OR NEW.expires_at IS DISTINCT FROM
       expected_window_start + NEW.window_seconds * interval '1 second' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'tenant rate-limit mutation denied';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.request_count <> 1 THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'tenant rate-limit mutation denied';
    END IF;
  ELSIF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.scope_kind IS DISTINCT FROM OLD.scope_kind
     OR NEW.scope_hash IS DISTINCT FROM OLD.scope_hash
     OR NEW.route_class IS DISTINCT FROM OLD.route_class
     OR NEW.window_started_at IS DISTINCT FROM OLD.window_started_at
     OR NEW.window_seconds IS DISTINCT FROM OLD.window_seconds
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.request_count IS DISTINCT FROM OLD.request_count + 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'tenant rate-limit mutation denied';
  END IF;

  NEW.updated_at := pg_catalog.statement_timestamp();
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION uptech.enforce_tenant_rate_bucket_mutation() FROM PUBLIC;

CREATE TRIGGER rate_limit_buckets_guard
BEFORE INSERT OR UPDATE ON uptech.rate_limit_buckets
FOR EACH ROW EXECUTE FUNCTION uptech.enforce_tenant_rate_bucket_mutation();

CREATE FUNCTION uptech.reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, uptech, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'audit events are append-only';
END
$function$;

REVOKE ALL ON FUNCTION uptech.reject_audit_mutation() FROM PUBLIC;

CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON uptech.audit_events
FOR EACH ROW EXECUTE FUNCTION uptech.reject_audit_mutation();

CREATE TRIGGER platform_audit_events_append_only
BEFORE UPDATE OR DELETE ON uptech.platform_audit_events
FOR EACH ROW EXECUTE FUNCTION uptech.reject_audit_mutation();

-- Every tenant relation is protected even from its owner. The explicit owner
-- policy exists solely so the offline migration owner and its two audited,
-- SECURITY DEFINER routines can cross tenant rows.
ALTER TABLE uptech.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.workspaces FORCE ROW LEVEL SECURITY;
ALTER TABLE uptech.workspace_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.workspace_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE uptech.service_actors ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.service_actors FORCE ROW LEVEL SECURITY;
ALTER TABLE uptech.connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.connectors FORCE ROW LEVEL SECURITY;
ALTER TABLE uptech.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.sources FORCE ROW LEVEL SECURITY;
ALTER TABLE uptech.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE uptech.session_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.session_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE uptech.sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.sync_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE uptech.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE uptech.security_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.security_outbox FORCE ROW LEVEL SECURITY;
ALTER TABLE uptech.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.rate_limit_buckets FORCE ROW LEVEL SECURITY;

CREATE POLICY workspaces_migration_owner ON uptech.workspaces
  TO uptech_migration_owner USING (true) WITH CHECK (true);
CREATE POLICY workspace_memberships_migration_owner ON uptech.workspace_memberships
  TO uptech_migration_owner USING (true) WITH CHECK (true);
CREATE POLICY service_actors_migration_owner ON uptech.service_actors
  TO uptech_migration_owner USING (true) WITH CHECK (true);
CREATE POLICY connectors_migration_owner ON uptech.connectors
  TO uptech_migration_owner USING (true) WITH CHECK (true);
CREATE POLICY sources_migration_owner ON uptech.sources
  TO uptech_migration_owner USING (true) WITH CHECK (true);
CREATE POLICY sessions_migration_owner ON uptech.sessions
  TO uptech_migration_owner USING (true) WITH CHECK (true);
CREATE POLICY session_tokens_migration_owner ON uptech.session_tokens
  TO uptech_migration_owner USING (true) WITH CHECK (true);
CREATE POLICY sync_jobs_migration_owner ON uptech.sync_jobs
  TO uptech_migration_owner USING (true) WITH CHECK (true);
CREATE POLICY audit_events_migration_owner ON uptech.audit_events
  TO uptech_migration_owner USING (true) WITH CHECK (true);
CREATE POLICY security_outbox_migration_owner ON uptech.security_outbox
  TO uptech_migration_owner USING (true) WITH CHECK (true);
CREATE POLICY rate_limit_buckets_migration_owner ON uptech.rate_limit_buckets
  TO uptech_migration_owner USING (true) WITH CHECK (true);

-- API context is accepted only when all three transaction-local values have
-- been populated from authenticate_session's verified result.
CREATE POLICY workspaces_api_scope ON uptech.workspaces TO uptech_api_runtime
  USING (
    workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND status = 'ACTIVE'
    AND EXISTS (
      SELECT 1
      FROM uptech.workspace_memberships AS context_membership
      WHERE context_membership.workspace_id = workspaces.workspace_id
        AND context_membership.id::text =
          NULLIF(current_setting('app.membership_id', true), '')
        AND context_membership.user_id::text =
          NULLIF(current_setting('app.actor_id', true), '')
        AND context_membership.status = 'ACTIVE'
    )
  )
  WITH CHECK (
    workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND status = 'ACTIVE'
    AND EXISTS (
      SELECT 1
      FROM uptech.workspace_memberships AS context_membership
      WHERE context_membership.workspace_id = workspaces.workspace_id
        AND context_membership.id::text =
          NULLIF(current_setting('app.membership_id', true), '')
        AND context_membership.user_id::text =
          NULLIF(current_setting('app.actor_id', true), '')
        AND context_membership.status = 'ACTIVE'
    )
  );
CREATE POLICY workspace_memberships_api_scope ON uptech.workspace_memberships
  TO uptech_api_runtime
  USING (
    workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND id::text = NULLIF(current_setting('app.membership_id', true), '')
    AND user_id::text = NULLIF(current_setting('app.actor_id', true), '')
    AND status = 'ACTIVE'
  )
  WITH CHECK (
    workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND id::text = NULLIF(current_setting('app.membership_id', true), '')
    AND user_id::text = NULLIF(current_setting('app.actor_id', true), '')
    AND status = 'ACTIVE'
  );
CREATE POLICY connectors_api_scope ON uptech.connectors TO uptech_api_runtime
  USING (
    workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND EXISTS (
      SELECT 1 FROM uptech.workspaces AS context_workspace
      WHERE context_workspace.workspace_id = connectors.workspace_id
    )
  )
  WITH CHECK (
    workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND EXISTS (
      SELECT 1 FROM uptech.workspaces AS context_workspace
      WHERE context_workspace.workspace_id = connectors.workspace_id
    )
  );
CREATE POLICY sources_api_scope ON uptech.sources TO uptech_api_runtime
  USING (
    workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND EXISTS (
      SELECT 1 FROM uptech.workspaces AS context_workspace
      WHERE context_workspace.workspace_id = sources.workspace_id
    )
  )
  WITH CHECK (
    workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND EXISTS (
      SELECT 1 FROM uptech.workspaces AS context_workspace
      WHERE context_workspace.workspace_id = sources.workspace_id
    )
  );
CREATE POLICY sessions_api_scope ON uptech.sessions TO uptech_api_runtime
  USING (
    workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND EXISTS (
      SELECT 1 FROM uptech.workspaces AS context_workspace
      WHERE context_workspace.workspace_id = sessions.workspace_id
    )
  )
  WITH CHECK (
    workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND EXISTS (
      SELECT 1 FROM uptech.workspaces AS context_workspace
      WHERE context_workspace.workspace_id = sessions.workspace_id
    )
  );
CREATE POLICY session_tokens_api_scope ON uptech.session_tokens TO uptech_api_runtime
  USING (
    workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND EXISTS (
      SELECT 1 FROM uptech.workspaces AS context_workspace
      WHERE context_workspace.workspace_id = session_tokens.workspace_id
    )
  )
  WITH CHECK (
    workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND EXISTS (
      SELECT 1 FROM uptech.workspaces AS context_workspace
      WHERE context_workspace.workspace_id = session_tokens.workspace_id
    )
  );
CREATE POLICY sync_jobs_api_scope ON uptech.sync_jobs TO uptech_api_runtime
  USING (
    workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND EXISTS (
      SELECT 1 FROM uptech.workspaces AS context_workspace
      WHERE context_workspace.workspace_id = sync_jobs.workspace_id
    )
  )
  WITH CHECK (
    workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND EXISTS (
      SELECT 1 FROM uptech.workspaces AS context_workspace
      WHERE context_workspace.workspace_id = sync_jobs.workspace_id
    )
  );
CREATE POLICY audit_events_api_read ON uptech.audit_events
  FOR SELECT TO uptech_api_runtime
  USING (
    workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND EXISTS (
      SELECT 1
      FROM uptech.workspace_memberships AS context_membership
      WHERE context_membership.workspace_id = audit_events.workspace_id
        AND context_membership.id::text =
          NULLIF(current_setting('app.membership_id', true), '')
        AND context_membership.user_id::text =
          NULLIF(current_setting('app.actor_id', true), '')
        AND context_membership.status = 'ACTIVE'
        AND context_membership.role IN ('OWNER', 'ADMIN')
    )
  );
CREATE POLICY audit_events_api_insert ON uptech.audit_events
  FOR INSERT TO uptech_api_runtime
  WITH CHECK (
    workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND actor_kind = 'USER'
    AND actor_id::text = NULLIF(current_setting('app.actor_id', true), '')
    AND membership_id::text = NULLIF(current_setting('app.membership_id', true), '')
    AND session_id::text = NULLIF(current_setting('app.session_id', true), '')
    AND EXISTS (
      SELECT 1
      FROM uptech.sessions AS context_session
      WHERE context_session.workspace_id = audit_events.workspace_id
        AND context_session.id = audit_events.session_id
        AND context_session.user_id = audit_events.actor_id
        AND context_session.membership_id = audit_events.membership_id
        AND context_session.status = 'ACTIVE'
        AND context_session.revoked_at IS NULL
        AND context_session.idle_expires_at > pg_catalog.statement_timestamp()
        AND context_session.absolute_expires_at > pg_catalog.statement_timestamp()
    )
  );
CREATE POLICY security_outbox_api_scope ON uptech.security_outbox TO uptech_api_runtime
  USING (
    workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND EXISTS (
      SELECT 1 FROM uptech.workspaces AS context_workspace
      WHERE context_workspace.workspace_id = security_outbox.workspace_id
    )
  )
  WITH CHECK (
    workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND EXISTS (
      SELECT 1 FROM uptech.workspaces AS context_workspace
      WHERE context_workspace.workspace_id = security_outbox.workspace_id
    )
  );
CREATE POLICY rate_limit_buckets_api_scope ON uptech.rate_limit_buckets
  TO uptech_api_runtime
  USING (
    workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND EXISTS (
      SELECT 1 FROM uptech.workspaces AS context_workspace
      WHERE context_workspace.workspace_id = rate_limit_buckets.workspace_id
    )
  )
  WITH CHECK (
    workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND EXISTS (
      SELECT 1 FROM uptech.workspaces AS context_workspace
      WHERE context_workspace.workspace_id = rate_limit_buckets.workspace_id
    )
  );

-- Worker context has no membership authority. It must carry the workspace,
-- service actor and exact leased job/fence returned by lease_next_job.
-- PostgreSQL also checks a SELECT policy against an UPDATE's new row. The
-- lease identity/expiry therefore stays authoritative while terminal status
-- changes are allowed to complete inside the same transaction.
CREATE POLICY sync_jobs_worker_select ON uptech.sync_jobs
  FOR SELECT TO uptech_worker_runtime
  USING (
    workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND id::text = NULLIF(current_setting('app.job_id', true), '')
    AND service_actor_id::text = NULLIF(current_setting('app.actor_id', true), '')
    AND connector_id::text = NULLIF(current_setting('app.connector_id', true), '')
    AND COALESCE(source_id::text, '') = COALESCE(current_setting('app.source_id', true), '')
    AND lease_owner = session_user::text
    AND lease_fence::text = NULLIF(current_setting('app.lease_fence', true), '')
    AND lease_expires_at > statement_timestamp()
  );
CREATE POLICY sync_jobs_worker_update ON uptech.sync_jobs
  FOR UPDATE TO uptech_worker_runtime
  USING (
    workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND id::text = NULLIF(current_setting('app.job_id', true), '')
    AND service_actor_id::text = NULLIF(current_setting('app.actor_id', true), '')
    AND connector_id::text = NULLIF(current_setting('app.connector_id', true), '')
    AND COALESCE(source_id::text, '') = COALESCE(current_setting('app.source_id', true), '')
    AND status = 'LEASED'
    AND lease_owner = session_user::text
    AND lease_fence::text = NULLIF(current_setting('app.lease_fence', true), '')
    AND lease_expires_at > statement_timestamp()
  )
  WITH CHECK (
    workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND id::text = NULLIF(current_setting('app.job_id', true), '')
    AND service_actor_id::text = NULLIF(current_setting('app.actor_id', true), '')
    AND connector_id::text = NULLIF(current_setting('app.connector_id', true), '')
    AND COALESCE(source_id::text, '') = COALESCE(current_setting('app.source_id', true), '')
    AND lease_owner = session_user::text
    AND lease_fence::text = NULLIF(current_setting('app.lease_fence', true), '')
    AND lease_expires_at > statement_timestamp()
    AND status IN ('SUCCEEDED', 'FAILED', 'CANCELLED')
  );
CREATE POLICY workspaces_worker_scope ON uptech.workspaces TO uptech_worker_runtime
  USING (
    workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND status = 'ACTIVE'
    AND EXISTS (
      SELECT 1 FROM uptech.sync_jobs AS context_job
      WHERE context_job.workspace_id = workspaces.workspace_id
        AND context_job.id::text = NULLIF(current_setting('app.job_id', true), '')
        AND context_job.lease_owner = session_user::text
        AND context_job.lease_fence::text = NULLIF(current_setting('app.lease_fence', true), '')
        AND context_job.lease_expires_at > statement_timestamp()
    )
  );
CREATE POLICY service_actors_worker_scope ON uptech.service_actors TO uptech_worker_runtime
  USING (
    workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND id::text = NULLIF(current_setting('app.actor_id', true), '')
    AND status = 'ACTIVE'
    AND EXISTS (
      SELECT 1 FROM uptech.sync_jobs AS context_job
      WHERE context_job.workspace_id = service_actors.workspace_id
        AND context_job.id::text = NULLIF(current_setting('app.job_id', true), '')
        AND context_job.lease_owner = session_user::text
        AND context_job.lease_fence::text = NULLIF(current_setting('app.lease_fence', true), '')
        AND context_job.lease_expires_at > statement_timestamp()
    )
  );
CREATE POLICY connectors_worker_scope ON uptech.connectors TO uptech_worker_runtime
  USING (
    workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND id::text = NULLIF(current_setting('app.connector_id', true), '')
    AND status IN ('ACTIVE', 'DEGRADED')
    AND EXISTS (
      SELECT 1 FROM uptech.sync_jobs AS context_job
      WHERE context_job.workspace_id = connectors.workspace_id
        AND context_job.id::text = NULLIF(current_setting('app.job_id', true), '')
        AND context_job.lease_owner = session_user::text
        AND context_job.lease_fence::text = NULLIF(current_setting('app.lease_fence', true), '')
        AND context_job.lease_expires_at > statement_timestamp()
    )
  );
CREATE POLICY sources_worker_scope ON uptech.sources TO uptech_worker_runtime
  USING (
    workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND connector_id::text = NULLIF(current_setting('app.connector_id', true), '')
    AND id::text = NULLIF(current_setting('app.source_id', true), '')
    AND status IN ('ACTIVE', 'DEGRADED')
    AND EXISTS (
      SELECT 1 FROM uptech.sync_jobs AS context_job
      WHERE context_job.workspace_id = sources.workspace_id
        AND context_job.id::text = NULLIF(current_setting('app.job_id', true), '')
        AND context_job.lease_owner = session_user::text
        AND context_job.lease_fence::text = NULLIF(current_setting('app.lease_fence', true), '')
        AND context_job.lease_expires_at > statement_timestamp()
    )
  );
CREATE POLICY audit_events_worker_scope ON uptech.audit_events TO uptech_worker_runtime
  WITH CHECK (
    workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND actor_kind = 'SERVICE'
    AND actor_id::text = NULLIF(current_setting('app.actor_id', true), '')
    AND membership_id IS NULL
    AND session_id IS NULL
    AND COALESCE(current_setting('app.membership_id', true), '') = ''
    AND COALESCE(current_setting('app.session_id', true), '') = ''
    AND EXISTS (
      SELECT 1 FROM uptech.sync_jobs AS context_job
      WHERE context_job.workspace_id = audit_events.workspace_id
        AND context_job.id::text = NULLIF(current_setting('app.job_id', true), '')
        AND context_job.service_actor_id = audit_events.actor_id
        AND context_job.lease_owner = session_user::text
        AND context_job.lease_fence::text = NULLIF(current_setting('app.lease_fence', true), '')
        AND context_job.lease_expires_at > statement_timestamp()
    )
  );
CREATE FUNCTION uptech.authenticate_session(p_token_hash bytea)
RETURNS TABLE (
  context_kind text,
  identity_id uuid,
  user_id uuid,
  workspace_id uuid,
  membership_id uuid,
  session_id uuid,
  token_id uuid,
  client_type text,
  token_kind text,
  workspace_role text,
  user_security_version bigint,
  identity_security_version bigint,
  workspace_security_version bigint,
  membership_authz_version bigint,
  session_security_version bigint,
  csrf_token_hash bytea,
  allowed_operations text[],
  context_expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech, pg_temp
AS $function$
  WITH auth_time AS (
    SELECT transaction_timestamp() AS observed_at
  ),
  workspace_candidate AS (
    SELECT
      'SESSION'::text AS context_kind,
      s.identity_id,
      s.user_id,
      s.workspace_id,
      s.membership_id,
      s.id AS session_id,
      st.id AS token_id,
      s.client_type,
      st.token_kind,
      m.role AS workspace_role,
      u.security_version AS user_security_version,
      i.security_version AS identity_security_version,
      w.security_version AS workspace_security_version,
      m.authz_version AS membership_authz_version,
      s.security_version AS session_security_version,
      st.csrf_token_hash,
      ARRAY[]::text[] AS allowed_operations,
      LEAST(st.expires_at, s.idle_expires_at, s.absolute_expires_at) AS context_expires_at
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
    CROSS JOIN auth_time AS t
    WHERE st.token_hash = p_token_hash
      AND st.token_kind IN ('WEB_SESSION', 'NATIVE_ACCESS')
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
      'ONBOARDING'::text AS context_kind,
      os.identity_id,
      i.user_id,
      NULL::uuid AS workspace_id,
      NULL::uuid AS membership_id,
      NULL::uuid AS session_id,
      os.id AS token_id,
      NULL::text AS client_type,
      'ONBOARDING'::text AS token_kind,
      NULL::text AS workspace_role,
      u.security_version AS user_security_version,
      i.security_version AS identity_security_version,
      NULL::bigint AS workspace_security_version,
      NULL::bigint AS membership_authz_version,
      NULL::bigint AS session_security_version,
      NULL::bytea AS csrf_token_hash,
      os.allowed_operations,
      os.expires_at AS context_expires_at
    FROM uptech.onboarding_sessions AS os
    JOIN uptech.identities AS i ON i.id = os.identity_id
    JOIN uptech.users AS u ON u.id = i.user_id
    CROSS JOIN auth_time AS t
    WHERE os.token_hash = p_token_hash
      AND os.status = 'ACTIVE'
      AND os.consumed_at IS NULL
      AND os.revoked_at IS NULL
      AND os.expires_at > t.observed_at
      AND i.status = 'ACTIVE'
      AND u.status = 'ACTIVE'
  ),
  candidates AS (
    SELECT * FROM workspace_candidate
    UNION ALL
    SELECT * FROM onboarding_candidate
  ),
  masked_unique_candidate AS (
    SELECT candidates.*, count(*) OVER () AS candidate_count
    FROM candidates
  )
  SELECT
    candidate.context_kind,
    candidate.identity_id,
    candidate.user_id,
    candidate.workspace_id,
    candidate.membership_id,
    candidate.session_id,
    candidate.token_id,
    candidate.client_type,
    candidate.token_kind,
    candidate.workspace_role,
    candidate.user_security_version,
    candidate.identity_security_version,
    candidate.workspace_security_version,
    candidate.membership_authz_version,
    candidate.session_security_version,
    candidate.csrf_token_hash,
    candidate.allowed_operations,
    candidate.context_expires_at
  FROM masked_unique_candidate AS candidate
  WHERE candidate.candidate_count = 1
$function$;

REVOKE ALL ON FUNCTION uptech.authenticate_session(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION uptech.authenticate_session(bytea)
  FROM uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.authenticate_session(bytea)
  TO uptech_api_runtime;

CREATE FUNCTION uptech.lease_next_job()
RETURNS TABLE (
  workspace_id uuid,
  job_id uuid,
  job_kind text,
  service_actor_id uuid,
  connector_id uuid,
  source_id uuid,
  lease_fence uuid,
  lease_expires_at timestamptz
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech, pg_temp
AS $function$
  WITH lease_time AS (
    SELECT statement_timestamp() AS observed_at
  ),
  candidate AS (
    SELECT j.workspace_id, j.id
    FROM uptech.sync_jobs AS j
    JOIN uptech.workspaces AS w
      ON w.workspace_id = j.workspace_id
     AND w.status = 'ACTIVE'
    JOIN uptech.service_actors AS a
      ON a.workspace_id = j.workspace_id
     AND a.id = j.service_actor_id
     AND a.status = 'ACTIVE'
    JOIN uptech.connectors AS c
      ON c.workspace_id = j.workspace_id
     AND c.id = j.connector_id
     AND c.status IN ('ACTIVE', 'DEGRADED')
    LEFT JOIN uptech.sources AS s
      ON s.workspace_id = j.workspace_id
     AND s.id = j.source_id
     AND s.connector_id = j.connector_id
    CROSS JOIN lease_time AS t
    WHERE j.job_kind IN (
        'DIRECTORY_SYNC',
        'DRIVE_SYNC',
        'DRIVE_CHANGES',
        'DRIVE_RECONCILE'
      )
      AND (
        (j.job_kind = 'DIRECTORY_SYNC' AND c.purpose = 'DIRECTORY')
        OR (j.job_kind <> 'DIRECTORY_SYNC' AND c.purpose = 'DRIVE')
      )
      AND j.available_at <= t.observed_at
      AND j.attempt_count < j.max_attempts
      AND (
        j.status = 'QUEUED'
        OR (j.status = 'LEASED' AND j.lease_expires_at <= t.observed_at)
      )
      AND (j.source_id IS NULL OR s.status IN ('ACTIVE', 'DEGRADED'))
    ORDER BY j.priority DESC, j.available_at, j.created_at, j.workspace_id, j.id
    FOR UPDATE OF j SKIP LOCKED
    LIMIT 1
  ),
  leased AS (
    UPDATE uptech.sync_jobs AS j
    SET status = 'LEASED',
        leased_at = t.observed_at,
        lease_expires_at = t.observed_at + interval '5 minutes',
        lease_owner = session_user::text,
        lease_fence = pg_catalog.gen_random_uuid(),
        attempt_count = j.attempt_count + 1,
        updated_at = t.observed_at
    FROM candidate AS c
    CROSS JOIN lease_time AS t
    WHERE j.workspace_id = c.workspace_id
      AND j.id = c.id
    RETURNING
      j.workspace_id,
      j.id AS job_id,
      j.job_kind,
      j.service_actor_id,
      j.connector_id,
      j.source_id,
      j.lease_fence,
      j.lease_expires_at
  )
  SELECT
    leased.workspace_id,
    leased.job_id,
    leased.job_kind,
    leased.service_actor_id,
    leased.connector_id,
    leased.source_id,
    leased.lease_fence,
    leased.lease_expires_at
  FROM leased
$function$;

REVOKE ALL ON FUNCTION uptech.lease_next_job() FROM PUBLIC;
REVOKE ALL ON FUNCTION uptech.lease_next_job() FROM uptech_api_runtime;
GRANT EXECUTE ON FUNCTION uptech.lease_next_job() TO uptech_worker_runtime;

REVOKE ALL ON ALL TABLES IN SCHEMA uptech FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA uptech
  FROM uptech_api_runtime, uptech_worker_runtime;

GRANT SELECT ON uptech.workspaces, uptech.workspace_memberships,
  uptech.connectors, uptech.sources, uptech.sessions,
  uptech.sync_jobs, uptech.audit_events
  TO uptech_api_runtime;
GRANT SELECT (
  workspace_id,
  id,
  session_id,
  client_type,
  token_kind,
  token_status,
  session_security_version,
  rotation_version,
  issued_at,
  expires_at,
  became_previous_at,
  previous_valid_until,
  revoked_at
) ON uptech.session_tokens TO uptech_api_runtime;
GRANT INSERT ON uptech.sessions, uptech.session_tokens TO uptech_api_runtime;
GRANT UPDATE (
  status,
  security_version,
  current_rotation_version,
  last_seen_at,
  idle_expires_at,
  revoked_at,
  revocation_reason
) ON uptech.sessions TO uptech_api_runtime;
GRANT UPDATE (
  token_status,
  became_previous_at,
  previous_valid_until,
  revoked_at
) ON uptech.session_tokens TO uptech_api_runtime;
GRANT SELECT (
  workspace_id,
  scope_kind,
  scope_hash,
  route_class,
  window_started_at,
  request_count
) ON uptech.rate_limit_buckets TO uptech_api_runtime;
GRANT INSERT ON uptech.rate_limit_buckets TO uptech_api_runtime;
GRANT UPDATE (request_count, updated_at) ON uptech.rate_limit_buckets
  TO uptech_api_runtime;
GRANT INSERT ON uptech.sync_jobs, uptech.audit_events, uptech.security_outbox
  TO uptech_api_runtime;

GRANT SELECT ON uptech.workspaces, uptech.service_actors, uptech.connectors,
  uptech.sources, uptech.sync_jobs
  TO uptech_worker_runtime;
GRANT UPDATE (
  status,
  completed_at,
  last_error_code,
  updated_at
) ON uptech.sync_jobs TO uptech_worker_runtime;
GRANT INSERT ON uptech.audit_events TO uptech_worker_runtime;

-- Reassert defaults after all objects exist. Future migration-owned objects are
-- private until a migration grants an explicit capability.
ALTER DEFAULT PRIVILEGES FOR ROLE uptech_migration_owner IN SCHEMA uptech
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE uptech_migration_owner IN SCHEMA uptech
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMIT;
