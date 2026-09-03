\set ON_ERROR_STOP on

BEGIN;
SET LOCAL ROLE uptech_migration_owner;

CREATE TYPE uptech.google_workspace_domain_kind_v1 AS ENUM (
  'PRIMARY', 'SECONDARY', 'ALIAS'
);

CREATE TYPE uptech.google_workspace_bootstrap_attempt_state_v1 AS ENUM (
  'PREPARED', 'COMMITTED', 'ABORTED'
);

CREATE TYPE uptech.workspace_access_request_status_v1 AS ENUM (
  'PENDING', 'FULFILLED', 'CANCELLED'
);

CREATE TYPE uptech.google_login_access_state_v2 AS ENUM (
  'UNKNOWN_WORKSPACE',
  'USER_NOT_PROVISIONED',
  'ACCESS_MAPPING_CONFLICT',
  'USER_SUSPENDED',
  'USER_REMOVED',
  'DIRECTORY_SYNC_PENDING',
  'DIRECTORY_STALE',
  'DIRECTORY_STALE_ACCESS_REQUEST_AVAILABLE',
  'WORKSPACE_SUSPENDED'
);

CREATE TYPE uptech.google_workspace_verified_domain_v1 AS (
  normalized_domain text,
  domain_kind uptech.google_workspace_domain_kind_v1,
  provider_parent_domain text
);

CREATE FUNCTION uptech.onboarding_operations_are_unique_v1(p_values text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO pg_catalog, uptech
AS $function$
  SELECT p_values IS NOT NULL
    AND array_position(p_values, NULL) IS NULL
    AND cardinality(p_values) = (
      SELECT count(DISTINCT operation_name)
      FROM unnest(p_values) AS operation_name
    )
$function$;

REVOKE ALL ON FUNCTION uptech.onboarding_operations_are_unique_v1(text[])
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;

ALTER TABLE uptech.onboarding_sessions
  ADD COLUMN resource_workspace_id uuid;

ALTER TABLE uptech.onboarding_sessions
  ADD CONSTRAINT onboarding_sessions_resource_workspace_fk
    FOREIGN KEY (resource_workspace_id)
    REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT
    NOT VALID;

ALTER TABLE uptech.onboarding_sessions
  VALIDATE CONSTRAINT onboarding_sessions_resource_workspace_fk;

ALTER TABLE uptech.onboarding_sessions
  DROP CONSTRAINT onboarding_sessions_operations_check,
  DROP CONSTRAINT onboarding_sessions_expiry_check;

ALTER TABLE uptech.onboarding_sessions
  ADD CONSTRAINT onboarding_sessions_operations_check CHECK (
    cardinality(allowed_operations) BETWEEN 1 AND 5
    AND uptech.onboarding_operations_are_unique_v1(allowed_operations)
    AND (
      (
        allowed_operations <@ ARRAY[
          'FIRST_DOMAIN_CLAIM_READ',
          'FIRST_DOMAIN_CLAIM_RESERVE',
          'FIRST_DOMAIN_CLAIM_COMPLETE'
        ]::text[]
        AND resource_workspace_id IS NULL
      )
      OR (
        allowed_operations <@ ARRAY[
          'ACCESS_REQUEST_READ',
          'ACCESS_REQUEST_SUBMIT'
        ]::text[]
        AND resource_workspace_id IS NOT NULL
      )
      OR (
        allowed_operations <@ ARRAY[
          'DIRECTORY_BOOTSTRAP_STATUS_READ',
          'DIRECTORY_BOOTSTRAP_SYNC_RETRY'
        ]::text[]
        AND resource_workspace_id IS NOT NULL
      )
    )
  ) NOT VALID,
  ADD CONSTRAINT onboarding_sessions_expiry_check CHECK (
    expires_at > created_at
    AND (
      (
        allowed_operations <@ ARRAY[
          'DIRECTORY_BOOTSTRAP_STATUS_READ',
          'DIRECTORY_BOOTSTRAP_SYNC_RETRY'
        ]::text[]
        AND expires_at <= created_at + interval '24 hours'
      )
      OR (
        NOT (allowed_operations <@ ARRAY[
          'DIRECTORY_BOOTSTRAP_STATUS_READ',
          'DIRECTORY_BOOTSTRAP_SYNC_RETRY'
        ]::text[])
        AND expires_at <= created_at + interval '30 minutes'
      )
    )
  ) NOT VALID;

ALTER TABLE uptech.onboarding_sessions
  VALIDATE CONSTRAINT onboarding_sessions_operations_check;
ALTER TABLE uptech.onboarding_sessions
  VALIDATE CONSTRAINT onboarding_sessions_expiry_check;

ALTER TABLE uptech.workspace_domain_locators
  ADD COLUMN google_customer_id text COLLATE "C",
  ADD COLUMN domain_kind uptech.google_workspace_domain_kind_v1,
  ADD COLUMN provider_parent_domain uptech.google_normalized_domain_v1;

ALTER TABLE uptech.workspace_domain_locators
  ADD CONSTRAINT workspace_domain_locators_customer_shape_check CHECK (
    (
      google_customer_id IS NULL
      AND domain_kind IS NULL
      AND provider_parent_domain IS NULL
    )
    OR (
      google_customer_id IS NOT NULL
      AND length(google_customer_id) BETWEEN 1 AND 512
      AND google_customer_id = btrim(google_customer_id)
      AND domain_kind IS NOT NULL
      AND (
        (domain_kind IN ('PRIMARY', 'SECONDARY') AND provider_parent_domain IS NULL)
        OR (
          domain_kind = 'ALIAS'
          AND provider_parent_domain IS NOT NULL
          AND provider_parent_domain <> normalized_domain
        )
      )
    )
  ) NOT VALID,
  ADD CONSTRAINT workspace_domain_locators_workspace_customer_fk
    FOREIGN KEY (workspace_id, google_customer_id)
    REFERENCES uptech.workspaces (workspace_id, google_customer_id)
    ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT workspace_domain_locators_workspace_customer_domain_unique
    UNIQUE (workspace_id, google_customer_id, normalized_domain);

ALTER TABLE uptech.workspace_domain_locators
  VALIDATE CONSTRAINT workspace_domain_locators_customer_shape_check;
ALTER TABLE uptech.workspace_domain_locators
  VALIDATE CONSTRAINT workspace_domain_locators_workspace_customer_fk;

ALTER TABLE uptech.workspace_domain_locators
  ADD CONSTRAINT workspace_domain_locators_alias_parent_fk
    FOREIGN KEY (workspace_id, google_customer_id, provider_parent_domain)
    REFERENCES uptech.workspace_domain_locators (
      workspace_id, google_customer_id, normalized_domain
    )
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX workspace_domain_locators_one_primary_customer
  ON uptech.workspace_domain_locators (workspace_id, google_customer_id)
  WHERE domain_kind = 'PRIMARY';

CREATE FUNCTION uptech.enforce_workspace_domain_alias_parent_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, uptech
AS $function$
BEGIN
  IF NEW.domain_kind = 'ALIAS' AND NOT EXISTS (
    SELECT 1
    FROM uptech.workspace_domain_locators AS parent
    WHERE parent.workspace_id = NEW.workspace_id
      AND parent.google_customer_id = NEW.google_customer_id
      AND parent.normalized_domain = NEW.provider_parent_domain
      AND parent.status = 'VERIFIED'
      AND parent.domain_kind IN ('PRIMARY', 'SECONDARY')
  ) THEN
    RAISE EXCEPTION 'alias parent must be a verified same-customer domain'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1
    FROM uptech.workspace_domain_locators AS child
    WHERE child.workspace_id = OLD.workspace_id
      AND child.google_customer_id = OLD.google_customer_id
      AND child.provider_parent_domain = OLD.normalized_domain
      AND child.domain_kind = 'ALIAS'
  ) AND (
    NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.google_customer_id IS DISTINCT FROM OLD.google_customer_id
    OR NEW.normalized_domain IS DISTINCT FROM OLD.normalized_domain
    OR NEW.status <> 'VERIFIED'
    OR NEW.domain_kind NOT IN ('PRIMARY', 'SECONDARY')
  ) THEN
    RAISE EXCEPTION 'verified domain is still referenced by an alias'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

CREATE CONSTRAINT TRIGGER workspace_domain_locators_alias_parent_check
AFTER INSERT OR UPDATE ON uptech.workspace_domain_locators
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION uptech.enforce_workspace_domain_alias_parent_v1();

REVOKE ALL ON FUNCTION uptech.enforce_workspace_domain_alias_parent_v1()
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;

CREATE FUNCTION uptech.normalize_google_workspace_verified_domains_v1(
  p_customer_domain text,
  p_domains uptech.google_workspace_verified_domain_v1[]
)
RETURNS uptech.google_workspace_verified_domain_v1[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  normalized_customer uptech.google_normalized_domain_v1;
  normalized_domains uptech.google_workspace_verified_domain_v1[];
  total_bytes bigint;
BEGIN
  normalized_customer := lower(btrim(p_customer_domain))::uptech.google_normalized_domain_v1;

  IF p_domains IS NULL OR cardinality(p_domains) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'verified domain count must be between 1 and 1000'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_domains) AS supplied
    WHERE supplied.normalized_domain IS NULL OR supplied.domain_kind IS NULL
      OR (
        supplied.domain_kind IN ('PRIMARY', 'SECONDARY')
        AND supplied.provider_parent_domain IS NOT NULL
      )
      OR (
        supplied.domain_kind = 'ALIAS'
        AND supplied.provider_parent_domain IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'verified domain provenance is incomplete'
      USING ERRCODE = '22023';
  END IF;

  WITH normalized AS (
    SELECT
      lower(btrim(supplied.normalized_domain))::uptech.google_normalized_domain_v1
        AS normalized_domain,
      supplied.domain_kind,
      CASE WHEN supplied.provider_parent_domain IS NULL THEN NULL
        ELSE lower(btrim(supplied.provider_parent_domain))::uptech.google_normalized_domain_v1
      END AS provider_parent_domain
    FROM unnest(p_domains) AS supplied
  ), deduplicated AS (
    SELECT DISTINCT normalized_domain, domain_kind, provider_parent_domain
    FROM normalized
  )
  SELECT array_agg(
    ROW(normalized_domain::text, domain_kind, provider_parent_domain::text)
      ::uptech.google_workspace_verified_domain_v1
    ORDER BY normalized_domain COLLATE "C", domain_kind::text,
      provider_parent_domain COLLATE "C" NULLS FIRST
  )
  INTO normalized_domains
  FROM deduplicated;

  IF EXISTS (
    SELECT 1
    FROM unnest(normalized_domains) AS candidate
    GROUP BY candidate.normalized_domain
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'a domain has conflicting provenance'
      USING ERRCODE = '22023';
  END IF;

  IF (
    SELECT count(*) FROM unnest(normalized_domains) AS candidate
    WHERE candidate.domain_kind = 'PRIMARY'
  ) <> 1 OR NOT EXISTS (
    SELECT 1 FROM unnest(normalized_domains) AS candidate
    WHERE candidate.domain_kind = 'PRIMARY'
      AND candidate.normalized_domain = normalized_customer
  ) THEN
    RAISE EXCEPTION 'customer domain must equal the sole primary domain'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(normalized_domains) AS alias_domain
    WHERE alias_domain.domain_kind = 'ALIAS'
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(normalized_domains) AS parent_domain
        WHERE parent_domain.normalized_domain = alias_domain.provider_parent_domain
          AND parent_domain.domain_kind IN ('PRIMARY', 'SECONDARY')
      )
  ) THEN
    RAISE EXCEPTION 'alias parent must be in the verified domain set'
      USING ERRCODE = '22023';
  END IF;

  SELECT sum(
    octet_length(candidate.normalized_domain)
    + octet_length(candidate.domain_kind::text)
    + coalesce(octet_length(candidate.provider_parent_domain), 0)
  ) INTO total_bytes
  FROM unnest(normalized_domains) AS candidate;

  IF total_bytes > 256 * 1024 THEN
    RAISE EXCEPTION 'verified domain provenance exceeds 256 KiB'
      USING ERRCODE = '22023';
  END IF;

  RETURN normalized_domains;
END
$function$;

REVOKE ALL ON FUNCTION uptech.normalize_google_workspace_verified_domains_v1(
  text, uptech.google_workspace_verified_domain_v1[]
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;

ALTER TABLE uptech.connectors
  ADD CONSTRAINT connectors_directory_authorized_identity_fk
    FOREIGN KEY (directory_authorized_by_identity_id)
    REFERENCES uptech.identities (id) ON DELETE RESTRICT
    NOT VALID;

ALTER TABLE uptech.connectors
  VALIDATE CONSTRAINT connectors_directory_authorized_identity_fk;

ALTER TABLE uptech.connectors
  DROP CONSTRAINT connectors_directory_setup_metadata_check;

ALTER TABLE uptech.connectors
  ADD CONSTRAINT connectors_directory_setup_metadata_check CHECK (
    (
      provider_customer_id IS NULL
      AND credential_reference IS NULL
      AND directory_authorized_by_identity_id IS NULL
      AND directory_authorized_scopes IS NULL
    )
    OR (
      purpose = 'DIRECTORY'
      AND provider_customer_id IS NOT NULL
      AND length(provider_customer_id) BETWEEN 1 AND 512
      AND provider_customer_id = btrim(provider_customer_id)
      AND credential_reference IS NOT NULL
      AND length(credential_reference) BETWEEN 1 AND 1024
      AND directory_authorized_by_identity_id IS NOT NULL
      AND directory_authorized_scopes IS NOT NULL
      AND cardinality(directory_authorized_scopes) IN (4, 5)
      AND array_position(directory_authorized_scopes, NULL) IS NULL
      AND directory_authorized_scopes @> ARRAY[
        'https://www.googleapis.com/auth/admin.directory.customer.readonly',
        'https://www.googleapis.com/auth/admin.directory.user.readonly',
        'https://www.googleapis.com/auth/admin.directory.group.readonly',
        'https://www.googleapis.com/auth/admin.directory.orgunit.readonly'
      ]::text[]
      AND directory_authorized_scopes <@ ARRAY[
        'https://www.googleapis.com/auth/admin.directory.customer.readonly',
        'https://www.googleapis.com/auth/admin.directory.domain.readonly',
        'https://www.googleapis.com/auth/admin.directory.user.readonly',
        'https://www.googleapis.com/auth/admin.directory.group.readonly',
        'https://www.googleapis.com/auth/admin.directory.orgunit.readonly'
      ]::text[]
    )
  ) NOT VALID;

ALTER TABLE uptech.connectors
  VALIDATE CONSTRAINT connectors_directory_setup_metadata_check;

CREATE UNIQUE INDEX service_actors_one_active_sync_worker
  ON uptech.service_actors (workspace_id)
  WHERE actor_kind = 'SYNC_WORKER' AND status = 'ACTIVE';

ALTER TABLE uptech.people_permission_mappings
  ADD CONSTRAINT people_permission_mappings_source_check_v3 CHECK (
    source_kind IN ('ADMIN_GROUP', 'GROUP', 'DEPARTMENT', 'ORG_UNIT')
    AND length(source_value) BETWEEN 1 AND 512
    AND source_value = btrim(source_value)
    AND (source_kind <> 'DEPARTMENT' OR source_value = lower(source_value))
    AND (source_kind <> 'ORG_UNIT' OR source_value !~ '^/')
  ) NOT VALID,
  ADD CONSTRAINT people_permission_mappings_target_check_v3 CHECK (
    (source_kind = 'ADMIN_GROUP' AND target_role = 'ADMIN'
      AND target_department_key IS NULL)
    OR (source_kind IN ('GROUP', 'DEPARTMENT', 'ORG_UNIT')
      AND target_role = 'MEMBER'
      AND target_department_key IN ('SALES', 'HR', 'IT', 'FINANCE'))
  ) NOT VALID;

ALTER TABLE uptech.people_permission_mappings
  VALIDATE CONSTRAINT people_permission_mappings_source_check_v3;
ALTER TABLE uptech.people_permission_mappings
  VALIDATE CONSTRAINT people_permission_mappings_target_check_v3;
ALTER TABLE uptech.people_permission_mappings
  DROP CONSTRAINT people_permission_mappings_source_check,
  DROP CONSTRAINT people_permission_mappings_target_check;
ALTER TABLE uptech.people_permission_mappings
  RENAME CONSTRAINT people_permission_mappings_source_check_v3
  TO people_permission_mappings_source_check;
ALTER TABLE uptech.people_permission_mappings
  RENAME CONSTRAINT people_permission_mappings_target_check_v3
  TO people_permission_mappings_target_check;

CREATE TABLE uptech.google_workspace_bootstrap_attempts (
  id uuid PRIMARY KEY,
  source_onboarding_session_id uuid NOT NULL,
  identity_id uuid NOT NULL,
  candidate_workspace_id uuid NOT NULL,
  candidate_status_hash uptech.google_auth_hash32_v1 NOT NULL,
  state uptech.google_workspace_bootstrap_attempt_state_v1 NOT NULL DEFAULT 'PREPARED',
  completion_deadline timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  committed_at timestamptz,
  aborted_at timestamptz,
  retain_until timestamptz NOT NULL DEFAULT transaction_timestamp() + interval '7 days',
  provider_secret_disposition text,
  provider_secret_disposed_at timestamptz,
  CONSTRAINT google_workspace_bootstrap_attempts_identity_fk
    FOREIGN KEY (identity_id) REFERENCES uptech.identities (id) ON DELETE RESTRICT,
  CONSTRAINT google_workspace_bootstrap_attempts_candidate_workspace_unique
    UNIQUE (candidate_workspace_id),
  CONSTRAINT google_workspace_bootstrap_attempts_candidate_status_hash_unique
    UNIQUE (candidate_status_hash),
  CONSTRAINT google_workspace_bootstrap_attempts_receipt_binding_unique
    UNIQUE (id, source_onboarding_session_id, identity_id, candidate_workspace_id),
  CONSTRAINT google_workspace_bootstrap_attempts_deadline_check CHECK (
    completion_deadline > created_at
    AND completion_deadline <= created_at + interval '10 minutes'
  ),
  CONSTRAINT google_workspace_bootstrap_attempts_state_check CHECK (
    (
      state = 'PREPARED' AND committed_at IS NULL AND aborted_at IS NULL
      AND provider_secret_disposition IS NULL AND provider_secret_disposed_at IS NULL
    )
    OR (
      state = 'COMMITTED' AND committed_at IS NOT NULL AND aborted_at IS NULL
      AND provider_secret_disposition IS NULL AND provider_secret_disposed_at IS NULL
    )
    OR (
      state = 'ABORTED' AND aborted_at IS NOT NULL AND committed_at IS NULL
      AND (
        (provider_secret_disposition IS NULL AND provider_secret_disposed_at IS NULL)
        OR (
          provider_secret_disposition IN ('DESTROYED', 'QUARANTINED')
          AND provider_secret_disposed_at IS NOT NULL
        )
      )
    )
  ),
  CONSTRAINT google_workspace_bootstrap_attempts_timestamps_check CHECK (
    updated_at >= created_at
    AND retain_until >= coalesce(committed_at, aborted_at, created_at) + interval '7 days'
  )
);

CREATE UNIQUE INDEX google_workspace_bootstrap_attempts_one_live_source
  ON uptech.google_workspace_bootstrap_attempts (source_onboarding_session_id)
  WHERE state = 'PREPARED';

CREATE FUNCTION uptech.enforce_google_workspace_bootstrap_attempt_transition_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, uptech
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state <> 'ABORTED'
      OR OLD.provider_secret_disposition IS NULL
      OR OLD.retain_until > clock_timestamp()
    THEN
      RAISE EXCEPTION 'bootstrap attempt is still retained'
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.source_onboarding_session_id IS DISTINCT FROM OLD.source_onboarding_session_id
    OR NEW.identity_id IS DISTINCT FROM OLD.identity_id
    OR NEW.candidate_workspace_id IS DISTINCT FROM OLD.candidate_workspace_id
    OR NEW.candidate_status_hash IS DISTINCT FROM OLD.candidate_status_hash
    OR NEW.completion_deadline IS DISTINCT FROM OLD.completion_deadline
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'bootstrap attempt bindings are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.state = 'PREPARED' AND NEW.state IN ('COMMITTED', 'ABORTED') THEN
    NEW.updated_at := clock_timestamp();
    NEW.retain_until := greatest(
      NEW.retain_until,
      coalesce(NEW.committed_at, NEW.aborted_at, clock_timestamp()) + interval '7 days'
    );
    RETURN NEW;
  END IF;

  IF OLD.state = 'ABORTED' AND NEW.state = 'ABORTED'
    AND OLD.provider_secret_disposition IS NULL
    AND NEW.provider_secret_disposition IN ('DESTROYED', 'QUARANTINED')
    AND NEW.provider_secret_disposed_at IS NOT NULL
  THEN
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'bootstrap attempt transitions are one-way'
    USING ERRCODE = '55000';
END
$function$;

CREATE TRIGGER google_workspace_bootstrap_attempts_transition_guard
BEFORE UPDATE OR DELETE ON uptech.google_workspace_bootstrap_attempts
FOR EACH ROW EXECUTE FUNCTION
  uptech.enforce_google_workspace_bootstrap_attempt_transition_v1();

REVOKE ALL ON FUNCTION uptech.enforce_google_workspace_bootstrap_attempt_transition_v1()
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;

CREATE TABLE uptech.google_workspace_bootstrap_receipts (
  attempt_id uuid PRIMARY KEY,
  source_onboarding_session_id uuid NOT NULL UNIQUE,
  initial_status_onboarding_session_id uuid NOT NULL UNIQUE,
  identity_id uuid NOT NULL,
  workspace_id uuid NOT NULL UNIQUE,
  connector_id uuid NOT NULL,
  committed_at timestamptz NOT NULL,
  CONSTRAINT google_workspace_bootstrap_receipts_attempt_binding_fk
    FOREIGN KEY (
      attempt_id, source_onboarding_session_id, identity_id, workspace_id
    ) REFERENCES uptech.google_workspace_bootstrap_attempts (
      id, source_onboarding_session_id, identity_id, candidate_workspace_id
    ) ON DELETE RESTRICT,
  CONSTRAINT google_workspace_bootstrap_receipts_identity_fk
    FOREIGN KEY (identity_id) REFERENCES uptech.identities (id) ON DELETE RESTRICT,
  CONSTRAINT google_workspace_bootstrap_receipts_workspace_fk
    FOREIGN KEY (workspace_id) REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT,
  CONSTRAINT google_workspace_bootstrap_receipts_connector_fk
    FOREIGN KEY (workspace_id, connector_id)
    REFERENCES uptech.connectors (workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT google_workspace_bootstrap_receipts_connector_unique
    UNIQUE (workspace_id, connector_id)
);

CREATE FUNCTION uptech.enforce_google_workspace_bootstrap_receipt_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, uptech
AS $function$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'bootstrap receipts are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM uptech.google_workspace_bootstrap_attempts AS attempt
    WHERE attempt.id = NEW.attempt_id
      AND attempt.state = 'COMMITTED'
      AND attempt.committed_at = NEW.committed_at
  ) THEN
    RAISE EXCEPTION 'bootstrap receipt requires its committed attempt'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;

CREATE CONSTRAINT TRIGGER google_workspace_bootstrap_receipts_committed_attempt
AFTER INSERT ON uptech.google_workspace_bootstrap_receipts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION uptech.enforce_google_workspace_bootstrap_receipt_v1();

CREATE TRIGGER google_workspace_bootstrap_receipts_immutable
BEFORE UPDATE OR DELETE ON uptech.google_workspace_bootstrap_receipts
FOR EACH ROW EXECUTE FUNCTION uptech.enforce_google_workspace_bootstrap_receipt_v1();

REVOKE ALL ON FUNCTION uptech.enforce_google_workspace_bootstrap_receipt_v1()
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;

CREATE TABLE uptech.workspace_access_requests (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  identity_id uuid NOT NULL,
  reason_class text COLLATE "C" NOT NULL,
  status uptech.workspace_access_request_status_v1 NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  fulfilled_at timestamptz,
  cancelled_at timestamptz,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT workspace_access_requests_workspace_fk
    FOREIGN KEY (workspace_id) REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT,
  CONSTRAINT workspace_access_requests_identity_fk
    FOREIGN KEY (identity_id) REFERENCES uptech.identities (id) ON DELETE RESTRICT,
  CONSTRAINT workspace_access_requests_reason_check CHECK (
    reason_class IN (
      'ORGANIZATION_ALREADY_REGISTERED',
      'USER_NOT_PROVISIONED',
      'ACCESS_MAPPING_CONFLICT',
      'DIRECTORY_STALE'
    )
  ),
  CONSTRAINT workspace_access_requests_state_check CHECK (
    (status = 'PENDING' AND fulfilled_at IS NULL AND cancelled_at IS NULL)
    OR (status = 'FULFILLED' AND fulfilled_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND fulfilled_at IS NULL)
  ),
  CONSTRAINT workspace_access_requests_timestamps_check CHECK (
    updated_at >= created_at
    AND coalesce(fulfilled_at, updated_at) >= created_at
    AND coalesce(cancelled_at, updated_at) >= created_at
  )
);

CREATE UNIQUE INDEX workspace_access_requests_one_pending_identity_reason
  ON uptech.workspace_access_requests (workspace_id, identity_id, reason_class)
  WHERE status = 'PENDING';

CREATE FUNCTION uptech.enforce_workspace_access_request_transition_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, uptech
AS $function$
BEGIN
  IF TG_OP = 'DELETE'
    OR OLD.status <> 'PENDING'
    OR NEW.status NOT IN ('FULFILLED', 'CANCELLED')
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.identity_id IS DISTINCT FROM OLD.identity_id
    OR NEW.reason_class IS DISTINCT FROM OLD.reason_class
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'access request transition is not allowed'
      USING ERRCODE = '55000';
  END IF;

  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END
$function$;

CREATE TRIGGER workspace_access_requests_transition_guard
BEFORE UPDATE OR DELETE ON uptech.workspace_access_requests
FOR EACH ROW EXECUTE FUNCTION uptech.enforce_workspace_access_request_transition_v1();

REVOKE ALL ON FUNCTION uptech.enforce_workspace_access_request_transition_v1()
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;

ALTER TABLE uptech.workspace_access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.workspace_access_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY workspace_access_requests_migration_owner
  ON uptech.workspace_access_requests
  FOR ALL TO uptech_migration_owner
  USING (true) WITH CHECK (true);

REVOKE ALL ON uptech.google_workspace_bootstrap_attempts,
  uptech.google_workspace_bootstrap_receipts,
  uptech.workspace_access_requests
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;

COMMIT;
