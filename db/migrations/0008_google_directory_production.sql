\set ON_ERROR_STOP on

BEGIN;
SET LOCAL ROLE uptech_migration_owner;

-- Expansion migration from the immutable 0007 enterprise-login baseline.
-- Existing nullable Google customer IDs already have a global partial unique
-- index from 0001. This composite key exists only to support the tenant-bound
-- connector foreign key.
ALTER TABLE uptech.workspaces
  ADD CONSTRAINT workspaces_workspace_customer_unique
  UNIQUE (workspace_id, google_customer_id);

ALTER TABLE uptech.connectors
  ADD COLUMN provider_customer_id text,
  ADD COLUMN credential_reference text,
  ADD COLUMN directory_authorized_by_identity_id uuid,
  ADD COLUMN directory_authorized_scopes text[];

ALTER TABLE uptech.connectors
  ADD CONSTRAINT connectors_directory_customer_fk
    FOREIGN KEY (workspace_id, provider_customer_id)
    REFERENCES uptech.workspaces (workspace_id, google_customer_id)
    ON DELETE RESTRICT
    NOT VALID,
  ADD CONSTRAINT connectors_directory_setup_metadata_check_v2 CHECK (
    (provider_customer_id IS NULL
      AND credential_reference IS NULL
      AND directory_authorized_by_identity_id IS NULL
      AND directory_authorized_scopes IS NULL)
    OR (
      purpose = 'DIRECTORY'
      AND provider_customer_id IS NOT NULL AND length(provider_customer_id) BETWEEN 1 AND 512
      AND credential_reference IS NOT NULL AND length(credential_reference) BETWEEN 1 AND 1024
      AND directory_authorized_by_identity_id IS NOT NULL
      AND directory_authorized_scopes IS NOT NULL
      AND cardinality(directory_authorized_scopes) = 4
      AND array_position(directory_authorized_scopes, NULL) IS NULL
      AND directory_authorized_scopes @> ARRAY[
        'https://www.googleapis.com/auth/admin.directory.customer.readonly',
        'https://www.googleapis.com/auth/admin.directory.user.readonly',
        'https://www.googleapis.com/auth/admin.directory.group.readonly',
        'https://www.googleapis.com/auth/admin.directory.orgunit.readonly'
      ]::text[]
    )
  ) NOT VALID;

ALTER TABLE uptech.connectors
  VALIDATE CONSTRAINT connectors_directory_customer_fk;
ALTER TABLE uptech.connectors
  VALIDATE CONSTRAINT connectors_directory_setup_metadata_check_v2;
ALTER TABLE uptech.connectors
  RENAME CONSTRAINT connectors_directory_setup_metadata_check_v2
  TO connectors_directory_setup_metadata_check;

ALTER TABLE uptech.people_sync_generations
  ADD COLUMN google_customer_id text,
  ADD COLUMN primary_domain text;

CREATE TABLE uptech.people_org_units (
  workspace_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  google_org_unit_id text COLLATE "C" NOT NULL,
  org_unit_path text NOT NULL,
  parent_org_unit_id text COLLATE "C",
  PRIMARY KEY (workspace_id, generation_id, google_org_unit_id),
  CONSTRAINT people_org_units_generation_fk FOREIGN KEY (workspace_id, generation_id)
    REFERENCES uptech.people_sync_generations (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT people_org_units_path_check CHECK (length(org_unit_path) BETWEEN 1 AND 1024)
);

ALTER TABLE uptech.people_profiles
  ADD COLUMN org_unit_path text,
  ADD COLUMN google_is_admin boolean,
  ADD COLUMN google_is_delegated_admin boolean,
  ADD CONSTRAINT people_profiles_org_unit_path_check
    CHECK (org_unit_path IS NULL OR length(org_unit_path) BETWEEN 1 AND 1024)
    NOT VALID,
  ADD CONSTRAINT people_profiles_effective_authority_check_v2 CHECK (
    (effective_role IS NULL AND effective_department_key IS NULL)
    OR (effective_role = 'ADMIN' AND effective_department_key IS NULL)
    OR (effective_role = 'MEMBER'
      AND effective_department_key IN ('SALES', 'HR', 'IT', 'FINANCE'))
  ) NOT VALID;

ALTER TABLE uptech.people_profiles
  VALIDATE CONSTRAINT people_profiles_org_unit_path_check;
ALTER TABLE uptech.people_profiles
  VALIDATE CONSTRAINT people_profiles_effective_authority_check_v2;
ALTER TABLE uptech.people_profiles
  DROP CONSTRAINT people_profiles_effective_authority_check;
ALTER TABLE uptech.people_profiles
  RENAME CONSTRAINT people_profiles_effective_authority_check_v2
  TO people_profiles_effective_authority_check;

ALTER TABLE uptech.people_permission_mappings
  ADD CONSTRAINT people_permission_mappings_source_check_v2 CHECK (
    source_kind IN ('ADMIN_GROUP', 'GROUP', 'DEPARTMENT')
    AND length(source_value) BETWEEN 1 AND 512
    AND (source_kind <> 'DEPARTMENT' OR source_value = lower(btrim(source_value)))
  ) NOT VALID,
  ADD CONSTRAINT people_permission_mappings_target_check_v2 CHECK (
    (source_kind = 'ADMIN_GROUP' AND target_role = 'ADMIN'
      AND target_department_key IS NULL)
    OR (source_kind IN ('GROUP', 'DEPARTMENT') AND target_role = 'MEMBER'
      AND target_department_key IN ('SALES', 'HR', 'IT', 'FINANCE'))
  ) NOT VALID;

ALTER TABLE uptech.people_permission_mappings
  VALIDATE CONSTRAINT people_permission_mappings_source_check_v2;
ALTER TABLE uptech.people_permission_mappings
  VALIDATE CONSTRAINT people_permission_mappings_target_check_v2;
ALTER TABLE uptech.people_permission_mappings
  DROP CONSTRAINT people_permission_mappings_source_check,
  DROP CONSTRAINT people_permission_mappings_target_check;
ALTER TABLE uptech.people_permission_mappings
  RENAME CONSTRAINT people_permission_mappings_source_check_v2
  TO people_permission_mappings_source_check;
ALTER TABLE uptech.people_permission_mappings
  RENAME CONSTRAINT people_permission_mappings_target_check_v2
  TO people_permission_mappings_target_check;

CREATE UNIQUE INDEX connectors_one_live_directory_workspace
  ON uptech.connectors (workspace_id)
  WHERE purpose = 'DIRECTORY'
    AND status IN ('AUTHORIZING', 'ACTIVE', 'DEGRADED', 'DISCONNECTED');

CREATE OR REPLACE FUNCTION uptech.prepare_directory_consent_v1(p_request_id uuid)
RETURNS TABLE (
  outcome text,
  connector_id uuid,
  provider_subject text,
  provider_email text,
  hosted_domain text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  selected_workspace_id uuid := NULLIF(current_setting('app.workspace_id', true), '')::uuid;
  selected_actor_id uuid := NULLIF(current_setting('app.actor_id', true), '')::uuid;
  selected_membership_id uuid := NULLIF(current_setting('app.membership_id', true), '')::uuid;
  selected_session_id uuid := NULLIF(current_setting('app.session_id', true), '')::uuid;
  selected_identity_id uuid;
  selected_role text;
  selected_subject text;
  selected_email text;
  selected_domain text;
  selected_connector_id uuid;
  selected_connector_status text;
BEGIN
  IF p_request_id IS NULL OR selected_workspace_id IS NULL
     OR selected_actor_id IS NULL OR selected_membership_id IS NULL
     OR selected_session_id IS NULL THEN
    RETURN QUERY SELECT 'DENIED'::text, NULL::uuid, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT identity_row.id, membership.role, identity_row.provider_subject,
         lower(identity_row.email_claim), lower(identity_row.hosted_domain_claim)
    INTO selected_identity_id, selected_role, selected_subject,
         selected_email, selected_domain
  FROM uptech.workspace_memberships AS membership
  JOIN uptech.sessions AS session_row
    ON session_row.workspace_id = membership.workspace_id
   AND session_row.membership_id = membership.id
   AND session_row.user_id = membership.user_id
  JOIN uptech.users AS user_row ON user_row.id = membership.user_id
  JOIN uptech.identities AS identity_row
    ON identity_row.id = session_row.identity_id
   AND identity_row.user_id = membership.user_id
  JOIN uptech.workspaces AS workspace
    ON workspace.workspace_id = membership.workspace_id
  JOIN uptech.workspace_domain_locators AS locator
    ON locator.workspace_id = workspace.workspace_id
   AND locator.normalized_domain::text = lower(identity_row.hosted_domain_claim)
   AND locator.status = 'VERIFIED'
  WHERE membership.workspace_id = selected_workspace_id
    AND membership.id = selected_membership_id
    AND membership.user_id = selected_actor_id
    AND membership.status = 'ACTIVE'
    AND membership.role IN ('OWNER', 'ADMIN')
    AND session_row.id = selected_session_id
    AND session_row.client_type = 'WEB'
    AND session_row.status = 'ACTIVE' AND session_row.revoked_at IS NULL
    AND session_row.idle_expires_at > statement_timestamp()
    AND session_row.absolute_expires_at > statement_timestamp()
    AND session_row.user_security_version = user_row.security_version
    AND session_row.identity_security_version = identity_row.security_version
    AND session_row.workspace_security_version = workspace.security_version
    AND session_row.membership_authz_version = membership.authz_version
    AND user_row.status = 'ACTIVE'
    AND identity_row.provider = 'GOOGLE'
    AND identity_row.issuer = 'https://accounts.google.com'
    AND identity_row.status = 'ACTIVE'
    AND identity_row.email_verified
    AND identity_row.email_claim IS NOT NULL
    AND identity_row.hosted_domain_claim IS NOT NULL
    AND workspace.status = 'ACTIVE'
  FOR UPDATE OF membership, session_row, user_row, identity_row, workspace;

  IF selected_identity_id IS NULL OR selected_subject IS NULL
     OR selected_email IS NULL OR selected_domain IS NULL
     OR (selected_role = 'ADMIN' AND EXISTS (
       SELECT 1 FROM uptech.connectors AS configured
       WHERE configured.workspace_id = selected_workspace_id
         AND configured.purpose = 'DIRECTORY'
         AND configured.status IN ('ACTIVE', 'DEGRADED')
         AND configured.provider_customer_id IS NOT NULL
         AND configured.credential_reference IS NOT NULL
     ) AND NOT uptech.has_current_people_authority_v1(
       selected_workspace_id, selected_actor_id, selected_identity_id,
       selected_membership_id
     )) THEN
    RETURN QUERY SELECT 'DENIED'::text, NULL::uuid, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  INSERT INTO uptech.service_actors (workspace_id, id, actor_kind, status)
  SELECT selected_workspace_id, gen_random_uuid(), 'SYNC_WORKER', 'ACTIVE'
  WHERE NOT EXISTS (
    SELECT 1 FROM uptech.service_actors AS actor
    WHERE actor.workspace_id = selected_workspace_id
      AND actor.actor_kind = 'SYNC_WORKER' AND actor.status = 'ACTIVE'
  );

  SELECT connector.id, connector.status
    INTO selected_connector_id, selected_connector_status
  FROM uptech.connectors AS connector
  WHERE connector.workspace_id = selected_workspace_id
    AND connector.purpose = 'DIRECTORY'
    AND connector.status IN ('AUTHORIZING', 'ACTIVE', 'DEGRADED', 'DISCONNECTED')
  ORDER BY connector.created_at, connector.id
  LIMIT 1
  FOR UPDATE;

  IF selected_connector_id IS NULL THEN
    selected_connector_id := gen_random_uuid();
    INSERT INTO uptech.connectors (workspace_id, id, purpose, status)
    VALUES (selected_workspace_id, selected_connector_id, 'DIRECTORY', 'AUTHORIZING');
  ELSIF selected_connector_status = 'DISCONNECTED' THEN
    UPDATE uptech.connectors
       SET status = 'AUTHORIZING', updated_at = statement_timestamp()
     WHERE workspace_id = selected_workspace_id AND id = selected_connector_id;
  END IF;

  INSERT INTO uptech.audit_events (
    workspace_id, id, actor_kind, actor_id, membership_id, session_id,
    action, target_type, target_id, outcome, request_id, metadata
  ) VALUES (
    selected_workspace_id, gen_random_uuid(), 'USER', selected_actor_id,
    selected_membership_id, selected_session_id, 'DIRECTORY_CONSENT_PREPARED',
    'CONNECTOR', selected_connector_id, 'SUCCEEDED', p_request_id,
    '{}'::jsonb
  );

  RETURN QUERY SELECT 'PREPARED'::text, selected_connector_id,
    selected_subject, selected_email, selected_domain;
END
$function$;

-- Google admin flags are setup eligibility evidence only. Activation rebinds
-- the callback to the same request identity and verified hosted domain, then
-- establishes a null-or-equal customer binding atomically.
CREATE OR REPLACE FUNCTION uptech.activate_directory_connector_v1(
  p_connector_id uuid,
  p_provider_customer_id text,
  p_credential_reference text,
  p_provider_subject text,
  p_hosted_domain text,
  p_scopes text[],
  p_request_id uuid
)
RETURNS TABLE (
  outcome text,
  previous_credential_reference text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  selected_workspace_id uuid := NULLIF(current_setting('app.workspace_id', true), '')::uuid;
  selected_actor_id uuid := NULLIF(current_setting('app.actor_id', true), '')::uuid;
  selected_membership_id uuid := NULLIF(current_setting('app.membership_id', true), '')::uuid;
  selected_session_id uuid := NULLIF(current_setting('app.session_id', true), '')::uuid;
  selected_identity_id uuid;
  selected_role text;
  selected_service_actor_id uuid;
  selected_previous_credential_reference text;
BEGIN
  IF p_connector_id IS NULL OR p_provider_customer_id IS NULL
     OR length(btrim(p_provider_customer_id)) NOT BETWEEN 1 AND 512
     OR p_credential_reference IS NULL
     OR length(btrim(p_credential_reference)) NOT BETWEEN 1 AND 1024
     OR p_provider_subject IS NULL
     OR length(btrim(p_provider_subject)) NOT BETWEEN 1 AND 512
     OR p_hosted_domain IS NULL
     OR length(btrim(p_hosted_domain)) NOT BETWEEN 3 AND 253
     OR p_request_id IS NULL OR p_scopes IS NULL
     OR cardinality(p_scopes) <> 4
     OR array_position(p_scopes, NULL) IS NOT NULL
     OR NOT (p_scopes @> ARRAY[
       'https://www.googleapis.com/auth/admin.directory.customer.readonly',
       'https://www.googleapis.com/auth/admin.directory.user.readonly',
       'https://www.googleapis.com/auth/admin.directory.group.readonly',
       'https://www.googleapis.com/auth/admin.directory.orgunit.readonly'
     ]::text[]) THEN
    RETURN QUERY SELECT 'DENIED'::text, NULL::text;
    RETURN;
  END IF;

  SELECT identity_row.id, membership.role, connector.credential_reference
    INTO selected_identity_id, selected_role,
      selected_previous_credential_reference
  FROM uptech.workspace_memberships AS membership
  JOIN uptech.sessions AS session_row
    ON session_row.workspace_id = membership.workspace_id
   AND session_row.membership_id = membership.id
   AND session_row.user_id = membership.user_id
  JOIN uptech.users AS user_row ON user_row.id = membership.user_id
  JOIN uptech.workspaces AS workspace
    ON workspace.workspace_id = membership.workspace_id
  JOIN uptech.identities AS identity_row
    ON identity_row.id = session_row.identity_id
   AND identity_row.user_id = membership.user_id
  JOIN uptech.workspace_domain_locators AS locator
    ON locator.workspace_id = workspace.workspace_id
   AND locator.normalized_domain::text = lower(btrim(p_hosted_domain))
   AND locator.status = 'VERIFIED'
  JOIN uptech.connectors AS connector
    ON connector.workspace_id = membership.workspace_id
   AND connector.id = p_connector_id
  WHERE membership.workspace_id = selected_workspace_id
    AND membership.id = selected_membership_id
    AND membership.user_id = selected_actor_id
    AND membership.status = 'ACTIVE'
    AND membership.role IN ('OWNER', 'ADMIN')
    AND session_row.id = selected_session_id
    AND session_row.client_type = 'WEB'
    AND session_row.status = 'ACTIVE' AND session_row.revoked_at IS NULL
    AND session_row.idle_expires_at > statement_timestamp()
    AND session_row.absolute_expires_at > statement_timestamp()
    AND session_row.user_security_version = user_row.security_version
    AND session_row.identity_security_version = identity_row.security_version
    AND session_row.workspace_security_version = workspace.security_version
    AND session_row.membership_authz_version = membership.authz_version
    AND user_row.status = 'ACTIVE'
    AND workspace.status = 'ACTIVE'
    AND (workspace.google_customer_id IS NULL
      OR workspace.google_customer_id = btrim(p_provider_customer_id))
    AND NOT EXISTS (
      SELECT 1 FROM uptech.workspaces AS other_workspace
      WHERE other_workspace.google_customer_id = btrim(p_provider_customer_id)
        AND other_workspace.workspace_id <> selected_workspace_id
    )
    AND identity_row.provider = 'GOOGLE'
    AND identity_row.issuer = 'https://accounts.google.com'
    AND identity_row.status = 'ACTIVE'
    AND identity_row.email_verified
    AND identity_row.provider_subject = btrim(p_provider_subject)
    AND lower(identity_row.hosted_domain_claim) = lower(btrim(p_hosted_domain))
    AND connector.purpose = 'DIRECTORY'
    AND connector.status IN ('AUTHORIZING', 'ACTIVE', 'DEGRADED')
  FOR UPDATE OF membership, session_row, user_row, identity_row, workspace, connector;

  IF selected_identity_id IS NULL
     OR (selected_role = 'ADMIN' AND EXISTS (
       SELECT 1 FROM uptech.connectors AS configured
       WHERE configured.workspace_id = selected_workspace_id
         AND configured.purpose = 'DIRECTORY'
         AND configured.status IN ('ACTIVE', 'DEGRADED')
         AND configured.provider_customer_id IS NOT NULL
         AND configured.credential_reference IS NOT NULL
         AND configured.directory_authorized_by_identity_id IS NOT NULL
     ) AND NOT uptech.has_current_people_authority_v1(
       selected_workspace_id, selected_actor_id, selected_identity_id,
       selected_membership_id
     )) THEN
    RETURN QUERY SELECT 'DENIED'::text, NULL::text;
    RETURN;
  END IF;

  SELECT service_actor.id INTO selected_service_actor_id
  FROM uptech.service_actors AS service_actor
  WHERE service_actor.workspace_id = selected_workspace_id
    AND service_actor.actor_kind = 'SYNC_WORKER'
    AND service_actor.status = 'ACTIVE'
  ORDER BY service_actor.id LIMIT 1 FOR KEY SHARE;
  IF selected_service_actor_id IS NULL THEN
    RETURN QUERY SELECT 'DENIED'::text, NULL::text;
    RETURN;
  END IF;

  UPDATE uptech.workspaces
     SET google_customer_id = COALESCE(google_customer_id,
           btrim(p_provider_customer_id)),
         updated_at = statement_timestamp()
   WHERE workspace_id = selected_workspace_id;

  UPDATE uptech.connectors
  SET provider_customer_id = btrim(p_provider_customer_id),
      credential_reference = btrim(p_credential_reference),
      directory_authorized_by_identity_id = selected_identity_id,
      directory_authorized_scopes = p_scopes,
      status = 'ACTIVE',
      security_version = security_version + 1,
      updated_at = statement_timestamp()
  WHERE workspace_id = selected_workspace_id AND id = p_connector_id;

  INSERT INTO uptech.sync_jobs (
    workspace_id, id, service_actor_id, connector_id, source_id,
    job_kind, status, dedupe_key, available_at
  )
  SELECT selected_workspace_id, gen_random_uuid(), selected_service_actor_id,
    p_connector_id, NULL, 'DIRECTORY_SYNC', 'QUEUED',
    'directory-sync:' || p_connector_id::text, statement_timestamp()
  WHERE NOT EXISTS (
    SELECT 1 FROM uptech.sync_jobs AS existing_job
    WHERE existing_job.workspace_id = selected_workspace_id
      AND existing_job.connector_id = p_connector_id
      AND existing_job.job_kind = 'DIRECTORY_SYNC'
      AND existing_job.status IN ('QUEUED', 'LEASED')
  ) ON CONFLICT DO NOTHING;

  INSERT INTO uptech.audit_events (
    workspace_id, id, actor_kind, actor_id, membership_id, session_id,
    action, target_type, target_id, outcome, request_id, metadata
  ) VALUES (
    selected_workspace_id, gen_random_uuid(), 'USER', selected_actor_id,
    selected_membership_id, selected_session_id, 'DIRECTORY_CONNECTOR_ACTIVATED',
    'CONNECTOR', p_connector_id, 'SUCCEEDED', p_request_id,
    jsonb_build_object('provider_customer_id', btrim(p_provider_customer_id))
  );
  RETURN QUERY SELECT 'ACTIVATED'::text,
    selected_previous_credential_reference;
EXCEPTION WHEN unique_violation THEN
  RETURN QUERY SELECT 'DENIED'::text, NULL::text;
END
$function$;

-- The dedicated Directory worker must never lease Drive work. This retains the
-- existing sync_jobs fencing and retry contract while narrowing the candidate
-- set to tenant-bound DIRECTORY_SYNC rows.
CREATE OR REPLACE FUNCTION uptech.lease_next_directory_job_v1()
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
SET search_path TO pg_catalog, uptech
AS $function$
  WITH lease_time AS (
    SELECT statement_timestamp() AS observed_at
  ),
  candidate AS (
    SELECT job.workspace_id, job.id
    FROM uptech.sync_jobs AS job
    JOIN uptech.workspaces AS workspace
      ON workspace.workspace_id = job.workspace_id
     AND workspace.status = 'ACTIVE'
    JOIN uptech.service_actors AS actor
      ON actor.workspace_id = job.workspace_id
     AND actor.id = job.service_actor_id
     AND actor.actor_kind = 'SYNC_WORKER'
     AND actor.status = 'ACTIVE'
    JOIN uptech.connectors AS connector
      ON connector.workspace_id = job.workspace_id
     AND connector.id = job.connector_id
     AND connector.purpose = 'DIRECTORY'
     AND connector.status IN ('ACTIVE', 'DEGRADED')
     AND connector.provider_customer_id = workspace.google_customer_id
     AND connector.credential_reference IS NOT NULL
     AND connector.directory_authorized_by_identity_id IS NOT NULL
     AND cardinality(connector.directory_authorized_scopes) = 4
    CROSS JOIN lease_time AS lease_time
    WHERE job.job_kind = 'DIRECTORY_SYNC'
      AND job.source_id IS NULL
      AND job.available_at <= lease_time.observed_at
      AND job.attempt_count < job.max_attempts
      AND (
        job.status = 'QUEUED'
        OR (job.status = 'LEASED' AND job.lease_expires_at <= lease_time.observed_at)
      )
    ORDER BY job.priority DESC, job.available_at, job.created_at,
      job.workspace_id, job.id
    FOR UPDATE OF job SKIP LOCKED
    LIMIT 1
  ),
  leased AS (
    UPDATE uptech.sync_jobs AS job
    SET status = 'LEASED',
        leased_at = lease_time.observed_at,
        lease_expires_at = lease_time.observed_at + interval '5 minutes',
        lease_owner = session_user::text,
        lease_fence = gen_random_uuid(),
        attempt_count = job.attempt_count + 1,
        updated_at = lease_time.observed_at
    FROM candidate
    CROSS JOIN lease_time
    WHERE job.workspace_id = candidate.workspace_id
      AND job.id = candidate.id
    RETURNING
      job.workspace_id,
      job.id AS job_id,
      job.job_kind,
      job.service_actor_id,
      job.connector_id,
      job.source_id,
      job.lease_fence,
      job.lease_expires_at
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

CREATE OR REPLACE FUNCTION uptech.begin_people_sync_generation_v1(
  p_workspace_id uuid,
  p_generation_id uuid,
  p_fence uuid,
  p_request_id uuid
)
RETURNS TABLE (outcome text, generation_id uuid, connector_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  selected_connector_id uuid;
  selected_actor_id uuid;
BEGIN
  IF p_workspace_id IS NULL OR p_generation_id IS NULL
     OR p_fence IS NULL OR p_request_id IS NULL THEN
    RETURN QUERY SELECT 'DENIED'::text, p_generation_id, NULL::uuid;
    RETURN;
  END IF;

  SELECT job.connector_id, job.service_actor_id
  INTO selected_connector_id, selected_actor_id
  FROM uptech.sync_jobs AS job
  JOIN uptech.connectors AS connector
    ON connector.workspace_id = job.workspace_id
   AND connector.id = job.connector_id
  JOIN uptech.workspaces AS workspace
    ON workspace.workspace_id = job.workspace_id
  JOIN uptech.service_actors AS actor
    ON actor.workspace_id=job.workspace_id AND actor.id=job.service_actor_id
  WHERE job.workspace_id = p_workspace_id
    AND job.id::text = NULLIF(current_setting('app.job_id', true), '')
    AND p_workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND p_fence::text = NULLIF(current_setting('app.lease_fence', true), '')
    AND job.job_kind = 'DIRECTORY_SYNC'
    AND job.source_id IS NULL
    AND job.status = 'LEASED'
    AND job.lease_owner = session_user::text
    AND job.lease_fence = p_fence
    AND job.lease_expires_at > statement_timestamp()
    AND connector.purpose = 'DIRECTORY'
    AND connector.status IN ('ACTIVE', 'DEGRADED')
    AND connector.provider_customer_id = workspace.google_customer_id
    AND connector.credential_reference IS NOT NULL
    AND connector.directory_authorized_by_identity_id IS NOT NULL
    AND cardinality(connector.directory_authorized_scopes) = 4
    AND workspace.status = 'ACTIVE'
    AND actor.status = 'ACTIVE'
  FOR UPDATE OF job;

  IF selected_connector_id IS NULL THEN
    RETURN QUERY SELECT 'DENIED'::text, p_generation_id, NULL::uuid;
    RETURN;
  END IF;

  INSERT INTO uptech.people_sync_generations (
    workspace_id, id, connector_id, job_id, lease_fence
  ) VALUES (
    p_workspace_id, p_generation_id, selected_connector_id,
    NULLIF(current_setting('app.job_id', true), '')::uuid, p_fence
  );

  INSERT INTO uptech.audit_events (
    workspace_id, id, actor_kind, actor_id, action, target_type,
    target_id, outcome, request_id, metadata
  ) VALUES (
    p_workspace_id, gen_random_uuid(), 'SERVICE', selected_actor_id,
    'PEOPLE_SYNC_STARTED', 'PEOPLE_SYNC_GENERATION', p_generation_id,
    'SUCCEEDED', p_request_id,
    jsonb_build_object('connector_id', selected_connector_id)
  );

  RETURN QUERY SELECT 'STARTED'::text, p_generation_id, selected_connector_id;
EXCEPTION
  WHEN unique_violation THEN
    RETURN QUERY SELECT 'CONCURRENT_LOSER'::text, p_generation_id, selected_connector_id;
END
$function$;

-- The worker may resolve only an opaque secret-provider reference after the
-- same lease and connector checks used by snapshot staging. Plaintext remains
-- exclusively inside the approved external SecretAdapter.
CREATE OR REPLACE FUNCTION uptech.resolve_directory_connector_credential_reference_v1()
RETURNS TABLE (credential_reference text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
BEGIN
  RETURN QUERY
  SELECT connector.credential_reference
  FROM uptech.sync_jobs AS job
  JOIN uptech.connectors AS connector
    ON connector.workspace_id = job.workspace_id
   AND connector.id = job.connector_id
  JOIN uptech.workspaces AS workspace
    ON workspace.workspace_id = job.workspace_id
  JOIN uptech.service_actors AS actor
    ON actor.workspace_id = job.workspace_id
   AND actor.id = job.service_actor_id
  WHERE job.id::text = NULLIF(current_setting('app.job_id', true), '')
    AND job.workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND job.connector_id::text = NULLIF(current_setting('app.connector_id', true), '')
    AND job.job_kind = 'DIRECTORY_SYNC'
    AND job.source_id IS NULL
    AND job.status = 'LEASED'
    AND job.lease_owner = session_user::text
    AND job.lease_fence::text = NULLIF(current_setting('app.lease_fence', true), '')
    AND job.lease_expires_at > statement_timestamp()
    AND connector.purpose = 'DIRECTORY'
    AND connector.status IN ('ACTIVE', 'DEGRADED')
    AND connector.provider_customer_id = workspace.google_customer_id
    AND connector.credential_reference IS NOT NULL
    AND connector.directory_authorized_by_identity_id IS NOT NULL
    AND cardinality(connector.directory_authorized_scopes) = 4
    AND connector.directory_authorized_scopes @> ARRAY[
      'https://www.googleapis.com/auth/admin.directory.customer.readonly',
      'https://www.googleapis.com/auth/admin.directory.user.readonly',
      'https://www.googleapis.com/auth/admin.directory.group.readonly',
      'https://www.googleapis.com/auth/admin.directory.orgunit.readonly'
    ]::text[]
    AND workspace.status = 'ACTIVE'
    AND actor.status = 'ACTIVE'
  FOR SHARE OF job, connector;
END
$function$;

CREATE OR REPLACE FUNCTION uptech.stage_people_profile_v1(
  p_workspace_id uuid,
  p_generation_id uuid,
  p_fence uuid,
  p_google_subject text,
  p_full_name text,
  p_primary_email text,
  p_department text,
  p_lifecycle_state text
)
RETURNS TABLE (outcome text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
BEGIN
  IF p_google_subject IS NULL OR p_full_name IS NULL OR p_primary_email IS NULL
     OR p_lifecycle_state IS NULL
     OR p_lifecycle_state NOT IN ('ACTIVE', 'SUSPENDED', 'DELETED')
     OR NOT EXISTS (
       SELECT 1
       FROM uptech.people_sync_generations AS generation
       JOIN uptech.sync_jobs AS job
         ON job.workspace_id = generation.workspace_id
        AND job.id = generation.job_id
       JOIN uptech.connectors AS connector
         ON connector.workspace_id = generation.workspace_id
        AND connector.id = generation.connector_id
        AND connector.id = job.connector_id
       JOIN uptech.workspaces AS workspace ON workspace.workspace_id=job.workspace_id
       JOIN uptech.service_actors AS actor
         ON actor.workspace_id=job.workspace_id AND actor.id=job.service_actor_id
       WHERE generation.workspace_id = p_workspace_id
         AND generation.id = p_generation_id
         AND generation.lease_fence = p_fence
         AND generation.status = 'RUNNING'
         AND p_workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
         AND job.id::text = NULLIF(current_setting('app.job_id', true), '')
         AND p_fence::text = NULLIF(current_setting('app.lease_fence', true), '')
         AND job.job_kind = 'DIRECTORY_SYNC'
         AND job.status = 'LEASED'
         AND job.lease_owner = session_user::text
         AND job.lease_fence = p_fence
         AND job.lease_expires_at > statement_timestamp()
         AND connector.purpose = 'DIRECTORY'
         AND connector.status IN ('ACTIVE', 'DEGRADED')
         AND connector.provider_customer_id = workspace.google_customer_id
         AND connector.credential_reference IS NOT NULL
         AND connector.directory_authorized_by_identity_id IS NOT NULL
         AND cardinality(connector.directory_authorized_scopes) = 4
         AND workspace.status='ACTIVE' AND actor.status='ACTIVE'
     ) THEN
    RETURN QUERY SELECT 'DENIED'::text;
    RETURN;
  END IF;

  INSERT INTO uptech.people_profiles (
    workspace_id, generation_id, google_subject, full_name,
    primary_email, department, lifecycle_state
  ) VALUES (
    p_workspace_id, p_generation_id, btrim(p_google_subject), btrim(p_full_name),
    lower(btrim(p_primary_email)), NULLIF(btrim(p_department), ''), p_lifecycle_state
  )
  ON CONFLICT (workspace_id, generation_id, google_subject) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    primary_email = EXCLUDED.primary_email,
    department = EXCLUDED.department,
    lifecycle_state = EXCLUDED.lifecycle_state,
    effective_role = NULL,
    effective_department_key = NULL;

  RETURN QUERY SELECT 'STAGED'::text;
EXCEPTION
  WHEN check_violation THEN
    RETURN QUERY SELECT 'DENIED'::text;
END
$function$;

CREATE OR REPLACE FUNCTION uptech.stage_people_profile_v2(
  p_workspace_id uuid, p_generation_id uuid, p_fence uuid,
  p_google_subject text, p_full_name text, p_primary_email text,
  p_department text, p_lifecycle_state text, p_org_unit_path text,
  p_google_is_admin boolean, p_google_is_delegated_admin boolean
)
RETURNS TABLE (outcome text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE staged text;
BEGIN
  -- Validate the v2-only fields before delegating to v1 so a rejected OU path
  -- cannot leave a partially staged base profile behind.
  IF p_org_unit_path IS NOT NULL
     AND length(btrim(p_org_unit_path)) NOT BETWEEN 1 AND 1024 THEN
    RETURN QUERY SELECT 'DENIED'::text;
    RETURN;
  END IF;

  SELECT result.outcome INTO staged FROM uptech.stage_people_profile_v1(
    p_workspace_id,p_generation_id,p_fence,p_google_subject,p_full_name,
    p_primary_email,p_department,p_lifecycle_state) AS result;
  IF staged <> 'STAGED' THEN RETURN QUERY SELECT staged; RETURN; END IF;
  UPDATE uptech.people_profiles
  SET org_unit_path = NULLIF(btrim(p_org_unit_path), ''),
      google_is_admin = p_google_is_admin,
      google_is_delegated_admin = p_google_is_delegated_admin
  WHERE workspace_id=p_workspace_id AND generation_id=p_generation_id
    AND google_subject=p_google_subject;
  RETURN QUERY SELECT 'STAGED'::text;
END
$function$;

CREATE OR REPLACE FUNCTION uptech.stage_people_directory_customer_v1(
  p_workspace_id uuid,p_generation_id uuid,p_fence uuid,
  p_google_customer_id text,p_primary_domain text
)
RETURNS TABLE (outcome text)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
  WITH staged AS (
    UPDATE uptech.people_sync_generations AS generation
    SET google_customer_id=btrim(p_google_customer_id), primary_domain=lower(btrim(p_primary_domain))
    FROM uptech.sync_jobs AS job
    JOIN uptech.connectors AS connector ON connector.workspace_id=job.workspace_id AND connector.id=job.connector_id
    JOIN uptech.workspaces AS workspace ON workspace.workspace_id=job.workspace_id
    JOIN uptech.service_actors AS actor
      ON actor.workspace_id=job.workspace_id AND actor.id=job.service_actor_id
    WHERE generation.workspace_id=p_workspace_id AND generation.id=p_generation_id
      AND generation.lease_fence=p_fence AND generation.status='RUNNING'
      AND job.workspace_id=generation.workspace_id AND job.id=generation.job_id
      AND job.id::text=NULLIF(current_setting('app.job_id',true),'')
      AND p_workspace_id::text=NULLIF(current_setting('app.workspace_id',true),'')
      AND p_fence::text=NULLIF(current_setting('app.lease_fence',true),'')
      AND job.job_kind='DIRECTORY_SYNC' AND job.source_id IS NULL
      AND job.status='LEASED' AND job.lease_owner=session_user::text AND job.lease_fence=p_fence
      AND job.lease_expires_at>statement_timestamp()
      AND connector.purpose='DIRECTORY' AND connector.status IN ('ACTIVE','DEGRADED')
      AND connector.provider_customer_id=workspace.google_customer_id
      AND connector.credential_reference IS NOT NULL
      AND connector.directory_authorized_by_identity_id IS NOT NULL
      AND cardinality(connector.directory_authorized_scopes)=4
      AND workspace.google_customer_id=btrim(p_google_customer_id)
      AND workspace.status='ACTIVE' AND actor.status='ACTIVE'
      AND length(btrim(p_primary_domain)) BETWEEN 1 AND 255
      AND EXISTS (
        SELECT 1
        FROM uptech.identities AS authorized_identity
        JOIN uptech.workspace_domain_locators AS locator
          ON locator.workspace_id = workspace.workspace_id
         AND locator.normalized_domain::text =
             lower(authorized_identity.hosted_domain_claim)
         AND locator.status = 'VERIFIED'
        WHERE authorized_identity.id =
              connector.directory_authorized_by_identity_id
          AND authorized_identity.provider = 'GOOGLE'
          AND authorized_identity.issuer = 'https://accounts.google.com'
          AND authorized_identity.status = 'ACTIVE'
          AND authorized_identity.email_verified
      )
    RETURNING 1
  )
  SELECT CASE WHEN EXISTS (SELECT 1 FROM staged) THEN 'STAGED' ELSE 'DENIED' END
$function$;

CREATE OR REPLACE FUNCTION uptech.stage_people_org_unit_v1(
  p_workspace_id uuid,p_generation_id uuid,p_fence uuid,
  p_google_org_unit_id text,p_org_unit_path text,p_parent_org_unit_id text
)
RETURNS TABLE (outcome text)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
  WITH authorized AS (
    SELECT 1 FROM uptech.people_sync_generations generation
    JOIN uptech.sync_jobs job ON job.workspace_id=generation.workspace_id AND job.id=generation.job_id
    JOIN uptech.connectors connector ON connector.workspace_id=job.workspace_id AND connector.id=job.connector_id
    JOIN uptech.workspaces workspace ON workspace.workspace_id=job.workspace_id
    JOIN uptech.service_actors actor ON actor.workspace_id=job.workspace_id AND actor.id=job.service_actor_id
    WHERE generation.workspace_id=p_workspace_id AND generation.id=p_generation_id
      AND generation.lease_fence=p_fence AND generation.status='RUNNING'
      AND job.id::text=NULLIF(current_setting('app.job_id',true),'')
      AND p_workspace_id::text=NULLIF(current_setting('app.workspace_id',true),'')
      AND p_fence::text=NULLIF(current_setting('app.lease_fence',true),'')
      AND job.job_kind='DIRECTORY_SYNC' AND job.source_id IS NULL
      AND job.status='LEASED' AND job.lease_owner=session_user::text AND job.lease_fence=p_fence
      AND job.lease_expires_at>statement_timestamp()
      AND connector.purpose='DIRECTORY' AND connector.status IN ('ACTIVE','DEGRADED')
      AND connector.provider_customer_id=workspace.google_customer_id
      AND connector.credential_reference IS NOT NULL
      AND connector.directory_authorized_by_identity_id IS NOT NULL
      AND cardinality(connector.directory_authorized_scopes)=4
      AND workspace.status='ACTIVE' AND actor.status='ACTIVE'
  ), staged AS (
    INSERT INTO uptech.people_org_units(workspace_id,generation_id,google_org_unit_id,org_unit_path,parent_org_unit_id)
    SELECT p_workspace_id,p_generation_id,btrim(p_google_org_unit_id),btrim(p_org_unit_path),NULLIF(btrim(p_parent_org_unit_id),'')
    FROM authorized WHERE length(btrim(p_google_org_unit_id)) BETWEEN 1 AND 512
      AND length(btrim(p_org_unit_path)) BETWEEN 1 AND 1024
    ON CONFLICT(workspace_id,generation_id,google_org_unit_id) DO UPDATE
      SET org_unit_path=EXCLUDED.org_unit_path,parent_org_unit_id=EXCLUDED.parent_org_unit_id
    RETURNING 1
  ) SELECT CASE WHEN EXISTS(SELECT 1 FROM staged) THEN 'STAGED' ELSE 'DENIED' END
$function$;

CREATE OR REPLACE FUNCTION uptech.stage_people_group_v1(
  p_workspace_id uuid,
  p_generation_id uuid,
  p_fence uuid,
  p_google_group_id text,
  p_group_name text
)
RETURNS TABLE (outcome text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
BEGIN
  IF p_google_group_id IS NULL OR p_group_name IS NULL OR NOT EXISTS (
    SELECT 1
    FROM uptech.people_sync_generations AS generation
    JOIN uptech.sync_jobs AS job
      ON job.workspace_id = generation.workspace_id AND job.id = generation.job_id
    JOIN uptech.connectors AS connector
      ON connector.workspace_id = generation.workspace_id
     AND connector.id = generation.connector_id AND connector.id = job.connector_id
    JOIN uptech.workspaces AS workspace ON workspace.workspace_id=job.workspace_id
    JOIN uptech.service_actors AS actor
      ON actor.workspace_id=job.workspace_id AND actor.id=job.service_actor_id
    WHERE generation.workspace_id = p_workspace_id
      AND generation.id = p_generation_id
      AND generation.lease_fence = p_fence
      AND generation.status = 'RUNNING'
      AND p_workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
      AND job.id::text = NULLIF(current_setting('app.job_id', true), '')
      AND p_fence::text = NULLIF(current_setting('app.lease_fence', true), '')
      AND job.job_kind = 'DIRECTORY_SYNC' AND job.source_id IS NULL
      AND job.status = 'LEASED'
      AND job.lease_owner = session_user::text AND job.lease_fence = p_fence
      AND job.lease_expires_at > statement_timestamp()
      AND connector.purpose = 'DIRECTORY' AND connector.status IN ('ACTIVE', 'DEGRADED')
      AND connector.provider_customer_id = workspace.google_customer_id
      AND connector.credential_reference IS NOT NULL
      AND connector.directory_authorized_by_identity_id IS NOT NULL
      AND cardinality(connector.directory_authorized_scopes) = 4
      AND workspace.status='ACTIVE' AND actor.status='ACTIVE'
  ) THEN
    RETURN QUERY SELECT 'DENIED'::text;
    RETURN;
  END IF;

  INSERT INTO uptech.people_groups (
    workspace_id, generation_id, google_group_id, group_name
  ) VALUES (
    p_workspace_id, p_generation_id, btrim(p_google_group_id), btrim(p_group_name)
  )
  ON CONFLICT (workspace_id, generation_id, google_group_id) DO UPDATE
  SET group_name = EXCLUDED.group_name;

  RETURN QUERY SELECT 'STAGED'::text;
EXCEPTION
  WHEN check_violation THEN
    RETURN QUERY SELECT 'DENIED'::text;
END
$function$;

CREATE OR REPLACE FUNCTION uptech.stage_people_group_membership_v1(
  p_workspace_id uuid,
  p_generation_id uuid,
  p_fence uuid,
  p_google_group_id text,
  p_google_subject text
)
RETURNS TABLE (outcome text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM uptech.people_sync_generations AS generation
    JOIN uptech.sync_jobs AS job
      ON job.workspace_id = generation.workspace_id AND job.id = generation.job_id
    JOIN uptech.connectors AS connector
      ON connector.workspace_id = generation.workspace_id
     AND connector.id = generation.connector_id AND connector.id = job.connector_id
    JOIN uptech.workspaces AS workspace ON workspace.workspace_id=job.workspace_id
    JOIN uptech.service_actors AS actor
      ON actor.workspace_id=job.workspace_id AND actor.id=job.service_actor_id
    JOIN uptech.people_groups AS people_group
      ON people_group.workspace_id = generation.workspace_id
     AND people_group.generation_id = generation.id
     AND people_group.google_group_id = p_google_group_id
    JOIN uptech.people_profiles AS profile
      ON profile.workspace_id = generation.workspace_id
     AND profile.generation_id = generation.id
     AND profile.google_subject = p_google_subject
    WHERE generation.workspace_id = p_workspace_id
      AND generation.id = p_generation_id
      AND generation.lease_fence = p_fence
      AND generation.status = 'RUNNING'
      AND p_workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
      AND job.id::text = NULLIF(current_setting('app.job_id', true), '')
      AND p_fence::text = NULLIF(current_setting('app.lease_fence', true), '')
      AND job.job_kind = 'DIRECTORY_SYNC' AND job.source_id IS NULL
      AND job.status = 'LEASED'
      AND job.lease_owner = session_user::text AND job.lease_fence = p_fence
      AND job.lease_expires_at > statement_timestamp()
      AND connector.purpose = 'DIRECTORY' AND connector.status IN ('ACTIVE', 'DEGRADED')
      AND connector.provider_customer_id = workspace.google_customer_id
      AND connector.credential_reference IS NOT NULL
      AND connector.directory_authorized_by_identity_id IS NOT NULL
      AND cardinality(connector.directory_authorized_scopes) = 4
      AND workspace.status='ACTIVE' AND actor.status='ACTIVE'
  ) THEN
    RETURN QUERY SELECT 'DENIED'::text;
    RETURN;
  END IF;

  INSERT INTO uptech.people_group_memberships (
    workspace_id, generation_id, google_group_id, google_subject
  ) VALUES (
    p_workspace_id, p_generation_id, p_google_group_id, p_google_subject
  ) ON CONFLICT DO NOTHING;

  RETURN QUERY SELECT 'STAGED'::text;
END
$function$;

CREATE OR REPLACE FUNCTION uptech.publish_people_sync_generation_v1(
  p_workspace_id uuid,
  p_generation_id uuid,
  p_fence uuid,
  p_traversal_complete boolean,
  p_fresh_until timestamptz,
  p_request_id uuid
)
RETURNS TABLE (outcome text, generation_id uuid, fresh_until timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  selected_connector_id uuid;
  selected_job_id uuid;
  selected_started_at timestamptz;
  selected_actor_id uuid;
  previous_generation_id uuid;
  directory_controls_authority boolean;
  observed_at timestamptz := clock_timestamp();
BEGIN
  SELECT generation.connector_id, job.id, generation.started_at,
    job.service_actor_id,
    workspace.provisioning_policy = 'GOOGLE_GROUP_CONTROLLED'
  INTO selected_connector_id, selected_job_id, selected_started_at,
    selected_actor_id, directory_controls_authority
  FROM uptech.people_sync_generations AS generation
  JOIN uptech.sync_jobs AS job
    ON job.workspace_id = generation.workspace_id AND job.id = generation.job_id
  JOIN uptech.connectors AS connector
    ON connector.workspace_id = generation.workspace_id
   AND connector.id = generation.connector_id AND connector.id = job.connector_id
  JOIN uptech.workspaces AS workspace ON workspace.workspace_id=job.workspace_id
  JOIN uptech.service_actors AS actor
    ON actor.workspace_id=job.workspace_id AND actor.id=job.service_actor_id
  WHERE generation.workspace_id = p_workspace_id
    AND generation.id = p_generation_id
    AND generation.lease_fence = p_fence
    AND generation.status = 'RUNNING'
    AND p_workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
    AND job.id::text = NULLIF(current_setting('app.job_id', true), '')
    AND p_fence::text = NULLIF(current_setting('app.lease_fence', true), '')
    AND job.job_kind = 'DIRECTORY_SYNC' AND job.status = 'LEASED'
    AND job.lease_owner = session_user::text AND job.lease_fence = p_fence
    AND job.lease_expires_at > statement_timestamp()
    AND connector.purpose = 'DIRECTORY' AND connector.status IN ('ACTIVE', 'DEGRADED')
    AND connector.provider_customer_id = workspace.google_customer_id
    AND connector.credential_reference IS NOT NULL
    AND connector.directory_authorized_by_identity_id IS NOT NULL
    AND cardinality(connector.directory_authorized_scopes) = 4
    AND generation.google_customer_id = workspace.google_customer_id
    AND EXISTS (
      SELECT 1
      FROM uptech.identities AS authorized_identity
      JOIN uptech.workspace_domain_locators AS locator
        ON locator.workspace_id = workspace.workspace_id
       AND locator.normalized_domain::text =
           lower(authorized_identity.hosted_domain_claim)
       AND locator.status = 'VERIFIED'
      WHERE authorized_identity.id =
            connector.directory_authorized_by_identity_id
        AND authorized_identity.provider = 'GOOGLE'
        AND authorized_identity.issuer = 'https://accounts.google.com'
        AND authorized_identity.status = 'ACTIVE'
        AND authorized_identity.email_verified
    )
    AND workspace.status='ACTIVE' AND actor.status='ACTIVE'
  FOR UPDATE OF generation, job, connector, workspace;

  IF selected_connector_id IS NULL OR p_traversal_complete IS NOT TRUE
     OR p_fresh_until IS NULL OR p_fresh_until <= observed_at
     OR p_fresh_until > observed_at + interval '5 minutes'
     OR p_request_id IS NULL THEN
    RETURN QUERY SELECT 'DENIED'::text, p_generation_id, NULL::timestamptz;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM uptech.people_sync_generations AS winner
    WHERE winner.workspace_id = p_workspace_id
      AND winner.status = 'PUBLISHED'
      AND winner.started_at > selected_started_at
  ) THEN
    UPDATE uptech.people_sync_generations
    SET status = 'SUPERSEDED', completed_at = observed_at
    WHERE workspace_id = p_workspace_id AND id = p_generation_id;
    RETURN QUERY SELECT 'CONCURRENT_LOSER'::text, p_generation_id, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT id INTO previous_generation_id
  FROM uptech.people_sync_generations
  WHERE workspace_id = p_workspace_id
    AND status = 'PUBLISHED';

  UPDATE uptech.people_profiles profile
  SET effective_role = CASE
        WHEN profile.lifecycle_state='ACTIVE' AND EXISTS (
          SELECT 1 FROM uptech.people_group_memberships edge
          JOIN uptech.people_permission_mappings mapping
            ON mapping.workspace_id=edge.workspace_id
           AND mapping.source_kind='ADMIN_GROUP'
           AND mapping.source_value=edge.google_group_id
           AND mapping.status='ACTIVE'
          WHERE edge.workspace_id=p_workspace_id
            AND edge.generation_id=p_generation_id
            AND edge.google_subject=profile.google_subject) THEN 'ADMIN'
        WHEN profile.lifecycle_state='ACTIVE' AND 1 = (
          SELECT count(DISTINCT candidate.target_department_key)
          FROM (
            SELECT mapping.target_department_key
            FROM uptech.people_permission_mappings mapping
            WHERE mapping.workspace_id=p_workspace_id
              AND mapping.source_kind='DEPARTMENT'
              AND mapping.source_value=lower(btrim(profile.department))
              AND mapping.status='ACTIVE'
            UNION ALL
            SELECT mapping.target_department_key
            FROM uptech.people_group_memberships edge
            JOIN uptech.people_permission_mappings mapping
              ON mapping.workspace_id=edge.workspace_id
             AND mapping.source_kind='GROUP'
             AND mapping.source_value=edge.google_group_id
             AND mapping.status='ACTIVE'
            WHERE edge.workspace_id=p_workspace_id
              AND edge.generation_id=p_generation_id
              AND edge.google_subject=profile.google_subject
          ) candidate
        ) THEN 'MEMBER'
        ELSE NULL END,
      effective_department_key = CASE
        WHEN profile.lifecycle_state='ACTIVE' AND NOT EXISTS (
          SELECT 1 FROM uptech.people_group_memberships edge
          JOIN uptech.people_permission_mappings mapping
            ON mapping.workspace_id=edge.workspace_id
           AND mapping.source_kind='ADMIN_GROUP'
           AND mapping.source_value=edge.google_group_id
           AND mapping.status='ACTIVE'
          WHERE edge.workspace_id=p_workspace_id
            AND edge.generation_id=p_generation_id
            AND edge.google_subject=profile.google_subject)
        THEN (
          SELECT min(candidate.target_department_key)
          FROM (
            SELECT mapping.target_department_key
            FROM uptech.people_permission_mappings mapping
            WHERE mapping.workspace_id=p_workspace_id
              AND mapping.source_kind='DEPARTMENT'
              AND mapping.source_value=lower(btrim(profile.department))
              AND mapping.status='ACTIVE'
            UNION ALL
            SELECT mapping.target_department_key
            FROM uptech.people_group_memberships edge
            JOIN uptech.people_permission_mappings mapping
              ON mapping.workspace_id=edge.workspace_id
             AND mapping.source_kind='GROUP'
             AND mapping.source_value=edge.google_group_id
             AND mapping.status='ACTIVE'
            WHERE edge.workspace_id=p_workspace_id
              AND edge.generation_id=p_generation_id
              AND edge.google_subject=profile.google_subject
          ) candidate
          HAVING count(DISTINCT candidate.target_department_key)=1
        ) ELSE NULL END
  WHERE profile.workspace_id=p_workspace_id AND profile.generation_id=p_generation_id;

  UPDATE uptech.people_sync_generations
  SET status = 'SUPERSEDED', completed_at = observed_at
  WHERE workspace_id = p_workspace_id
    AND status = 'PUBLISHED';

  UPDATE uptech.people_sync_generations
  SET status = 'PUBLISHED', traversal_complete = true,
      completed_at = observed_at, fresh_until = p_fresh_until
  WHERE workspace_id = p_workspace_id AND id = p_generation_id;

  -- Directory snapshots are informational for manually provisioned tenants.
  -- They may change login authority only for GOOGLE_GROUP_CONTROLLED tenants.
  IF directory_controls_authority THEN
    -- Only changed or ineligible memberships lose their sessions. Unchanged
    -- authorized members remain online across ordinary snapshot refreshes.
    WITH new_authority AS MATERIALIZED (
    SELECT membership.id AS membership_id, membership.role, membership.status,
      profile.lifecycle_state AS lifecycle_state,
      profile.effective_role,
      CASE WHEN membership.role='OWNER' THEN NULL::text
        ELSE profile.effective_department_key END AS department,
      CASE WHEN membership.role='OWNER'
                  AND profile.lifecycle_state='ACTIVE'
        THEN 'OWNER'
        ELSE COALESCE(profile.effective_role,membership.role) END AS target_role,
      CASE WHEN profile.lifecycle_state='DELETED' THEN 'DEPROVISIONED'
        WHEN profile.lifecycle_state='ACTIVE' AND (membership.role='OWNER'
          OR profile.effective_role IS NOT NULL) THEN 'ACTIVE' ELSE 'SUSPENDED' END AS target_status,
      old_profile.lifecycle_state AS old_lifecycle_state,
      old_profile.effective_role AS old_effective_role,
      CASE WHEN membership.role='OWNER' THEN NULL::text
        ELSE old_profile.effective_department_key END AS old_department
      ,COALESCE(ARRAY(
        SELECT edge.google_group_id
        FROM uptech.people_group_memberships edge
        WHERE edge.workspace_id=p_workspace_id
          AND edge.generation_id=p_generation_id
          AND edge.google_subject=profile.google_subject
        ORDER BY edge.google_group_id
      ), ARRAY[]::text[]) AS direct_group_ids
      ,COALESCE(ARRAY(
        SELECT edge.google_group_id
        FROM uptech.people_group_memberships edge
        WHERE edge.workspace_id=p_workspace_id
          AND edge.generation_id=previous_generation_id
          AND edge.google_subject=old_profile.google_subject
        ORDER BY edge.google_group_id
      ), ARRAY[]::text[]) AS old_direct_group_ids
    FROM uptech.workspace_memberships membership
    LEFT JOIN LATERAL (SELECT p.* FROM uptech.identities i JOIN uptech.people_profiles p
      ON p.workspace_id=p_workspace_id AND p.generation_id=p_generation_id AND p.google_subject=i.provider_subject
      WHERE i.user_id=membership.user_id AND i.provider='GOOGLE' AND i.issuer='https://accounts.google.com'
      ORDER BY i.id LIMIT 1) profile ON true
    LEFT JOIN LATERAL (SELECT p.* FROM uptech.identities i JOIN uptech.people_profiles p
      ON p.workspace_id=p_workspace_id AND p.generation_id=previous_generation_id AND p.google_subject=i.provider_subject
      WHERE i.user_id=membership.user_id AND i.provider='GOOGLE' AND i.issuer='https://accounts.google.com'
      ORDER BY i.id LIMIT 1) old_profile ON true
    WHERE membership.workspace_id=p_workspace_id
  ), affected AS (
    SELECT * FROM new_authority WHERE previous_generation_id IS NULL
      OR role IS DISTINCT FROM target_role OR status IS DISTINCT FROM target_status
      OR lifecycle_state IS DISTINCT FROM old_lifecycle_state
      OR (CASE WHEN role='OWNER' THEN 'OWNER' ELSE effective_role END) IS DISTINCT FROM
         (CASE WHEN role='OWNER' THEN 'OWNER' ELSE old_effective_role END)
      OR department IS DISTINCT FROM old_department
      OR (
        role <> 'OWNER'
        AND direct_group_ids IS DISTINCT FROM old_direct_group_ids
      )
  )
    UPDATE uptech.sessions session_row
    SET status = 'REVOKED', revoked_at = observed_at,
        revocation_reason = 'DIRECTORY_AUTHORIZATION_REFRESH',
        security_version = session_row.security_version + 1
    FROM affected
    WHERE session_row.workspace_id = p_workspace_id AND session_row.status = 'ACTIVE'
      AND session_row.membership_id = affected.membership_id;

    UPDATE uptech.session_tokens AS token
    SET token_status = 'REVOKED', revoked_at = observed_at,
        became_previous_at = NULL, previous_valid_until = NULL
    WHERE token.workspace_id = p_workspace_id
      AND token.token_status <> 'REVOKED'
      AND EXISTS (
        SELECT 1 FROM uptech.sessions AS session_row
        WHERE session_row.workspace_id = token.workspace_id
          AND session_row.id = token.session_id
          AND session_row.status = 'REVOKED'
          AND session_row.revocation_reason = 'DIRECTORY_AUTHORIZATION_REFRESH'
      );

    WITH authority AS MATERIALIZED (
    SELECT
      membership.id AS membership_id,
      profile.lifecycle_state AS lifecycle_state,
      CASE WHEN membership.role='OWNER' THEN NULL::text
        ELSE profile.effective_role END AS effective_role,
      CASE WHEN membership.role='OWNER' THEN NULL::text
        ELSE profile.effective_department_key END AS effective_department_key,
      old_profile.lifecycle_state AS old_lifecycle_state,
      CASE WHEN membership.role='OWNER' THEN NULL::text
        ELSE old_profile.effective_role END AS old_effective_role,
      CASE WHEN membership.role='OWNER' THEN NULL::text
        ELSE old_profile.effective_department_key END AS old_effective_department_key,
      COALESCE(ARRAY(
        SELECT edge.google_group_id
        FROM uptech.people_group_memberships edge
        WHERE edge.workspace_id=p_workspace_id
          AND edge.generation_id=p_generation_id
          AND edge.google_subject=profile.google_subject
        ORDER BY edge.google_group_id
      ), ARRAY[]::text[]) AS direct_group_ids,
      COALESCE(ARRAY(
        SELECT edge.google_group_id
        FROM uptech.people_group_memberships edge
        WHERE edge.workspace_id=p_workspace_id
          AND edge.generation_id=previous_generation_id
          AND edge.google_subject=old_profile.google_subject
        ORDER BY edge.google_group_id
      ), ARRAY[]::text[]) AS old_direct_group_ids,
      CASE
        WHEN membership.role = 'OWNER'
             AND profile.lifecycle_state = 'ACTIVE'
          THEN 'OWNER'
        ELSE profile.effective_role
      END AS resolved_role
    FROM uptech.workspace_memberships AS membership
    LEFT JOIN LATERAL (
      SELECT people_profile.*
      FROM uptech.identities AS identity_row
      JOIN uptech.people_profiles AS people_profile
        ON people_profile.workspace_id = p_workspace_id
       AND people_profile.generation_id = p_generation_id
       AND people_profile.google_subject = identity_row.provider_subject
      WHERE identity_row.user_id = membership.user_id
        AND identity_row.provider = 'GOOGLE'
        AND identity_row.issuer = 'https://accounts.google.com'
      ORDER BY identity_row.id
      LIMIT 1
    ) AS profile ON true
    LEFT JOIN LATERAL (
      SELECT people_profile.* FROM uptech.identities identity_row
      JOIN uptech.people_profiles people_profile
        ON people_profile.workspace_id=p_workspace_id
       AND people_profile.generation_id=previous_generation_id
       AND people_profile.google_subject=identity_row.provider_subject
      WHERE identity_row.user_id=membership.user_id AND identity_row.provider='GOOGLE'
        AND identity_row.issuer='https://accounts.google.com'
      ORDER BY identity_row.id LIMIT 1
    ) old_profile ON true
    WHERE membership.workspace_id = p_workspace_id
  )
    UPDATE uptech.workspace_memberships AS membership
    SET role = COALESCE(authority.resolved_role, membership.role),
        status = CASE
          WHEN authority.lifecycle_state = 'DELETED' THEN 'DEPROVISIONED'
          WHEN authority.resolved_role IS NOT NULL THEN 'ACTIVE'
          ELSE 'SUSPENDED'
        END,
        authz_version = membership.authz_version + CASE
          WHEN membership.role IS DISTINCT FROM COALESCE(authority.resolved_role,membership.role)
            OR membership.status IS DISTINCT FROM CASE
              WHEN authority.lifecycle_state='DELETED' THEN 'DEPROVISIONED'
              WHEN authority.resolved_role IS NOT NULL THEN 'ACTIVE' ELSE 'SUSPENDED' END
            OR EXISTS (SELECT 1 FROM uptech.sessions changed_session
              WHERE changed_session.workspace_id=membership.workspace_id
                AND changed_session.membership_id=membership.id
                AND changed_session.revocation_reason='DIRECTORY_AUTHORIZATION_REFRESH'
                AND changed_session.revoked_at=observed_at)
            OR authority.lifecycle_state IS DISTINCT FROM authority.old_lifecycle_state
            OR authority.effective_role IS DISTINCT FROM authority.old_effective_role
            OR authority.effective_department_key IS DISTINCT FROM authority.old_effective_department_key
            OR (
              membership.role <> 'OWNER'
              AND authority.direct_group_ids IS DISTINCT FROM authority.old_direct_group_ids
            )
          THEN 1 ELSE 0 END,
        updated_at = observed_at
    FROM authority
    WHERE membership.workspace_id = p_workspace_id
      AND membership.id = authority.membership_id;
  END IF;

  UPDATE uptech.workspaces
  SET permission_epoch = permission_epoch + 1, updated_at = observed_at
  WHERE workspace_id = p_workspace_id;

  INSERT INTO uptech.audit_events (
    workspace_id, id, actor_kind, actor_id, action, target_type,
    target_id, outcome, request_id, metadata
  ) VALUES (
    p_workspace_id, gen_random_uuid(), 'SERVICE', selected_actor_id,
    'PEOPLE_SYNC_PUBLISHED', 'PEOPLE_SYNC_GENERATION', p_generation_id,
    'SUCCEEDED', p_request_id,
    jsonb_build_object('connector_id', selected_connector_id)
  );

  UPDATE uptech.sync_jobs AS job
  SET status = 'QUEUED',
      available_at = GREATEST(observed_at, p_fresh_until - interval '1 minute'),
      attempt_count = 0,
      leased_at = NULL,
      lease_expires_at = NULL,
      lease_owner = NULL,
      lease_fence = NULL,
      completed_at = NULL,
      last_error_code = NULL,
      updated_at = observed_at
  WHERE job.workspace_id = p_workspace_id
    AND job.id = selected_job_id
    AND job.status = 'LEASED'
    AND job.lease_fence = p_fence;

  RETURN QUERY SELECT 'PUBLISHED'::text, p_generation_id, p_fresh_until;
END
$function$;

CREATE OR REPLACE FUNCTION uptech.load_people_permission_context_v1()
RETURNS TABLE (
  workspace_id uuid,
  membership_role text,
  department_key text,
  direct_group_ids text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
  WITH candidate AS MATERIALIZED (
    SELECT
      membership.workspace_id,
      membership.role AS membership_role,
      workspace.provisioning_policy,
      profile.google_subject,
      profile.effective_role,
      profile.effective_department_key,
      generation.id AS generation_id,
      COALESCE(ARRAY(
        SELECT edge.google_group_id
        FROM uptech.people_group_memberships AS edge
        WHERE edge.workspace_id = membership.workspace_id
          AND edge.generation_id = generation.id
          AND edge.google_subject = profile.google_subject
        ORDER BY edge.google_group_id
      ), ARRAY[]::text[]) AS direct_group_ids
    FROM uptech.workspace_memberships AS membership
    JOIN uptech.sessions AS session_row
      ON session_row.workspace_id = membership.workspace_id
     AND session_row.membership_id = membership.id
     AND session_row.user_id = membership.user_id
    JOIN uptech.users AS user_row ON user_row.id = membership.user_id
    JOIN uptech.identities AS identity_row
      ON identity_row.id = session_row.identity_id
     AND identity_row.user_id = membership.user_id
     AND identity_row.provider = 'GOOGLE'
     AND identity_row.issuer = 'https://accounts.google.com'
    JOIN uptech.workspaces AS workspace
      ON workspace.workspace_id = membership.workspace_id
    LEFT JOIN uptech.people_sync_generations AS generation
      ON generation.workspace_id = membership.workspace_id
     AND workspace.provisioning_policy = 'GOOGLE_GROUP_CONTROLLED'
     AND generation.status = 'PUBLISHED'
     AND generation.traversal_complete
     AND generation.fresh_until > statement_timestamp()
     AND generation.google_customer_id = workspace.google_customer_id
    LEFT JOIN uptech.connectors AS directory_connector
      ON directory_connector.workspace_id=generation.workspace_id
     AND directory_connector.id=generation.connector_id
     AND directory_connector.purpose='DIRECTORY'
     AND directory_connector.status IN ('ACTIVE','DEGRADED')
     AND directory_connector.provider_customer_id = workspace.google_customer_id
     AND directory_connector.credential_reference IS NOT NULL
     AND directory_connector.directory_authorized_by_identity_id IS NOT NULL
     AND cardinality(directory_connector.directory_authorized_scopes) = 4
     AND EXISTS (
       SELECT 1
       FROM uptech.identities AS authorized_identity
       JOIN uptech.workspace_domain_locators AS locator
         ON locator.workspace_id = workspace.workspace_id
        AND locator.normalized_domain::text =
            lower(authorized_identity.hosted_domain_claim)
        AND locator.status = 'VERIFIED'
       WHERE authorized_identity.id =
             directory_connector.directory_authorized_by_identity_id
         AND authorized_identity.provider = 'GOOGLE'
         AND authorized_identity.issuer = 'https://accounts.google.com'
         AND authorized_identity.status = 'ACTIVE'
         AND authorized_identity.email_verified
     )
    LEFT JOIN uptech.people_profiles AS profile
      ON profile.workspace_id = generation.workspace_id
     AND profile.generation_id = generation.id
     AND profile.google_subject = identity_row.provider_subject
     AND profile.lifecycle_state = 'ACTIVE'
     AND directory_connector.id IS NOT NULL
    WHERE membership.workspace_id::text = NULLIF(current_setting('app.workspace_id', true), '')
      AND membership.id::text = NULLIF(current_setting('app.membership_id', true), '')
      AND membership.user_id::text = NULLIF(current_setting('app.actor_id', true), '')
      AND session_row.id::text = NULLIF(current_setting('app.session_id', true), '')
      AND membership.status = 'ACTIVE'
      AND session_row.status = 'ACTIVE' AND session_row.revoked_at IS NULL
      AND session_row.idle_expires_at > statement_timestamp()
      AND session_row.absolute_expires_at > statement_timestamp()
      AND user_row.status = 'ACTIVE' AND identity_row.status = 'ACTIVE'
      AND workspace.status = 'ACTIVE'
      AND session_row.user_security_version = user_row.security_version
      AND session_row.identity_security_version = identity_row.security_version
      AND session_row.workspace_security_version = workspace.security_version
      AND session_row.membership_authz_version = membership.authz_version
  )
  SELECT
    candidate.workspace_id,candidate.membership_role,
    CASE WHEN candidate.provisioning_policy='GOOGLE_GROUP_CONTROLLED'
          AND candidate.membership_role='MEMBER'
      THEN candidate.effective_department_key ELSE NULL::text END,
    CASE WHEN candidate.provisioning_policy='GOOGLE_GROUP_CONTROLLED'
      THEN candidate.direct_group_ids ELSE ARRAY[]::text[] END
  FROM candidate
  WHERE candidate.provisioning_policy='INVITE_ONLY'
     OR (
       candidate.provisioning_policy='GOOGLE_GROUP_CONTROLLED'
       AND (
         (candidate.membership_role='OWNER' AND candidate.google_subject IS NOT NULL)
         OR (candidate.membership_role='ADMIN' AND candidate.effective_role='ADMIN')
         OR (candidate.membership_role='MEMBER' AND candidate.effective_role='MEMBER'
           AND candidate.effective_department_key IS NOT NULL)
       )
     )
$function$;

-- Shared, internal authority predicate for Web and native-session issuance.
-- INVITE_ONLY trusts an existing active UPTECH membership. The compatibility
-- policy GOOGLE_GROUP_CONTROLLED is the Directory-controlled mode and remains
-- fail-closed unless its published generation is complete and fresh.
CREATE OR REPLACE FUNCTION uptech.has_current_people_authority_v1(
  p_workspace_id uuid,
  p_user_id uuid,
  p_identity_id uuid,
  p_membership_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM uptech.workspace_memberships AS membership
    JOIN uptech.users AS user_row
      ON user_row.id = membership.user_id
    JOIN uptech.identities AS identity_row
      ON identity_row.id = p_identity_id
     AND identity_row.user_id = membership.user_id
     AND identity_row.provider = 'GOOGLE'
     AND identity_row.issuer = 'https://accounts.google.com'
    JOIN uptech.workspaces AS workspace
      ON workspace.workspace_id = membership.workspace_id
    WHERE membership.workspace_id = p_workspace_id
      AND membership.id = p_membership_id
      AND membership.user_id = p_user_id
      AND membership.status = 'ACTIVE'
      AND user_row.status = 'ACTIVE'
      AND identity_row.status = 'ACTIVE'
      AND workspace.status = 'ACTIVE'
      AND (
        workspace.provisioning_policy = 'INVITE_ONLY'
        OR (
          workspace.provisioning_policy = 'GOOGLE_GROUP_CONTROLLED'
          AND EXISTS (
          SELECT 1
          FROM uptech.people_sync_generations AS generation
          JOIN uptech.connectors AS directory_connector
            ON directory_connector.workspace_id = generation.workspace_id
           AND directory_connector.id = generation.connector_id
          JOIN uptech.people_profiles AS profile
            ON profile.workspace_id = generation.workspace_id
           AND profile.generation_id = generation.id
           AND profile.google_subject = identity_row.provider_subject
          WHERE generation.workspace_id = membership.workspace_id
            AND generation.status = 'PUBLISHED'
            AND generation.traversal_complete
            AND generation.fresh_until > statement_timestamp()
            AND generation.google_customer_id = workspace.google_customer_id
            AND EXISTS (
              SELECT 1
              FROM uptech.identities AS authorized_identity
              JOIN uptech.workspace_domain_locators AS locator
                ON locator.workspace_id = workspace.workspace_id
               AND locator.normalized_domain::text =
                   lower(authorized_identity.hosted_domain_claim)
               AND locator.status = 'VERIFIED'
              WHERE authorized_identity.id =
                    directory_connector.directory_authorized_by_identity_id
                AND authorized_identity.provider = 'GOOGLE'
                AND authorized_identity.issuer = 'https://accounts.google.com'
                AND authorized_identity.status = 'ACTIVE'
                AND authorized_identity.email_verified
            )
            AND directory_connector.purpose = 'DIRECTORY'
            AND directory_connector.status IN ('ACTIVE', 'DEGRADED')
            AND directory_connector.provider_customer_id = workspace.google_customer_id
            AND directory_connector.credential_reference IS NOT NULL
            AND directory_connector.directory_authorized_by_identity_id IS NOT NULL
            AND cardinality(directory_connector.directory_authorized_scopes) = 4
            AND directory_connector.directory_authorized_scopes @> ARRAY[
              'https://www.googleapis.com/auth/admin.directory.customer.readonly',
              'https://www.googleapis.com/auth/admin.directory.user.readonly',
              'https://www.googleapis.com/auth/admin.directory.group.readonly',
              'https://www.googleapis.com/auth/admin.directory.orgunit.readonly'
            ]::text[]
            AND profile.lifecycle_state = 'ACTIVE'
            AND (
              membership.role = 'OWNER'
              OR (membership.role = 'ADMIN'
                AND profile.effective_role = 'ADMIN'
                AND profile.effective_department_key IS NULL)
              OR
              (membership.role = 'MEMBER'
                AND profile.effective_role = 'MEMBER'
                AND profile.effective_department_key IN ('SALES', 'HR', 'IT', 'FINANCE'))
            )
          )
        )
      )
  )
$function$;

-- Keep the established OIDC completion routine as the sole identity/session
-- issuer, but make its successful effects conditional on current Directory
-- authority. The nested block is a PostgreSQL subtransaction: an unauthorized
-- NORMAL result rolls back any JIT user, membership, session, token and success
-- audit writes before the outer block records the safe rejection.
CREATE OR REPLACE FUNCTION uptech.complete_web_google_login_directory_v1(
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
  internal_result uptech.google_login_completion_result_v2;
  selected_workspace_id uuid;
  selected_user_id uuid;
  selected_identity_id uuid;
  selected_membership_id uuid;
  directory_denied boolean := false;
BEGIN
  BEGIN
    internal_result := uptech.complete_web_google_login_v1(
      p_completion_handle_hash,
      p_claims,
      p_session_token_hash,
      p_csrf_token_hash,
      p_onboarding_token_hash,
      p_request_id
    );

    IF (internal_result).outcome = 'NORMAL' THEN
      SELECT
        session_row.workspace_id,
        session_row.user_id,
        session_row.identity_id,
        session_row.membership_id
      INTO
        selected_workspace_id,
        selected_user_id,
        selected_identity_id,
        selected_membership_id
      FROM uptech.session_tokens AS token
      JOIN uptech.sessions AS session_row
        ON session_row.workspace_id = token.workspace_id
       AND session_row.id = token.session_id
      WHERE token.token_hash = p_session_token_hash
        AND token.client_type = 'WEB'
        AND token.token_kind = 'WEB_SESSION'
        AND token.token_status = 'CURRENT'
        AND session_row.client_type = 'WEB'
        AND session_row.status = 'ACTIVE';

      IF selected_workspace_id IS NULL
         OR NOT uptech.has_current_people_authority_v1(
           selected_workspace_id,
           selected_user_id,
           selected_identity_id,
           selected_membership_id
         ) THEN
        RAISE EXCEPTION USING
          ERRCODE = 'PT001',
          MESSAGE = 'Directory authority is not current';
      END IF;
    END IF;
  EXCEPTION
    WHEN SQLSTATE 'PT001' THEN
      directory_denied := true;
  END;

  IF directory_denied THEN
    PERFORM uptech.record_google_login_rejection_v1(
      p_completion_handle_hash,
      'IDENTITY_INELIGIBLE'::uptech.google_auth_rejection_class_v1,
      p_request_id
    );
    RETURN ROW(
      'DENIED'::uptech.google_login_completion_outcome_v1,
      NULL::uptech.google_login_access_state_v1,
      NULL::text[],
      NULL::timestamptz
    )::uptech.google_login_completion_result_v2;
  END IF;

  RETURN internal_result;
END
$function$;

-- Apply the same rollback-before-denial rule to native callback completion so
-- an unmapped Directory subject cannot leave a JIT membership or consumed
-- invitation behind before the one-time handoff is exchanged.
CREATE OR REPLACE FUNCTION uptech.complete_mobile_google_callback_directory_v1(
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
  internal_result uptech.mobile_callback_result_v1;
  selected_handoff uptech.mobile_handoffs%ROWTYPE;
  directory_denied boolean := false;
BEGIN
  BEGIN
    internal_result := uptech.complete_mobile_google_callback_v1(
      p_completion_handle_hash, p_claims, p_handoff_hash, p_request_id
    );
    IF (internal_result).outcome = 'NORMAL' THEN
      SELECT handoff.* INTO selected_handoff
      FROM uptech.mobile_handoffs handoff
      WHERE handoff.handoff_hash=p_handoff_hash
        AND handoff.status='ACTIVE';
      IF selected_handoff.id IS NULL
         OR NOT uptech.has_current_people_authority_v1(
           selected_handoff.workspace_id,
           selected_handoff.user_id,
           selected_handoff.identity_id,
           selected_handoff.membership_id
         ) THEN
        RAISE EXCEPTION USING ERRCODE='PT002',
          MESSAGE='Directory authority is not current';
      END IF;
    END IF;
  EXCEPTION WHEN SQLSTATE 'PT002' THEN
    directory_denied := true;
  END;

  IF directory_denied THEN
    RETURN uptech.complete_mobile_google_denial_v1(
      p_completion_handle_hash,
      p_handoff_hash,
      'IDENTITY_INELIGIBLE'::uptech.google_auth_rejection_class_v1,
      'USER_NOT_PROVISIONED'::uptech.mobile_auth_ui_category_v1,
      p_request_id
    );
  END IF;
  RETURN internal_result;
END
$function$;

CREATE OR REPLACE FUNCTION uptech.mobile_directory_memberships_json_v1(
  p_user_id uuid,
  p_identity_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'workspace_id', membership.workspace_id,
        'membership_id', membership.id,
        'role', membership.role
      ) ORDER BY membership.workspace_id
    ),
    '[]'::jsonb
  )
  FROM uptech.workspace_memberships AS membership
  WHERE membership.user_id = p_user_id
    AND uptech.has_current_people_authority_v1(
      membership.workspace_id,
      p_user_id,
      p_identity_id,
      membership.id
    )
$function$;

CREATE OR REPLACE FUNCTION uptech.exchange_mobile_handoff_directory_v1(
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
  selected_handoff uptech.mobile_handoffs%ROWTYPE;
  legacy_result uptech.mobile_handoff_exchange_result_v2;
  observed_at timestamptz := clock_timestamp();
BEGIN
  SELECT handoff.*
  INTO selected_handoff
  FROM uptech.mobile_handoffs AS handoff
  WHERE handoff.handoff_hash = p_handoff_hash
  FOR UPDATE;

  -- Authenticated denial handoffs contain no user authority and retain their
  -- one-time typed denial behavior in the existing v2 exchange routine.
  IF selected_handoff.id IS NULL
     OR selected_handoff.denial_category IS NOT NULL
     OR selected_handoff.status <> 'ACTIVE'
     OR selected_handoff.expires_at <= observed_at
     OR selected_handoff.app_exchange_challenge <> p_app_exchange_challenge
     OR selected_handoff.installation_binding_hash <> p_installation_binding_hash
     OR p_request_id IS NULL THEN
    RETURN uptech.exchange_mobile_handoff_v2(
      p_network_hmac, p_handoff_hash, p_app_exchange_challenge,
      p_installation_binding_hash, p_access_hash, p_refresh_hash, p_request_id
    );
  END IF;

  -- Serialize session issuance and the returned tenant list with Directory
  -- publication, which locks the same workspace rows before revocation.
  PERFORM workspace.workspace_id
  FROM uptech.workspaces AS workspace
  JOIN uptech.workspace_memberships AS membership
    ON membership.workspace_id = workspace.workspace_id
  WHERE membership.user_id = selected_handoff.user_id
  ORDER BY workspace.workspace_id
  FOR SHARE OF workspace;

  IF NOT uptech.has_current_people_authority_v1(
    selected_handoff.workspace_id,
    selected_handoff.user_id,
    selected_handoff.identity_id,
    selected_handoff.membership_id
  ) THEN
    IF NOT uptech.mobile_google_auth_admit_internal_v1(
      p_network_hmac, p_request_id
    ) THEN
      RETURN ROW(
        'RATE_LIMITED', NULL, NULL, NULL, NULL, NULL,
        NULL::uptech.mobile_auth_ui_category_v1
      )::uptech.mobile_handoff_exchange_result_v2;
    END IF;
    UPDATE uptech.mobile_handoffs
    SET status = 'CONSUMED', consumed_at = observed_at
    WHERE id = selected_handoff.id AND status = 'ACTIVE';
    INSERT INTO uptech.platform_audit_events (
      id, identity_id, action, target_type, outcome, request_id, metadata, occurred_at
    ) VALUES (
      gen_random_uuid(), selected_handoff.identity_id,
      'MOBILE_DIRECTORY_AUTHORITY_DENIED', 'MOBILE_HANDOFF', 'DENIED', p_request_id,
      jsonb_build_object(
        'correlation_id', selected_handoff.transaction_id,
        'workspace_id', selected_handoff.workspace_id
      ), observed_at
    );
    RETURN ROW(
      'DENIED', NULL, NULL, NULL, NULL, NULL,
      NULL::uptech.mobile_auth_ui_category_v1
    )::uptech.mobile_handoff_exchange_result_v2;
  END IF;

  legacy_result := uptech.exchange_mobile_handoff_v2(
    p_network_hmac, p_handoff_hash, p_app_exchange_challenge,
    p_installation_binding_hash, p_access_hash, p_refresh_hash, p_request_id
  );
  IF (legacy_result).outcome <> 'ISSUED' THEN
    RETURN legacy_result;
  END IF;
  RETURN ROW(
    (legacy_result).outcome,
    (legacy_result).session_id,
    (legacy_result).access_expires_at,
    (legacy_result).refresh_expires_at,
    (legacy_result).active_workspace_id,
    uptech.mobile_directory_memberships_json_v1(
      selected_handoff.user_id, selected_handoff.identity_id
    ),
    (legacy_result).denial_category
  )::uptech.mobile_handoff_exchange_result_v2;
END
$function$;

CREATE OR REPLACE FUNCTION uptech.authenticate_mobile_access_directory_v1(
  p_access_hash uptech.google_auth_hash32_v1
)
RETURNS uptech.mobile_auth_result_v1
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  candidate record;
  legacy_result uptech.mobile_auth_result_v1;
  observed_at timestamptz := clock_timestamp();
BEGIN
  SELECT session_row.workspace_id, session_row.id AS session_id,
    session_row.user_id, session_row.identity_id, session_row.membership_id
  INTO candidate
  FROM uptech.session_tokens AS token
  JOIN uptech.sessions AS session_row
    ON session_row.workspace_id = token.workspace_id
   AND session_row.id = token.session_id
  WHERE token.token_hash = p_access_hash
    AND token.token_kind = 'NATIVE_ACCESS'
    AND token.client_type = 'NATIVE';

  IF candidate.session_id IS NOT NULL THEN
    PERFORM workspace_id FROM uptech.workspaces
    WHERE workspace_id = candidate.workspace_id
    FOR SHARE;
  END IF;

  legacy_result := uptech.authenticate_mobile_access_v1(p_access_hash);
  IF (legacy_result).outcome <> 'AUTHORIZED' THEN
    RETURN legacy_result;
  END IF;
  IF uptech.has_current_people_authority_v1(
    (legacy_result).workspace_id,
    (legacy_result).user_id,
    (legacy_result).identity_id,
    (legacy_result).membership_id
  ) THEN
    RETURN legacy_result;
  END IF;

  UPDATE uptech.sessions
  SET status = 'REVOKED', revoked_at = observed_at,
      revocation_reason = 'DIRECTORY_AUTHORIZATION_STALE',
      security_version = security_version + 1
  WHERE workspace_id = (legacy_result).workspace_id
    AND id = (legacy_result).session_id
    AND status = 'ACTIVE';
  UPDATE uptech.session_tokens
  SET token_status = 'REVOKED', revoked_at = observed_at,
      became_previous_at = NULL, previous_valid_until = NULL
  WHERE workspace_id = (legacy_result).workspace_id
    AND session_id = (legacy_result).session_id
    AND token_status <> 'REVOKED';
  RETURN ROW(
    'SESSION_REVOKED', NULL, NULL, NULL, NULL, NULL, NULL
  )::uptech.mobile_auth_result_v1;
END
$function$;

CREATE OR REPLACE FUNCTION uptech.list_mobile_workspaces_directory_v1(
  p_access_hash uptech.google_auth_hash32_v1
)
RETURNS uptech.mobile_membership_list_result_v1
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  auth_result uptech.mobile_auth_result_v1;
BEGIN
  auth_result := uptech.authenticate_mobile_access_directory_v1(p_access_hash);
  IF (auth_result).outcome <> 'AUTHORIZED' THEN
    RETURN ROW(
      (auth_result).outcome, NULL
    )::uptech.mobile_membership_list_result_v1;
  END IF;

  PERFORM workspace.workspace_id
  FROM uptech.workspaces AS workspace
  JOIN uptech.workspace_memberships AS membership
    ON membership.workspace_id = workspace.workspace_id
  WHERE membership.user_id = (auth_result).user_id
  ORDER BY workspace.workspace_id
  FOR SHARE OF workspace;

  RETURN ROW(
    'AUTHORIZED',
    uptech.mobile_directory_memberships_json_v1(
      (auth_result).user_id, (auth_result).identity_id
    )
  )::uptech.mobile_membership_list_result_v1;
END
$function$;

CREATE OR REPLACE FUNCTION uptech.rotate_mobile_refresh_directory_v1(
  p_predecessor_hash uptech.google_auth_hash32_v1,
  p_installation_hash uptech.google_auth_hash32_v1,
  p_access_hash uptech.google_auth_hash32_v1,
  p_refresh_hash uptech.google_auth_hash32_v1,
  p_replay_capsule bytea,
  p_idempotency_key uptech.google_auth_ascii_identifier_v1,
  p_request_id uuid
)
RETURNS uptech.mobile_refresh_result_v1
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  candidate record;
  observed_at timestamptz := clock_timestamp();
BEGIN
  SELECT session_row.workspace_id, session_row.id AS session_id,
    session_row.user_id, session_row.identity_id, session_row.membership_id
  INTO candidate
  FROM uptech.session_tokens AS token
  JOIN uptech.sessions AS session_row
    ON session_row.workspace_id = token.workspace_id
   AND session_row.id = token.session_id
  WHERE token.token_hash = p_predecessor_hash
    AND token.token_kind = 'NATIVE_REFRESH'
    AND token.client_type = 'NATIVE';

  IF candidate.session_id IS NULL THEN
    RETURN uptech.rotate_mobile_refresh_v1(
      p_predecessor_hash, p_installation_hash, p_access_hash, p_refresh_hash,
      p_replay_capsule, p_idempotency_key, p_request_id
    );
  END IF;

  PERFORM workspace_id FROM uptech.workspaces
  WHERE workspace_id = candidate.workspace_id
  FOR SHARE;
  IF NOT uptech.has_current_people_authority_v1(
    candidate.workspace_id,
    candidate.user_id,
    candidate.identity_id,
    candidate.membership_id
  ) THEN
    UPDATE uptech.sessions
    SET status = 'REVOKED', revoked_at = observed_at,
        revocation_reason = 'DIRECTORY_AUTHORIZATION_STALE',
        security_version = security_version + 1
    WHERE workspace_id = candidate.workspace_id
      AND id = candidate.session_id
      AND status = 'ACTIVE';
    UPDATE uptech.session_tokens
    SET token_status = 'REVOKED', revoked_at = observed_at,
        became_previous_at = NULL, previous_valid_until = NULL
    WHERE workspace_id = candidate.workspace_id
      AND session_id = candidate.session_id
      AND token_status <> 'REVOKED';
    RETURN ROW(
      'SESSION_REVOKED', NULL, NULL, NULL
    )::uptech.mobile_refresh_result_v1;
  END IF;

  RETURN uptech.rotate_mobile_refresh_v1(
    p_predecessor_hash, p_installation_hash, p_access_hash, p_refresh_hash,
    p_replay_capsule, p_idempotency_key, p_request_id
  );
END
$function$;

CREATE OR REPLACE FUNCTION uptech.switch_mobile_workspace_directory_v1(
  p_access_hash uptech.google_auth_hash32_v1,
  p_target_workspace_id uuid,
  p_installation_hash uptech.google_auth_hash32_v1,
  p_new_access_hash uptech.google_auth_hash32_v1,
  p_new_refresh_hash uptech.google_auth_hash32_v1,
  p_replay_capsule bytea,
  p_idempotency_key uptech.google_auth_ascii_identifier_v1,
  p_request_id uuid
)
RETURNS uptech.mobile_rotation_result_v1
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO pg_catalog, uptech
AS $function$
DECLARE
  source_session record;
  target_membership_id uuid;
  replay_session record;
BEGIN
  SELECT session_row.workspace_id, session_row.user_id,
    session_row.identity_id, session_row.membership_id
  INTO replay_session
  FROM uptech.mobile_workspace_switch_replay_receipts AS receipt
  JOIN uptech.sessions AS session_row
    ON session_row.workspace_id = receipt.target_workspace_id
   AND session_row.id = receipt.successor_session_id
  WHERE receipt.predecessor_access_hash = p_access_hash;

  IF replay_session.workspace_id IS NOT NULL THEN
    PERFORM workspace_id FROM uptech.workspaces
    WHERE workspace_id = replay_session.workspace_id
    FOR SHARE;
    IF NOT uptech.has_current_people_authority_v1(
      replay_session.workspace_id,
      replay_session.user_id,
      replay_session.identity_id,
      replay_session.membership_id
    ) THEN
      RETURN ROW(
        'DENIED', NULL, NULL, NULL
      )::uptech.mobile_rotation_result_v1;
    END IF;
    RETURN uptech.switch_mobile_workspace_v1(
      p_access_hash, p_target_workspace_id, p_installation_hash,
      p_new_access_hash, p_new_refresh_hash, p_replay_capsule,
      p_idempotency_key, p_request_id
    );
  END IF;

  SELECT session_row.workspace_id, session_row.user_id,
    session_row.identity_id, session_row.membership_id
  INTO source_session
  FROM uptech.session_tokens AS token
  JOIN uptech.sessions AS session_row
    ON session_row.workspace_id = token.workspace_id
   AND session_row.id = token.session_id
  WHERE token.token_hash = p_access_hash
    AND token.token_kind = 'NATIVE_ACCESS'
    AND token.client_type = 'NATIVE';

  PERFORM workspace_id
  FROM uptech.workspaces
  WHERE workspace_id = ANY (
    ARRAY[source_session.workspace_id, p_target_workspace_id]::uuid[]
  )
  ORDER BY workspace_id
  FOR SHARE;

  SELECT membership.id
  INTO target_membership_id
  FROM uptech.workspace_memberships AS membership
  WHERE membership.workspace_id = p_target_workspace_id
    AND membership.user_id = source_session.user_id
    AND membership.status = 'ACTIVE';

  IF source_session.workspace_id IS NULL
     OR NOT uptech.has_current_people_authority_v1(
       source_session.workspace_id,
       source_session.user_id,
       source_session.identity_id,
       source_session.membership_id
     )
     OR NOT uptech.has_current_people_authority_v1(
       p_target_workspace_id,
       source_session.user_id,
       source_session.identity_id,
       target_membership_id
     ) THEN
    RETURN ROW(
      'DENIED', NULL, NULL, NULL
    )::uptech.mobile_rotation_result_v1;
  END IF;

  RETURN uptech.switch_mobile_workspace_v1(
    p_access_hash, p_target_workspace_id, p_installation_hash,
    p_new_access_hash, p_new_refresh_hash, p_replay_capsule,
    p_idempotency_key, p_request_id
  );
END
$function$;

ALTER TABLE uptech.people_org_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.people_org_units FORCE ROW LEVEL SECURITY;
CREATE POLICY people_org_units_migration_owner
  ON uptech.people_org_units
  TO uptech_migration_owner
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON uptech.people_org_units
FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;

REVOKE ALL ON FUNCTION uptech.begin_people_sync_generation_v1(uuid,uuid,uuid,uuid)
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.resolve_directory_connector_credential_reference_v1()
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.stage_people_profile_v1(uuid,uuid,uuid,text,text,text,text,text)
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.stage_people_profile_v2(uuid,uuid,uuid,text,text,text,text,text,text,boolean,boolean)
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.stage_people_directory_customer_v1(uuid,uuid,uuid,text,text)
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.stage_people_org_unit_v1(uuid,uuid,uuid,text,text,text)
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.stage_people_group_v1(uuid,uuid,uuid,text,text)
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.stage_people_group_membership_v1(uuid,uuid,uuid,text,text)
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.publish_people_sync_generation_v1(uuid,uuid,uuid,boolean,timestamptz,uuid)
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.load_people_permission_context_v1()
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.prepare_directory_consent_v1(uuid)
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.activate_directory_connector_v1(uuid,text,text,text,text,text[],uuid)
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.lease_next_directory_job_v1()
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.has_current_people_authority_v1(uuid,uuid,uuid,uuid)
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.complete_web_google_login_directory_v1(
  uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,
  uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.complete_mobile_google_callback_directory_v1(
  uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,
  uptech.google_auth_hash32_v1,uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.mobile_directory_memberships_json_v1(uuid,uuid)
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.exchange_mobile_handoff_directory_v1(
  uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.authenticate_mobile_access_directory_v1(uptech.google_auth_hash32_v1)
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.list_mobile_workspaces_directory_v1(uptech.google_auth_hash32_v1)
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.rotate_mobile_refresh_directory_v1(
  uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,
  bytea,uptech.google_auth_ascii_identifier_v1,uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.switch_mobile_workspace_directory_v1(
  uptech.google_auth_hash32_v1,uuid,uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,
  bytea,uptech.google_auth_ascii_identifier_v1,uuid
) FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;

GRANT EXECUTE ON FUNCTION uptech.begin_people_sync_generation_v1(uuid,uuid,uuid,uuid)
  TO uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.lease_next_directory_job_v1()
  TO uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.resolve_directory_connector_credential_reference_v1()
  TO uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.stage_people_profile_v1(uuid,uuid,uuid,text,text,text,text,text)
  TO uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.stage_people_profile_v2(uuid,uuid,uuid,text,text,text,text,text,text,boolean,boolean)
  TO uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.stage_people_directory_customer_v1(uuid,uuid,uuid,text,text)
  TO uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.stage_people_org_unit_v1(uuid,uuid,uuid,text,text,text)
  TO uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.stage_people_group_v1(uuid,uuid,uuid,text,text)
  TO uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.stage_people_group_membership_v1(uuid,uuid,uuid,text,text)
  TO uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.publish_people_sync_generation_v1(uuid,uuid,uuid,boolean,timestamptz,uuid)
  TO uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.load_people_permission_context_v1()
  TO uptech_api_runtime;
GRANT EXECUTE ON FUNCTION uptech.prepare_directory_consent_v1(uuid)
  TO uptech_api_runtime;
GRANT EXECUTE ON FUNCTION uptech.activate_directory_connector_v1(uuid,text,text,text,text,text[],uuid)
  TO uptech_api_runtime;
GRANT EXECUTE ON FUNCTION uptech.complete_web_google_login_directory_v1(
  uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,
  uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,uuid
) TO uptech_api_runtime;
GRANT EXECUTE ON FUNCTION uptech.complete_mobile_google_callback_directory_v1(
  uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,
  uptech.google_auth_hash32_v1,uuid
) TO uptech_api_runtime;
GRANT EXECUTE ON FUNCTION uptech.exchange_mobile_handoff_directory_v1(
  uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid
) TO uptech_api_runtime;
GRANT EXECUTE ON FUNCTION uptech.authenticate_mobile_access_directory_v1(uptech.google_auth_hash32_v1)
  TO uptech_api_runtime;
GRANT EXECUTE ON FUNCTION uptech.list_mobile_workspaces_directory_v1(uptech.google_auth_hash32_v1)
  TO uptech_api_runtime;
GRANT EXECUTE ON FUNCTION uptech.rotate_mobile_refresh_directory_v1(
  uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,
  bytea,uptech.google_auth_ascii_identifier_v1,uuid
) TO uptech_api_runtime;
GRANT EXECUTE ON FUNCTION uptech.switch_mobile_workspace_directory_v1(
  uptech.google_auth_hash32_v1,uuid,uptech.google_auth_hash32_v1,
  uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,
  bytea,uptech.google_auth_ascii_identifier_v1,uuid
) TO uptech_api_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE uptech_migration_owner IN SCHEMA uptech
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE uptech_migration_owner IN SCHEMA uptech
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMIT;
