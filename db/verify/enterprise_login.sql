\set ON_ERROR_STOP on

-- Run after 0008_google_directory_production.sql against a disposable database. Nothing
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
    ('people_org_units'),
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
    ('people_org_units_generation_fk'),
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

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_row
    JOIN pg_catalog.pg_class AS index_relation
      ON index_relation.oid = index_row.indexrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = index_relation.relnamespace
    WHERE namespace.nspname = 'uptech'
      AND index_relation.relname = 'workspaces_google_customer_unique'
      AND index_row.indisunique
      AND index_row.indpred IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'global Google customer-to-workspace uniqueness is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_row
    JOIN pg_catalog.pg_class AS index_relation
      ON index_relation.oid = index_row.indexrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = index_relation.relnamespace
    WHERE namespace.nspname = 'uptech'
      AND index_relation.relname = 'connectors_one_live_directory_workspace'
      AND index_row.indisunique
      AND index_row.indpred IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'one-live-Directory-connector-per-workspace invariant is missing';
  END IF;
END
$verify$;

DO $verify$
DECLARE
  begin_oid regprocedure :=
    'uptech.begin_people_sync_generation_v1(uuid,uuid,uuid,uuid)'::regprocedure;
  credential_reference_oid regprocedure :=
    'uptech.resolve_directory_connector_credential_reference_v1()'::regprocedure;
  profile_oid regprocedure :=
    'uptech.stage_people_profile_v1(uuid,uuid,uuid,text,text,text,text,text)'::regprocedure;
  profile_v2_oid regprocedure :=
    'uptech.stage_people_profile_v2(uuid,uuid,uuid,text,text,text,text,text,text,boolean,boolean)'::regprocedure;
  customer_oid regprocedure :=
    'uptech.stage_people_directory_customer_v1(uuid,uuid,uuid,text,text)'::regprocedure;
  org_unit_oid regprocedure :=
    'uptech.stage_people_org_unit_v1(uuid,uuid,uuid,text,text,text)'::regprocedure;
  group_oid regprocedure :=
    'uptech.stage_people_group_v1(uuid,uuid,uuid,text,text)'::regprocedure;
  edge_oid regprocedure :=
    'uptech.stage_people_group_membership_v1(uuid,uuid,uuid,text,text)'::regprocedure;
  publish_oid regprocedure :=
    'uptech.publish_people_sync_generation_v1(uuid,uuid,uuid,boolean,timestamp with time zone,uuid)'::regprocedure;
  context_oid regprocedure :=
    'uptech.load_people_permission_context_v1()'::regprocedure;
  consent_preparation_oid regprocedure :=
    'uptech.prepare_directory_consent_v1(uuid)'::regprocedure;
  connector_activation_oid regprocedure :=
    'uptech.activate_directory_connector_v1(uuid,text,text,text,text,text[],uuid)'::regprocedure;
  directory_lease_oid regprocedure :=
    'uptech.lease_next_directory_job_v1()'::regprocedure;
  people_authority_oid regprocedure :=
    'uptech.has_current_people_authority_v1(uuid,uuid,uuid,uuid)'::regprocedure;
  web_completion_oid regprocedure :=
    'uptech.complete_web_google_login_directory_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)'::regprocedure;
  legacy_web_completion_oid regprocedure :=
    'uptech.complete_web_google_login_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)'::regprocedure;
  mobile_completion_oid regprocedure :=
    'uptech.complete_mobile_google_callback_directory_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uuid)'::regprocedure;
  legacy_mobile_completion_oid regprocedure :=
    'uptech.complete_mobile_google_callback_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uuid)'::regprocedure;
  mobile_memberships_oid regprocedure :=
    'uptech.mobile_directory_memberships_json_v1(uuid,uuid)'::regprocedure;
  mobile_exchange_oid regprocedure :=
    'uptech.exchange_mobile_handoff_directory_v1(uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)'::regprocedure;
  mobile_authenticate_oid regprocedure :=
    'uptech.authenticate_mobile_access_directory_v1(uptech.google_auth_hash32_v1)'::regprocedure;
  mobile_list_oid regprocedure :=
    'uptech.list_mobile_workspaces_directory_v1(uptech.google_auth_hash32_v1)'::regprocedure;
  mobile_refresh_oid regprocedure :=
    'uptech.rotate_mobile_refresh_directory_v1(uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,bytea,uptech.google_auth_ascii_identifier_v1,uuid)'::regprocedure;
  mobile_switch_oid regprocedure :=
    'uptech.switch_mobile_workspace_directory_v1(uptech.google_auth_hash32_v1,uuid,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,bytea,uptech.google_auth_ascii_identifier_v1,uuid)'::regprocedure;
  legacy_mobile_exchange_v1_oid regprocedure :=
    'uptech.exchange_mobile_handoff_v1(uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)'::regprocedure;
  legacy_mobile_exchange_v2_oid regprocedure :=
    'uptech.exchange_mobile_handoff_v2(uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)'::regprocedure;
  legacy_mobile_authenticate_oid regprocedure :=
    'uptech.authenticate_mobile_access_v1(uptech.google_auth_hash32_v1)'::regprocedure;
  legacy_mobile_list_oid regprocedure :=
    'uptech.list_mobile_workspaces_v1(uptech.google_auth_hash32_v1)'::regprocedure;
  legacy_mobile_refresh_oid regprocedure :=
    'uptech.rotate_mobile_refresh_v1(uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,bytea,uptech.google_auth_ascii_identifier_v1,uuid)'::regprocedure;
  legacy_mobile_switch_oid regprocedure :=
    'uptech.switch_mobile_workspace_v1(uptech.google_auth_hash32_v1,uuid,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,bytea,uptech.google_auth_ascii_identifier_v1,uuid)'::regprocedure;
  routine_oid oid;
BEGIN
  FOREACH routine_oid IN ARRAY ARRAY[
    begin_oid::oid, credential_reference_oid::oid, profile_oid::oid, profile_v2_oid::oid,
    customer_oid::oid, org_unit_oid::oid, group_oid::oid, edge_oid::oid,
    publish_oid::oid, context_oid::oid, consent_preparation_oid::oid,
    connector_activation_oid::oid,
    directory_lease_oid::oid,
    people_authority_oid::oid, web_completion_oid::oid, mobile_completion_oid::oid,
    mobile_memberships_oid::oid,
    mobile_exchange_oid::oid, mobile_authenticate_oid::oid,
    mobile_list_oid::oid, mobile_refresh_oid::oid, mobile_switch_oid::oid
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
      'uptech_worker_runtime', credential_reference_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
      'uptech_worker_runtime', profile_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
      'uptech_worker_runtime', profile_v2_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
      'uptech_worker_runtime', customer_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
      'uptech_worker_runtime', org_unit_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
      'uptech_worker_runtime', group_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
      'uptech_worker_runtime', edge_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
      'uptech_worker_runtime', publish_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
      'uptech_worker_runtime', directory_lease_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
      'uptech_api_runtime', begin_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
      'uptech_api_runtime', credential_reference_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
      'uptech_api_runtime', profile_v2_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
      'uptech_api_runtime', customer_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
      'uptech_api_runtime', org_unit_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
      'uptech_api_runtime', publish_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
      'uptech_api_runtime', directory_lease_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'People worker routine role separation is incorrect';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
       'uptech_api_runtime', context_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
      'uptech_worker_runtime', context_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'People context routine role separation is incorrect';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
       'uptech_api_runtime', consent_preparation_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'uptech_worker_runtime', consent_preparation_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
       'uptech_api_runtime', connector_activation_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'uptech_worker_runtime', connector_activation_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Directory consent/activation role separation is incorrect';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
       'uptech_api_runtime', web_completion_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'uptech_worker_runtime', web_completion_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
       'uptech_api_runtime', legacy_web_completion_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'web Directory expansion compatibility is incorrect';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
       'uptech_api_runtime', mobile_completion_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'uptech_worker_runtime', mobile_completion_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
       'uptech_api_runtime', legacy_mobile_completion_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'mobile Directory expansion compatibility is incorrect';
  END IF;

  IF pg_catalog.has_function_privilege(
       'uptech_api_runtime', people_authority_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'uptech_worker_runtime', people_authority_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'uptech_api_runtime', mobile_memberships_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'uptech_worker_runtime', mobile_memberships_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'internal People/mobile helpers are directly executable';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
       'uptech_api_runtime', mobile_exchange_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
       'uptech_api_runtime', mobile_authenticate_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
       'uptech_api_runtime', mobile_list_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
       'uptech_api_runtime', mobile_refresh_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
       'uptech_api_runtime', mobile_switch_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'uptech_worker_runtime', mobile_exchange_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'uptech_worker_runtime', mobile_authenticate_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'uptech_worker_runtime', mobile_list_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'uptech_worker_runtime', mobile_refresh_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'uptech_worker_runtime', mobile_switch_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'mobile Directory wrapper role separation is incorrect';
  END IF;

  IF pg_catalog.has_function_privilege(
       'uptech_api_runtime', legacy_mobile_exchange_v1_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
       'uptech_api_runtime', legacy_mobile_exchange_v2_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
       'uptech_api_runtime', legacy_mobile_authenticate_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
       'uptech_api_runtime', legacy_mobile_list_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
       'uptech_api_runtime', legacy_mobile_refresh_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
       'uptech_api_runtime', legacy_mobile_switch_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'legacy mobile expansion compatibility is incorrect';
  END IF;

  IF pg_catalog.pg_get_function_result(context_oid) <>
     'TABLE(workspace_id uuid, membership_role text, department_key text, direct_group_ids text[])' THEN
    RAISE EXCEPTION 'People permission context exposes an unexpected shape';
  END IF;

  IF pg_catalog.pg_get_function_result(consent_preparation_oid) <>
     'TABLE(outcome text, connector_id uuid, provider_subject text, provider_email text, hosted_domain text)' THEN
    RAISE EXCEPTION 'Directory consent preparation exposes an unexpected shape';
  END IF;

  IF pg_catalog.pg_get_function_result(connector_activation_oid) <>
     'TABLE(outcome text, previous_credential_reference text)' THEN
    RAISE EXCEPTION 'Directory connector activation exposes an unexpected shape';
  END IF;

  IF pg_catalog.to_regprocedure(
       'uptech.activate_directory_connector_v1(uuid,text,text,uuid,text[],uuid)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'legacy caller-supplied identity activation remains executable';
  END IF;
END
$verify$;

DO $verify$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'people_sync_generations', 'people_profiles', 'people_org_units', 'people_groups',
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
