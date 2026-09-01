\set ON_ERROR_STOP on

-- Run against a disposable PostgreSQL database, as the same cluster
-- administrator that ran bootstrap/0001_roles.sql, after applying
-- migrations/0001_phase1_foundation.sql. The transaction is rolled back.
BEGIN;

DO $verify$
DECLARE
  bad_role_count integer;
  unprotected_table_count integer;
  runtime_owned_table_count integer;
BEGIN
  SELECT count(*) INTO bad_role_count
  FROM pg_catalog.pg_roles
  WHERE rolname IN ('uptech_api_runtime', 'uptech_worker_runtime')
    AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls);

  IF bad_role_count <> 0 THEN
    RAISE EXCEPTION 'runtime roles have elevated PostgreSQL attributes';
  END IF;

  IF pg_has_role('uptech_api_runtime', 'uptech_migration_owner', 'MEMBER')
     OR pg_has_role('uptech_worker_runtime', 'uptech_migration_owner', 'MEMBER')
     OR pg_has_role('uptech_api_runtime', 'uptech_worker_runtime', 'MEMBER')
     OR pg_has_role('uptech_worker_runtime', 'uptech_api_runtime', 'MEMBER') THEN
    RAISE EXCEPTION 'runtime capability roles are not isolated';
  END IF;

  SELECT count(*) INTO runtime_owned_table_count
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_roles AS r ON r.oid = c.relowner
  WHERE n.nspname = 'uptech'
    AND c.relkind IN ('r', 'p')
    AND r.rolname IN ('uptech_api_runtime', 'uptech_worker_runtime');

  IF runtime_owned_table_count <> 0 THEN
    RAISE EXCEPTION 'a runtime role owns an UPTECH relation';
  END IF;

  SELECT count(*) INTO unprotected_table_count
  FROM (
    VALUES
      ('workspaces'),
      ('workspace_memberships'),
      ('service_actors'),
      ('connectors'),
      ('sources'),
      ('sessions'),
      ('session_tokens'),
      ('sync_jobs'),
      ('audit_events'),
      ('security_outbox'),
      ('rate_limit_buckets')
  ) AS required(table_name)
  LEFT JOIN pg_catalog.pg_class AS c
    ON c.relname = required.table_name
  LEFT JOIN pg_catalog.pg_namespace AS n
    ON n.oid = c.relnamespace
   AND n.nspname = 'uptech'
  WHERE c.oid IS NULL OR NOT c.relrowsecurity OR NOT c.relforcerowsecurity;

  IF unprotected_table_count <> 0 THEN
    RAISE EXCEPTION 'one or more tenant relations lack ENABLE/FORCE RLS';
  END IF;
END
$verify$;

DO $verify$
DECLARE
  missing_constraint_count integer;
BEGIN
  SELECT count(*) INTO missing_constraint_count
  FROM (
    VALUES
      ('workspace_memberships_workspace_fk'),
      ('service_actors_workspace_fk'),
      ('connectors_workspace_fk'),
      ('sources_connector_fk'),
      ('sessions_workspace_fk'),
      ('sessions_membership_user_fk'),
      ('session_tokens_session_fk'),
      ('sync_jobs_workspace_fk'),
      ('sync_jobs_service_actor_fk'),
      ('sync_jobs_connector_fk'),
      ('sync_jobs_source_connector_fk'),
      ('audit_events_workspace_fk'),
      ('audit_events_membership_fk'),
      ('audit_events_session_fk'),
      ('security_outbox_workspace_fk'),
      ('security_outbox_audit_event_fk'),
      ('rate_limit_buckets_workspace_fk')
  ) AS required(constraint_name)
  LEFT JOIN pg_catalog.pg_constraint AS c
    ON c.conname = required.constraint_name
   AND c.contype = 'f'
  WHERE c.oid IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM unnest(c.conkey) AS key_column(attnum)
       JOIN pg_catalog.pg_attribute AS a
         ON a.attrelid = c.conrelid
        AND a.attnum = key_column.attnum
       WHERE a.attname = 'workspace_id'
     );

  IF missing_constraint_count <> 0 THEN
    RAISE EXCEPTION 'required composite tenant foreign keys are missing';
  END IF;
END
$verify$;

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = 'uptech.sync_jobs'::regclass
      AND a.attname = 'lease_fence'
      AND a.atttypid = 'uuid'::regtype
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'sync_jobs.lease_fence is missing or not uuid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS a
    JOIN pg_catalog.pg_attrdef AS d
      ON d.adrelid = a.attrelid
     AND d.adnum = a.attnum
    WHERE a.attrelid = 'uptech.sync_jobs'::regclass
      AND a.attname = 'lease_fence'
  ) THEN
    RAISE EXCEPTION 'lease fence can be generated outside lease_next_job';
  END IF;
END
$verify$;

DO $verify$
DECLARE
  authenticate_oid regprocedure := 'uptech.authenticate_session(bytea)'::regprocedure;
  lease_oid regprocedure := 'uptech.lease_next_job()'::regprocedure;
BEGIN
  IF (
    SELECT count(*)
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'uptech'
      AND p.prosecdef
  ) <> 2 THEN
    RAISE EXCEPTION 'unexpected SECURITY DEFINER routine count';
  END IF;

  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = authenticate_oid) THEN
    RAISE EXCEPTION 'authenticate_session is not SECURITY DEFINER';
  END IF;

  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = lease_oid) THEN
    RAISE EXCEPTION 'lease_next_job is not SECURITY DEFINER';
  END IF;

  IF NOT (
    SELECT proconfig @> ARRAY['search_path=pg_catalog, uptech, pg_temp']::text[]
    FROM pg_catalog.pg_proc WHERE oid = authenticate_oid
  ) OR NOT (
    SELECT proconfig @> ARRAY['search_path=pg_catalog, uptech, pg_temp']::text[]
    FROM pg_catalog.pg_proc WHERE oid = lease_oid
  ) THEN
    RAISE EXCEPTION 'privileged routine search_path is not fixed';
  END IF;

  IF pg_catalog.pg_get_functiondef(authenticate_oid) ~* '\mEXECUTE\M'
     OR pg_catalog.pg_get_functiondef(lease_oid) ~* '\mEXECUTE\M' THEN
    RAISE EXCEPTION 'dynamic SQL found in a privileged routine';
  END IF;

  IF position(
      'lease_fence = pg_catalog.gen_random_uuid()'
      IN pg_catalog.pg_get_functiondef(lease_oid)
    ) = 0
     OR position(
       'statement_timestamp() AS observed_at'
       IN pg_catalog.pg_get_functiondef(lease_oid)
     ) = 0
     OR position(
       'job_kind text'
       IN pg_catalog.pg_get_function_result(lease_oid)
     ) = 0
     OR position(
       'lease_fence uuid'
       IN pg_catalog.pg_get_function_result(lease_oid)
     ) = 0
     OR position(
       'lease_expires_at timestamp with time zone'
       IN pg_catalog.pg_get_function_result(lease_oid)
     ) = 0 THEN
    RAISE EXCEPTION 'lease_next_job does not generate/return the full fenced lease';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) AS acl
    WHERE p.oid IN (authenticate_oid, lease_oid)
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC can execute a privileged routine';
  END IF;

  IF NOT has_function_privilege(
      'uptech_api_runtime', authenticate_oid, 'EXECUTE'
    )
    OR has_function_privilege(
      'uptech_worker_runtime', authenticate_oid, 'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'authenticate_session role separation is incorrect';
  END IF;

  IF NOT has_function_privilege(
      'uptech_worker_runtime', lease_oid, 'EXECUTE'
    )
    OR has_function_privilege(
      'uptech_api_runtime', lease_oid, 'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'lease_next_job role separation is incorrect';
  END IF;

  IF has_table_privilege('uptech_api_runtime', 'uptech.users', 'SELECT')
     OR has_table_privilege('uptech_api_runtime', 'uptech.identities', 'SELECT')
     OR has_table_privilege('uptech_api_runtime', 'uptech.onboarding_sessions', 'SELECT')
     OR has_table_privilege('uptech_api_runtime', 'uptech.platform_audit_events', 'INSERT')
     OR has_table_privilege('uptech_worker_runtime', 'uptech.session_tokens', 'SELECT')
     OR has_table_privilege('uptech_worker_runtime', 'uptech.security_outbox', 'UPDATE')
     OR has_column_privilege(
       'uptech_api_runtime', 'uptech.session_tokens', 'token_hash', 'SELECT'
     )
     OR has_column_privilege(
       'uptech_api_runtime', 'uptech.session_tokens', 'csrf_token_hash', 'SELECT'
     )
     OR has_column_privilege(
       'uptech_worker_runtime', 'uptech.sync_jobs', 'lease_owner', 'UPDATE'
     )
     OR has_column_privilege(
       'uptech_worker_runtime', 'uptech.sync_jobs', 'lease_expires_at', 'UPDATE'
     )
     OR has_column_privilege(
       'uptech_worker_runtime', 'uptech.sync_jobs', 'leased_at', 'UPDATE'
     )
     OR has_column_privilege(
       'uptech_worker_runtime', 'uptech.sync_jobs', 'available_at', 'UPDATE'
     )
     OR has_column_privilege(
       'uptech_worker_runtime', 'uptech.sync_jobs', 'lease_fence', 'UPDATE'
     ) THEN
    RAISE EXCEPTION 'a runtime role has direct pre-tenant/session bootstrap access';
  END IF;

  IF has_table_privilege('uptech_api_runtime', 'uptech.audit_events', 'UPDATE')
     OR has_table_privilege('uptech_api_runtime', 'uptech.audit_events', 'DELETE')
     OR has_table_privilege('uptech_worker_runtime', 'uptech.audit_events', 'UPDATE')
     OR has_table_privilege('uptech_worker_runtime', 'uptech.audit_events', 'DELETE') THEN
    RAISE EXCEPTION 'runtime role can mutate an audit event';
  END IF;

  IF has_table_privilege(
       'uptech_api_runtime', 'uptech.rate_limit_buckets', 'DELETE'
     )
     OR has_table_privilege(
       'uptech_api_runtime', 'uptech.rate_limit_buckets', 'SELECT'
     )
     OR has_column_privilege(
       'uptech_api_runtime', 'uptech.rate_limit_buckets', 'scope_hash', 'UPDATE'
     )
     OR has_column_privilege(
       'uptech_api_runtime', 'uptech.rate_limit_buckets', 'window_started_at', 'UPDATE'
     )
     OR NOT has_column_privilege(
       'uptech_api_runtime', 'uptech.rate_limit_buckets', 'request_count', 'SELECT'
     )
     OR NOT has_column_privilege(
       'uptech_api_runtime', 'uptech.rate_limit_buckets', 'request_count', 'UPDATE'
     )
     OR has_column_privilege(
       'uptech_api_runtime', 'uptech.rate_limit_buckets', 'window_seconds', 'SELECT'
     )
     OR has_column_privilege(
       'uptech_api_runtime', 'uptech.rate_limit_buckets', 'expires_at', 'SELECT'
     )
     OR has_column_privilege(
       'uptech_api_runtime', 'uptech.rate_limit_buckets', 'updated_at', 'SELECT'
     ) THEN
    RAISE EXCEPTION 'tenant limiter table privileges are broader or narrower than required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS t
    JOIN pg_catalog.pg_proc AS p ON p.oid = t.tgfoid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE t.tgrelid = 'uptech.rate_limit_buckets'::regclass
      AND t.tgname = 'rate_limit_buckets_guard'
      AND NOT t.tgisinternal
      AND t.tgenabled = 'O'
      AND n.nspname = 'uptech'
      AND p.proname = 'enforce_tenant_rate_bucket_mutation'
      AND NOT p.prosecdef
  ) THEN
    RAISE EXCEPTION 'tenant limiter mutation guard is missing or privileged';
  END IF;
END
$verify$;

DO $verify$
DECLARE
  missing_fence_policy_count integer;
BEGIN
  SELECT count(*) INTO missing_fence_policy_count
  FROM (
    VALUES
      ('sync_jobs_worker_select', 'qual'),
      ('workspaces_worker_scope', 'qual'),
      ('service_actors_worker_scope', 'qual'),
      ('connectors_worker_scope', 'qual'),
      ('sources_worker_scope', 'qual'),
      ('audit_events_worker_scope', 'with_check')
  ) AS required(policy_name, expression_kind)
  LEFT JOIN pg_catalog.pg_policies AS p
    ON p.schemaname = 'uptech'
   AND p.policyname = required.policy_name
  WHERE p.policyname IS NULL
     OR position(
       'app.lease_fence'
       IN CASE required.expression_kind
         WHEN 'qual' THEN COALESCE(p.qual, '')
         ELSE COALESCE(p.with_check, '')
       END
     ) = 0
     OR position(
       'statement_timestamp()'
       IN CASE required.expression_kind
         WHEN 'qual' THEN COALESCE(p.qual, '')
         ELSE COALESCE(p.with_check, '')
       END
     ) = 0;

  IF missing_fence_policy_count <> 0 THEN
    RAISE EXCEPTION 'a worker RLS/audit policy lacks statement-time lease fencing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS p
    WHERE p.schemaname = 'uptech'
      AND p.policyname = 'sync_jobs_worker_update'
      AND position('app.lease_fence' IN COALESCE(p.qual, '')) > 0
      AND position('statement_timestamp()' IN COALESCE(p.qual, '')) > 0
      AND position('app.lease_fence' IN COALESCE(p.with_check, '')) > 0
      AND position('statement_timestamp()' IN COALESCE(p.with_check, '')) > 0
  ) THEN
    RAISE EXCEPTION 'worker job UPDATE is not fenced on both row images';
  END IF;
END
$verify$;

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS p
    WHERE p.schemaname = 'uptech'
      AND p.tablename = 'audit_events'
      AND p.policyname = 'audit_events_api_read'
      AND p.cmd = 'SELECT'
      AND position('OWNER' IN COALESCE(p.qual, '')) > 0
      AND position('ADMIN' IN COALESCE(p.qual, '')) > 0
      AND position('app.membership_id' IN COALESCE(p.qual, '')) > 0
  ) THEN
    RAISE EXCEPTION 'tenant audit reads are not admin-scoped';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS p
    WHERE p.schemaname = 'uptech'
      AND p.tablename = 'audit_events'
      AND p.policyname = 'audit_events_api_insert'
      AND p.cmd = 'INSERT'
      AND position('app.actor_id' IN COALESCE(p.with_check, '')) > 0
      AND position('app.membership_id' IN COALESCE(p.with_check, '')) > 0
      AND position('app.session_id' IN COALESCE(p.with_check, '')) > 0
  ) THEN
    RAISE EXCEPTION 'tenant audit inserts are not bound to request attribution';
  END IF;
END
$verify$;

SET LOCAL ROLE uptech_migration_owner;

INSERT INTO uptech.users (id, status, security_version)
VALUES
  ('b1000000-0000-0000-0000-000000000001', 'ACTIVE', 1),
  ('b2000000-0000-0000-0000-000000000002', 'ACTIVE', 1);

INSERT INTO uptech.identities (
  id,
  user_id,
  provider,
  issuer,
  provider_subject,
  status,
  security_version,
  email_claim,
  email_verified,
  hosted_domain_claim,
  claims_observed_at
)
VALUES
  (
    'c1000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000001',
    'GOOGLE',
    'https://accounts.google.com',
    'CaseSensitiveSubjectOne',
    'ACTIVE',
    1,
      'owner-one@tenant-a.example',
    true,
    'tenant-a.example',
    transaction_timestamp()
  ),
  (
    'c2000000-0000-0000-0000-000000000002',
    'b2000000-0000-0000-0000-000000000002',
    'GOOGLE',
    'https://accounts.google.com',
    'CaseSensitiveSubjectTwo',
    'ACTIVE',
    1,
    'owner-two@tenant-b.example',
    true,
    'tenant-b.example',
    transaction_timestamp()
  );

INSERT INTO uptech.onboarding_sessions (
  id,
  identity_id,
  token_hash,
  allowed_operations,
  expires_at
)
VALUES (
  'd0000000-0000-0000-0000-000000000001',
  'c1000000-0000-0000-0000-000000000001',
  decode(repeat('22', 32), 'hex'),
  ARRAY['FIRST_DOMAIN_CLAIM_READ', 'ACCESS_REQUEST_SUBMIT']::text[],
  transaction_timestamp() + interval '20 minutes'
);

INSERT INTO uptech.workspaces (
  workspace_id,
  status,
  provisioning_policy,
  security_version,
  permission_epoch
)
VALUES
  ('a1000000-0000-0000-0000-000000000001', 'ACTIVE', 'INVITE_ONLY', 1, 1),
  ('a2000000-0000-0000-0000-000000000002', 'ACTIVE', 'INVITE_ONLY', 1, 1);

INSERT INTO uptech.workspace_memberships (
  workspace_id,
  id,
  user_id,
  role,
  status,
  authz_version
)
VALUES
  (
    'a1000000-0000-0000-0000-000000000001',
    'd1000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000001',
    'OWNER',
    'ACTIVE',
    1
  ),
  (
    'a2000000-0000-0000-0000-000000000002',
    'd2000000-0000-0000-0000-000000000002',
    'b2000000-0000-0000-0000-000000000002',
    'OWNER',
    'ACTIVE',
    1
  );

INSERT INTO uptech.service_actors (workspace_id, id, actor_kind, status)
VALUES
  (
    'a1000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000001',
    'SYNC_WORKER',
    'ACTIVE'
  ),
  (
    'a2000000-0000-0000-0000-000000000002',
    'e2000000-0000-0000-0000-000000000002',
    'SYNC_WORKER',
    'ACTIVE'
  );

INSERT INTO uptech.connectors (workspace_id, id, purpose, status)
VALUES
  (
    'a1000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-000000000001',
    'DIRECTORY',
    'ACTIVE'
  ),
  (
    'a2000000-0000-0000-0000-000000000002',
    'f2000000-0000-0000-0000-000000000002',
    'DIRECTORY',
    'ACTIVE'
  );

INSERT INTO uptech.sessions (
  workspace_id,
  id,
  identity_id,
  user_id,
  membership_id,
  client_type,
  status,
  user_security_version,
  identity_security_version,
  workspace_security_version,
  membership_authz_version,
  security_version,
  current_rotation_version,
  created_at,
  last_seen_at,
  idle_expires_at,
  absolute_expires_at
)
VALUES
  (
    'a1000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000001',
    'c1000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000001',
    'd1000000-0000-0000-0000-000000000001',
    'WEB', 'ACTIVE', 1, 1, 1, 1, 1, 2,
    transaction_timestamp() - interval '1 hour',
    transaction_timestamp(),
    transaction_timestamp() + interval '7 hours',
    transaction_timestamp() + interval '6 days'
  ),
  (
    'a1000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000002',
    'c1000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000001',
    'd1000000-0000-0000-0000-000000000001',
    'WEB', 'ACTIVE', 999, 1, 1, 1, 1, 1,
    transaction_timestamp() - interval '1 hour',
    transaction_timestamp(),
    transaction_timestamp() + interval '7 hours',
    transaction_timestamp() + interval '6 days'
  ),
  (
    'a1000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000003',
    'c1000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000001',
    'd1000000-0000-0000-0000-000000000001',
    'NATIVE', 'ACTIVE', 1, 1, 1, 1, 1, 1,
    transaction_timestamp() - interval '1 hour',
    transaction_timestamp(),
    transaction_timestamp() + interval '7 hours',
    transaction_timestamp() + interval '29 days'
  ),
  (
    'a1000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000004',
    'c1000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000001',
    'd1000000-0000-0000-0000-000000000001',
    'WEB', 'ACTIVE', 1, 1, 1, 1, 1, 2,
    transaction_timestamp() - interval '2 hours',
    transaction_timestamp(),
    transaction_timestamp() + interval '7 hours',
    transaction_timestamp() + interval '6 days'
  ),
  (
    'a2000000-0000-0000-0000-000000000002',
    '12000000-0000-0000-0000-000000000002',
    'c2000000-0000-0000-0000-000000000002',
    'b2000000-0000-0000-0000-000000000002',
    'd2000000-0000-0000-0000-000000000002',
    'WEB', 'ACTIVE', 1, 1, 1, 1, 1, 1,
    transaction_timestamp() - interval '1 hour',
    transaction_timestamp(),
    transaction_timestamp() + interval '7 hours',
    transaction_timestamp() + interval '6 days'
  );

INSERT INTO uptech.session_tokens (
  workspace_id,
  id,
  session_id,
  client_type,
  token_kind,
  token_status,
  token_hash,
  csrf_token_hash,
  session_security_version,
  rotation_version,
  issued_at,
  expires_at,
  became_previous_at,
  previous_valid_until
)
VALUES
  (
    'a1000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000001',
    'WEB', 'WEB_SESSION', 'CURRENT',
    decode(repeat('11', 32), 'hex'),
    decode(repeat('91', 32), 'hex'),
    1, 2,
    transaction_timestamp() - interval '1 hour',
    transaction_timestamp() + interval '23 hours',
    NULL,
    NULL
  ),
  (
    'a1000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000002',
    '11000000-0000-0000-0000-000000000001',
    'WEB', 'WEB_SESSION', 'PREVIOUS',
    decode(repeat('14', 32), 'hex'),
    decode(repeat('94', 32), 'hex'),
    1, 1,
    transaction_timestamp() - interval '1 hour',
    transaction_timestamp() + interval '23 hours',
    transaction_timestamp() - interval '10 seconds',
    transaction_timestamp() + interval '20 seconds'
  ),
  (
    'a1000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000003',
    '11000000-0000-0000-0000-000000000002',
    'WEB', 'WEB_SESSION', 'CURRENT',
    decode(repeat('12', 32), 'hex'),
    decode(repeat('92', 32), 'hex'),
    1, 1,
    transaction_timestamp() - interval '1 hour',
    transaction_timestamp() + interval '23 hours',
    NULL,
    NULL
  ),
  (
    'a1000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000004',
    '11000000-0000-0000-0000-000000000003',
    'NATIVE', 'NATIVE_REFRESH', 'CURRENT',
    decode(repeat('13', 32), 'hex'),
    NULL,
    1, 1,
    transaction_timestamp() - interval '1 hour',
    transaction_timestamp() + interval '29 days',
    NULL,
    NULL
  ),
  (
    'a1000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000005',
    '11000000-0000-0000-0000-000000000004',
    'WEB', 'WEB_SESSION', 'PREVIOUS',
    decode(repeat('15', 32), 'hex'),
    decode(repeat('95', 32), 'hex'),
    1, 1,
    transaction_timestamp() - interval '2 hours',
    transaction_timestamp() + interval '23 hours',
    transaction_timestamp() - interval '40 seconds',
    transaction_timestamp() - interval '10 seconds'
  ),
  (
    'a2000000-0000-0000-0000-000000000002',
    '22000000-0000-0000-0000-000000000002',
    '12000000-0000-0000-0000-000000000002',
    'WEB', 'WEB_SESSION', 'CURRENT',
    decode(repeat('33', 32), 'hex'),
    decode(repeat('93', 32), 'hex'),
    1, 1,
    transaction_timestamp() - interval '1 hour',
    transaction_timestamp() + interval '23 hours',
    NULL,
    NULL
  );

INSERT INTO uptech.audit_events (
  workspace_id,
  id,
  actor_kind,
  actor_id,
  membership_id,
  session_id,
  action,
  target_type,
  target_id,
  outcome,
  request_id,
  metadata
)
VALUES
  (
    'a1000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000001',
    'USER',
    'b1000000-0000-0000-0000-000000000001',
    'd1000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000001',
    'SESSION_TEST_CREATED',
    'SESSION',
    '11000000-0000-0000-0000-000000000001',
    'SUCCEEDED',
    '51000000-0000-0000-0000-000000000001',
    '{"fixture":true}'::jsonb
  ),
  (
    'a2000000-0000-0000-0000-000000000002',
    '32000000-0000-0000-0000-000000000002',
    'USER',
    'b2000000-0000-0000-0000-000000000002',
    'd2000000-0000-0000-0000-000000000002',
    '12000000-0000-0000-0000-000000000002',
    'SESSION_TEST_CREATED',
    'SESSION',
    '12000000-0000-0000-0000-000000000002',
    'SUCCEEDED',
    '52000000-0000-0000-0000-000000000002',
    '{"fixture":true}'::jsonb
  );

INSERT INTO uptech.sync_jobs (
  workspace_id,
  id,
  service_actor_id,
  connector_id,
  source_id,
  job_kind,
  status,
  priority,
  dedupe_key,
  payload,
  available_at
)
VALUES (
  'a1000000-0000-0000-0000-000000000001',
  '41000000-0000-0000-0000-000000000001',
  'e1000000-0000-0000-0000-000000000001',
  'f1000000-0000-0000-0000-000000000001',
  NULL,
  'DIRECTORY_SYNC',
  'QUEUED',
  10,
  'verification-directory-sync',
  '{"fixture":true}'::jsonb,
  transaction_timestamp() - interval '1 second'
);

RESET ROLE;
SET LOCAL ROLE uptech_api_runtime;

DO $verify$
DECLARE
  context_count integer;
  context_workspace uuid;
  context_kind text;
BEGIN
  SELECT count(*) INTO context_count
  FROM uptech.authenticate_session(decode(repeat('11', 32), 'hex'));

  SELECT auth.workspace_id, auth.context_kind
  INTO context_workspace, context_kind
  FROM uptech.authenticate_session(decode(repeat('11', 32), 'hex')) AS auth;

  IF context_count <> 1
     OR context_workspace <> 'a1000000-0000-0000-0000-000000000001'::uuid
     OR context_kind <> 'SESSION' THEN
    RAISE EXCEPTION 'valid workspace session did not authenticate exactly once';
  END IF;

  IF (SELECT count(*) FROM uptech.authenticate_session(decode(repeat('14', 32), 'hex'))) <> 1 THEN
    RAISE EXCEPTION 'bounded previous-token grace was not honored';
  END IF;

  IF EXISTS (
    SELECT 1 FROM uptech.authenticate_session(decode(repeat('12', 32), 'hex'))
  ) THEN
    RAISE EXCEPTION 'stale user security version authenticated';
  END IF;

  IF EXISTS (
    SELECT 1 FROM uptech.authenticate_session(decode(repeat('13', 32), 'hex'))
  ) THEN
    RAISE EXCEPTION 'native refresh credential authenticated as an access session';
  END IF;

  IF EXISTS (
    SELECT 1 FROM uptech.authenticate_session(decode(repeat('15', 32), 'hex'))
  ) THEN
    RAISE EXCEPTION 'expired previous-token grace authenticated';
  END IF;

  IF EXISTS (
    SELECT 1 FROM uptech.authenticate_session(decode(repeat('ff', 32), 'hex'))
  ) THEN
    RAISE EXCEPTION 'unknown credential authenticated';
  END IF;

  IF EXISTS (
    SELECT 1 FROM uptech.authenticate_session(decode('ff', 'hex'))
  ) THEN
    RAISE EXCEPTION 'malformed credential hash authenticated';
  END IF;

  SELECT count(*) INTO context_count
  FROM uptech.authenticate_session(decode(repeat('22', 32), 'hex'));

  SELECT auth.context_kind, auth.workspace_id
  INTO context_kind, context_workspace
  FROM uptech.authenticate_session(decode(repeat('22', 32), 'hex')) AS auth;

  IF context_count <> 1 OR context_kind <> 'ONBOARDING' OR context_workspace IS NOT NULL THEN
    RAISE EXCEPTION 'onboarding context was absent or gained workspace authority';
  END IF;
END
$verify$;

DO $verify$
BEGIN
  BEGIN
    PERFORM count(*) FROM uptech.users;
    RAISE EXCEPTION 'API read global users directly';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM * FROM uptech.lease_next_job();
    RAISE EXCEPTION 'API executed worker lease routine';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END
$verify$;

-- Missing transaction context is deny, and a savepoint proves transaction-local
-- settings do not survive rollback/pool-style transaction cleanup.
DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM uptech.workspaces) THEN
    RAISE EXCEPTION 'RLS returned tenant rows without context';
  END IF;
END
$verify$;

SAVEPOINT tenant_context_scope;
SELECT set_config('app.workspace_id', 'a1000000-0000-0000-0000-000000000001', true);
SELECT set_config('app.actor_id', 'b1000000-0000-0000-0000-000000000001', true);
SELECT set_config('app.membership_id', 'd1000000-0000-0000-0000-000000000001', true);
SELECT set_config('app.session_id', '11000000-0000-0000-0000-000000000001', true);
ROLLBACK TO SAVEPOINT tenant_context_scope;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM uptech.workspaces) THEN
    RAISE EXCEPTION 'transaction-local tenant context survived savepoint rollback';
  END IF;
END
$verify$;

SELECT set_config('app.workspace_id', 'a1000000-0000-0000-0000-000000000001', true);
SELECT set_config('app.actor_id', 'b1000000-0000-0000-0000-000000000001', true);
SELECT set_config('app.membership_id', 'd1000000-0000-0000-0000-000000000001', true);
SELECT set_config('app.session_id', '11000000-0000-0000-0000-000000000001', true);

DO $verify$
BEGIN
  IF (SELECT count(*) FROM uptech.workspaces) <> 1
     OR (SELECT count(*) FROM uptech.workspace_memberships) <> 1
     OR (SELECT count(*) FROM uptech.audit_events) <> 1 THEN
    RAISE EXCEPTION 'API RLS did not isolate workspace one';
  END IF;

  IF EXISTS (
    SELECT 1 FROM uptech.workspaces
    WHERE workspace_id = 'a2000000-0000-0000-0000-000000000002'
  ) THEN
    RAISE EXCEPTION 'API RLS exposed workspace two';
  END IF;

  BEGIN
    INSERT INTO uptech.rate_limit_buckets (
      workspace_id,
      scope_kind,
      scope_hash,
      route_class,
      window_started_at,
      window_seconds,
      request_count,
      expires_at
    ) VALUES (
      'a2000000-0000-0000-0000-000000000002',
      'MEMBERSHIP',
      decode(repeat('44', 32), 'hex'),
      'SEARCH',
      transaction_timestamp(),
      60,
      1,
      transaction_timestamp() + interval '60 seconds'
    );
    RAISE EXCEPTION 'API inserted a cross-workspace rate bucket';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE uptech.audit_events
    SET metadata = '{"tampered":true}'::jsonb;
    RAISE EXCEPTION 'API updated append-only audit data';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END
$verify$;

DO $verify$
BEGIN
  BEGIN
    INSERT INTO uptech.audit_events (
      workspace_id,
      id,
      actor_kind,
      actor_id,
      membership_id,
      session_id,
      action,
      target_type,
      target_id,
      outcome,
      request_id
    ) VALUES (
      'a1000000-0000-0000-0000-000000000001',
      '31000000-0000-0000-0000-000000000004',
      'USER',
      'b2000000-0000-0000-0000-000000000002',
      'd1000000-0000-0000-0000-000000000001',
      '11000000-0000-0000-0000-000000000001',
      'FORGED_AUDIT_TEST',
      'WORKSPACE',
      'a1000000-0000-0000-0000-000000000001',
      'SUCCEEDED',
      '51000000-0000-0000-0000-000000000004'
    );
    RAISE EXCEPTION 'API forged tenant audit attribution';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END
$verify$;

DO $verify$
DECLARE
  current_window timestamptz := pg_catalog.to_timestamp(
    pg_catalog.floor(
      extract(epoch FROM pg_catalog.statement_timestamp()) / 60
    ) * 60
  );
BEGIN
  BEGIN
    INSERT INTO uptech.rate_limit_buckets (
      workspace_id,
      scope_kind,
      scope_hash,
      route_class,
      window_started_at,
      window_seconds,
      request_count,
      expires_at
    ) VALUES (
      'a1000000-0000-0000-0000-000000000001',
      'MEMBERSHIP',
      decode(repeat('44', 32), 'hex'),
      'SEARCH',
      current_window,
      60,
      1,
      current_window + interval '60 seconds'
    );
    RAISE EXCEPTION 'API forged a tenant rate-limit scope hash';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    DELETE FROM uptech.rate_limit_buckets;
    RAISE EXCEPTION 'API deleted tenant rate-limit buckets';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END
$verify$;

SELECT set_config('app.workspace_id', 'a2000000-0000-0000-0000-000000000002', true);

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM uptech.workspaces) THEN
    RAISE EXCEPTION 'mismatched workspace/actor/membership context was accepted';
  END IF;
END
$verify$;

SELECT set_config('app.workspace_id', 'a1000000-0000-0000-0000-000000000001', true);

INSERT INTO uptech.audit_events (
  workspace_id,
  id,
  actor_kind,
  actor_id,
  membership_id,
  session_id,
  action,
  target_type,
  target_id,
  outcome,
  request_id,
  metadata
)
VALUES (
  'a1000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000003',
  'USER',
  'b1000000-0000-0000-0000-000000000001',
  'd1000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  'AUDIT_APPEND_TEST',
  'WORKSPACE',
  'a1000000-0000-0000-0000-000000000001',
  'SUCCEEDED',
  '51000000-0000-0000-0000-000000000003',
  '{"fixture":true}'::jsonb
);

INSERT INTO uptech.rate_limit_buckets (
  workspace_id,
  scope_kind,
  scope_hash,
  route_class,
  window_started_at,
  window_seconds,
  request_count,
  expires_at
)
VALUES (
  'a1000000-0000-0000-0000-000000000001',
  'MEMBERSHIP',
  pg_catalog.sha256(
    pg_catalog.convert_to(
      'd1000000-0000-0000-0000-000000000001',
      'UTF8'
    )
  ),
  'SEARCH',
  pg_catalog.to_timestamp(
    pg_catalog.floor(
      extract(epoch FROM pg_catalog.statement_timestamp()) / 60
    ) * 60
  ),
  60,
  1,
  pg_catalog.to_timestamp(
    pg_catalog.floor(
      extract(epoch FROM pg_catalog.statement_timestamp()) / 60
    ) * 60
  ) + interval '60 seconds'
)
ON CONFLICT (
  workspace_id,
  scope_kind,
  scope_hash,
  route_class,
  window_started_at
)
DO UPDATE SET
  request_count = uptech.rate_limit_buckets.request_count + 1,
  updated_at = transaction_timestamp();

DO $verify$
BEGIN
  BEGIN
    UPDATE uptech.rate_limit_buckets
    SET request_count = request_count;
    RAISE EXCEPTION 'API rewound or replayed a tenant rate-limit counter';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END
$verify$;

RESET ROLE;
SET LOCAL ROLE uptech_migration_owner;

DO $verify$
BEGIN
  BEGIN
    UPDATE uptech.audit_events
    SET metadata = '{"tampered_by_owner":true}'::jsonb
    WHERE workspace_id = 'a1000000-0000-0000-0000-000000000001'
      AND id = '31000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'append-only trigger allowed audit mutation';
  EXCEPTION
    WHEN object_not_in_prerequisite_state THEN NULL;
  END;
END
$verify$;

RESET ROLE;
SET LOCAL ROLE uptech_worker_runtime;

DO $verify$
BEGIN
  BEGIN
    PERFORM * FROM uptech.authenticate_session(decode(repeat('11', 32), 'hex'));
    RAISE EXCEPTION 'worker executed session bootstrap routine';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END
$verify$;

SELECT set_config('app.workspace_id', 'a1000000-0000-0000-0000-000000000001', true);
SELECT set_config('app.actor_id', 'e1000000-0000-0000-0000-000000000001', true);
SELECT set_config('app.membership_id', '', true);
SELECT set_config('app.session_id', '', true);
SELECT set_config('app.job_id', '41000000-0000-0000-0000-000000000001', true);
SELECT set_config('app.connector_id', 'f1000000-0000-0000-0000-000000000001', true);
SELECT set_config('app.source_id', '', true);
SELECT set_config('app.lease_fence', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM uptech.sync_jobs) THEN
    RAISE EXCEPTION 'worker-provided GUC values authorized an unleased job';
  END IF;
END
$verify$;

SELECT * FROM uptech.lease_next_job()
\gset leased_

SELECT set_config('app.workspace_id', :'leased_workspace_id', true);
SELECT set_config('app.actor_id', :'leased_service_actor_id', true);
SELECT set_config('app.job_id', :'leased_job_id', true);
SELECT set_config('app.connector_id', :'leased_connector_id', true);
SELECT set_config('app.source_id', '', true);
SELECT set_config('app.lease_fence', :'leased_lease_fence', true);
SELECT set_config('verify.first_lease_fence', :'leased_lease_fence', true);
SELECT set_config('verify.first_job_id', :'leased_job_id', true);

DO $verify$
BEGIN
  IF (SELECT count(*) FROM uptech.sync_jobs) <> 1 THEN
    RAISE EXCEPTION 'worker context did not expose exactly its leased job';
  END IF;

  IF EXISTS (SELECT 1 FROM uptech.lease_next_job()) THEN
    RAISE EXCEPTION 'the same active lease was returned twice';
  END IF;
END
$verify$;

RESET ROLE;
SET LOCAL ROLE uptech_migration_owner;

-- Simulate a long-running worker whose transaction began while the lease was
-- valid. statement_timestamp(), unlike transaction_timestamp(), must reject
-- its next statement after the lease expires.
UPDATE uptech.sync_jobs
SET leased_at = statement_timestamp() - interval '10 minutes',
    lease_expires_at = statement_timestamp() - interval '5 minutes'
WHERE workspace_id = :'leased_workspace_id'::uuid
  AND id = :'leased_job_id'::uuid;

RESET ROLE;
SET LOCAL ROLE uptech_worker_runtime;

DO $verify$
DECLARE
  affected_rows integer;
BEGIN
  IF EXISTS (SELECT 1 FROM uptech.sync_jobs) THEN
    RAISE EXCEPTION 'an expired lease remained visible at statement time';
  END IF;

  UPDATE uptech.sync_jobs
  SET status = 'FAILED',
      completed_at = statement_timestamp(),
      updated_at = statement_timestamp()
  WHERE workspace_id = 'a1000000-0000-0000-0000-000000000001'
    AND id = '41000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 0 THEN
    RAISE EXCEPTION 'an expired lease updated its job';
  END IF;

  BEGIN
    INSERT INTO uptech.audit_events (
      workspace_id, id, actor_kind, actor_id, action, target_type,
      target_id, outcome, request_id, metadata
    ) VALUES (
      'a1000000-0000-0000-0000-000000000001',
      '31000000-0000-0000-0000-000000000005',
      'SERVICE',
      'e1000000-0000-0000-0000-000000000001',
      'EXPIRED_LEASE_MUST_NOT_AUDIT',
      'SYNC_JOB',
      '41000000-0000-0000-0000-000000000001',
      'DENIED',
      '51000000-0000-0000-0000-000000000005',
      '{}'::jsonb
    );
    RAISE EXCEPTION 'an expired lease appended a worker audit event';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END
$verify$;

-- The existing privileged routine re-leases the expired job and must rotate
-- the fence. No direct worker UPDATE grant can mint or replace this value.
SELECT * FROM uptech.lease_next_job()
\gset re_leased_

SELECT set_config('verify.second_lease_fence', :'re_leased_lease_fence', true);
SELECT set_config('verify.second_job_id', :'re_leased_job_id', true);

DO $verify$
DECLARE
  affected_rows integer;
BEGIN
  IF current_setting('verify.first_job_id') <> current_setting('verify.second_job_id') THEN
    RAISE EXCEPTION 'fixture did not re-lease the same expired job';
  END IF;

  IF current_setting('verify.first_lease_fence') = current_setting('verify.second_lease_fence') THEN
    RAISE EXCEPTION 're-leasing did not rotate the opaque lease fence';
  END IF;

  IF EXISTS (SELECT 1 FROM uptech.sync_jobs) THEN
    RAISE EXCEPTION 'the stale fence authorized a newly active lease';
  END IF;

  UPDATE uptech.sync_jobs
  SET status = 'FAILED',
      completed_at = statement_timestamp(),
      updated_at = statement_timestamp()
  WHERE workspace_id = 'a1000000-0000-0000-0000-000000000001'
    AND id = '41000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 0 THEN
    RAISE EXCEPTION 'a stale fence updated a newly active lease';
  END IF;

  BEGIN
    INSERT INTO uptech.audit_events (
      workspace_id, id, actor_kind, actor_id, action, target_type,
      target_id, outcome, request_id, metadata
    ) VALUES (
      'a1000000-0000-0000-0000-000000000001',
      '31000000-0000-0000-0000-000000000006',
      'SERVICE',
      'e1000000-0000-0000-0000-000000000001',
      'STALE_FENCE_MUST_NOT_AUDIT',
      'SYNC_JOB',
      '41000000-0000-0000-0000-000000000001',
      'DENIED',
      '51000000-0000-0000-0000-000000000006',
      '{}'::jsonb
    );
    RAISE EXCEPTION 'a stale fence appended a worker audit event';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END
$verify$;

SELECT set_config('app.workspace_id', :'re_leased_workspace_id', true);
SELECT set_config('app.actor_id', :'re_leased_service_actor_id', true);
SELECT set_config('app.job_id', :'re_leased_job_id', true);
SELECT set_config('app.connector_id', :'re_leased_connector_id', true);
SELECT set_config('app.source_id', '', true);
SELECT set_config('app.lease_fence', :'re_leased_lease_fence', true);

DO $verify$
BEGIN
  IF (SELECT count(*) FROM uptech.sync_jobs) <> 1 THEN
    RAISE EXCEPTION 'the current re-leased fence did not authorize its job';
  END IF;
END
$verify$;

UPDATE uptech.sync_jobs
SET status = 'SUCCEEDED',
    completed_at = transaction_timestamp(),
    updated_at = transaction_timestamp()
WHERE workspace_id = :'re_leased_workspace_id'::uuid
  AND id = :'re_leased_job_id'::uuid;

INSERT INTO uptech.audit_events (
  workspace_id,
  id,
  actor_kind,
  actor_id,
  membership_id,
  session_id,
  action,
  target_type,
  target_id,
  outcome,
  request_id,
  metadata
)
VALUES (
  :'re_leased_workspace_id'::uuid,
  '31000000-0000-0000-0000-000000000004',
  'SERVICE',
  :'re_leased_service_actor_id'::uuid,
  NULL,
  NULL,
  'SYNC_JOB_TEST_COMPLETED',
  'SYNC_JOB',
  :'re_leased_job_id'::uuid,
  'SUCCEEDED',
  '51000000-0000-0000-0000-000000000004',
  '{"fixture":true}'::jsonb
);

RESET ROLE;
SET LOCAL ROLE uptech_migration_owner;

DO $verify$
BEGIN
  IF (
    SELECT status <> 'SUCCEEDED' OR attempt_count <> 2
    FROM uptech.sync_jobs
    WHERE workspace_id = 'a1000000-0000-0000-0000-000000000001'
      AND id = '41000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'worker lease generation count or completion is incorrect';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM uptech.audit_events
    WHERE workspace_id = 'a1000000-0000-0000-0000-000000000001'
      AND id = '31000000-0000-0000-0000-000000000004'
      AND actor_kind = 'SERVICE'
  ) THEN
    RAISE EXCEPTION 'worker audit append was not persisted in the transaction';
  END IF;

  IF EXISTS (
    SELECT 1 FROM uptech.audit_events
    WHERE id IN (
      '31000000-0000-0000-0000-000000000005',
      '31000000-0000-0000-0000-000000000006'
    )
  ) THEN
    RAISE EXCEPTION 'expired or stale lease audit event escaped RLS';
  END IF;
END
$verify$;

ROLLBACK;

\echo 'Phase 1 PostgreSQL foundation verification passed (transaction rolled back).'
