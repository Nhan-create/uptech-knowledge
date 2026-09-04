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

CREATE TYPE uptech.google_web_completion_validation_outcome_v1 AS ENUM (
  'VALID', 'DENIED'
);

CREATE TYPE uptech.google_login_route_v1 AS ENUM ('/admin', '/home');

CREATE TYPE uptech.google_web_completion_validation_result_v1 AS (
  outcome uptech.google_web_completion_validation_outcome_v1,
  transaction_id uuid,
  canonical_claims uptech.google_verified_claims_assertion_v1
);

CREATE TYPE uptech.google_login_completion_result_v3 AS (
  outcome uptech.google_login_completion_outcome_v1,
  access_state uptech.google_login_access_state_v2,
  allowed_operations text[],
  expires_at timestamptz,
  route uptech.google_login_route_v1
);

CREATE TYPE uptech.google_workspace_verified_domain_v1 AS (
  normalized_domain text,
  domain_kind uptech.google_workspace_domain_kind_v1,
  provider_parent_domain text
);

CREATE TYPE uptech.google_workspace_bootstrap_prepare_outcome_v1 AS ENUM (
  'PREPARED', 'DENIED'
);

CREATE TYPE uptech.google_workspace_bootstrap_prepare_result_v1 AS (
  outcome uptech.google_workspace_bootstrap_prepare_outcome_v1
);

CREATE TYPE uptech.google_workspace_bootstrap_complete_outcome_v1 AS ENUM (
  'PROVISIONING', 'DENIED'
);

CREATE TYPE uptech.google_workspace_bootstrap_complete_result_v1 AS (
  outcome uptech.google_workspace_bootstrap_complete_outcome_v1,
  status_expires_at timestamptz
);

CREATE TYPE uptech.google_workspace_bootstrap_abort_outcome_v1 AS ENUM (
  'ABORTED', 'UNKNOWN'
);

CREATE TYPE uptech.google_workspace_bootstrap_abort_result_v1 AS (
  outcome uptech.google_workspace_bootstrap_abort_outcome_v1
);

CREATE TYPE uptech.google_workspace_bootstrap_reconcile_outcome_v1 AS ENUM (
  'COMMITTED', 'NOT_COMMITTED', 'UNKNOWN'
);

CREATE TYPE uptech.google_workspace_bootstrap_reconcile_result_v1 AS (
  outcome uptech.google_workspace_bootstrap_reconcile_outcome_v1
);

CREATE TYPE uptech.google_workspace_bootstrap_status_outcome_v1 AS ENUM (
  'DIRECTORY_BOOTSTRAP_SYNC_PENDING',
  'READY',
  'DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE',
  'DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED',
  'ONBOARDING_EXPIRED',
  'DENIED'
);

CREATE TYPE uptech.google_workspace_bootstrap_status_result_v1 AS (
  outcome uptech.google_workspace_bootstrap_status_outcome_v1
);

CREATE TYPE uptech.google_workspace_bootstrap_retry_outcome_v1 AS ENUM (
  'REQUEUED',
  'DIRECTORY_BOOTSTRAP_SYNC_PENDING',
  'READY',
  'DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED',
  'ONBOARDING_EXPIRED',
  'DENIED'
);

CREATE TYPE uptech.google_workspace_bootstrap_retry_result_v1 AS (
  outcome uptech.google_workspace_bootstrap_retry_outcome_v1
);

CREATE TYPE uptech.google_workspace_bootstrap_finish_outcome_v1 AS ENUM (
  'FINISHED', 'DENIED'
);

CREATE TYPE uptech.google_workspace_bootstrap_finish_result_v1 AS (
  outcome uptech.google_workspace_bootstrap_finish_outcome_v1
);

CREATE TYPE uptech.google_workspace_bootstrap_reissue_outcome_v1 AS ENUM (
  'REISSUED', 'DENIED'
);

CREATE TYPE uptech.google_workspace_bootstrap_reissue_result_v1 AS (
  outcome uptech.google_workspace_bootstrap_reissue_outcome_v1,
  status_expires_at timestamptz
);

CREATE TYPE uptech.onboarding_capability_revoke_outcome_v1 AS ENUM (
  'REVOKED', 'DENIED'
);

CREATE TYPE uptech.onboarding_capability_revoke_result_v1 AS (
  outcome uptech.onboarding_capability_revoke_outcome_v1
);

CREATE TYPE uptech.workspace_access_request_submit_outcome_v1 AS ENUM (
  'PENDING', 'DENIED'
);

CREATE TYPE uptech.workspace_access_request_submit_result_v1 AS (
  outcome uptech.workspace_access_request_submit_outcome_v1,
  request_id uuid,
  status uptech.workspace_access_request_status_v1
);

CREATE TYPE uptech.workspace_access_request_read_outcome_v1 AS ENUM (
  'FOUND', 'DENIED'
);

CREATE TYPE uptech.workspace_access_request_read_result_v1 AS (
  outcome uptech.workspace_access_request_read_outcome_v1,
  request_id uuid,
  status uptech.workspace_access_request_status_v1
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
  ADD COLUMN resource_workspace_id uuid,
  ADD COLUMN access_request_reason_class text COLLATE "C";

ALTER TABLE uptech.onboarding_sessions
  ADD CONSTRAINT onboarding_sessions_resource_workspace_fk
    FOREIGN KEY (resource_workspace_id)
    REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT
    NOT VALID;

ALTER TABLE uptech.onboarding_sessions
  VALIDATE CONSTRAINT onboarding_sessions_resource_workspace_fk;

UPDATE uptech.onboarding_sessions AS capability
SET allowed_operations = (
  SELECT array_agg(deduplicated.operation_name ORDER BY deduplicated.first_position)
  FROM (
    SELECT operation_name, min(position) AS first_position
    FROM unnest(capability.allowed_operations) WITH ORDINALITY AS operation(operation_name, position)
    GROUP BY operation_name
  ) AS deduplicated
)
WHERE cardinality(capability.allowed_operations) <> (
  SELECT count(DISTINCT operation_name) FROM unnest(capability.allowed_operations) AS operation_name
);

UPDATE uptech.onboarding_sessions
SET allowed_operations = ARRAY(
  SELECT operation_name FROM unnest(allowed_operations) AS operation_name
  WHERE operation_name LIKE 'FIRST_DOMAIN_CLAIM_%'
)
WHERE allowed_operations && ARRAY['FIRST_DOMAIN_CLAIM_READ','FIRST_DOMAIN_CLAIM_RESERVE','FIRST_DOMAIN_CLAIM_COMPLETE']::text[]
  AND allowed_operations && ARRAY['ACCESS_REQUEST_READ','ACCESS_REQUEST_SUBMIT']::text[];

UPDATE uptech.onboarding_sessions AS capability
SET resource_workspace_id = locator.workspace_id
FROM uptech.identities AS identity_row
JOIN uptech.workspace_domain_locators AS locator
  ON locator.normalized_domain = lower(btrim(identity_row.hosted_domain_claim))
 AND locator.status = 'VERIFIED'
WHERE capability.identity_id = identity_row.id
  AND capability.allowed_operations <@ ARRAY['ACCESS_REQUEST_READ','ACCESS_REQUEST_SUBMIT']::text[]
  AND capability.resource_workspace_id IS NULL;

-- Legacy access credentials have no persisted server reason provenance. Even
-- when their tenant can be reconstructed, remove them rather than guessing a
-- reason and accidentally merging distinct request families.
DELETE FROM uptech.onboarding_sessions
WHERE allowed_operations <@ ARRAY['ACCESS_REQUEST_READ','ACCESS_REQUEST_SUBMIT']::text[]
  AND access_request_reason_class IS NULL;

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
  ) NOT VALID,
  ADD CONSTRAINT onboarding_sessions_access_reason_check CHECK (
    (
      allowed_operations <@ ARRAY[
        'ACCESS_REQUEST_READ',
        'ACCESS_REQUEST_SUBMIT'
      ]::text[]
      AND access_request_reason_class IS NOT NULL
      AND access_request_reason_class IN (
        'ORGANIZATION_ALREADY_REGISTERED',
        'USER_NOT_PROVISIONED',
        'ACCESS_MAPPING_CONFLICT',
        'DIRECTORY_STALE'
      )
    )
    OR (
      NOT (allowed_operations <@ ARRAY[
        'ACCESS_REQUEST_READ',
        'ACCESS_REQUEST_SUBMIT'
      ]::text[])
      AND access_request_reason_class IS NULL
    )
  ) NOT VALID;

ALTER TABLE uptech.onboarding_sessions
  VALIDATE CONSTRAINT onboarding_sessions_operations_check;
ALTER TABLE uptech.onboarding_sessions
  VALIDATE CONSTRAINT onboarding_sessions_expiry_check;
ALTER TABLE uptech.onboarding_sessions
  VALIDATE CONSTRAINT onboarding_sessions_access_reason_check;

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

CREATE FUNCTION uptech.directory_scopes_are_supported_v1(p_scopes text[])
RETURNS boolean LANGUAGE sql IMMUTABLE
SET search_path TO pg_catalog, uptech
AS $function$
  SELECT p_scopes IS NOT NULL
    AND array_position(p_scopes, NULL) IS NULL
    AND cardinality(p_scopes) IN (4, 5)
    AND cardinality(p_scopes) = (SELECT count(DISTINCT scope_name) FROM unnest(p_scopes) AS scope_name)
    AND p_scopes @> ARRAY[
    'https://www.googleapis.com/auth/admin.directory.customer.readonly',
    'https://www.googleapis.com/auth/admin.directory.user.readonly',
    'https://www.googleapis.com/auth/admin.directory.group.readonly',
    'https://www.googleapis.com/auth/admin.directory.orgunit.readonly']::text[]
    AND p_scopes <@ ARRAY[
    'https://www.googleapis.com/auth/admin.directory.customer.readonly',
    'https://www.googleapis.com/auth/admin.directory.user.readonly',
    'https://www.googleapis.com/auth/admin.directory.group.readonly',
    'https://www.googleapis.com/auth/admin.directory.orgunit.readonly',
    'https://www.googleapis.com/auth/admin.directory.domain.readonly']::text[]
$function$;

REVOKE ALL ON FUNCTION uptech.directory_scopes_are_supported_v1(text[])
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;

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
      AND uptech.directory_scopes_are_supported_v1(directory_authorized_scopes)
    )
  ) NOT VALID;

ALTER TABLE uptech.connectors
  VALIDATE CONSTRAINT connectors_directory_setup_metadata_check;

DO $replace_directory_scope_checks$
DECLARE routine_oid oid; definition text;
BEGIN
  FOR routine_oid IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='uptech' AND p.prosrc LIKE '%directory_authorized_scopes%'
  LOOP
    definition := pg_get_functiondef(routine_oid);
    definition := replace(definition, 'cardinality(p_scopes) <> 4', 'NOT uptech.directory_scopes_are_supported_v1(p_scopes)');
    definition := replace(definition, 'cardinality(connector.directory_authorized_scopes) = 4', 'uptech.directory_scopes_are_supported_v1(connector.directory_authorized_scopes)');
    definition := replace(definition, 'cardinality(connector.directory_authorized_scopes)=4', 'uptech.directory_scopes_are_supported_v1(connector.directory_authorized_scopes)');
    definition := replace(definition, 'cardinality(directory_connector.directory_authorized_scopes) = 4', 'uptech.directory_scopes_are_supported_v1(directory_connector.directory_authorized_scopes)');
    EXECUTE definition;
  END LOOP;
END
$replace_directory_scope_checks$;

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

CREATE FUNCTION uptech.authenticate_google_workspace_bootstrap_source_v1(
  p_source_token_hash uptech.google_auth_hash32_v1
)
RETURNS TABLE (
  identity_id uuid,
  provider_subject text,
  normalized_email text,
  hosted_domain text,
  identity_active boolean,
  user_active boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
  SELECT
    identity_row.id,
    identity_row.provider_subject,
    pg_catalog.lower(pg_catalog.btrim(identity_row.email_claim)),
    pg_catalog.lower(pg_catalog.btrim(identity_row.hosted_domain_claim)),
    identity_row.status = 'ACTIVE',
    user_row.status = 'ACTIVE'
  FROM uptech.onboarding_sessions AS source
  JOIN uptech.identities AS identity_row ON identity_row.id = source.identity_id
  JOIN uptech.users AS user_row ON user_row.id = identity_row.user_id
  WHERE p_source_token_hash IS NOT NULL
    AND source.token_hash = p_source_token_hash
    AND source.status = 'ACTIVE'
    AND source.expires_at > pg_catalog.statement_timestamp()
    AND source.resource_workspace_id IS NULL
    AND pg_catalog.cardinality(source.allowed_operations) = 3
    AND source.allowed_operations @> ARRAY[
      'FIRST_DOMAIN_CLAIM_READ',
      'FIRST_DOMAIN_CLAIM_RESERVE',
      'FIRST_DOMAIN_CLAIM_COMPLETE'
    ]::text[]
    AND identity_row.provider = 'GOOGLE'
    AND identity_row.issuer IN ('https://accounts.google.com', 'accounts.google.com')
    AND identity_row.status = 'ACTIVE'
    AND identity_row.email_verified IS TRUE
    AND identity_row.email_claim IS NOT NULL
    AND pg_catalog.octet_length(pg_catalog.lower(pg_catalog.btrim(identity_row.email_claim))) BETWEEN 3 AND 320
    AND pg_catalog.lower(pg_catalog.btrim(identity_row.email_claim)) ~ '^[^[:space:]@]+@[^[:space:]@]+$'
    AND identity_row.hosted_domain_claim IS NOT NULL
    AND pg_catalog.octet_length(pg_catalog.lower(pg_catalog.btrim(identity_row.hosted_domain_claim))) BETWEEN 3 AND 253
    AND pg_catalog.lower(pg_catalog.btrim(identity_row.hosted_domain_claim)) !~ '[.]$'
    AND pg_catalog.lower(pg_catalog.btrim(identity_row.hosted_domain_claim)) !~ '[.][.]'
    AND pg_catalog.lower(pg_catalog.btrim(identity_row.hosted_domain_claim)) ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
    AND pg_catalog.lower(pg_catalog.btrim(identity_row.email_claim)) LIKE
      '%@' || pg_catalog.lower(pg_catalog.btrim(identity_row.hosted_domain_claim))
    AND user_row.status = 'ACTIVE'
  LIMIT 1
$function$;

REVOKE ALL ON FUNCTION uptech.authenticate_google_workspace_bootstrap_source_v1(
  uptech.google_auth_hash32_v1
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.authenticate_google_workspace_bootstrap_source_v1(
  uptech.google_auth_hash32_v1
) TO uptech_api_runtime;

CREATE FUNCTION uptech.prepare_google_workspace_bootstrap_v1(
  p_attempt_id uuid,
  p_source_token_hash uptech.google_auth_hash32_v1,
  p_candidate_workspace_id uuid,
  p_status_token_hash uptech.google_auth_hash32_v1,
  p_request_id uuid
)
RETURNS uptech.google_workspace_bootstrap_prepare_result_v1
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  existing_attempt uptech.google_workspace_bootstrap_attempts%ROWTYPE;
  selected_identity_id uuid;
  selected_source_id uuid;
BEGIN
  IF p_attempt_id IS NULL OR p_source_token_hash IS NULL
    OR p_candidate_workspace_id IS NULL OR p_status_token_hash IS NULL
    OR p_request_id IS NULL OR p_source_token_hash = p_status_token_hash
  THEN
    RETURN ROW('DENIED')::uptech.google_workspace_bootstrap_prepare_result_v1;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'google-workspace-bootstrap:' || p_attempt_id::text, 0
  ));

  SELECT * INTO existing_attempt
  FROM uptech.google_workspace_bootstrap_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;

  IF existing_attempt.id IS NOT NULL THEN
    IF existing_attempt.state <> 'PREPARED'
      OR existing_attempt.completion_deadline <= pg_catalog.statement_timestamp()
      OR existing_attempt.candidate_workspace_id <> p_candidate_workspace_id
      OR existing_attempt.candidate_status_hash <> p_status_token_hash
    THEN
      RETURN ROW('DENIED')::uptech.google_workspace_bootstrap_prepare_result_v1;
    END IF;
  END IF;

  SELECT source.id, source.identity_id INTO selected_source_id, selected_identity_id
  FROM uptech.onboarding_sessions AS source
  JOIN uptech.identities AS identity_row ON identity_row.id = source.identity_id
  JOIN uptech.users AS user_row ON user_row.id = identity_row.user_id
  WHERE source.token_hash = p_source_token_hash
    AND source.status = 'ACTIVE'
    AND source.expires_at > pg_catalog.statement_timestamp()
    AND source.resource_workspace_id IS NULL
    AND pg_catalog.cardinality(source.allowed_operations) = 3
    AND source.allowed_operations @> ARRAY[
      'FIRST_DOMAIN_CLAIM_READ',
      'FIRST_DOMAIN_CLAIM_RESERVE',
      'FIRST_DOMAIN_CLAIM_COMPLETE'
    ]::text[]
    AND identity_row.provider = 'GOOGLE'
    AND identity_row.issuer IN ('https://accounts.google.com', 'accounts.google.com')
    AND identity_row.status = 'ACTIVE'
    AND identity_row.email_verified
    AND identity_row.hosted_domain_claim IS NOT NULL
    AND user_row.status = 'ACTIVE'
  FOR UPDATE OF source, identity_row, user_row;

  IF selected_identity_id IS NULL
    OR (
      existing_attempt.id IS NOT NULL
      AND (
        existing_attempt.source_onboarding_session_id <> selected_source_id
        OR existing_attempt.identity_id <> selected_identity_id
      )
    )
    OR EXISTS (SELECT 1 FROM uptech.workspaces WHERE workspace_id = p_candidate_workspace_id)
    OR EXISTS (
      SELECT 1 FROM uptech.google_workspace_bootstrap_attempts
      WHERE source_onboarding_session_id = selected_source_id
        AND state = 'PREPARED'
        AND id <> p_attempt_id
    )
    OR EXISTS (SELECT 1 FROM uptech.onboarding_sessions WHERE token_hash = p_status_token_hash)
    OR EXISTS (SELECT 1 FROM uptech.session_tokens WHERE token_hash = p_status_token_hash)
    OR EXISTS (
      SELECT 1 FROM uptech.google_workspace_bootstrap_attempts
      WHERE candidate_status_hash = p_status_token_hash
        AND id <> p_attempt_id
    )
  THEN
    RETURN ROW('DENIED')::uptech.google_workspace_bootstrap_prepare_result_v1;
  END IF;

  IF existing_attempt.id IS NOT NULL THEN
    RETURN ROW('PREPARED')::uptech.google_workspace_bootstrap_prepare_result_v1;
  END IF;

  BEGIN
    INSERT INTO uptech.google_workspace_bootstrap_attempts (
      id, source_onboarding_session_id, identity_id, candidate_workspace_id,
      candidate_status_hash, completion_deadline
    ) VALUES (
      p_attempt_id, selected_source_id, selected_identity_id,
      p_candidate_workspace_id, p_status_token_hash,
      pg_catalog.transaction_timestamp() + interval '10 minutes'
    );
  EXCEPTION WHEN unique_violation THEN
    RETURN ROW('DENIED')::uptech.google_workspace_bootstrap_prepare_result_v1;
  END;

  RETURN ROW('PREPARED')::uptech.google_workspace_bootstrap_prepare_result_v1;
END
$function$;

CREATE FUNCTION uptech.abort_google_workspace_bootstrap_v1(
  p_attempt_id uuid,
  p_source_token_hash uptech.google_auth_hash32_v1,
  p_request_id uuid
)
RETURNS uptech.google_workspace_bootstrap_abort_result_v1
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  selected_attempt uptech.google_workspace_bootstrap_attempts%ROWTYPE;
BEGIN
  IF p_attempt_id IS NULL OR p_source_token_hash IS NULL OR p_request_id IS NULL THEN
    RETURN ROW('UNKNOWN')::uptech.google_workspace_bootstrap_abort_result_v1;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'google-workspace-bootstrap:' || p_attempt_id::text, 0
  ));

  SELECT attempt.* INTO selected_attempt
  FROM uptech.google_workspace_bootstrap_attempts AS attempt
  JOIN uptech.onboarding_sessions AS source
    ON source.id = attempt.source_onboarding_session_id
   AND source.token_hash = p_source_token_hash
  WHERE attempt.id = p_attempt_id
  FOR UPDATE OF attempt;

  IF selected_attempt.id IS NULL OR selected_attempt.state = 'COMMITTED' THEN
    RETURN ROW('UNKNOWN')::uptech.google_workspace_bootstrap_abort_result_v1;
  END IF;
  IF selected_attempt.state = 'PREPARED' THEN
    UPDATE uptech.google_workspace_bootstrap_attempts
    SET state = 'ABORTED', aborted_at = pg_catalog.statement_timestamp()
    WHERE id = p_attempt_id AND state = 'PREPARED';
  END IF;
  RETURN ROW('ABORTED')::uptech.google_workspace_bootstrap_abort_result_v1;
END
$function$;

CREATE FUNCTION uptech.complete_google_workspace_bootstrap_v1(
  p_attempt_id uuid,
  p_source_token_hash uptech.google_auth_hash32_v1,
  p_status_token_hash uptech.google_auth_hash32_v1,
  p_customer_id text,
  p_customer_domain text,
  p_provider_subject text,
  p_hosted_domain text,
  p_verified_domains uptech.google_workspace_verified_domain_v1[],
  p_credential_reference text,
  p_authorized_scopes text[],
  p_request_id uuid
)
RETURNS uptech.google_workspace_bootstrap_complete_result_v1
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  selected_attempt uptech.google_workspace_bootstrap_attempts%ROWTYPE;
  selected_identity_id uuid;
  selected_user_id uuid;
  selected_membership_id uuid := pg_catalog.gen_random_uuid();
  selected_actor_id uuid := pg_catalog.gen_random_uuid();
  selected_connector_id uuid := pg_catalog.gen_random_uuid();
  selected_status_id uuid := pg_catalog.gen_random_uuid();
  normalized_domains uptech.google_workspace_verified_domain_v1[];
  normalized_customer_domain uptech.google_normalized_domain_v1;
  normalized_hosted_domain uptech.google_normalized_domain_v1;
  committed_time timestamptz := pg_catalog.statement_timestamp();
  selected_status_expires_at timestamptz := committed_time + interval '24 hours';
BEGIN
  IF p_attempt_id IS NULL OR p_source_token_hash IS NULL OR p_status_token_hash IS NULL
    OR p_request_id IS NULL OR p_source_token_hash = p_status_token_hash
    OR p_customer_id IS NULL OR pg_catalog.length(p_customer_id) NOT BETWEEN 1 AND 512
    OR p_customer_id <> pg_catalog.btrim(p_customer_id)
    OR p_provider_subject IS NULL OR pg_catalog.length(p_provider_subject) NOT BETWEEN 1 AND 255
    OR p_provider_subject <> pg_catalog.btrim(p_provider_subject)
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
    RETURN ROW('DENIED', NULL)::uptech.google_workspace_bootstrap_complete_result_v1;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'google-workspace-bootstrap:' || p_attempt_id::text, 0
  ));

  SELECT * INTO selected_attempt
  FROM uptech.google_workspace_bootstrap_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;

  IF selected_attempt.id IS NULL
    OR selected_attempt.candidate_status_hash <> p_status_token_hash
  THEN
    RETURN ROW('DENIED', NULL)::uptech.google_workspace_bootstrap_complete_result_v1;
  END IF;

  IF selected_attempt.state <> 'PREPARED'
    OR selected_attempt.completion_deadline <= committed_time
  THEN
    RETURN ROW('DENIED', NULL)::uptech.google_workspace_bootstrap_complete_result_v1;
  END IF;

  BEGIN
    normalized_customer_domain := pg_catalog.lower(pg_catalog.btrim(p_customer_domain))::uptech.google_normalized_domain_v1;
    normalized_hosted_domain := pg_catalog.lower(pg_catalog.btrim(p_hosted_domain))::uptech.google_normalized_domain_v1;
    normalized_domains := uptech.normalize_google_workspace_verified_domains_v1(
      normalized_customer_domain::text, p_verified_domains
    );
  EXCEPTION WHEN invalid_parameter_value OR check_violation OR not_null_violation THEN
    RETURN ROW('DENIED', NULL)::uptech.google_workspace_bootstrap_complete_result_v1;
  END;

  SELECT identity_row.id, identity_row.user_id
    INTO selected_identity_id, selected_user_id
  FROM uptech.onboarding_sessions AS source
  JOIN uptech.identities AS identity_row ON identity_row.id = source.identity_id
  JOIN uptech.users AS user_row ON user_row.id = identity_row.user_id
  WHERE source.id = selected_attempt.source_onboarding_session_id
    AND source.token_hash = p_source_token_hash
    AND source.status = 'ACTIVE'
    AND source.expires_at > committed_time
    AND source.resource_workspace_id IS NULL
    AND pg_catalog.cardinality(source.allowed_operations) = 3
    AND source.allowed_operations @> ARRAY[
      'FIRST_DOMAIN_CLAIM_READ', 'FIRST_DOMAIN_CLAIM_RESERVE', 'FIRST_DOMAIN_CLAIM_COMPLETE'
    ]::text[]
    AND identity_row.id = selected_attempt.identity_id
    AND identity_row.provider = 'GOOGLE'
    AND identity_row.issuer IN ('https://accounts.google.com', 'accounts.google.com')
    AND identity_row.provider_subject = p_provider_subject
    AND identity_row.status = 'ACTIVE'
    AND identity_row.email_verified
    AND pg_catalog.lower(pg_catalog.btrim(identity_row.hosted_domain_claim)) = normalized_hosted_domain::text
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(normalized_domains) AS supplied
      WHERE supplied.normalized_domain = normalized_hosted_domain::text
    )
    AND user_row.status = 'ACTIVE'
  FOR UPDATE OF source, identity_row, user_row;

  IF selected_identity_id IS NULL
    OR EXISTS (SELECT 1 FROM uptech.workspaces WHERE google_customer_id = p_customer_id)
    OR EXISTS (
      SELECT 1 FROM pg_catalog.unnest(normalized_domains) AS supplied
      JOIN uptech.workspace_domain_locators AS locator
        ON locator.normalized_domain::text = supplied.normalized_domain
    )
    OR EXISTS (SELECT 1 FROM uptech.onboarding_sessions WHERE token_hash = p_status_token_hash)
    OR EXISTS (SELECT 1 FROM uptech.session_tokens WHERE token_hash = p_status_token_hash)
  THEN
    RETURN ROW('DENIED', NULL)::uptech.google_workspace_bootstrap_complete_result_v1;
  END IF;

  BEGIN
    INSERT INTO uptech.workspaces (
      workspace_id, status, provisioning_policy, google_customer_id,
      created_at, updated_at
    ) VALUES (
      selected_attempt.candidate_workspace_id, 'ACTIVE',
      'GOOGLE_GROUP_CONTROLLED', p_customer_id, committed_time, committed_time
    );

    INSERT INTO uptech.workspace_domain_locators (
      normalized_domain, workspace_id, status, verified_at, created_at, updated_at,
      google_customer_id, domain_kind, provider_parent_domain
    )
    SELECT supplied.normalized_domain::uptech.google_normalized_domain_v1,
      selected_attempt.candidate_workspace_id, 'VERIFIED', committed_time,
      committed_time, committed_time, p_customer_id, supplied.domain_kind,
      supplied.provider_parent_domain::uptech.google_normalized_domain_v1
    FROM pg_catalog.unnest(normalized_domains) AS supplied;

    INSERT INTO uptech.workspace_memberships (
      workspace_id, id, user_id, role, status, created_at, updated_at
    ) VALUES (
      selected_attempt.candidate_workspace_id, selected_membership_id,
      selected_user_id, 'OWNER', 'ACTIVE', committed_time, committed_time
    );

    INSERT INTO uptech.service_actors (
      workspace_id, id, actor_kind, status, created_at, updated_at
    ) VALUES (
      selected_attempt.candidate_workspace_id, selected_actor_id,
      'SYNC_WORKER', 'ACTIVE', committed_time, committed_time
    );

    INSERT INTO uptech.connectors (
      workspace_id, id, purpose, status, created_at, updated_at,
      provider_customer_id, credential_reference,
      directory_authorized_by_identity_id, directory_authorized_scopes
    ) VALUES (
      selected_attempt.candidate_workspace_id, selected_connector_id,
      'DIRECTORY', 'ACTIVE', committed_time, committed_time, p_customer_id,
      p_credential_reference, selected_identity_id, p_authorized_scopes
    );

    INSERT INTO uptech.sync_jobs (
      workspace_id, id, service_actor_id, connector_id, job_kind, status,
      dedupe_key, payload, available_at, created_at, updated_at
    ) VALUES (
      selected_attempt.candidate_workspace_id, pg_catalog.gen_random_uuid(),
      selected_actor_id, selected_connector_id, 'DIRECTORY_SYNC', 'QUEUED',
      'initial-directory-sync',
      pg_catalog.jsonb_build_object('bootstrap_attempt_id', p_attempt_id),
      committed_time, committed_time, committed_time
    );

    UPDATE uptech.onboarding_sessions
    SET status = 'CONSUMED', consumed_at = committed_time
    WHERE id = selected_attempt.source_onboarding_session_id AND status = 'ACTIVE';

    INSERT INTO uptech.onboarding_sessions (
      id, identity_id, token_hash, allowed_operations, status,
      created_at, expires_at, resource_workspace_id
    ) VALUES (
      selected_status_id, selected_identity_id, p_status_token_hash,
      ARRAY['DIRECTORY_BOOTSTRAP_STATUS_READ','DIRECTORY_BOOTSTRAP_SYNC_RETRY']::text[],
      'ACTIVE', committed_time, selected_status_expires_at,
      selected_attempt.candidate_workspace_id
    );

    UPDATE uptech.google_workspace_bootstrap_attempts
    SET state = 'COMMITTED', committed_at = committed_time
    WHERE id = p_attempt_id AND state = 'PREPARED';

    INSERT INTO uptech.google_workspace_bootstrap_receipts (
      attempt_id, source_onboarding_session_id,
      initial_status_onboarding_session_id, identity_id, workspace_id,
      connector_id, committed_at
    ) VALUES (
      p_attempt_id, selected_attempt.source_onboarding_session_id,
      selected_status_id, selected_identity_id,
      selected_attempt.candidate_workspace_id, selected_connector_id, committed_time
    );

    INSERT INTO uptech.audit_events (
      workspace_id, id, actor_kind, action, target_type, target_id,
      outcome, request_id, metadata, occurred_at
    ) VALUES (
      selected_attempt.candidate_workspace_id, pg_catalog.gen_random_uuid(),
      'SYSTEM', 'GOOGLE_WORKSPACE_BOOTSTRAP_COMMITTED', 'CONNECTOR',
      selected_connector_id, 'SUCCEEDED', p_request_id,
      pg_catalog.jsonb_build_object('bootstrap_attempt_id', p_attempt_id), committed_time
    );

    INSERT INTO uptech.platform_audit_events (
      id, identity_id, action, target_type, outcome, request_id, metadata, occurred_at
    ) VALUES (
      pg_catalog.gen_random_uuid(), selected_identity_id,
      'GOOGLE_WORKSPACE_BOOTSTRAP_COMMITTED', 'GOOGLE_WORKSPACE_BOOTSTRAP',
      'SUCCEEDED', p_request_id,
      pg_catalog.jsonb_build_object(
        'bootstrap_attempt_id', p_attempt_id,
        'workspace_id', selected_attempt.candidate_workspace_id
      ), committed_time
    );
  EXCEPTION WHEN unique_violation THEN
    RETURN ROW('DENIED', NULL)::uptech.google_workspace_bootstrap_complete_result_v1;
  END;

  RETURN ROW('PROVISIONING', selected_status_expires_at)::uptech.google_workspace_bootstrap_complete_result_v1;
END
$function$;

CREATE FUNCTION uptech.reconcile_google_workspace_bootstrap_v1(
  p_attempt_id uuid,
  p_source_token_hash uptech.google_auth_hash32_v1,
  p_status_token_hash uptech.google_auth_hash32_v1,
  p_credential_reference text,
  p_request_id uuid
)
RETURNS uptech.google_workspace_bootstrap_reconcile_result_v1
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  selected_attempt uptech.google_workspace_bootstrap_attempts%ROWTYPE;
BEGIN
  IF p_attempt_id IS NULL OR p_source_token_hash IS NULL
    OR p_status_token_hash IS NULL OR p_source_token_hash = p_status_token_hash
    OR p_credential_reference IS NULL
    OR pg_catalog.length(p_credential_reference) NOT BETWEEN 1 AND 1024
    OR p_credential_reference <> pg_catalog.btrim(p_credential_reference)
    OR p_request_id IS NULL
  THEN
    RETURN ROW('UNKNOWN')::uptech.google_workspace_bootstrap_reconcile_result_v1;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'google-workspace-bootstrap:' || p_attempt_id::text, 0
  ));

  SELECT attempt.* INTO selected_attempt
  FROM uptech.google_workspace_bootstrap_attempts AS attempt
  JOIN uptech.onboarding_sessions AS source
    ON source.id = attempt.source_onboarding_session_id
   AND source.token_hash = p_source_token_hash
  WHERE attempt.id = p_attempt_id
    AND attempt.candidate_status_hash = p_status_token_hash
  FOR UPDATE OF attempt;

  IF selected_attempt.id IS NULL THEN
    RETURN ROW('UNKNOWN')::uptech.google_workspace_bootstrap_reconcile_result_v1;
  END IF;

  IF selected_attempt.state = 'COMMITTED' THEN
    IF EXISTS (
      SELECT 1
      FROM uptech.google_workspace_bootstrap_receipts AS receipt
      JOIN uptech.onboarding_sessions AS source
        ON source.id = receipt.source_onboarding_session_id
       AND source.token_hash = p_source_token_hash
      JOIN uptech.onboarding_sessions AS status_capability
        ON status_capability.id = receipt.initial_status_onboarding_session_id
       AND status_capability.token_hash = p_status_token_hash
      JOIN uptech.connectors AS connector
        ON connector.workspace_id = receipt.workspace_id
       AND connector.id = receipt.connector_id
       AND connector.credential_reference = p_credential_reference
      WHERE receipt.attempt_id = p_attempt_id
        AND receipt.workspace_id = selected_attempt.candidate_workspace_id
        AND receipt.identity_id = selected_attempt.identity_id
    ) THEN
      RETURN ROW('COMMITTED')::uptech.google_workspace_bootstrap_reconcile_result_v1;
    END IF;
    RETURN ROW('UNKNOWN')::uptech.google_workspace_bootstrap_reconcile_result_v1;
  END IF;

  IF selected_attempt.state = 'PREPARED' THEN
    IF selected_attempt.completion_deadline > pg_catalog.statement_timestamp()
      OR EXISTS (
        SELECT 1 FROM uptech.google_workspace_bootstrap_receipts
        WHERE attempt_id = p_attempt_id
      )
      OR EXISTS (
        SELECT 1 FROM uptech.connectors
        WHERE credential_reference = p_credential_reference
      )
    THEN
      RETURN ROW('UNKNOWN')::uptech.google_workspace_bootstrap_reconcile_result_v1;
    END IF;

    UPDATE uptech.google_workspace_bootstrap_attempts
    SET state = 'ABORTED', aborted_at = pg_catalog.statement_timestamp()
    WHERE id = p_attempt_id AND state = 'PREPARED';

    IF NOT FOUND THEN
      RETURN ROW('UNKNOWN')::uptech.google_workspace_bootstrap_reconcile_result_v1;
    END IF;
    selected_attempt.state := 'ABORTED';
  END IF;

  IF selected_attempt.state = 'ABORTED'
    AND NOT EXISTS (
      SELECT 1 FROM uptech.google_workspace_bootstrap_receipts
      WHERE attempt_id = p_attempt_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM uptech.connectors
      WHERE credential_reference = p_credential_reference
    )
  THEN
    RETURN ROW('NOT_COMMITTED')::uptech.google_workspace_bootstrap_reconcile_result_v1;
  END IF;

  RETURN ROW('UNKNOWN')::uptech.google_workspace_bootstrap_reconcile_result_v1;
END
$function$;

REVOKE ALL ON FUNCTION uptech.prepare_google_workspace_bootstrap_v1(
  uuid, uptech.google_auth_hash32_v1, uuid, uptech.google_auth_hash32_v1, uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.prepare_google_workspace_bootstrap_v1(
  uuid, uptech.google_auth_hash32_v1, uuid, uptech.google_auth_hash32_v1, uuid
) TO uptech_api_runtime;

REVOKE ALL ON FUNCTION uptech.complete_google_workspace_bootstrap_v1(
  uuid, uptech.google_auth_hash32_v1, uptech.google_auth_hash32_v1,
  text, text, text, text, uptech.google_workspace_verified_domain_v1[],
  text, text[], uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.complete_google_workspace_bootstrap_v1(
  uuid, uptech.google_auth_hash32_v1, uptech.google_auth_hash32_v1,
  text, text, text, text, uptech.google_workspace_verified_domain_v1[],
  text, text[], uuid
) TO uptech_api_runtime;

REVOKE ALL ON FUNCTION uptech.reconcile_google_workspace_bootstrap_v1(
  uuid, uptech.google_auth_hash32_v1, uptech.google_auth_hash32_v1, text, uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.reconcile_google_workspace_bootstrap_v1(
  uuid, uptech.google_auth_hash32_v1, uptech.google_auth_hash32_v1, text, uuid
) TO uptech_api_runtime;

REVOKE ALL ON FUNCTION uptech.abort_google_workspace_bootstrap_v1(
  uuid, uptech.google_auth_hash32_v1, uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.abort_google_workspace_bootstrap_v1(
  uuid, uptech.google_auth_hash32_v1, uuid
) TO uptech_api_runtime;

-- Internal, fixed-shape append used only by the seven capability-bound Task 6
-- routines. The request/action advisory lock makes a retried request idempotent
-- without storing credential material in either audit sink.
CREATE FUNCTION uptech.append_task6_audit_events_v1(
  p_workspace_id uuid,
  p_identity_id uuid,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_outcome text,
  p_request_id uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
BEGIN
  IF p_request_id IS NULL
    OR p_action NOT IN (
      'GOOGLE_WORKSPACE_BOOTSTRAP_STATUS_CHECKED',
      'GOOGLE_WORKSPACE_BOOTSTRAP_SYNC_RETRY_REQUESTED',
      'GOOGLE_WORKSPACE_BOOTSTRAP_SYNC_RETRY_RESULT',
      'GOOGLE_WORKSPACE_BOOTSTRAP_FINISHED',
      'GOOGLE_WORKSPACE_BOOTSTRAP_STATUS_REISSUED',
      'ONBOARDING_CAPABILITY_REVOKED',
      'WORKSPACE_ACCESS_REQUEST_SUBMITTED',
      'WORKSPACE_ACCESS_REQUEST_DEDUPLICATED',
      'WORKSPACE_ACCESS_REQUEST_READ'
    )
    OR p_outcome NOT IN ('SUCCEEDED','DENIED','FAILED')
    OR pg_catalog.jsonb_typeof(p_metadata) <> 'object'
    OR (p_metadata - ARRAY['result','reason_class']::text[]) <> '{}'::jsonb
  THEN
    RAISE EXCEPTION 'invalid Task 6 audit event' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'task6-audit:' || p_action || ':' || p_request_id::text, 0));

  IF p_workspace_id IS NOT NULL THEN
    INSERT INTO uptech.audit_events(
      workspace_id,id,actor_kind,action,target_type,target_id,outcome,
      request_id,metadata,occurred_at
    ) SELECT p_workspace_id,pg_catalog.gen_random_uuid(),'SYSTEM',p_action,
      p_target_type,p_target_id,p_outcome,p_request_id,p_metadata,
      pg_catalog.clock_timestamp()
    WHERE NOT EXISTS (
      SELECT 1 FROM uptech.audit_events AS existing
      WHERE existing.workspace_id = p_workspace_id
        AND existing.request_id = p_request_id
        AND existing.action = p_action
    );
  ELSE
    INSERT INTO uptech.platform_audit_events(
      id,identity_id,action,target_type,outcome,request_id,metadata,occurred_at
    ) SELECT pg_catalog.gen_random_uuid(),p_identity_id,p_action,p_target_type,
      p_outcome,p_request_id,p_metadata,pg_catalog.clock_timestamp()
    WHERE NOT EXISTS (
      SELECT 1 FROM uptech.platform_audit_events AS existing
      WHERE existing.request_id = p_request_id
        AND existing.action = p_action
    );
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION uptech.append_task6_audit_events_v1(
  uuid,uuid,text,text,uuid,text,uuid,jsonb
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;

CREATE FUNCTION uptech.read_google_workspace_bootstrap_status_v1(
  p_status_token_hash uptech.google_auth_hash32_v1,
  p_request_id uuid
)
RETURNS uptech.google_workspace_bootstrap_status_result_v1
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  selected_capability uptech.onboarding_sessions%ROWTYPE;
  selected_attempt_id uuid;
  selected_workspace_id uuid;
  selected_connector_id uuid;
  selected_customer_id text;
  selected_job uptech.sync_jobs%ROWTYPE;
  observed_at timestamptz := pg_catalog.statement_timestamp();
BEGIN
  IF p_status_token_hash IS NULL OR p_request_id IS NULL THEN
    RETURN ROW('DENIED')::uptech.google_workspace_bootstrap_status_result_v1;
  END IF;

  -- Credential-only lookup comes first. An expired status credential never
  -- reaches a tenant-owned relation and therefore cannot reveal tenant state.
  SELECT capability.* INTO selected_capability
  FROM uptech.onboarding_sessions AS capability
  WHERE capability.token_hash = p_status_token_hash;

  IF selected_capability.id IS NULL
    OR pg_catalog.cardinality(selected_capability.allowed_operations) <> 2
    OR NOT selected_capability.allowed_operations @> ARRAY[
      'DIRECTORY_BOOTSTRAP_STATUS_READ',
      'DIRECTORY_BOOTSTRAP_SYNC_RETRY'
    ]::text[]
  THEN
    PERFORM uptech.append_task6_audit_events_v1(
      NULL,selected_capability.identity_id,'GOOGLE_WORKSPACE_BOOTSTRAP_STATUS_CHECKED',
      'GOOGLE_WORKSPACE_BOOTSTRAP',NULL,'DENIED',p_request_id,
      pg_catalog.jsonb_build_object('result','DENIED'));
    RETURN ROW('DENIED')::uptech.google_workspace_bootstrap_status_result_v1;
  END IF;

  IF selected_capability.status IN ('CONSUMED', 'EXPIRED')
    OR (selected_capability.status = 'ACTIVE'
      AND selected_capability.expires_at <= observed_at)
  THEN
    PERFORM uptech.append_task6_audit_events_v1(
      NULL,selected_capability.identity_id,'GOOGLE_WORKSPACE_BOOTSTRAP_STATUS_CHECKED',
      'GOOGLE_WORKSPACE_BOOTSTRAP',NULL,'SUCCEEDED',p_request_id,
      pg_catalog.jsonb_build_object('result','ONBOARDING_EXPIRED'));
    RETURN ROW('ONBOARDING_EXPIRED')::uptech.google_workspace_bootstrap_status_result_v1;
  END IF;

  IF selected_capability.status <> 'ACTIVE' THEN
    PERFORM uptech.append_task6_audit_events_v1(
      NULL,selected_capability.identity_id,'GOOGLE_WORKSPACE_BOOTSTRAP_STATUS_CHECKED',
      'GOOGLE_WORKSPACE_BOOTSTRAP',NULL,'DENIED',p_request_id,
      pg_catalog.jsonb_build_object('result','DENIED'));
    RETURN ROW('DENIED')::uptech.google_workspace_bootstrap_status_result_v1;
  END IF;

  SELECT receipt.attempt_id, receipt.workspace_id, receipt.connector_id,
    workspace.google_customer_id
  INTO selected_attempt_id, selected_workspace_id, selected_connector_id,
    selected_customer_id
  FROM uptech.google_workspace_bootstrap_receipts AS receipt
  JOIN uptech.google_workspace_bootstrap_attempts AS attempt
    ON attempt.id = receipt.attempt_id AND attempt.state = 'COMMITTED'
  JOIN uptech.workspaces AS workspace
    ON workspace.workspace_id = receipt.workspace_id
   AND workspace.status = 'ACTIVE'
   AND workspace.google_customer_id IS NOT NULL
  JOIN uptech.connectors AS connector
    ON connector.workspace_id = receipt.workspace_id
   AND connector.id = receipt.connector_id
   AND connector.purpose = 'DIRECTORY'
   AND connector.status IN ('ACTIVE', 'DEGRADED')
   AND connector.provider_customer_id = workspace.google_customer_id
   AND connector.directory_authorized_by_identity_id = receipt.identity_id
  WHERE receipt.identity_id = selected_capability.identity_id
    AND receipt.workspace_id = selected_capability.resource_workspace_id;

  IF selected_attempt_id IS NULL THEN
    PERFORM uptech.append_task6_audit_events_v1(
      NULL,selected_capability.identity_id,'GOOGLE_WORKSPACE_BOOTSTRAP_STATUS_CHECKED',
      'GOOGLE_WORKSPACE_BOOTSTRAP',NULL,'DENIED',p_request_id,
      pg_catalog.jsonb_build_object('result','DENIED'));
    RETURN ROW('DENIED')::uptech.google_workspace_bootstrap_status_result_v1;
  END IF;

  SELECT job.* INTO selected_job
  FROM uptech.sync_jobs AS job
  WHERE job.workspace_id = selected_workspace_id
    AND job.connector_id = selected_connector_id
    AND job.job_kind = 'DIRECTORY_SYNC'
    AND job.source_id IS NULL
    AND job.payload ->> 'bootstrap_attempt_id' = selected_attempt_id::text
  ORDER BY job.created_at, job.id
  LIMIT 1;

  IF selected_job.id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM uptech.people_sync_generations AS generation
    WHERE generation.workspace_id = selected_workspace_id
      AND generation.connector_id = selected_connector_id
      AND generation.job_id = selected_job.id
      AND generation.google_customer_id = selected_customer_id
      AND generation.status = 'PUBLISHED'
      AND generation.traversal_complete
      AND generation.completed_at IS NOT NULL
      AND generation.fresh_until > observed_at
  ) THEN
    PERFORM uptech.append_task6_audit_events_v1(
      selected_workspace_id,selected_capability.identity_id,
      'GOOGLE_WORKSPACE_BOOTSTRAP_STATUS_CHECKED','GOOGLE_WORKSPACE_BOOTSTRAP',
      selected_attempt_id,'SUCCEEDED',p_request_id,
      pg_catalog.jsonb_build_object('result','READY'));
    RETURN ROW('READY')::uptech.google_workspace_bootstrap_status_result_v1;
  END IF;

  IF selected_job.id IS NOT NULL AND (
    (selected_job.status = 'QUEUED'
      AND selected_job.attempt_count < selected_job.max_attempts)
    OR (selected_job.status = 'LEASED'
      AND selected_job.lease_expires_at > observed_at)
  ) THEN
    PERFORM uptech.append_task6_audit_events_v1(
      selected_workspace_id,selected_capability.identity_id,
      'GOOGLE_WORKSPACE_BOOTSTRAP_STATUS_CHECKED','GOOGLE_WORKSPACE_BOOTSTRAP',
      selected_attempt_id,'SUCCEEDED',p_request_id,
      pg_catalog.jsonb_build_object('result','DIRECTORY_BOOTSTRAP_SYNC_PENDING'));
    RETURN ROW('DIRECTORY_BOOTSTRAP_SYNC_PENDING')
      ::uptech.google_workspace_bootstrap_status_result_v1;
  END IF;

  IF selected_job.id IS NOT NULL
    AND selected_job.status = 'LEASED'
    AND selected_job.lease_expires_at <= observed_at
    AND selected_job.attempt_count < selected_job.max_attempts
  THEN
    PERFORM uptech.append_task6_audit_events_v1(
      selected_workspace_id,selected_capability.identity_id,
      'GOOGLE_WORKSPACE_BOOTSTRAP_STATUS_CHECKED','GOOGLE_WORKSPACE_BOOTSTRAP',
      selected_attempt_id,'SUCCEEDED',p_request_id,
      pg_catalog.jsonb_build_object('result','DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE'));
    RETURN ROW('DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE')
      ::uptech.google_workspace_bootstrap_status_result_v1;
  END IF;

  PERFORM uptech.append_task6_audit_events_v1(
    selected_workspace_id,selected_capability.identity_id,
    'GOOGLE_WORKSPACE_BOOTSTRAP_STATUS_CHECKED','GOOGLE_WORKSPACE_BOOTSTRAP',
    selected_attempt_id,'SUCCEEDED',p_request_id,
    pg_catalog.jsonb_build_object('result','DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED'));
  RETURN ROW('DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED')
    ::uptech.google_workspace_bootstrap_status_result_v1;
END
$function$;

CREATE FUNCTION uptech.retry_google_workspace_bootstrap_sync_v1(
  p_status_token_hash uptech.google_auth_hash32_v1,
  p_request_id uuid
)
RETURNS uptech.google_workspace_bootstrap_retry_result_v1
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  selected_capability uptech.onboarding_sessions%ROWTYPE;
  selected_attempt_id uuid;
  selected_workspace_id uuid;
  selected_connector_id uuid;
  selected_customer_id text;
  selected_job uptech.sync_jobs%ROWTYPE;
  observed_at timestamptz := pg_catalog.statement_timestamp();
BEGIN
  IF p_status_token_hash IS NULL OR p_request_id IS NULL THEN
    RETURN ROW('DENIED')::uptech.google_workspace_bootstrap_retry_result_v1;
  END IF;

  SELECT capability.* INTO selected_capability
  FROM uptech.onboarding_sessions AS capability
  WHERE capability.token_hash = p_status_token_hash;

  IF selected_capability.id IS NULL
    OR pg_catalog.cardinality(selected_capability.allowed_operations) <> 2
    OR NOT selected_capability.allowed_operations @> ARRAY[
      'DIRECTORY_BOOTSTRAP_STATUS_READ',
      'DIRECTORY_BOOTSTRAP_SYNC_RETRY'
    ]::text[]
  THEN
    RETURN ROW('DENIED')::uptech.google_workspace_bootstrap_retry_result_v1;
  END IF;

  IF selected_capability.status IN ('CONSUMED', 'EXPIRED')
    OR (selected_capability.status = 'ACTIVE'
      AND selected_capability.expires_at <= observed_at)
  THEN
    RETURN ROW('ONBOARDING_EXPIRED')::uptech.google_workspace_bootstrap_retry_result_v1;
  END IF;

  IF selected_capability.status <> 'ACTIVE' THEN
    RETURN ROW('DENIED')::uptech.google_workspace_bootstrap_retry_result_v1;
  END IF;

  SELECT receipt.attempt_id, receipt.workspace_id, receipt.connector_id,
    workspace.google_customer_id
  INTO selected_attempt_id, selected_workspace_id, selected_connector_id,
    selected_customer_id
  FROM uptech.google_workspace_bootstrap_receipts AS receipt
  JOIN uptech.google_workspace_bootstrap_attempts AS attempt
    ON attempt.id = receipt.attempt_id AND attempt.state = 'COMMITTED'
  JOIN uptech.workspaces AS workspace
    ON workspace.workspace_id = receipt.workspace_id
   AND workspace.status = 'ACTIVE'
   AND workspace.google_customer_id IS NOT NULL
  JOIN uptech.connectors AS connector
    ON connector.workspace_id = receipt.workspace_id
   AND connector.id = receipt.connector_id
   AND connector.purpose = 'DIRECTORY'
   AND connector.status IN ('ACTIVE', 'DEGRADED')
   AND connector.provider_customer_id = workspace.google_customer_id
   AND connector.directory_authorized_by_identity_id = receipt.identity_id
  WHERE receipt.identity_id = selected_capability.identity_id
    AND receipt.workspace_id = selected_capability.resource_workspace_id;

  IF selected_attempt_id IS NULL THEN
    RETURN ROW('DENIED')::uptech.google_workspace_bootstrap_retry_result_v1;
  END IF;

  PERFORM uptech.append_task6_audit_events_v1(
    selected_workspace_id,selected_capability.identity_id,
    'GOOGLE_WORKSPACE_BOOTSTRAP_SYNC_RETRY_REQUESTED','GOOGLE_WORKSPACE_BOOTSTRAP',
    selected_attempt_id,'SUCCEEDED',p_request_id,'{}'::jsonb);

  SELECT job.* INTO selected_job
  FROM uptech.sync_jobs AS job
  WHERE job.workspace_id = selected_workspace_id
    AND job.connector_id = selected_connector_id
    AND job.job_kind = 'DIRECTORY_SYNC'
    AND job.source_id IS NULL
    AND job.payload ->> 'bootstrap_attempt_id' = selected_attempt_id::text
  ORDER BY job.created_at, job.id
  LIMIT 1
  FOR UPDATE;

  IF selected_job.id IS NOT NULL AND EXISTS (
    SELECT 1 FROM uptech.people_sync_generations AS generation
    WHERE generation.workspace_id = selected_workspace_id
      AND generation.connector_id = selected_connector_id
      AND generation.job_id = selected_job.id
      AND generation.google_customer_id = selected_customer_id
      AND generation.status = 'PUBLISHED'
      AND generation.traversal_complete
      AND generation.completed_at IS NOT NULL
      AND generation.fresh_until > observed_at
  ) THEN
    PERFORM uptech.append_task6_audit_events_v1(
      selected_workspace_id,selected_capability.identity_id,
      'GOOGLE_WORKSPACE_BOOTSTRAP_SYNC_RETRY_RESULT','GOOGLE_WORKSPACE_BOOTSTRAP',
      selected_attempt_id,'SUCCEEDED',p_request_id,
      pg_catalog.jsonb_build_object('result','READY'));
    RETURN ROW('READY')::uptech.google_workspace_bootstrap_retry_result_v1;
  END IF;

  IF selected_job.id IS NOT NULL AND (
    (selected_job.status = 'QUEUED'
      AND selected_job.attempt_count < selected_job.max_attempts)
    OR (selected_job.status = 'LEASED'
      AND selected_job.lease_expires_at > observed_at)
  ) THEN
    PERFORM uptech.append_task6_audit_events_v1(
      selected_workspace_id,selected_capability.identity_id,
      'GOOGLE_WORKSPACE_BOOTSTRAP_SYNC_RETRY_RESULT','GOOGLE_WORKSPACE_BOOTSTRAP',
      selected_attempt_id,'SUCCEEDED',p_request_id,
      pg_catalog.jsonb_build_object('result','DIRECTORY_BOOTSTRAP_SYNC_PENDING'));
    RETURN ROW('DIRECTORY_BOOTSTRAP_SYNC_PENDING')
      ::uptech.google_workspace_bootstrap_retry_result_v1;
  END IF;

  IF selected_job.id IS NOT NULL
    AND selected_job.status = 'LEASED'
    AND selected_job.lease_expires_at <= observed_at
    AND selected_job.attempt_count < selected_job.max_attempts
  THEN
    UPDATE uptech.sync_jobs
    SET status = 'QUEUED', available_at = observed_at,
      leased_at = NULL, lease_expires_at = NULL, lease_owner = NULL,
      lease_fence = NULL, completed_at = NULL, last_error_code = NULL,
      updated_at = observed_at
    WHERE workspace_id = selected_workspace_id AND id = selected_job.id
      AND status = 'LEASED' AND lease_fence = selected_job.lease_fence
      AND lease_expires_at <= observed_at AND attempt_count < max_attempts;
    IF FOUND THEN
      PERFORM uptech.append_task6_audit_events_v1(
        selected_workspace_id,selected_capability.identity_id,
        'GOOGLE_WORKSPACE_BOOTSTRAP_SYNC_RETRY_RESULT','GOOGLE_WORKSPACE_BOOTSTRAP',
        selected_attempt_id,'SUCCEEDED',p_request_id,
        pg_catalog.jsonb_build_object('result','REQUEUED'));
      RETURN ROW('REQUEUED')::uptech.google_workspace_bootstrap_retry_result_v1;
    END IF;
  END IF;

  PERFORM uptech.append_task6_audit_events_v1(
    selected_workspace_id,selected_capability.identity_id,
    'GOOGLE_WORKSPACE_BOOTSTRAP_SYNC_RETRY_RESULT','GOOGLE_WORKSPACE_BOOTSTRAP',
    selected_attempt_id,'SUCCEEDED',p_request_id,
    pg_catalog.jsonb_build_object('result','DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED'));
  RETURN ROW('DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED')
    ::uptech.google_workspace_bootstrap_retry_result_v1;
END
$function$;

REVOKE ALL ON FUNCTION uptech.read_google_workspace_bootstrap_status_v1(
  uptech.google_auth_hash32_v1, uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.read_google_workspace_bootstrap_status_v1(
  uptech.google_auth_hash32_v1, uuid
) TO uptech_api_runtime;

REVOKE ALL ON FUNCTION uptech.retry_google_workspace_bootstrap_sync_v1(
  uptech.google_auth_hash32_v1, uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.retry_google_workspace_bootstrap_sync_v1(
  uptech.google_auth_hash32_v1, uuid
) TO uptech_api_runtime;

CREATE FUNCTION uptech.finish_google_workspace_bootstrap_v1(
  p_status_token_hash uptech.google_auth_hash32_v1,
  p_request_id uuid
)
RETURNS uptech.google_workspace_bootstrap_finish_result_v1
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  selected_capability uptech.onboarding_sessions%ROWTYPE;
  selected_attempt_id uuid;
  selected_workspace_id uuid;
  selected_connector_id uuid;
  selected_customer_id text;
  observed_at timestamptz := pg_catalog.statement_timestamp();
BEGIN
  IF p_status_token_hash IS NULL OR p_request_id IS NULL THEN
    RETURN ROW('DENIED')::uptech.google_workspace_bootstrap_finish_result_v1;
  END IF;

  SELECT capability.* INTO selected_capability
  FROM uptech.onboarding_sessions AS capability
  WHERE capability.token_hash = p_status_token_hash
  FOR UPDATE;

  IF selected_capability.id IS NULL
    OR selected_capability.status <> 'ACTIVE'
    OR selected_capability.expires_at <= observed_at
    OR selected_capability.resource_workspace_id IS NULL
    OR pg_catalog.cardinality(selected_capability.allowed_operations) <> 2
    OR NOT selected_capability.allowed_operations @> ARRAY[
      'DIRECTORY_BOOTSTRAP_STATUS_READ',
      'DIRECTORY_BOOTSTRAP_SYNC_RETRY'
    ]::text[]
  THEN
    RETURN ROW('DENIED')::uptech.google_workspace_bootstrap_finish_result_v1;
  END IF;

  SELECT receipt.attempt_id, receipt.workspace_id, receipt.connector_id,
    workspace.google_customer_id
  INTO selected_attempt_id, selected_workspace_id, selected_connector_id,
    selected_customer_id
  FROM uptech.google_workspace_bootstrap_receipts AS receipt
  JOIN uptech.google_workspace_bootstrap_attempts AS attempt
    ON attempt.id = receipt.attempt_id AND attempt.state = 'COMMITTED'
  JOIN uptech.workspaces AS workspace
    ON workspace.workspace_id = receipt.workspace_id
   AND workspace.status = 'ACTIVE'
   AND workspace.google_customer_id IS NOT NULL
  JOIN uptech.connectors AS connector
    ON connector.workspace_id = receipt.workspace_id
   AND connector.id = receipt.connector_id
   AND connector.purpose = 'DIRECTORY'
   AND connector.status IN ('ACTIVE', 'DEGRADED')
   AND connector.provider_customer_id = workspace.google_customer_id
   AND connector.directory_authorized_by_identity_id = receipt.identity_id
  JOIN uptech.identities AS identity_row
    ON identity_row.id = receipt.identity_id
   AND identity_row.status = 'ACTIVE'
  JOIN uptech.users AS user_row
    ON user_row.id = identity_row.user_id AND user_row.status = 'ACTIVE'
  WHERE receipt.identity_id = selected_capability.identity_id
    AND receipt.workspace_id = selected_capability.resource_workspace_id;

  IF selected_attempt_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM uptech.sync_jobs AS job
    JOIN uptech.people_sync_generations AS generation
      ON generation.workspace_id = job.workspace_id
     AND generation.connector_id = job.connector_id
     AND generation.job_id = job.id
    WHERE job.workspace_id = selected_workspace_id
      AND job.connector_id = selected_connector_id
      AND job.job_kind = 'DIRECTORY_SYNC'
      AND job.source_id IS NULL
      AND job.payload ->> 'bootstrap_attempt_id' = selected_attempt_id::text
      AND generation.google_customer_id = selected_customer_id
      AND generation.status = 'PUBLISHED'
      AND generation.traversal_complete
      AND generation.completed_at IS NOT NULL
      AND generation.fresh_until > observed_at
  ) THEN
    RETURN ROW('DENIED')::uptech.google_workspace_bootstrap_finish_result_v1;
  END IF;

  UPDATE uptech.onboarding_sessions
  SET status = 'CONSUMED', consumed_at = observed_at
  WHERE id = selected_capability.id AND status = 'ACTIVE'
    AND expires_at > observed_at;
  IF NOT FOUND THEN
    RETURN ROW('DENIED')::uptech.google_workspace_bootstrap_finish_result_v1;
  END IF;

  PERFORM uptech.append_task6_audit_events_v1(
    selected_workspace_id,selected_capability.identity_id,
    'GOOGLE_WORKSPACE_BOOTSTRAP_FINISHED','GOOGLE_WORKSPACE_BOOTSTRAP',
    selected_attempt_id,'SUCCEEDED',p_request_id,
    pg_catalog.jsonb_build_object('result','FINISHED'));
  RETURN ROW('FINISHED')::uptech.google_workspace_bootstrap_finish_result_v1;
END
$function$;

CREATE FUNCTION uptech.reissue_google_workspace_bootstrap_status_v1(
  p_reserved_completion_hash uptech.google_auth_hash32_v1,
  p_claims uptech.google_verified_claims_assertion_v1,
  p_new_status_token_hash uptech.google_auth_hash32_v1,
  p_request_id uuid
)
RETURNS uptech.google_workspace_bootstrap_reissue_result_v1
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  observed_at timestamptz;
  selected_transaction uptech.oauth_transactions%ROWTYPE;
  bound_configuration uptech.google_auth_configuration_registry%ROWTYPE;
  selected_attempt_id uuid;
  selected_identity_id uuid;
  selected_workspace_id uuid;
  selected_connector_id uuid;
  selected_customer_id text;
  canonical_issuer text;
  claims_are_valid boolean;
  new_status_id uuid := pg_catalog.gen_random_uuid();
  new_status_expires_at timestamptz;
  transitioned_rows integer;
BEGIN
  IF p_reserved_completion_hash IS NOT NULL THEN
    SELECT transaction_row.* INTO selected_transaction
    FROM uptech.oauth_transactions AS transaction_row
    WHERE transaction_row.completion_handle_hash = p_reserved_completion_hash
      AND transaction_row.purpose = 'WEB_LOGIN'
      AND transaction_row.status = 'EXCHANGE_RESERVED'
    FOR UPDATE;
  END IF;

  observed_at := pg_catalog.clock_timestamp();
  IF selected_transaction.id IS NULL OR p_request_id IS NULL
    OR selected_transaction.completion_expires_at <= observed_at
  THEN
    IF selected_transaction.id IS NOT NULL THEN
      UPDATE uptech.oauth_transactions
      SET status = 'REJECTED', rejected_at = observed_at
      WHERE id = selected_transaction.id AND status = 'EXCHANGE_RESERVED';
    END IF;
    RETURN ROW('DENIED', NULL)::uptech.google_workspace_bootstrap_reissue_result_v1;
  END IF;

  SELECT configuration_row.* INTO bound_configuration
  FROM uptech.google_auth_configuration_registry AS configuration_row
  WHERE configuration_row.environment_name = selected_transaction.environment_name
    AND configuration_row.configuration_key = selected_transaction.configuration_key
    AND configuration_row.purpose = 'WEB_LOGIN'
    AND configuration_row.is_enabled;

  canonical_issuer := CASE
    WHEN (p_claims).issuer::text IN (
      'https://accounts.google.com', 'accounts.google.com'
    ) THEN 'https://accounts.google.com'
    ELSE NULL
  END;
  claims_are_valid :=
    bound_configuration.configuration_key IS NOT NULL
    AND canonical_issuer IS NOT NULL
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

  IF claims_are_valid IS NOT TRUE OR p_new_status_token_hash IS NULL
    OR p_new_status_token_hash = p_reserved_completion_hash
  THEN
    UPDATE uptech.oauth_transactions
    SET status = 'REJECTED', rejected_at = observed_at
    WHERE id = selected_transaction.id AND status = 'EXCHANGE_RESERVED';
    RETURN ROW('DENIED', NULL)::uptech.google_workspace_bootstrap_reissue_result_v1;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      canonical_issuer || pg_catalog.chr(31) || (p_claims).provider_subject::text,
      0
    )
  );

  SELECT receipt.attempt_id, receipt.identity_id, receipt.workspace_id,
    receipt.connector_id, workspace.google_customer_id
  INTO selected_attempt_id, selected_identity_id, selected_workspace_id,
    selected_connector_id, selected_customer_id
  FROM uptech.google_workspace_bootstrap_receipts AS receipt
  JOIN uptech.google_workspace_bootstrap_attempts AS attempt
    ON attempt.id = receipt.attempt_id AND attempt.state = 'COMMITTED'
  JOIN uptech.workspaces AS workspace
    ON workspace.workspace_id = receipt.workspace_id
   AND workspace.status = 'ACTIVE'
   AND workspace.google_customer_id IS NOT NULL
  JOIN uptech.connectors AS connector
    ON connector.workspace_id = receipt.workspace_id
   AND connector.id = receipt.connector_id
   AND connector.purpose = 'DIRECTORY'
   AND connector.status IN ('ACTIVE', 'DEGRADED')
   AND connector.provider_customer_id = workspace.google_customer_id
   AND connector.directory_authorized_by_identity_id = receipt.identity_id
  JOIN uptech.identities AS identity_row
    ON identity_row.id = receipt.identity_id
   AND identity_row.provider = 'GOOGLE'
   AND identity_row.issuer = canonical_issuer
   AND identity_row.provider_subject = (p_claims).provider_subject::text
   AND identity_row.status = 'ACTIVE'
  JOIN uptech.users AS user_row
    ON user_row.id = identity_row.user_id AND user_row.status = 'ACTIVE'
  JOIN uptech.workspace_domain_locators AS locator
    ON locator.normalized_domain = (p_claims).normalized_hosted_domain
   AND locator.workspace_id = receipt.workspace_id
   AND locator.status = 'VERIFIED'
   AND locator.google_customer_id = workspace.google_customer_id
  FOR UPDATE OF receipt, workspace, connector, identity_row, user_row;

  IF selected_attempt_id IS NULL OR EXISTS (
    SELECT 1
    FROM uptech.sync_jobs AS job
    JOIN uptech.people_sync_generations AS generation
      ON generation.workspace_id = job.workspace_id
     AND generation.connector_id = job.connector_id
     AND generation.job_id = job.id
    WHERE job.workspace_id = selected_workspace_id
      AND job.connector_id = selected_connector_id
      AND job.job_kind = 'DIRECTORY_SYNC'
      AND job.source_id IS NULL
      AND job.payload ->> 'bootstrap_attempt_id' = selected_attempt_id::text
      AND generation.google_customer_id = selected_customer_id
      AND generation.status = 'PUBLISHED'
      AND generation.traversal_complete
      AND generation.completed_at IS NOT NULL
      AND generation.fresh_until > observed_at
  ) THEN
    UPDATE uptech.oauth_transactions
    SET status = 'REJECTED', rejected_at = observed_at
    WHERE id = selected_transaction.id AND status = 'EXCHANGE_RESERVED';
    RETURN ROW('DENIED', NULL)::uptech.google_workspace_bootstrap_reissue_result_v1;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'UPTECH_CREDENTIAL_V1' || pg_catalog.encode(p_new_status_token_hash, 'hex'),
      0
    )
  );
  IF EXISTS (
      SELECT 1 FROM uptech.onboarding_sessions
      WHERE token_hash = p_new_status_token_hash
    ) OR EXISTS (
      SELECT 1 FROM uptech.session_tokens
      WHERE token_hash = p_new_status_token_hash
    )
  THEN
    UPDATE uptech.oauth_transactions
    SET status = 'REJECTED', rejected_at = observed_at
    WHERE id = selected_transaction.id AND status = 'EXCHANGE_RESERVED';
    RETURN ROW('DENIED', NULL)::uptech.google_workspace_bootstrap_reissue_result_v1;
  END IF;

  UPDATE uptech.onboarding_sessions
  SET status = 'REVOKED', revoked_at = observed_at
  WHERE identity_id = selected_identity_id
    AND resource_workspace_id = selected_workspace_id
    AND status = 'ACTIVE'
    AND pg_catalog.cardinality(allowed_operations) = 2
    AND allowed_operations @> ARRAY[
      'DIRECTORY_BOOTSTRAP_STATUS_READ',
      'DIRECTORY_BOOTSTRAP_SYNC_RETRY'
    ]::text[];

  new_status_expires_at := observed_at + interval '24 hours';
  INSERT INTO uptech.onboarding_sessions (
    id, identity_id, token_hash, allowed_operations, status,
    created_at, expires_at, resource_workspace_id
  ) VALUES (
    new_status_id, selected_identity_id, p_new_status_token_hash,
    ARRAY[
      'DIRECTORY_BOOTSTRAP_STATUS_READ',
      'DIRECTORY_BOOTSTRAP_SYNC_RETRY'
    ]::text[],
    'ACTIVE', observed_at, new_status_expires_at, selected_workspace_id
  );

  observed_at := pg_catalog.clock_timestamp();
  UPDATE uptech.oauth_transactions
  SET status = 'COMPLETED', completed_at = observed_at
  WHERE id = selected_transaction.id
    AND status = 'EXCHANGE_RESERVED'
    AND completion_expires_at > observed_at
    AND (p_claims).issued_at >= observed_at - interval '5 minutes'
    AND (p_claims).issued_at <= observed_at + interval '2 minutes'
    AND (p_claims).expires_at > observed_at;
  GET DIAGNOSTICS transitioned_rows = ROW_COUNT;
  IF transitioned_rows <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PGA01', MESSAGE = 'google login reservation expired';
  END IF;

  PERFORM uptech.append_task6_audit_events_v1(
    selected_workspace_id,selected_identity_id,
    'GOOGLE_WORKSPACE_BOOTSTRAP_STATUS_REISSUED','GOOGLE_WORKSPACE_BOOTSTRAP',
    selected_attempt_id,'SUCCEEDED',p_request_id,
    pg_catalog.jsonb_build_object('result','REISSUED'));
  RETURN ROW('REISSUED', new_status_expires_at)
    ::uptech.google_workspace_bootstrap_reissue_result_v1;
EXCEPTION
  WHEN SQLSTATE 'PGA01' OR unique_violation THEN
    RETURN ROW('DENIED', NULL)::uptech.google_workspace_bootstrap_reissue_result_v1;
END
$function$;

CREATE FUNCTION uptech.revoke_onboarding_capability_v1(
  p_capability_hash uptech.google_auth_hash32_v1,
  p_request_id uuid
)
RETURNS uptech.onboarding_capability_revoke_result_v1
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  selected_capability uptech.onboarding_sessions%ROWTYPE;
  observed_at timestamptz := pg_catalog.statement_timestamp();
BEGIN
  IF p_capability_hash IS NULL OR p_request_id IS NULL THEN
    RETURN ROW('DENIED')::uptech.onboarding_capability_revoke_result_v1;
  END IF;

  SELECT capability.* INTO selected_capability
  FROM uptech.onboarding_sessions AS capability
  WHERE capability.token_hash = p_capability_hash
  FOR UPDATE;
  IF selected_capability.id IS NULL THEN
    RETURN ROW('DENIED')::uptech.onboarding_capability_revoke_result_v1;
  END IF;

  IF selected_capability.status <> 'REVOKED' THEN
    UPDATE uptech.onboarding_sessions
    SET status = 'REVOKED', revoked_at = observed_at
    WHERE id = selected_capability.id;
  END IF;
  PERFORM uptech.append_task6_audit_events_v1(
    selected_capability.resource_workspace_id,selected_capability.identity_id,
    'ONBOARDING_CAPABILITY_REVOKED','ONBOARDING_CAPABILITY',NULL,
    'SUCCEEDED',p_request_id,pg_catalog.jsonb_build_object('result','REVOKED'));
  RETURN ROW('REVOKED')::uptech.onboarding_capability_revoke_result_v1;
END
$function$;

REVOKE ALL ON FUNCTION uptech.finish_google_workspace_bootstrap_v1(
  uptech.google_auth_hash32_v1, uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.finish_google_workspace_bootstrap_v1(
  uptech.google_auth_hash32_v1, uuid
) TO uptech_api_runtime;

REVOKE ALL ON FUNCTION uptech.reissue_google_workspace_bootstrap_status_v1(
  uptech.google_auth_hash32_v1, uptech.google_verified_claims_assertion_v1,
  uptech.google_auth_hash32_v1, uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.reissue_google_workspace_bootstrap_status_v1(
  uptech.google_auth_hash32_v1, uptech.google_verified_claims_assertion_v1,
  uptech.google_auth_hash32_v1, uuid
) TO uptech_api_runtime;

REVOKE ALL ON FUNCTION uptech.revoke_onboarding_capability_v1(
  uptech.google_auth_hash32_v1, uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.revoke_onboarding_capability_v1(
  uptech.google_auth_hash32_v1, uuid
) TO uptech_api_runtime;

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

CREATE FUNCTION uptech.submit_workspace_access_request_v1(
  p_capability_hash uptech.google_auth_hash32_v1,
  p_request_id uuid
)
RETURNS uptech.workspace_access_request_submit_result_v1
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  observed_at timestamptz := pg_catalog.clock_timestamp();
  selected_capability uptech.onboarding_sessions%ROWTYPE;
  selected_request uptech.workspace_access_requests%ROWTYPE;
  request_was_inserted boolean := false;
BEGIN
  IF p_capability_hash IS NULL OR p_request_id IS NULL THEN
    RETURN ROW('DENIED',NULL,NULL)::uptech.workspace_access_request_submit_result_v1;
  END IF;

  SELECT capability.* INTO selected_capability
  FROM uptech.onboarding_sessions AS capability
  JOIN uptech.identities AS identity_row ON identity_row.id = capability.identity_id
  JOIN uptech.users AS user_row ON user_row.id = identity_row.user_id
  WHERE capability.token_hash = p_capability_hash
    AND capability.status = 'ACTIVE'
    AND capability.expires_at > observed_at
    AND capability.resource_workspace_id IS NOT NULL
    AND pg_catalog.cardinality(capability.allowed_operations) = 2
    AND capability.allowed_operations @> ARRAY['ACCESS_REQUEST_READ','ACCESS_REQUEST_SUBMIT']::text[]
    AND capability.allowed_operations <@ ARRAY['ACCESS_REQUEST_READ','ACCESS_REQUEST_SUBMIT']::text[]
    AND capability.access_request_reason_class IN (
      'ORGANIZATION_ALREADY_REGISTERED','USER_NOT_PROVISIONED',
      'ACCESS_MAPPING_CONFLICT','DIRECTORY_STALE'
    )
    AND identity_row.status = 'ACTIVE'
    AND user_row.status = 'ACTIVE'
  FOR UPDATE OF capability;

  IF NOT FOUND THEN
    RETURN ROW('DENIED',NULL,NULL)::uptech.workspace_access_request_submit_result_v1;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'workspace-access-request:' || selected_capability.resource_workspace_id::text || ':' ||
    selected_capability.identity_id::text || ':' ||
    selected_capability.access_request_reason_class, 0));

  INSERT INTO uptech.workspace_access_requests(
    workspace_id,id,identity_id,reason_class,status
  ) VALUES (
    selected_capability.resource_workspace_id,pg_catalog.gen_random_uuid(),
    selected_capability.identity_id,selected_capability.access_request_reason_class,'PENDING'
  ) ON CONFLICT (workspace_id,identity_id,reason_class) WHERE status = 'PENDING'
    DO NOTHING
  RETURNING * INTO selected_request;
  request_was_inserted := FOUND;

  IF NOT FOUND THEN
    SELECT request_row.* INTO STRICT selected_request
    FROM uptech.workspace_access_requests AS request_row
    WHERE request_row.workspace_id = selected_capability.resource_workspace_id
      AND request_row.identity_id = selected_capability.identity_id
      AND request_row.reason_class = selected_capability.access_request_reason_class
      AND request_row.status = 'PENDING';
  END IF;

  PERFORM uptech.append_task6_audit_events_v1(
    selected_capability.resource_workspace_id,selected_capability.identity_id,
    CASE WHEN request_was_inserted
      THEN 'WORKSPACE_ACCESS_REQUEST_SUBMITTED'
      ELSE 'WORKSPACE_ACCESS_REQUEST_DEDUPLICATED'
    END,
    'WORKSPACE_ACCESS_REQUEST',selected_request.id,'SUCCEEDED',p_request_id,
    pg_catalog.jsonb_build_object(
      'result','PENDING',
      'reason_class',selected_capability.access_request_reason_class
    ));
  RETURN ROW('PENDING',selected_request.id,selected_request.status)
    ::uptech.workspace_access_request_submit_result_v1;
END
$function$;

CREATE FUNCTION uptech.read_workspace_access_request_v1(
  p_capability_hash uptech.google_auth_hash32_v1,
  p_request_id uuid
)
RETURNS uptech.workspace_access_request_read_result_v1
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  observed_at timestamptz := pg_catalog.clock_timestamp();
  selected_capability uptech.onboarding_sessions%ROWTYPE;
  selected_request uptech.workspace_access_requests%ROWTYPE;
BEGIN
  IF p_capability_hash IS NULL OR p_request_id IS NULL THEN
    RETURN ROW('DENIED',NULL,NULL)::uptech.workspace_access_request_read_result_v1;
  END IF;

  SELECT capability.* INTO selected_capability
  FROM uptech.onboarding_sessions AS capability
  JOIN uptech.identities AS identity_row ON identity_row.id = capability.identity_id
  JOIN uptech.users AS user_row ON user_row.id = identity_row.user_id
  WHERE capability.token_hash = p_capability_hash
    AND capability.status = 'ACTIVE'
    AND capability.expires_at > observed_at
    AND capability.resource_workspace_id IS NOT NULL
    AND pg_catalog.cardinality(capability.allowed_operations) = 2
    AND capability.allowed_operations @> ARRAY['ACCESS_REQUEST_READ','ACCESS_REQUEST_SUBMIT']::text[]
    AND capability.allowed_operations <@ ARRAY['ACCESS_REQUEST_READ','ACCESS_REQUEST_SUBMIT']::text[]
    AND capability.access_request_reason_class IN (
      'ORGANIZATION_ALREADY_REGISTERED','USER_NOT_PROVISIONED',
      'ACCESS_MAPPING_CONFLICT','DIRECTORY_STALE'
    )
    AND identity_row.status = 'ACTIVE'
    AND user_row.status = 'ACTIVE';

  IF NOT FOUND THEN
    RETURN ROW('DENIED',NULL,NULL)::uptech.workspace_access_request_read_result_v1;
  END IF;

  SELECT request_row.* INTO selected_request
  FROM uptech.workspace_access_requests AS request_row
  WHERE request_row.workspace_id = selected_capability.resource_workspace_id
    AND request_row.identity_id = selected_capability.identity_id
    AND request_row.reason_class = selected_capability.access_request_reason_class
  ORDER BY (request_row.status = 'PENDING') DESC, request_row.created_at DESC, request_row.id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    PERFORM uptech.append_task6_audit_events_v1(
      selected_capability.resource_workspace_id,selected_capability.identity_id,
      'WORKSPACE_ACCESS_REQUEST_READ','WORKSPACE_ACCESS_REQUEST',NULL,
      'DENIED',p_request_id,pg_catalog.jsonb_build_object(
        'result','DENIED',
        'reason_class',selected_capability.access_request_reason_class
      ));
    RETURN ROW('DENIED',NULL,NULL)::uptech.workspace_access_request_read_result_v1;
  END IF;

  PERFORM uptech.append_task6_audit_events_v1(
    selected_capability.resource_workspace_id,selected_capability.identity_id,
    'WORKSPACE_ACCESS_REQUEST_READ','WORKSPACE_ACCESS_REQUEST',selected_request.id,
    'SUCCEEDED',p_request_id,pg_catalog.jsonb_build_object(
      'result',selected_request.status::text,
      'reason_class',selected_capability.access_request_reason_class
    ));
  RETURN ROW('FOUND',selected_request.id,selected_request.status)
    ::uptech.workspace_access_request_read_result_v1;
END
$function$;

REVOKE ALL ON FUNCTION uptech.submit_workspace_access_request_v1(
  uptech.google_auth_hash32_v1, uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.submit_workspace_access_request_v1(
  uptech.google_auth_hash32_v1, uuid
) TO uptech_api_runtime;

REVOKE ALL ON FUNCTION uptech.read_workspace_access_request_v1(
  uptech.google_auth_hash32_v1, uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.read_workspace_access_request_v1(
  uptech.google_auth_hash32_v1, uuid
) TO uptech_api_runtime;

CREATE TYPE uptech.google_workspace_bootstrap_start_admission_outcome_v1 AS ENUM (
  'ADMITTED', 'RATE_LIMITED', 'DENIED'
);

CREATE TYPE uptech.google_workspace_bootstrap_start_admission_result_v1 AS (
  outcome uptech.google_workspace_bootstrap_start_admission_outcome_v1
);

CREATE FUNCTION uptech.admit_google_workspace_bootstrap_start_v1(
  p_network_hmac uptech.google_auth_hash32_v1,
  p_request_id uuid
)
RETURNS uptech.google_workspace_bootstrap_start_admission_result_v1
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  observed_at timestamptz := pg_catalog.clock_timestamp();
  window_start timestamptz;
  active_environment uptech.google_auth_ascii_identifier_v1;
  audit_hmac_key uptech.google_auth_hash32_v1;
  audit_bucket_key uptech.google_auth_hash32_v1;
  is_rate_limited boolean;
BEGIN
  IF p_network_hmac IS NULL OR p_request_id IS NULL THEN
    RETURN ROW('DENIED')::uptech.google_workspace_bootstrap_start_admission_result_v1;
  END IF;

  SELECT environment_name, rate_limit_audit_hmac_key
  INTO STRICT active_environment, audit_hmac_key
  FROM uptech.google_auth_environment_registry
  WHERE is_active;

  window_start := pg_catalog.to_timestamp(
    pg_catalog.floor(pg_catalog.date_part('epoch', observed_at) / 60) * 60
  );

  INSERT INTO uptech.google_auth_rate_limit_buckets (
    environment_name, bucket_scope, network_hmac, window_started_at,
    request_count, over_limit_observed, expires_at, updated_at
  ) VALUES (
    active_environment, 'GOOGLE_AUTH', p_network_hmac, window_start,
    1, false, window_start + interval '1 minute', observed_at
  )
  ON CONFLICT (environment_name, bucket_scope, network_hmac, window_started_at)
  DO UPDATE SET
    request_count = CASE
      WHEN uptech.google_auth_rate_limit_buckets.request_count < 10
        THEN uptech.google_auth_rate_limit_buckets.request_count + 1
      ELSE uptech.google_auth_rate_limit_buckets.request_count
    END,
    over_limit_observed =
      uptech.google_auth_rate_limit_buckets.over_limit_observed
      OR uptech.google_auth_rate_limit_buckets.request_count >= 10,
    updated_at = observed_at
  RETURNING over_limit_observed INTO is_rate_limited;

  IF is_rate_limited THEN
    audit_bucket_key := uptech.google_auth_hmac_sha256_v1(
      audit_hmac_key,
      pg_catalog.convert_to('UPTECH_GOOGLE_AUTH_RATE_LIMIT_AUDIT_V1', 'UTF8')
      || pg_catalog.int8send(pg_catalog.date_part('epoch', window_start)::bigint)
      || p_network_hmac
    );
    INSERT INTO uptech.platform_audit_events (
      id, action, target_type, outcome, request_id, metadata, occurred_at,
      google_auth_rate_limit_audit_key
    ) VALUES (
      pg_catalog.gen_random_uuid(), 'GOOGLE_AUTH_RATE_LIMITED', 'GOOGLE_AUTH',
      'DENIED', p_request_id,
      pg_catalog.jsonb_build_object('bucket_scope', 'GOOGLE_AUTH'), observed_at,
      audit_bucket_key
    )
    ON CONFLICT (google_auth_rate_limit_audit_key)
      WHERE google_auth_rate_limit_audit_key IS NOT NULL
    DO NOTHING;
    RETURN ROW('RATE_LIMITED')::uptech.google_workspace_bootstrap_start_admission_result_v1;
  END IF;

  RETURN ROW('ADMITTED')::uptech.google_workspace_bootstrap_start_admission_result_v1;
END
$function$;

REVOKE ALL ON FUNCTION uptech.admit_google_workspace_bootstrap_start_v1(
  uptech.google_auth_hash32_v1, uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.admit_google_workspace_bootstrap_start_v1(
  uptech.google_auth_hash32_v1, uuid
) TO uptech_api_runtime;

-- Shared private Web completion prelude. It owns the EXCHANGE_RESERVED row
-- lock and canonical OIDC validation, but never creates product authority.
CREATE FUNCTION uptech.validate_web_google_login_completion_v1(
  p_completion_handle_hash uptech.google_auth_hash32_v1,
  p_claims uptech.google_verified_claims_assertion_v1,
  p_request_id uuid
)
RETURNS uptech.google_web_completion_validation_result_v1
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  observed_at timestamptz := pg_catalog.clock_timestamp();
  selected_transaction uptech.oauth_transactions%ROWTYPE;
  bound_configuration uptech.google_auth_configuration_registry%ROWTYPE;
  canonical_claims uptech.google_verified_claims_assertion_v1;
  claims_are_valid boolean;
BEGIN
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
    SELECT transaction_row.* INTO selected_transaction
    FROM uptech.oauth_transactions AS transaction_row
    WHERE transaction_row.completion_handle_hash = p_completion_handle_hash
      AND transaction_row.purpose = 'WEB_LOGIN'
      AND transaction_row.status = 'EXCHANGE_RESERVED'
    FOR UPDATE;
  END IF;

  -- All expiry/freshness decisions use time sampled after any row-lock wait.
  observed_at := pg_catalog.clock_timestamp();
  IF selected_transaction.id IS NULL
     OR selected_transaction.completion_expires_at IS NULL
     OR selected_transaction.completion_expires_at <= observed_at THEN
    RETURN ROW('DENIED',NULL,NULL)
      ::uptech.google_web_completion_validation_result_v1;
  END IF;

  SELECT configuration_row.* INTO bound_configuration
  FROM uptech.google_auth_configuration_registry AS configuration_row
  WHERE configuration_row.environment_name = selected_transaction.environment_name
    AND configuration_row.configuration_key = selected_transaction.configuration_key
    AND configuration_row.purpose = 'WEB_LOGIN'
    AND configuration_row.is_enabled;

  claims_are_valid :=
    bound_configuration.configuration_key IS NOT NULL
    AND (p_claims).issuer::text IN ('https://accounts.google.com','accounts.google.com')
    AND p_request_id = selected_transaction.request_id
    AND (canonical_claims).provider_subject IS NOT NULL
    AND pg_catalog.length((canonical_claims).provider_subject::text) BETWEEN 1 AND 512
    AND (canonical_claims).normalized_email IS NOT NULL
    AND (canonical_claims).email_verified IS TRUE
    AND (canonical_claims).normalized_hosted_domain IS NOT NULL
    AND (canonical_claims).issued_at IS NOT NULL
    AND (canonical_claims).expires_at IS NOT NULL
    AND (canonical_claims).issued_at >= observed_at - interval '5 minutes'
    AND (canonical_claims).issued_at <= observed_at + interval '2 minutes'
    AND (canonical_claims).expires_at > observed_at
    AND (canonical_claims).expires_at > (canonical_claims).issued_at
    AND (canonical_claims).expires_at <= (canonical_claims).issued_at + interval '2 hours'
    AND (canonical_claims).audience_configuration_key =
      bound_configuration.audience_configuration_key
    AND ((canonical_claims).authorized_party_configuration_key IS NULL
      OR (canonical_claims).authorized_party_configuration_key = ANY (
        bound_configuration.allowed_azp_configuration_keys))
    AND (canonical_claims).web_nonce_hash IS NOT NULL
    AND (canonical_claims).web_nonce_hash = selected_transaction.web_nonce_hash;

  IF claims_are_valid IS NOT TRUE THEN
    PERFORM uptech.record_google_login_rejection_v1(
      p_completion_handle_hash,
      'CLAIMS_INVALID'::uptech.google_auth_rejection_class_v1,
      selected_transaction.request_id
    );
    RETURN ROW('DENIED',NULL,NULL)
      ::uptech.google_web_completion_validation_result_v1;
  END IF;

  RETURN ROW('VALID',selected_transaction.id,canonical_claims)
    ::uptech.google_web_completion_validation_result_v1;
END
$function$;

REVOKE ALL ON TYPE uptech.google_web_completion_validation_outcome_v1,
  uptech.google_web_completion_validation_result_v1
FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.validate_web_google_login_completion_v1(
  uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;

-- Task 7B1 intentionally handles only an unknown verified hosted domain. All
-- known-tenant paths fail closed here until the Directory/JIT slice lands.
CREATE FUNCTION uptech.complete_web_google_login_directory_v2(
  p_completion_handle_hash uptech.google_auth_hash32_v1,
  p_claims uptech.google_verified_claims_assertion_v1,
  p_session_token_hash uptech.google_auth_hash32_v1,
  p_csrf_token_hash uptech.google_auth_hash32_v1,
  p_onboarding_token_hash uptech.google_auth_hash32_v1,
  p_request_id uuid
)
RETURNS uptech.google_login_completion_result_v3
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  validation uptech.google_web_completion_validation_result_v1;
  canonical_claims uptech.google_verified_claims_assertion_v1;
  observed_at timestamptz;
  selected_identity_id uuid;
  selected_user_id uuid;
  selected_user_status text;
  selected_identity_status text;
  selected_user_security_version bigint;
  selected_identity_security_version bigint;
  selected_workspace_id uuid;
  selected_workspace_status text;
  selected_workspace_policy text;
  selected_workspace_security_version bigint;
  selected_generation_id uuid;
  selected_generation_fresh_until timestamptz;
  selected_membership_id uuid;
  selected_membership_role text;
  selected_membership_status text;
  selected_membership_authz_version bigint;
  previous_membership_role text;
  membership_authority_changed boolean := false;
  selected_session_id uuid;
  mapping_outcome text;
  mapping_target_role text;
  mapping_target_department text;
  legacy_result uptech.google_login_completion_result_v1;
  insert_member boolean := false;
  reactivate_member boolean := false;
  credential_expiry timestamptz;
  denial_access_state uptech.google_login_access_state_v2;
  capability_reason text;
  capability_public_state uptech.google_login_access_state_v2;
  capability_committed boolean := false;
  transitioned_rows integer;
BEGIN
  validation := uptech.validate_web_google_login_completion_v1(
    p_completion_handle_hash,p_claims,p_request_id
  );
  IF (validation).outcome <> 'VALID' THEN
    RETURN ROW('DENIED',NULL,NULL,NULL,NULL)::uptech.google_login_completion_result_v3;
  END IF;
  canonical_claims := (validation).canonical_claims;

  SELECT locator.workspace_id INTO selected_workspace_id
  FROM uptech.workspace_domain_locators AS locator
  JOIN uptech.workspaces AS located_workspace
    ON located_workspace.workspace_id=locator.workspace_id
   AND located_workspace.google_customer_id=locator.google_customer_id
  WHERE locator.normalized_domain=(canonical_claims).normalized_hosted_domain
    AND locator.status='VERIFIED' AND locator.google_customer_id IS NOT NULL
  FOR UPDATE OF locator;

  IF selected_workspace_id IS NULL AND EXISTS (
    SELECT 1 FROM uptech.workspace_domain_locators AS mismatched_locator
    WHERE mismatched_locator.normalized_domain=(canonical_claims).normalized_hosted_domain
      AND mismatched_locator.status='VERIFIED'
  ) THEN
    PERFORM uptech.record_google_login_rejection_v1(
      p_completion_handle_hash,'CLAIMS_INVALID'::uptech.google_auth_rejection_class_v1,p_request_id);
    RETURN ROW('DENIED',NULL,NULL,NULL,NULL)::uptech.google_login_completion_result_v3;
  END IF;

  IF selected_workspace_id IS NOT NULL THEN
    SELECT status,provisioning_policy,security_version
    INTO selected_workspace_status,selected_workspace_policy,selected_workspace_security_version
    FROM uptech.workspaces WHERE workspace_id=selected_workspace_id FOR UPDATE;

    -- INVITE_ONLY and DOMAIN_AUTO_PROVISION retain the established completion
    -- implementation. This branch is intentionally not used for controlled JIT.
    IF selected_workspace_policy <> 'GOOGLE_GROUP_CONTROLLED' THEN
      legacy_result:=uptech.complete_web_google_login_a1_internal_v1(
        p_completion_handle_hash,canonical_claims,p_session_token_hash,
        p_csrf_token_hash,p_onboarding_token_hash,p_request_id
      );
      IF (legacy_result).outcome='NORMAL' THEN
        SELECT membership.role INTO selected_membership_role
        FROM uptech.identities identity_row
        JOIN uptech.workspace_memberships membership ON membership.user_id=identity_row.user_id
          AND membership.workspace_id=selected_workspace_id AND membership.status='ACTIVE'
        WHERE identity_row.provider='GOOGLE' AND identity_row.issuer=(canonical_claims).issuer::text
          AND identity_row.provider_subject=(canonical_claims).provider_subject::text;
        RETURN ROW('NORMAL',NULL,NULL,NULL,
          CASE WHEN selected_membership_role IN ('OWNER','ADMIN') THEN '/admin' ELSE '/home' END)
          ::uptech.google_login_completion_result_v3;
      ELSIF (legacy_result).outcome='ONBOARDING' THEN
        RETURN ROW('ONBOARDING','USER_NOT_PROVISIONED',(legacy_result).allowed_operations,
          (legacy_result).expires_at,NULL)::uptech.google_login_completion_result_v3;
      END IF;
      RETURN ROW('DENIED',NULL,NULL,NULL,NULL)::uptech.google_login_completion_result_v3;
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      (canonical_claims).issuer::text || pg_catalog.chr(31)
        || (canonical_claims).provider_subject::text,0));
    SELECT i.id,i.user_id,u.status,i.status,u.security_version,i.security_version
    INTO selected_identity_id,selected_user_id,selected_user_status,selected_identity_status,
      selected_user_security_version,selected_identity_security_version
    FROM uptech.identities i JOIN uptech.users u ON u.id=i.user_id
    WHERE i.provider='GOOGLE' AND i.issuer=(canonical_claims).issuer::text
      AND i.provider_subject=(canonical_claims).provider_subject::text
    FOR UPDATE OF i,u;
    observed_at:=pg_catalog.clock_timestamp();
    IF selected_identity_id IS NULL THEN
      selected_user_id:=pg_catalog.gen_random_uuid(); selected_identity_id:=pg_catalog.gen_random_uuid();
      selected_user_status:='ACTIVE'; selected_identity_status:='ACTIVE';
      selected_user_security_version:=1; selected_identity_security_version:=1;
      INSERT INTO uptech.users(id,status,security_version,created_at,updated_at)
      VALUES(selected_user_id,'ACTIVE',1,observed_at,observed_at);
      INSERT INTO uptech.identities(id,user_id,provider,issuer,provider_subject,status,security_version,
        email_claim,email_verified,hosted_domain_claim,claims_observed_at,created_at,updated_at)
      VALUES(selected_identity_id,selected_user_id,'GOOGLE',(canonical_claims).issuer::text,
        (canonical_claims).provider_subject::text,'ACTIVE',1,(canonical_claims).normalized_email::text,
        true,(canonical_claims).normalized_hosted_domain::text,observed_at,observed_at,observed_at);
    ELSIF selected_user_status='ACTIVE' AND selected_identity_status='ACTIVE' THEN
      UPDATE uptech.identities SET email_claim=(canonical_claims).normalized_email::text,email_verified=true,
        hosted_domain_claim=(canonical_claims).normalized_hosted_domain::text,claims_observed_at=observed_at,
        updated_at=observed_at WHERE id=selected_identity_id;
    ELSE
      UPDATE uptech.oauth_transactions SET status='REJECTED',rejected_at=observed_at
      WHERE id=(validation).transaction_id AND status='EXCHANGE_RESERVED';
      RETURN ROW('DENIED','USER_REMOVED',NULL,NULL,NULL)::uptech.google_login_completion_result_v3;
    END IF;

    SELECT id,role,status,authz_version INTO selected_membership_id,selected_membership_role,
      selected_membership_status,selected_membership_authz_version
    FROM uptech.workspace_memberships WHERE workspace_id=selected_workspace_id
      AND user_id=selected_user_id FOR UPDATE;

    IF selected_workspace_status <> 'ACTIVE' THEN
      denial_access_state:='WORKSPACE_SUSPENDED';
    ELSE
      SELECT generation.id,generation.fresh_until
      INTO selected_generation_id,selected_generation_fresh_until
      FROM uptech.people_sync_generations AS generation
      JOIN uptech.workspaces AS workspace ON workspace.workspace_id=generation.workspace_id
        AND generation.google_customer_id=workspace.google_customer_id
      WHERE generation.workspace_id=selected_workspace_id
        AND generation.status='PUBLISHED' AND generation.traversal_complete
        AND generation.completed_at IS NOT NULL AND generation.fresh_until IS NOT NULL
      ORDER BY generation.completed_at DESC,generation.id DESC LIMIT 1;
      IF selected_generation_id IS NULL THEN
        denial_access_state:='DIRECTORY_SYNC_PENDING';
      ELSIF selected_generation_fresh_until <= pg_catalog.clock_timestamp() THEN
        IF selected_membership_status='ACTIVE' AND selected_membership_role IN ('OWNER','ADMIN') THEN
          denial_access_state:='DIRECTORY_STALE';
        ELSE
          capability_reason:='DIRECTORY_STALE';
          capability_public_state:='DIRECTORY_STALE_ACCESS_REQUEST_AVAILABLE';
        END IF;
      ELSIF NOT uptech.google_directory_generation_has_current_authority_v1(
        selected_workspace_id,selected_generation_id) THEN
        denial_access_state:='USER_NOT_PROVISIONED';
      END IF;
    END IF;

    IF denial_access_state IS NULL AND capability_reason IS NULL THEN
      IF selected_membership_role='OWNER' AND selected_membership_status='ACTIVE' THEN
        SELECT CASE
          WHEN profile.lifecycle_state='SUSPENDED' THEN 'USER_SUSPENDED'
          WHEN profile.lifecycle_state='DELETED' THEN 'USER_REMOVED'
          ELSE NULL END
        INTO mapping_outcome
        FROM uptech.people_profiles AS profile
        WHERE profile.workspace_id=selected_workspace_id
          AND profile.generation_id=selected_generation_id
          AND profile.google_subject=(canonical_claims).provider_subject::text;
        IF NOT EXISTS (SELECT 1 FROM uptech.people_profiles WHERE workspace_id=selected_workspace_id
          AND generation_id=selected_generation_id
          AND google_subject=(canonical_claims).provider_subject::text
          AND lifecycle_state='ACTIVE') THEN
          SELECT (evaluation).outcome::text INTO mapping_outcome
          FROM uptech.evaluate_google_directory_mapping_v1(selected_workspace_id,
            selected_generation_id,(canonical_claims).provider_subject::text) AS evaluation;
          denial_access_state:=mapping_outcome::uptech.google_login_access_state_v2;
        END IF;
      ELSE
        SELECT (evaluation).outcome::text,(evaluation).target_role,(evaluation).target_department_key
        INTO mapping_outcome,mapping_target_role,mapping_target_department
        FROM uptech.evaluate_google_directory_mapping_v1(selected_workspace_id,
          selected_generation_id,(canonical_claims).provider_subject::text) AS evaluation;
        IF mapping_outcome IN ('ACCESS_MAPPING_CONFLICT','USER_NOT_PROVISIONED') THEN
          capability_reason:=mapping_outcome;
          capability_public_state:=mapping_outcome::uptech.google_login_access_state_v2;
        ELSIF mapping_outcome IN ('USER_SUSPENDED','USER_REMOVED') THEN
          denial_access_state:=mapping_outcome::uptech.google_login_access_state_v2;
        END IF;
      END IF;
    END IF;

    IF capability_reason IS NOT NULL THEN
      IF p_onboarding_token_hash IS NOT NULL THEN
        PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
          'UPTECH_CREDENTIAL_V1' || pg_catalog.encode(p_onboarding_token_hash,'hex'),0));
      END IF;
      IF p_onboarding_token_hash IS NOT NULL
        AND p_onboarding_token_hash IS DISTINCT FROM p_session_token_hash
        AND p_onboarding_token_hash IS DISTINCT FROM p_csrf_token_hash
        AND NOT EXISTS (SELECT 1 FROM uptech.session_tokens
          WHERE token_hash=p_onboarding_token_hash OR csrf_token_hash=p_onboarding_token_hash)
        AND NOT EXISTS (SELECT 1 FROM uptech.onboarding_sessions
          WHERE token_hash=p_onboarding_token_hash) THEN
        credential_expiry:=observed_at+interval '30 minutes';
        UPDATE uptech.onboarding_sessions SET status='REVOKED',revoked_at=observed_at
        WHERE identity_id=selected_identity_id AND status='ACTIVE'
          AND allowed_operations @> ARRAY['ACCESS_REQUEST_READ','ACCESS_REQUEST_SUBMIT']::text[]
          AND allowed_operations <@ ARRAY['ACCESS_REQUEST_READ','ACCESS_REQUEST_SUBMIT']::text[];
        INSERT INTO uptech.onboarding_sessions(id,identity_id,token_hash,allowed_operations,status,
          created_at,expires_at,resource_workspace_id,access_request_reason_class)
        VALUES(pg_catalog.gen_random_uuid(),selected_identity_id,p_onboarding_token_hash,
          ARRAY['ACCESS_REQUEST_READ','ACCESS_REQUEST_SUBMIT'],'ACTIVE',observed_at,credential_expiry,
          selected_workspace_id,capability_reason);
        capability_committed:=true;
      END IF;
      IF capability_committed THEN
        observed_at:=pg_catalog.clock_timestamp();
        UPDATE uptech.oauth_transactions SET status='COMPLETED',completed_at=observed_at
        WHERE id=(validation).transaction_id AND status='EXCHANGE_RESERVED'
          AND completion_expires_at>observed_at
          AND (canonical_claims).issued_at>=observed_at-interval '5 minutes'
          AND (canonical_claims).issued_at<=observed_at+interval '2 minutes'
          AND (canonical_claims).expires_at>observed_at
          AND (canonical_claims).expires_at>(canonical_claims).issued_at
          AND (canonical_claims).expires_at<=(canonical_claims).issued_at+interval '2 hours';
        GET DIAGNOSTICS transitioned_rows=ROW_COUNT;
        IF transitioned_rows<>1 THEN RAISE EXCEPTION USING ERRCODE='PGA01',MESSAGE='reservation expired'; END IF;
        INSERT INTO uptech.platform_audit_events(id,identity_id,action,target_type,outcome,request_id,
          metadata,occurred_at) VALUES(pg_catalog.gen_random_uuid(),selected_identity_id,
          'GOOGLE_AUTH_ONBOARDING_ISSUED','ONBOARDING_SESSION','SUCCEEDED',p_request_id,
          pg_catalog.jsonb_build_object('correlation_id',(validation).transaction_id,
            'identity_id',selected_identity_id,'access_state',capability_public_state::text),observed_at);
        INSERT INTO uptech.audit_events(workspace_id,id,actor_kind,actor_id,action,target_type,
          outcome,request_id,metadata,occurred_at)
        VALUES(selected_workspace_id,pg_catalog.gen_random_uuid(),'SYSTEM',NULL,
          'GOOGLE_AUTH_ONBOARDING_ISSUED','ONBOARDING_SESSION','SUCCEEDED',p_request_id,
          pg_catalog.jsonb_build_object('identity_id',selected_identity_id,
            'access_state',capability_public_state::text,'reason_class',capability_reason),observed_at);
        RETURN ROW('ONBOARDING',capability_public_state,
          ARRAY['ACCESS_REQUEST_READ','ACCESS_REQUEST_SUBMIT'],credential_expiry,NULL)
          ::uptech.google_login_completion_result_v3;
      END IF;
      denial_access_state:=CASE WHEN capability_reason='DIRECTORY_STALE'
        THEN 'DIRECTORY_STALE'::uptech.google_login_access_state_v2 ELSE NULL END;
    END IF;

    IF denial_access_state IS NOT NULL OR capability_reason IS NOT NULL THEN
      UPDATE uptech.oauth_transactions SET status='REJECTED',rejected_at=pg_catalog.clock_timestamp()
      WHERE id=(validation).transaction_id AND status='EXCHANGE_RESERVED';
      RETURN ROW('DENIED',denial_access_state,NULL,NULL,NULL)
        ::uptech.google_login_completion_result_v3;
    END IF;

    IF selected_membership_role='OWNER' AND selected_membership_status='ACTIVE' THEN
      NULL;
    ELSE
      IF selected_membership_id IS NULL THEN
        selected_membership_id:=pg_catalog.gen_random_uuid(); selected_membership_authz_version:=1;
        insert_member:=true;
        INSERT INTO uptech.workspace_memberships(workspace_id,id,user_id,role,status,authz_version,created_at,updated_at)
        VALUES(selected_workspace_id,selected_membership_id,selected_user_id,mapping_target_role,
          'ACTIVE',1,observed_at,observed_at);
      ELSIF selected_membership_status IN ('PENDING','DEPROVISIONED')
        AND selected_membership_role <> 'OWNER' THEN
        reactivate_member:=true;
        UPDATE uptech.workspace_memberships SET role=mapping_target_role,status='ACTIVE',
          authz_version=authz_version+1,updated_at=observed_at
        WHERE workspace_id=selected_workspace_id AND id=selected_membership_id
        RETURNING role,authz_version INTO selected_membership_role,selected_membership_authz_version;
      ELSIF selected_membership_status <> 'ACTIVE' THEN
        UPDATE uptech.oauth_transactions SET status='REJECTED',rejected_at=observed_at
        WHERE id=(validation).transaction_id AND status='EXCHANGE_RESERVED';
        RETURN ROW('DENIED','USER_SUSPENDED',NULL,NULL,NULL)::uptech.google_login_completion_result_v3;
      ELSE
        previous_membership_role:=selected_membership_role;
        UPDATE uptech.workspace_memberships SET role=mapping_target_role,
          authz_version=authz_version + CASE WHEN role IS DISTINCT FROM mapping_target_role THEN 1 ELSE 0 END,
          updated_at=observed_at WHERE workspace_id=selected_workspace_id AND id=selected_membership_id
        RETURNING role,authz_version INTO selected_membership_role,selected_membership_authz_version;
        membership_authority_changed:=previous_membership_role IS DISTINCT FROM selected_membership_role;
      END IF;
      selected_membership_role:=mapping_target_role;
    END IF;

    IF p_session_token_hash IS NOT NULL AND p_csrf_token_hash IS NOT NULL THEN
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'UPTECH_CREDENTIAL_V1' || LEAST(pg_catalog.encode(p_session_token_hash,'hex'),
          pg_catalog.encode(p_csrf_token_hash,'hex')),0));
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'UPTECH_CREDENTIAL_V1' || GREATEST(pg_catalog.encode(p_session_token_hash,'hex'),
          pg_catalog.encode(p_csrf_token_hash,'hex')),0));
    END IF;
    IF p_session_token_hash IS NULL OR p_csrf_token_hash IS NULL
      OR p_session_token_hash=p_csrf_token_hash OR p_session_token_hash=p_onboarding_token_hash
      OR p_csrf_token_hash=p_onboarding_token_hash
      OR EXISTS(SELECT 1 FROM uptech.session_tokens WHERE token_hash IN(p_session_token_hash,p_csrf_token_hash))
      OR EXISTS(SELECT 1 FROM uptech.onboarding_sessions WHERE token_hash IN(p_session_token_hash,p_csrf_token_hash)) THEN
      RAISE EXCEPTION USING ERRCODE='PGA01',MESSAGE='credential collision';
    END IF;
    selected_session_id:=pg_catalog.gen_random_uuid();
    INSERT INTO uptech.sessions(workspace_id,id,identity_id,user_id,membership_id,client_type,status,
      user_security_version,identity_security_version,workspace_security_version,membership_authz_version,
      security_version,current_rotation_version,created_at,last_seen_at,idle_expires_at,absolute_expires_at)
    VALUES(selected_workspace_id,selected_session_id,selected_identity_id,selected_user_id,selected_membership_id,
      'WEB','ACTIVE',selected_user_security_version,selected_identity_security_version,
      selected_workspace_security_version,selected_membership_authz_version,1,1,observed_at,observed_at,
      observed_at+interval '8 hours',observed_at+interval '24 hours');
    INSERT INTO uptech.session_tokens(workspace_id,id,session_id,client_type,token_kind,token_status,
      token_hash,csrf_token_hash,session_security_version,rotation_version,issued_at,expires_at)
    VALUES(selected_workspace_id,pg_catalog.gen_random_uuid(),selected_session_id,'WEB','WEB_SESSION','CURRENT',
      p_session_token_hash,p_csrf_token_hash,1,1,observed_at,observed_at+interval '24 hours');
    IF membership_authority_changed THEN
      INSERT INTO uptech.audit_events(workspace_id,id,actor_kind,actor_id,membership_id,session_id,
        action,target_type,target_id,outcome,request_id,metadata,occurred_at)
      VALUES(selected_workspace_id,pg_catalog.gen_random_uuid(),'USER',selected_user_id,
        selected_membership_id,selected_session_id,'MEMBERSHIP_AUTHORITY_CHANGED',
        'WORKSPACE_MEMBERSHIP',selected_membership_id,'SUCCEEDED',p_request_id,
        pg_catalog.jsonb_build_object('old_role',previous_membership_role,
          'new_role',selected_membership_role),observed_at);
    END IF;
    IF insert_member OR reactivate_member THEN
      INSERT INTO uptech.audit_events(workspace_id,id,actor_kind,actor_id,membership_id,session_id,
        action,target_type,target_id,outcome,request_id,metadata,occurred_at)
      VALUES(selected_workspace_id,pg_catalog.gen_random_uuid(),'USER',selected_user_id,
        selected_membership_id,selected_session_id,'MEMBERSHIP_AUTO_PROVISIONED',
        'WORKSPACE_MEMBERSHIP',selected_membership_id,'SUCCEEDED',p_request_id,
        pg_catalog.jsonb_build_object('purpose','WEB_LOGIN','configuration_key','GOOGLE_WEB_LOGIN_V1',
          'identity_id',selected_identity_id),observed_at);
    END IF;
    INSERT INTO uptech.platform_audit_events(id,identity_id,action,target_type,outcome,request_id,
      metadata,occurred_at)
    VALUES(pg_catalog.gen_random_uuid(),selected_identity_id,'GOOGLE_AUTH_LOGIN_SUCCEEDED','SESSION',
      'SUCCEEDED',p_request_id,pg_catalog.jsonb_build_object('purpose','WEB_LOGIN',
        'configuration_key','GOOGLE_WEB_LOGIN_V1','correlation_id',(validation).transaction_id,
        'identity_id',selected_identity_id),observed_at);
    INSERT INTO uptech.audit_events(workspace_id,id,actor_kind,actor_id,membership_id,session_id,
      action,target_type,target_id,outcome,request_id,metadata,occurred_at)
    VALUES(selected_workspace_id,pg_catalog.gen_random_uuid(),'USER',selected_user_id,
      selected_membership_id,selected_session_id,'GOOGLE_AUTH_LOGIN_SUCCEEDED','SESSION',
      selected_session_id,'SUCCEEDED',p_request_id,pg_catalog.jsonb_build_object(
        'purpose','WEB_LOGIN','configuration_key','GOOGLE_WEB_LOGIN_V1','identity_id',selected_identity_id),
      observed_at);
    observed_at:=pg_catalog.clock_timestamp();
    UPDATE uptech.oauth_transactions SET status='COMPLETED',completed_at=observed_at
    WHERE id=(validation).transaction_id AND status='EXCHANGE_RESERVED' AND completion_expires_at>observed_at
      AND (canonical_claims).issued_at>=observed_at-interval '5 minutes'
      AND (canonical_claims).issued_at<=observed_at+interval '2 minutes'
      AND (canonical_claims).expires_at>observed_at
      AND (canonical_claims).expires_at>(canonical_claims).issued_at
      AND (canonical_claims).expires_at<=(canonical_claims).issued_at+interval '2 hours';
    GET DIAGNOSTICS transitioned_rows=ROW_COUNT;
    IF transitioned_rows<>1 THEN RAISE EXCEPTION USING ERRCODE='PGA01',MESSAGE='reservation expired'; END IF;
    RETURN ROW('NORMAL',NULL,NULL,NULL,
      CASE WHEN selected_membership_role IN ('OWNER','ADMIN') THEN '/admin' ELSE '/home' END)
      ::uptech.google_login_completion_result_v3;
  END IF;

  IF p_onboarding_token_hash IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'UPTECH_CREDENTIAL_V1' || pg_catalog.encode(p_onboarding_token_hash,'hex'),0
    ));
  END IF;
  IF p_onboarding_token_hash IS NULL
     OR p_onboarding_token_hash = p_session_token_hash
     OR p_onboarding_token_hash = p_csrf_token_hash
     OR EXISTS (SELECT 1 FROM uptech.session_tokens WHERE token_hash=p_onboarding_token_hash)
     OR EXISTS (SELECT 1 FROM uptech.onboarding_sessions WHERE token_hash=p_onboarding_token_hash)
  THEN
    PERFORM uptech.record_google_login_rejection_v1(
      p_completion_handle_hash,'INTERNAL_FAILURE',p_request_id
    );
    RETURN ROW('DENIED',NULL,NULL,NULL,NULL)::uptech.google_login_completion_result_v3;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    (canonical_claims).issuer::text || pg_catalog.chr(31)
      || (canonical_claims).provider_subject::text,0
  ));
  SELECT identity_row.id,identity_row.user_id,user_row.status,identity_row.status
  INTO selected_identity_id,selected_user_id,selected_user_status,selected_identity_status
  FROM uptech.identities AS identity_row
  JOIN uptech.users AS user_row ON user_row.id=identity_row.user_id
  WHERE identity_row.provider='GOOGLE'
    AND identity_row.issuer=(canonical_claims).issuer::text
    AND identity_row.provider_subject=(canonical_claims).provider_subject::text
  FOR UPDATE OF identity_row,user_row;

  observed_at := pg_catalog.clock_timestamp();
  IF selected_identity_id IS NULL THEN
    selected_user_id := pg_catalog.gen_random_uuid();
    selected_identity_id := pg_catalog.gen_random_uuid();
    INSERT INTO uptech.users(id,status,security_version,created_at,updated_at)
    VALUES(selected_user_id,'ACTIVE',1,observed_at,observed_at);
    INSERT INTO uptech.identities(
      id,user_id,provider,issuer,provider_subject,status,security_version,
      email_claim,email_verified,hosted_domain_claim,claims_observed_at,created_at,updated_at
    ) VALUES (
      selected_identity_id,selected_user_id,'GOOGLE',(canonical_claims).issuer::text,
      (canonical_claims).provider_subject::text,'ACTIVE',1,
      (canonical_claims).normalized_email::text,true,
      (canonical_claims).normalized_hosted_domain::text,observed_at,observed_at,observed_at
    );
  ELSIF selected_user_status='ACTIVE' AND selected_identity_status='ACTIVE' THEN
    UPDATE uptech.identities SET
      email_claim=(canonical_claims).normalized_email::text,
      email_verified=true,
      hosted_domain_claim=(canonical_claims).normalized_hosted_domain::text,
      claims_observed_at=observed_at,
      updated_at=observed_at
    WHERE id=selected_identity_id;
  ELSE
    PERFORM uptech.record_google_login_rejection_v1(
      p_completion_handle_hash,'IDENTITY_INELIGIBLE',p_request_id
    );
    RETURN ROW('DENIED',NULL,NULL,NULL,NULL)::uptech.google_login_completion_result_v3;
  END IF;

  credential_expiry := observed_at + interval '30 minutes';
  -- The identity row lock serializes replacement: one current unknown-domain
  -- capability per identity, while preserving revoked rows for audit.
  UPDATE uptech.onboarding_sessions
  SET status='REVOKED',revoked_at=observed_at
  WHERE identity_id=selected_identity_id
    AND status='ACTIVE'
    AND resource_workspace_id IS NULL
    AND allowed_operations <@ ARRAY[
      'FIRST_DOMAIN_CLAIM_READ','FIRST_DOMAIN_CLAIM_RESERVE','FIRST_DOMAIN_CLAIM_COMPLETE'
    ]::text[];

  INSERT INTO uptech.onboarding_sessions(
    id,identity_id,token_hash,allowed_operations,status,created_at,expires_at,
    resource_workspace_id,access_request_reason_class
  ) VALUES (
    pg_catalog.gen_random_uuid(),selected_identity_id,p_onboarding_token_hash,
    ARRAY['FIRST_DOMAIN_CLAIM_READ','FIRST_DOMAIN_CLAIM_RESERVE','FIRST_DOMAIN_CLAIM_COMPLETE'],
    'ACTIVE',observed_at,credential_expiry,NULL,NULL
  );

  UPDATE uptech.oauth_transactions SET status='COMPLETED',completed_at=observed_at
  WHERE id=(validation).transaction_id AND status='EXCHANGE_RESERVED'
    AND completion_expires_at > observed_at;
  GET DIAGNOSTICS transitioned_rows = ROW_COUNT;
  IF transitioned_rows <> 1 THEN
    RAISE EXCEPTION USING ERRCODE='PGA01',MESSAGE='google login reservation expired';
  END IF;

  INSERT INTO uptech.platform_audit_events(
    id,identity_id,action,target_type,outcome,request_id,metadata,occurred_at
  ) VALUES (
    pg_catalog.gen_random_uuid(),selected_identity_id,'GOOGLE_AUTH_ONBOARDING_ISSUED',
    'ONBOARDING_SESSION','SUCCEEDED',p_request_id,
    pg_catalog.jsonb_build_object('correlation_id',(validation).transaction_id,
      'identity_id',selected_identity_id,'access_state','UNKNOWN_WORKSPACE'),observed_at
  );
  RETURN ROW('ONBOARDING','UNKNOWN_WORKSPACE',
    ARRAY['FIRST_DOMAIN_CLAIM_READ','FIRST_DOMAIN_CLAIM_RESERVE','FIRST_DOMAIN_CLAIM_COMPLETE'],
    credential_expiry,NULL)::uptech.google_login_completion_result_v3;
EXCEPTION WHEN SQLSTATE 'PGA01' THEN
  RETURN ROW('DENIED',NULL,NULL,NULL,NULL)::uptech.google_login_completion_result_v3;
END
$function$;

REVOKE ALL ON TYPE uptech.google_login_route_v1,
  uptech.google_login_completion_result_v3
FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.complete_web_google_login_directory_v2(
  uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,
  uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.complete_web_google_login_directory_v2(
  uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,
  uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,uuid
) TO uptech_api_runtime;

-- Internal, versioned Directory mapping decision used by login completion.
-- The caller supplies the workspace and exact generation it selected; this
-- routine revalidates that snapshot and never searches for an alternative.
CREATE TYPE uptech.google_directory_mapping_outcome_v1 AS ENUM (
  'ADMIN',
  'MEMBER',
  'ACCESS_MAPPING_CONFLICT',
  'USER_NOT_PROVISIONED',
  'USER_SUSPENDED',
  'USER_REMOVED'
);

CREATE FUNCTION uptech.google_directory_generation_has_current_authority_v1(
  p_workspace_id uuid,p_generation_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM uptech.workspaces AS workspace
    JOIN uptech.people_sync_generations AS generation
      ON generation.workspace_id=workspace.workspace_id AND generation.id=p_generation_id
      AND generation.status='PUBLISHED' AND generation.traversal_complete
      AND generation.completed_at IS NOT NULL AND generation.fresh_until>pg_catalog.statement_timestamp()
      AND generation.google_customer_id=workspace.google_customer_id
    JOIN uptech.connectors AS connector
      ON connector.workspace_id=generation.workspace_id AND connector.id=generation.connector_id
      AND connector.purpose='DIRECTORY' AND connector.status IN ('ACTIVE','DEGRADED')
      AND connector.provider_customer_id=workspace.google_customer_id
      AND connector.credential_reference IS NOT NULL
      AND connector.directory_authorized_by_identity_id IS NOT NULL
      AND uptech.directory_scopes_are_supported_v1(connector.directory_authorized_scopes)
    JOIN uptech.identities AS authorized_identity
      ON authorized_identity.id=connector.directory_authorized_by_identity_id
      AND authorized_identity.provider='GOOGLE'
      AND authorized_identity.issuer='https://accounts.google.com'
      AND authorized_identity.status='ACTIVE' AND authorized_identity.email_verified
    JOIN uptech.workspace_domain_locators AS locator
      ON locator.workspace_id=workspace.workspace_id
      AND locator.google_customer_id=workspace.google_customer_id
      AND locator.normalized_domain::text=pg_catalog.lower(authorized_identity.hosted_domain_claim)
      AND locator.status='VERIFIED'
    WHERE workspace.workspace_id=p_workspace_id AND workspace.status='ACTIVE'
      AND workspace.provisioning_policy='GOOGLE_GROUP_CONTROLLED')
$function$;

REVOKE ALL ON FUNCTION uptech.google_directory_generation_has_current_authority_v1(uuid,uuid)
FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;

CREATE FUNCTION uptech.refresh_published_people_authority_v2()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
BEGIN
  UPDATE uptech.people_profiles AS profile
  SET effective_role = CASE
        WHEN profile.lifecycle_state='ACTIVE' AND EXISTS (
          SELECT 1 FROM uptech.people_group_memberships AS edge
          JOIN uptech.people_permission_mappings AS mapping
            ON mapping.workspace_id=edge.workspace_id AND mapping.source_kind='ADMIN_GROUP'
           AND mapping.source_value=edge.google_group_id AND mapping.status='ACTIVE'
          WHERE edge.workspace_id=NEW.workspace_id AND edge.generation_id=NEW.id
            AND edge.google_subject=profile.google_subject) THEN 'ADMIN'
        WHEN profile.lifecycle_state='ACTIVE' AND 1=(
          SELECT pg_catalog.count(DISTINCT signal.target_department_key)
          FROM (
            SELECT mapping.target_department_key FROM uptech.people_permission_mappings AS mapping
            WHERE mapping.workspace_id=NEW.workspace_id AND mapping.source_kind='DEPARTMENT'
              AND mapping.source_value=pg_catalog.lower(pg_catalog.btrim(profile.department))
              AND mapping.status='ACTIVE'
            UNION ALL
            SELECT mapping.target_department_key FROM uptech.people_group_memberships AS edge
            JOIN uptech.people_permission_mappings AS mapping
              ON mapping.workspace_id=edge.workspace_id AND mapping.source_kind='GROUP'
             AND mapping.source_value=edge.google_group_id AND mapping.status='ACTIVE'
            WHERE edge.workspace_id=NEW.workspace_id AND edge.generation_id=NEW.id
              AND edge.google_subject=profile.google_subject
            UNION ALL
            SELECT mapping.target_department_key FROM uptech.people_org_units AS org_unit
            JOIN uptech.people_permission_mappings AS mapping
              ON mapping.workspace_id=org_unit.workspace_id AND mapping.source_kind='ORG_UNIT'
             AND mapping.source_value=org_unit.google_org_unit_id AND mapping.status='ACTIVE'
            WHERE org_unit.workspace_id=NEW.workspace_id AND org_unit.generation_id=NEW.id
              AND org_unit.org_unit_path=profile.org_unit_path
          ) AS signal) THEN 'MEMBER'
        ELSE NULL END,
      effective_department_key = CASE
        WHEN profile.lifecycle_state='ACTIVE' AND NOT EXISTS (
          SELECT 1 FROM uptech.people_group_memberships AS edge
          JOIN uptech.people_permission_mappings AS mapping
            ON mapping.workspace_id=edge.workspace_id AND mapping.source_kind='ADMIN_GROUP'
           AND mapping.source_value=edge.google_group_id AND mapping.status='ACTIVE'
          WHERE edge.workspace_id=NEW.workspace_id AND edge.generation_id=NEW.id
            AND edge.google_subject=profile.google_subject)
        THEN (SELECT pg_catalog.min(signal.target_department_key) FROM (
          SELECT mapping.target_department_key FROM uptech.people_permission_mappings AS mapping
          WHERE mapping.workspace_id=NEW.workspace_id AND mapping.source_kind='DEPARTMENT'
            AND mapping.source_value=pg_catalog.lower(pg_catalog.btrim(profile.department))
            AND mapping.status='ACTIVE'
          UNION ALL
          SELECT mapping.target_department_key FROM uptech.people_group_memberships AS edge
          JOIN uptech.people_permission_mappings AS mapping
            ON mapping.workspace_id=edge.workspace_id AND mapping.source_kind='GROUP'
           AND mapping.source_value=edge.google_group_id AND mapping.status='ACTIVE'
          WHERE edge.workspace_id=NEW.workspace_id AND edge.generation_id=NEW.id
            AND edge.google_subject=profile.google_subject
          UNION ALL
          SELECT mapping.target_department_key FROM uptech.people_org_units AS org_unit
          JOIN uptech.people_permission_mappings AS mapping
            ON mapping.workspace_id=org_unit.workspace_id AND mapping.source_kind='ORG_UNIT'
           AND mapping.source_value=org_unit.google_org_unit_id AND mapping.status='ACTIVE'
          WHERE org_unit.workspace_id=NEW.workspace_id AND org_unit.generation_id=NEW.id
            AND org_unit.org_unit_path=profile.org_unit_path
        ) AS signal HAVING pg_catalog.count(DISTINCT signal.target_department_key)=1)
        ELSE NULL END
  WHERE profile.workspace_id=NEW.workspace_id AND profile.generation_id=NEW.id;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION uptech.refresh_published_people_authority_v2()
FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;

CREATE TRIGGER refresh_published_people_authority_v2
AFTER UPDATE OF status ON uptech.people_sync_generations
FOR EACH ROW WHEN (NEW.status='PUBLISHED')
EXECUTE FUNCTION uptech.refresh_published_people_authority_v2();

-- Backfill the currently published snapshot when 0009 is applied to an
-- installation that already published Directory data under the v1 calculator.
UPDATE uptech.people_sync_generations
SET status=status
WHERE status='PUBLISHED';

CREATE TYPE uptech.google_directory_mapping_result_v1 AS (
  outcome uptech.google_directory_mapping_outcome_v1,
  target_role text,
  target_department_key text
);

CREATE FUNCTION uptech.evaluate_google_directory_mapping_v1(
  p_workspace_id uuid,
  p_generation_id uuid,
  p_google_subject text
)
RETURNS uptech.google_directory_mapping_result_v1
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  selected_profile uptech.people_profiles%ROWTYPE;
  generation_is_fresh boolean;
  has_admin_mapping boolean;
  member_department_count integer;
  selected_department_key text;
BEGIN
  IF p_workspace_id IS NULL OR p_generation_id IS NULL
     OR p_google_subject IS NULL
     OR pg_catalog.length(pg_catalog.btrim(p_google_subject)) NOT BETWEEN 1 AND 512
     OR p_google_subject <> pg_catalog.btrim(p_google_subject) THEN
    RETURN ROW('USER_NOT_PROVISIONED',NULL,NULL)
      ::uptech.google_directory_mapping_result_v1;
  END IF;

  SELECT generation.fresh_until > pg_catalog.statement_timestamp()
  INTO generation_is_fresh
  FROM uptech.workspaces AS workspace
  JOIN uptech.people_sync_generations AS generation
    ON generation.workspace_id = workspace.workspace_id
   AND generation.id = p_generation_id
   AND generation.status = 'PUBLISHED'
   AND generation.traversal_complete
   AND generation.completed_at IS NOT NULL
   AND generation.fresh_until IS NOT NULL
   AND generation.google_customer_id = workspace.google_customer_id
  JOIN uptech.connectors AS connector
    ON connector.workspace_id = generation.workspace_id
   AND connector.id = generation.connector_id
   AND connector.purpose = 'DIRECTORY'
   AND connector.status IN ('ACTIVE','DEGRADED')
   AND connector.provider_customer_id = workspace.google_customer_id
   AND connector.credential_reference IS NOT NULL
   AND connector.directory_authorized_by_identity_id IS NOT NULL
   AND uptech.directory_scopes_are_supported_v1(connector.directory_authorized_scopes)
  JOIN uptech.identities AS authorized_identity
    ON authorized_identity.id = connector.directory_authorized_by_identity_id
   AND authorized_identity.provider = 'GOOGLE'
   AND authorized_identity.issuer = 'https://accounts.google.com'
   AND authorized_identity.status = 'ACTIVE'
   AND authorized_identity.email_verified
  JOIN uptech.workspace_domain_locators AS authorized_locator
    ON authorized_locator.workspace_id = workspace.workspace_id
   AND authorized_locator.google_customer_id = workspace.google_customer_id
   AND authorized_locator.normalized_domain::text =
       pg_catalog.lower(authorized_identity.hosted_domain_claim)
   AND authorized_locator.status = 'VERIFIED'
  WHERE workspace.workspace_id = p_workspace_id
    AND workspace.status = 'ACTIVE'
    AND workspace.provisioning_policy = 'GOOGLE_GROUP_CONTROLLED';

  IF NOT FOUND THEN
    RETURN ROW('USER_NOT_PROVISIONED',NULL,NULL)
      ::uptech.google_directory_mapping_result_v1;
  END IF;

  IF NOT generation_is_fresh THEN
    RETURN ROW('USER_NOT_PROVISIONED',NULL,NULL)
      ::uptech.google_directory_mapping_result_v1;
  END IF;

  SELECT profile.* INTO selected_profile
  FROM uptech.people_profiles AS profile
  WHERE profile.workspace_id = p_workspace_id
    AND profile.generation_id = p_generation_id
    AND profile.google_subject = p_google_subject;

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1
      FROM uptech.people_profiles AS prior_profile
      JOIN uptech.people_sync_generations AS prior_generation
        ON prior_generation.workspace_id = prior_profile.workspace_id
       AND prior_generation.id = prior_profile.generation_id
      JOIN uptech.workspaces AS prior_workspace
        ON prior_workspace.workspace_id = prior_generation.workspace_id
       AND prior_generation.google_customer_id = prior_workspace.google_customer_id
      WHERE prior_profile.workspace_id = p_workspace_id
        AND prior_profile.google_subject = p_google_subject
        AND prior_generation.id <> p_generation_id
        AND prior_generation.status IN ('PUBLISHED','SUPERSEDED')
        AND prior_generation.traversal_complete
        AND prior_generation.completed_at IS NOT NULL
    ) THEN
      RETURN ROW('USER_REMOVED',NULL,NULL)
        ::uptech.google_directory_mapping_result_v1;
    END IF;
    RETURN ROW('USER_NOT_PROVISIONED',NULL,NULL)
      ::uptech.google_directory_mapping_result_v1;
  END IF;

  IF selected_profile.lifecycle_state = 'SUSPENDED' THEN
    RETURN ROW('USER_SUSPENDED',NULL,NULL)
      ::uptech.google_directory_mapping_result_v1;
  ELSIF selected_profile.lifecycle_state = 'DELETED' THEN
    RETURN ROW('USER_REMOVED',NULL,NULL)
      ::uptech.google_directory_mapping_result_v1;
  ELSIF selected_profile.lifecycle_state <> 'ACTIVE' THEN
    RETURN ROW('USER_NOT_PROVISIONED',NULL,NULL)
      ::uptech.google_directory_mapping_result_v1;
  END IF;

  IF selected_profile.effective_role = 'ADMIN'
     AND selected_profile.effective_department_key IS NULL THEN
    RETURN ROW('ADMIN','ADMIN',NULL)
      ::uptech.google_directory_mapping_result_v1;
  ELSIF selected_profile.effective_role = 'MEMBER'
        AND selected_profile.effective_department_key IS NOT NULL THEN
    RETURN ROW('MEMBER','MEMBER',selected_profile.effective_department_key)
      ::uptech.google_directory_mapping_result_v1;
  END IF;

  SELECT pg_catalog.count(DISTINCT signal.target_department_key)
  INTO member_department_count
  FROM (
    SELECT mapping.target_department_key FROM uptech.people_group_memberships AS membership
    JOIN uptech.people_permission_mappings AS mapping
      ON mapping.workspace_id=membership.workspace_id AND mapping.source_kind='GROUP'
     AND mapping.source_value=membership.google_group_id AND mapping.status='ACTIVE'
    WHERE membership.workspace_id=p_workspace_id AND membership.generation_id=p_generation_id
      AND membership.google_subject=p_google_subject
    UNION ALL
    SELECT mapping.target_department_key FROM uptech.people_permission_mappings AS mapping
    WHERE mapping.workspace_id=p_workspace_id AND mapping.source_kind='DEPARTMENT'
      AND mapping.source_value=pg_catalog.lower(pg_catalog.btrim(selected_profile.department))
      AND mapping.status='ACTIVE'
    UNION ALL
    SELECT mapping.target_department_key FROM uptech.people_org_units AS org_unit
    JOIN uptech.people_permission_mappings AS mapping
      ON mapping.workspace_id=org_unit.workspace_id AND mapping.source_kind='ORG_UNIT'
     AND mapping.source_value=org_unit.google_org_unit_id AND mapping.status='ACTIVE'
    WHERE org_unit.workspace_id=p_workspace_id AND org_unit.generation_id=p_generation_id
      AND org_unit.org_unit_path=selected_profile.org_unit_path
  ) AS signal;
  IF member_department_count > 1 THEN
    RETURN ROW('ACCESS_MAPPING_CONFLICT',NULL,NULL)
      ::uptech.google_directory_mapping_result_v1;
  END IF;

  RETURN ROW('USER_NOT_PROVISIONED',NULL,NULL)
    ::uptech.google_directory_mapping_result_v1;
END
$function$;

REVOKE ALL ON TYPE uptech.google_directory_mapping_outcome_v1,
  uptech.google_directory_mapping_result_v1
FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.evaluate_google_directory_mapping_v1(uuid,uuid,text)
FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;

COMMIT;
