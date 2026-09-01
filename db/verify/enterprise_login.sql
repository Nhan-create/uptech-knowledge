\set ON_ERROR_STOP on

-- Run after 0007_enterprise_login.sql against a disposable database. Nothing
-- in this verifier persists.
BEGIN;

DO $verify$
DECLARE
  missing_or_unprotected integer;
  forbidden_count integer;
BEGIN
  SELECT count(*) INTO missing_or_unprotected
  FROM (VALUES
    ('people_sync_generations'),
    ('people_profiles'),
    ('people_groups'),
    ('people_group_memberships'),
    ('people_permission_mappings')
  ) AS required(table_name)
  LEFT JOIN pg_catalog.pg_class AS relation
    ON relation.relname = required.table_name
  LEFT JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
   AND namespace.nspname = 'uptech'
  WHERE relation.oid IS NULL
     OR NOT relation.relrowsecurity
     OR NOT relation.relforcerowsecurity
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_policy AS policy
       WHERE policy.polrelid = relation.oid
         AND policy.polname = required.table_name || '_migration_owner'
         AND policy.polroles = ARRAY['uptech_migration_owner'::regrole::oid]
     );

  IF missing_or_unprotected <> 0 THEN
    RAISE EXCEPTION 'People relations are missing forced RLS or owner policy';
  END IF;

  SELECT count(*) INTO forbidden_count
  FROM (VALUES
    ('enterprise_login_transactions'),
    ('enterprise_discovery_rate_buckets'),
    ('people_data_connections'),
    ('workspace_identity_connections'),
    ('workspace_secret_envelopes'),
    ('workspace_sso_policies'),
    ('workspace_access_groups'),
    ('setup_sessions'),
    ('setup_invitations'),
    ('platform_operators')
  ) AS forbidden(object_name)
  WHERE pg_catalog.to_regclass('uptech.' || forbidden.object_name) IS NOT NULL;

  IF forbidden_count <> 0 THEN
    RAISE EXCEPTION 'removed enterprise/setup/OIDC authority is still present';
  END IF;
END
$verify$;

DO $verify$
DECLARE
  missing_constraint_count integer;
BEGIN
  SELECT count(*) INTO missing_constraint_count
  FROM (VALUES
    ('people_sync_generations_workspace_fk'),
    ('people_sync_generations_connector_fk'),
    ('people_sync_generations_job_fk'),
    ('people_profiles_generation_fk'),
    ('people_groups_generation_fk'),
    ('people_group_memberships_group_fk'),
    ('people_group_memberships_profile_fk'),
    ('people_permission_mappings_workspace_fk')
  ) AS required(constraint_name)
  LEFT JOIN pg_catalog.pg_constraint AS constraint_row
    ON constraint_row.conname = required.constraint_name
   AND constraint_row.contype = 'f'
  WHERE constraint_row.oid IS NULL;

  IF missing_constraint_count <> 0 THEN
    RAISE EXCEPTION 'People tenant/connector/job snapshot foreign key is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_row
    JOIN pg_catalog.pg_class AS index_relation
      ON index_relation.oid = index_row.indexrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = index_relation.relnamespace
    WHERE namespace.nspname = 'uptech'
      AND index_relation.relname = 'people_sync_generations_one_published_workspace'
      AND index_row.indisunique
      AND index_row.indpred IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'one-published-Directory-generation-per-workspace invariant is missing';
  END IF;
END
$verify$;

DO $verify$
DECLARE
  begin_oid regprocedure :=
    'uptech.begin_people_sync_generation_v1(uuid,uuid,uuid,uuid)'::regprocedure;
  profile_oid regprocedure :=
    'uptech.stage_people_profile_v1(uuid,uuid,uuid,text,text,text,text,text)'::regprocedure;
  group_oid regprocedure :=
    'uptech.stage_people_group_v1(uuid,uuid,uuid,text,text)'::regprocedure;
  edge_oid regprocedure :=
    'uptech.stage_people_group_membership_v1(uuid,uuid,uuid,text,text)'::regprocedure;
  publish_oid regprocedure :=
    'uptech.publish_people_sync_generation_v1(uuid,uuid,uuid,boolean,timestamp with time zone,uuid)'::regprocedure;
  context_oid regprocedure :=
    'uptech.load_people_permission_context_v1()'::regprocedure;
  routine_oid oid;
BEGIN
  FOREACH routine_oid IN ARRAY ARRAY[
    begin_oid::oid, profile_oid::oid, group_oid::oid, edge_oid::oid,
    publish_oid::oid, context_oid::oid
  ] LOOP
    IF NOT (SELECT procedure_row.prosecdef
            FROM pg_catalog.pg_proc AS procedure_row
            WHERE procedure_row.oid = routine_oid)
       OR NOT (SELECT procedure_row.proconfig @>
                 ARRAY['search_path=pg_catalog, uptech']::text[]
               FROM pg_catalog.pg_proc AS procedure_row
               WHERE procedure_row.oid = routine_oid)
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.pg_proc AS procedure_row
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(
             procedure_row.proacl,
             pg_catalog.acldefault('f', procedure_row.proowner)
           )
         ) AS acl
         WHERE procedure_row.oid = routine_oid
           AND acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'People routine % is not hardened', routine_oid::regprocedure;
    END IF;
  END LOOP;

  IF NOT pg_catalog.has_function_privilege(
      'uptech_worker_runtime', begin_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
      'uptech_worker_runtime', profile_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
      'uptech_worker_runtime', group_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
      'uptech_worker_runtime', edge_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
      'uptech_worker_runtime', publish_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
      'uptech_api_runtime', begin_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
      'uptech_api_runtime', publish_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'People worker routine role separation is incorrect';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
      'uptech_api_runtime', context_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
      'uptech_worker_runtime', context_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'People context routine role separation is incorrect';
  END IF;

  IF pg_catalog.pg_get_function_result(context_oid) <>
     'TABLE(workspace_id uuid, membership_role text, department_key text, direct_group_ids text[])' THEN
    RAISE EXCEPTION 'People permission context exposes an unexpected shape';
  END IF;
END
$verify$;

DO $verify$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'people_sync_generations', 'people_profiles', 'people_groups',
    'people_group_memberships', 'people_permission_mappings'
  ] LOOP
    IF pg_catalog.has_table_privilege(
         'uptech_api_runtime', 'uptech.' || table_name, 'SELECT')
       OR pg_catalog.has_table_privilege(
         'uptech_worker_runtime', 'uptech.' || table_name, 'SELECT') THEN
      RAISE EXCEPTION 'runtime role has direct People table access: %', table_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure_row.pronamespace
    WHERE namespace.nspname = 'uptech'
      AND (
        procedure_row.proname LIKE '%enterprise_login%'
        OR procedure_row.proname LIKE '%setup_session%'
        OR procedure_row.proname LIKE '%platform_operator%'
        OR procedure_row.proname LIKE '%people_data_connection%'
      )
  ) THEN
    RAISE EXCEPTION 'removed enterprise/setup/OIDC routines are still present';
  END IF;
END
$verify$;

ROLLBACK;
