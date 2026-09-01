\set ON_ERROR_STOP on

BEGIN;
SET LOCAL ROLE uptech_migration_owner;

-- Directory snapshots reuse the existing connectors and fenced sync_jobs.
-- They do not introduce a second connection, login, session, or operator authority.
CREATE TABLE uptech.people_sync_generations (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  connector_id uuid NOT NULL,
  job_id uuid NOT NULL,
  lease_fence uuid NOT NULL,
  status text NOT NULL DEFAULT 'RUNNING',
  traversal_complete boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  completed_at timestamptz,
  fresh_until timestamptz,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT people_sync_generations_workspace_fk
    FOREIGN KEY (workspace_id)
    REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT,
  CONSTRAINT people_sync_generations_connector_fk
    FOREIGN KEY (workspace_id, connector_id)
    REFERENCES uptech.connectors (workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT people_sync_generations_job_fk
    FOREIGN KEY (workspace_id, job_id)
    REFERENCES uptech.sync_jobs (workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT people_sync_generations_status_check
    CHECK (status IN ('RUNNING', 'PUBLISHED', 'SUPERSEDED')),
  CONSTRAINT people_sync_generations_completion_check CHECK (
    (status = 'RUNNING' AND NOT traversal_complete
      AND completed_at IS NULL AND fresh_until IS NULL)
    OR (status = 'PUBLISHED' AND traversal_complete
      AND completed_at IS NOT NULL AND fresh_until > completed_at)
    OR (status = 'SUPERSEDED' AND completed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX people_sync_generations_one_running_job
  ON uptech.people_sync_generations (workspace_id, job_id)
  WHERE status = 'RUNNING';

CREATE UNIQUE INDEX people_sync_generations_one_published_workspace
  ON uptech.people_sync_generations (workspace_id)
  WHERE status = 'PUBLISHED';

CREATE TABLE uptech.people_profiles (
  workspace_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  google_subject text COLLATE "C" NOT NULL,
  full_name text NOT NULL,
  primary_email text COLLATE "C" NOT NULL,
  department text,
  lifecycle_state text NOT NULL,
  effective_role text,
  effective_department_key text,
  PRIMARY KEY (workspace_id, generation_id, google_subject),
  CONSTRAINT people_profiles_generation_fk
    FOREIGN KEY (workspace_id, generation_id)
    REFERENCES uptech.people_sync_generations (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT people_profiles_subject_check
    CHECK (length(google_subject) BETWEEN 1 AND 512),
  CONSTRAINT people_profiles_name_check CHECK (length(full_name) BETWEEN 1 AND 500),
  CONSTRAINT people_profiles_email_check CHECK (
    length(primary_email) BETWEEN 3 AND 320
    AND primary_email = lower(btrim(primary_email))
  ),
  CONSTRAINT people_profiles_department_check
    CHECK (department IS NULL OR length(department) BETWEEN 1 AND 200),
  CONSTRAINT people_profiles_lifecycle_check
    CHECK (lifecycle_state IN ('ACTIVE', 'SUSPENDED', 'DELETED')),
  CONSTRAINT people_profiles_effective_authority_check CHECK (
    (effective_role IS NULL AND effective_department_key IS NULL)
    OR (effective_role='ADMIN' AND effective_department_key IS NULL)
    OR (effective_role='MEMBER' AND effective_department_key IN ('SALES','HR','IT'))
  )
);

CREATE TABLE uptech.people_groups (
  workspace_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  google_group_id text COLLATE "C" NOT NULL,
  group_name text NOT NULL,
  PRIMARY KEY (workspace_id, generation_id, google_group_id),
  CONSTRAINT people_groups_generation_fk
    FOREIGN KEY (workspace_id, generation_id)
    REFERENCES uptech.people_sync_generations (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT people_groups_id_check CHECK (length(google_group_id) BETWEEN 1 AND 512),
  CONSTRAINT people_groups_name_check CHECK (length(group_name) BETWEEN 1 AND 500)
);

CREATE TABLE uptech.people_group_memberships (
  workspace_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  google_group_id text COLLATE "C" NOT NULL,
  google_subject text COLLATE "C" NOT NULL,
  PRIMARY KEY (workspace_id, generation_id, google_group_id, google_subject),
  CONSTRAINT people_group_memberships_group_fk
    FOREIGN KEY (workspace_id, generation_id, google_group_id)
    REFERENCES uptech.people_groups (workspace_id, generation_id, google_group_id)
    ON DELETE CASCADE,
  CONSTRAINT people_group_memberships_profile_fk
    FOREIGN KEY (workspace_id, generation_id, google_subject)
    REFERENCES uptech.people_profiles (workspace_id, generation_id, google_subject)
    ON DELETE CASCADE
);

CREATE INDEX people_group_memberships_subject_idx
  ON uptech.people_group_memberships (workspace_id, generation_id, google_subject);

CREATE TABLE uptech.people_permission_mappings (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  source_kind text NOT NULL,
  source_value text COLLATE "C" NOT NULL,
  target_role text NOT NULL,
  target_department_key text,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT people_permission_mappings_workspace_fk
    FOREIGN KEY (workspace_id)
    REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT,
  CONSTRAINT people_permission_mappings_source_unique
    UNIQUE (workspace_id, source_kind, source_value),
  CONSTRAINT people_permission_mappings_source_check CHECK (
    source_kind IN ('ADMIN_GROUP', 'DEPARTMENT')
    AND length(source_value) BETWEEN 1 AND 512
    AND (source_kind <> 'DEPARTMENT' OR source_value = lower(btrim(source_value)))
  ),
  CONSTRAINT people_permission_mappings_target_check CHECK (
    (source_kind = 'ADMIN_GROUP' AND target_role = 'ADMIN'
      AND target_department_key IS NULL)
    OR (source_kind = 'DEPARTMENT' AND target_role = 'MEMBER'
      AND target_department_key IN ('SALES', 'HR', 'IT'))
  ),
  CONSTRAINT people_permission_mappings_status_check
    CHECK (status IN ('ACTIVE', 'DISABLED')),
  CONSTRAINT people_permission_mappings_timestamps_check
    CHECK (updated_at >= created_at)
);

CREATE FUNCTION uptech.begin_people_sync_generation_v1(
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

CREATE FUNCTION uptech.stage_people_profile_v1(
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

CREATE FUNCTION uptech.stage_people_group_v1(
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
      AND job.job_kind = 'DIRECTORY_SYNC' AND job.status = 'LEASED'
      AND job.lease_owner = session_user::text AND job.lease_fence = p_fence
      AND job.lease_expires_at > statement_timestamp()
      AND connector.purpose = 'DIRECTORY' AND connector.status IN ('ACTIVE', 'DEGRADED')
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

CREATE FUNCTION uptech.stage_people_group_membership_v1(
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
      AND job.job_kind = 'DIRECTORY_SYNC' AND job.status = 'LEASED'
      AND job.lease_owner = session_user::text AND job.lease_fence = p_fence
      AND job.lease_expires_at > statement_timestamp()
      AND connector.purpose = 'DIRECTORY' AND connector.status IN ('ACTIVE', 'DEGRADED')
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

CREATE FUNCTION uptech.publish_people_sync_generation_v1(
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
  selected_started_at timestamptz;
  selected_actor_id uuid;
  previous_generation_id uuid;
  observed_at timestamptz := clock_timestamp();
BEGIN
  SELECT generation.connector_id, generation.started_at, job.service_actor_id
  INTO selected_connector_id, selected_started_at, selected_actor_id
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
    AND workspace.status='ACTIVE' AND actor.status='ACTIVE'
  FOR UPDATE OF generation, connector, workspace;

  IF selected_connector_id IS NULL OR p_traversal_complete IS NOT TRUE
     OR p_fresh_until IS NULL OR p_fresh_until <= observed_at
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
        WHEN profile.lifecycle_state='ACTIVE' AND EXISTS (
          SELECT 1 FROM uptech.people_permission_mappings mapping
          WHERE mapping.workspace_id=p_workspace_id
            AND mapping.source_kind='DEPARTMENT'
            AND mapping.source_value=lower(btrim(profile.department))
            AND mapping.status='ACTIVE') THEN 'MEMBER'
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
        THEN (SELECT mapping.target_department_key
          FROM uptech.people_permission_mappings mapping
          WHERE mapping.workspace_id=p_workspace_id
            AND mapping.source_kind='DEPARTMENT'
            AND mapping.source_value=lower(btrim(profile.department))
            AND mapping.status='ACTIVE') ELSE NULL END
  WHERE profile.workspace_id=p_workspace_id AND profile.generation_id=p_generation_id;

  UPDATE uptech.people_sync_generations
  SET status = 'SUPERSEDED', completed_at = observed_at
  WHERE workspace_id = p_workspace_id
    AND status = 'PUBLISHED';

  UPDATE uptech.people_sync_generations
  SET status = 'PUBLISHED', traversal_complete = true,
      completed_at = observed_at, fresh_until = p_fresh_until
  WHERE workspace_id = p_workspace_id AND id = p_generation_id;

  -- Only changed or ineligible memberships lose their sessions. Unchanged
  -- authorized members remain online across ordinary snapshot refreshes.
  WITH new_authority AS MATERIALIZED (
    SELECT membership.id AS membership_id, membership.role, membership.status,
      profile.lifecycle_state, profile.effective_role,
      CASE WHEN membership.role='OWNER' THEN NULL::text
        ELSE profile.effective_department_key END AS department,
      CASE WHEN membership.role='OWNER' AND profile.lifecycle_state='ACTIVE' THEN 'OWNER'
        ELSE COALESCE(profile.effective_role,membership.role) END AS target_role,
      CASE WHEN profile.lifecycle_state='DELETED' THEN 'DEPROVISIONED'
        WHEN profile.lifecycle_state='ACTIVE' AND (membership.role='OWNER'
          OR profile.effective_role IS NOT NULL) THEN 'ACTIVE' ELSE 'SUSPENDED' END AS target_status,
      old_profile.lifecycle_state AS old_lifecycle_state,
      old_profile.effective_role AS old_effective_role,
      CASE WHEN membership.role='OWNER' THEN NULL::text
        ELSE old_profile.effective_department_key END AS old_department
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
      profile.lifecycle_state,
      CASE WHEN membership.role='OWNER' THEN NULL::text
        ELSE profile.effective_role END AS effective_role,
      CASE WHEN membership.role='OWNER' THEN NULL::text
        ELSE profile.effective_department_key END AS effective_department_key,
      old_profile.lifecycle_state AS old_lifecycle_state,
      CASE WHEN membership.role='OWNER' THEN NULL::text
        ELSE old_profile.effective_role END AS old_effective_role,
      CASE WHEN membership.role='OWNER' THEN NULL::text
        ELSE old_profile.effective_department_key END AS old_effective_department_key,
      CASE
        WHEN membership.role = 'OWNER' AND profile.lifecycle_state = 'ACTIVE'
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
        THEN 1 ELSE 0 END,
      updated_at = observed_at
  FROM authority
  WHERE membership.workspace_id = p_workspace_id
    AND membership.id = authority.membership_id;

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

  RETURN QUERY SELECT 'PUBLISHED'::text, p_generation_id, p_fresh_until;
END
$function$;

CREATE FUNCTION uptech.load_people_permission_context_v1()
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
    JOIN uptech.people_sync_generations AS generation
      ON generation.workspace_id = membership.workspace_id
     AND generation.status = 'PUBLISHED'
     AND generation.fresh_until > statement_timestamp()
    JOIN uptech.connectors AS directory_connector
      ON directory_connector.workspace_id=generation.workspace_id
     AND directory_connector.id=generation.connector_id
     AND directory_connector.purpose='DIRECTORY'
     AND directory_connector.status IN ('ACTIVE','DEGRADED')
    JOIN uptech.people_profiles AS profile
      ON profile.workspace_id = generation.workspace_id
     AND profile.generation_id = generation.id
     AND profile.google_subject = identity_row.provider_subject
     AND profile.lifecycle_state = 'ACTIVE'
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
    CASE WHEN candidate.membership_role='MEMBER'
      THEN candidate.effective_department_key ELSE NULL::text END,
    candidate.direct_group_ids
  FROM candidate
  WHERE candidate.membership_role='OWNER'
     OR (candidate.membership_role='ADMIN' AND candidate.effective_role='ADMIN')
     OR (candidate.membership_role='MEMBER' AND candidate.effective_role='MEMBER'
       AND candidate.effective_department_key IS NOT NULL)
$function$;

DO $rls$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'people_sync_generations', 'people_profiles', 'people_groups',
    'people_group_memberships', 'people_permission_mappings'
  ] LOOP
    EXECUTE format('ALTER TABLE uptech.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE uptech.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON uptech.%I TO uptech_migration_owner USING (true) WITH CHECK (true)',
      table_name || '_migration_owner', table_name
    );
  END LOOP;
END
$rls$;

REVOKE ALL ON uptech.people_sync_generations, uptech.people_profiles,
  uptech.people_groups, uptech.people_group_memberships,
  uptech.people_permission_mappings
FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;

REVOKE ALL ON FUNCTION uptech.begin_people_sync_generation_v1(uuid,uuid,uuid,uuid)
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.stage_people_profile_v1(uuid,uuid,uuid,text,text,text,text,text)
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.stage_people_group_v1(uuid,uuid,uuid,text,text)
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.stage_people_group_membership_v1(uuid,uuid,uuid,text,text)
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.publish_people_sync_generation_v1(uuid,uuid,uuid,boolean,timestamptz,uuid)
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;
REVOKE ALL ON FUNCTION uptech.load_people_permission_context_v1()
  FROM PUBLIC, uptech_api_runtime, uptech_worker_runtime;

GRANT EXECUTE ON FUNCTION uptech.begin_people_sync_generation_v1(uuid,uuid,uuid,uuid)
  TO uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.stage_people_profile_v1(uuid,uuid,uuid,text,text,text,text,text)
  TO uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.stage_people_group_v1(uuid,uuid,uuid,text,text)
  TO uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.stage_people_group_membership_v1(uuid,uuid,uuid,text,text)
  TO uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.publish_people_sync_generation_v1(uuid,uuid,uuid,boolean,timestamptz,uuid)
  TO uptech_worker_runtime;
GRANT EXECUTE ON FUNCTION uptech.load_people_permission_context_v1()
  TO uptech_api_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE uptech_migration_owner IN SCHEMA uptech
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE uptech_migration_owner IN SCHEMA uptech
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMIT;
