\set ON_ERROR_STOP on

-- Run after 0009 against a disposable database. Catalog checks and behavior probes
-- execute in one transaction; nothing in this verifier persists.
BEGIN;

DO $verify$
DECLARE
  mismatch_count integer;
BEGIN
  SELECT count(*) INTO mismatch_count
  FROM (VALUES
    ('google_workspace_domain_kind_v1', ARRAY['PRIMARY','SECONDARY','ALIAS']::text[]),
    ('google_workspace_bootstrap_attempt_state_v1', ARRAY['PREPARED','COMMITTED','ABORTED']::text[]),
    ('workspace_access_request_status_v1', ARRAY['PENDING','FULFILLED','CANCELLED']::text[]),
    ('google_login_access_state_v2', ARRAY[
      'UNKNOWN_WORKSPACE','USER_NOT_PROVISIONED','ACCESS_MAPPING_CONFLICT',
      'USER_SUSPENDED','USER_REMOVED','DIRECTORY_SYNC_PENDING','DIRECTORY_STALE',
      'DIRECTORY_STALE_ACCESS_REQUEST_AVAILABLE','WORKSPACE_SUSPENDED']::text[])
  ) AS required(type_name, labels)
  WHERE required.labels IS DISTINCT FROM (
    SELECT array_agg(enum_row.enumlabel::text ORDER BY enum_row.enumsortorder)
    FROM pg_catalog.pg_type AS type_row
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = type_row.typnamespace
    JOIN pg_catalog.pg_enum AS enum_row ON enum_row.enumtypid = type_row.oid
    WHERE namespace.nspname = 'uptech' AND type_row.typname = required.type_name
  );
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'Task 2 enum type is missing or has incorrect labels';
  END IF;

  IF pg_catalog.to_regtype('uptech.google_workspace_verified_domain_v1') IS NULL
     OR (SELECT array_agg(attribute.attname ORDER BY attribute.attnum)
         FROM pg_catalog.pg_attribute AS attribute
         WHERE attribute.attrelid = (
           SELECT type_row.typrelid FROM pg_catalog.pg_type AS type_row
           WHERE type_row.oid = 'uptech.google_workspace_verified_domain_v1'::regtype)
           AND attribute.attnum > 0 AND NOT attribute.attisdropped)
        IS DISTINCT FROM ARRAY['normalized_domain','domain_kind','provider_parent_domain']::name[]
  THEN
    RAISE EXCEPTION 'verified-domain composite shape is missing or incorrect';
  END IF;
END
$verify$;

DO $verify$
DECLARE
  missing_count integer;
BEGIN
  SELECT count(*) INTO missing_count
  FROM (VALUES
    ('onboarding_sessions','resource_workspace_id'),
    ('workspace_domain_locators','google_customer_id'),
    ('workspace_domain_locators','domain_kind'),
    ('workspace_domain_locators','provider_parent_domain'),
    ('connectors','directory_authorized_by_identity_id'),
    ('google_workspace_bootstrap_attempts','id'),
    ('google_workspace_bootstrap_attempts','source_onboarding_session_id'),
    ('google_workspace_bootstrap_attempts','candidate_status_hash'),
    ('google_workspace_bootstrap_attempts','retain_until'),
    ('google_workspace_bootstrap_receipts','attempt_id'),
    ('google_workspace_bootstrap_receipts','initial_status_onboarding_session_id'),
    ('workspace_access_requests','workspace_id'),
    ('workspace_access_requests','identity_id'),
    ('workspace_access_requests','reason_class'),
    ('workspace_access_requests','status')
  ) AS required(table_name, column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = pg_catalog.to_regclass('uptech.' || required.table_name)
      AND attribute.attname = required.column_name AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  );
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'Task 2 relation or required column is missing';
  END IF;

  SELECT count(*) INTO missing_count
  FROM (VALUES
    ('workspaces_workspace_customer_unique','u'),
    ('onboarding_sessions_resource_workspace_fk','f'),
    ('onboarding_sessions_operations_check','c'),
    ('onboarding_sessions_expiry_check','c'),
    ('workspace_domain_locators_customer_shape_check','c'),
    ('workspace_domain_locators_workspace_customer_fk','f'),
    ('workspace_domain_locators_workspace_customer_domain_unique','u'),
    ('workspace_domain_locators_alias_parent_fk','f'),
    ('connectors_directory_authorized_identity_fk','f'),
    ('connectors_directory_setup_metadata_check','c'),
    ('people_permission_mappings_source_check','c'),
    ('people_permission_mappings_target_check','c'),
    ('google_workspace_bootstrap_attempts_identity_fk','f'),
    ('google_workspace_bootstrap_attempts_candidate_workspace_unique','u'),
    ('google_workspace_bootstrap_attempts_candidate_status_hash_uniqu','u'),
    ('google_workspace_bootstrap_attempts_receipt_binding_unique','u'),
    ('google_workspace_bootstrap_attempts_deadline_check','c'),
    ('google_workspace_bootstrap_attempts_state_check','c'),
    ('google_workspace_bootstrap_attempts_timestamps_check','c'),
    ('google_workspace_bootstrap_receipts_attempt_binding_fk','f'),
    ('google_workspace_bootstrap_receipts_identity_fk','f'),
    ('google_workspace_bootstrap_receipts_workspace_fk','f'),
    ('google_workspace_bootstrap_receipts_connector_fk','f'),
    ('google_workspace_bootstrap_receipts_connector_unique','u'),
    ('workspace_access_requests_workspace_fk','f'),
    ('workspace_access_requests_identity_fk','f'),
    ('workspace_access_requests_reason_check','c'),
    ('workspace_access_requests_state_check','c'),
    ('workspace_access_requests_timestamps_check','c')
  ) AS required(constraint_name, constraint_type)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS constraint_row
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = constraint_row.connamespace
    WHERE namespace.nspname = 'uptech'
      AND constraint_row.conname = required.constraint_name
      AND constraint_row.contype = required.constraint_type::"char"
      AND constraint_row.convalidated
  );
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'Task 2 constraint is missing, wrong-kind, or unvalidated';
  END IF;
END
$verify$;

DO $verify$
DECLARE
  missing_count integer;
BEGIN
  SELECT count(*) INTO missing_count
  FROM (VALUES
    ('workspace_domain_locators_one_primary_customer', '(domain_kind = ''PRIMARY''::uptech.google_workspace_domain_kind_v1)'),
    ('service_actors_one_active_sync_worker', '((actor_kind = ''SYNC_WORKER''::text) AND (status = ''ACTIVE''::text))'),
    ('google_workspace_bootstrap_attempts_one_live_source', '(state = ''PREPARED''::uptech.google_workspace_bootstrap_attempt_state_v1)'),
    ('workspace_access_requests_one_pending_identity_reason', '(status = ''PENDING''::uptech.workspace_access_request_status_v1)')
  ) AS required(index_name, predicate)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index AS index_row
    JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index_row.indexrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = index_relation.relnamespace
    WHERE namespace.nspname = 'uptech' AND index_relation.relname = required.index_name
      AND index_row.indisunique AND index_row.indisvalid
      AND pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid) = required.predicate
  );
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'Task 2 partial unique index or predicate is missing';
  END IF;

  SELECT count(*) INTO missing_count
  FROM (VALUES
    ('workspace_domain_locators_alias_parent_check','enforce_workspace_domain_alias_parent_v1'),
    ('google_workspace_bootstrap_attempts_transition_guard','enforce_google_workspace_bootstrap_attempt_transition_v1'),
    ('google_workspace_bootstrap_receipts_committed_attempt','enforce_google_workspace_bootstrap_receipt_v1'),
    ('google_workspace_bootstrap_receipts_immutable','enforce_google_workspace_bootstrap_receipt_v1'),
    ('workspace_access_requests_transition_guard','enforce_workspace_access_request_transition_v1')
  ) AS required(trigger_name, function_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgname = required.trigger_name
      AND NOT trigger_row.tgisinternal AND trigger_row.tgenabled <> 'D'
      AND trigger_row.tgfoid = pg_catalog.to_regprocedure('uptech.' || required.function_name || '()')
  );
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'Task 2 enforcement trigger is missing or disabled';
  END IF;
END
$verify$;

DO $verify$
DECLARE
  relation_oid oid := 'uptech.workspace_access_requests'::regclass;
BEGIN
  IF NOT (SELECT relation.relrowsecurity AND relation.relforcerowsecurity
          FROM pg_catalog.pg_class AS relation WHERE relation.oid = relation_oid)
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy AS policy
       WHERE policy.polrelid = relation_oid
         AND policy.polname = 'workspace_access_requests_migration_owner'
         AND policy.polcmd = '*' AND policy.polpermissive
         AND policy.polroles = ARRAY['uptech_migration_owner'::regrole::oid]
         AND pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) = 'true'
         AND pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid) = 'true'
     )
     OR (SELECT count(*) FROM pg_catalog.pg_policy AS policy
         WHERE policy.polrelid = relation_oid) <> 1
  THEN
    RAISE EXCEPTION 'workspace access requests require forced RLS and the exact owner policy';
  END IF;
END
$verify$;

DO $verify$
DECLARE
  object_oid oid;
BEGIN
  FOREACH object_oid IN ARRAY ARRAY[
    'uptech.onboarding_operations_are_unique_v1(text[])'::regprocedure::oid,
    'uptech.directory_scopes_are_supported_v1(text[])'::regprocedure::oid,
    'uptech.enforce_workspace_domain_alias_parent_v1()'::regprocedure::oid,
    'uptech.normalize_google_workspace_verified_domains_v1(text,uptech.google_workspace_verified_domain_v1[])'::regprocedure::oid,
    'uptech.enforce_google_workspace_bootstrap_attempt_transition_v1()'::regprocedure::oid,
    'uptech.enforce_google_workspace_bootstrap_receipt_v1()'::regprocedure::oid,
    'uptech.enforce_workspace_access_request_transition_v1()'::regprocedure::oid
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS procedure_row
      WHERE procedure_row.oid = object_oid
        AND (procedure_row.prosecdef
          OR procedure_row.proowner <> 'uptech_migration_owner'::regrole::oid
          OR procedure_row.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, uptech']::text[])
    ) OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS procedure_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
        procedure_row.proacl, pg_catalog.acldefault('f', procedure_row.proowner))) AS acl
      WHERE procedure_row.oid = object_oid
        AND (acl.grantee <> 'uptech_migration_owner'::regrole::oid
          OR acl.privilege_type <> 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'Task 2 routine % has wrong definer/search_path/grants', object_oid::regprocedure;
    END IF;
  END LOOP;

  FOREACH object_oid IN ARRAY ARRAY[
    'uptech.google_workspace_bootstrap_attempts'::regclass::oid,
    'uptech.google_workspace_bootstrap_receipts'::regclass::oid,
    'uptech.workspace_access_requests'::regclass::oid
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_class AS relation
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
        relation.relacl, pg_catalog.acldefault('r', relation.relowner))) AS acl
      WHERE relation.oid = object_oid
        AND acl.grantee <> 'uptech_migration_owner'::regrole::oid
    ) OR NOT pg_catalog.has_table_privilege('uptech_migration_owner', object_oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    THEN
      RAISE EXCEPTION 'Task 2 table % has non-owner grants or lacks owner grants', object_oid::regclass;
    END IF;
  END LOOP;
END
$verify$;

-- Catalog/ACL checks above intentionally evaluate the runtime roles' denied
-- privileges. The normalization behavior probe itself is owner-only.
RESET ROLE;
SET LOCAL ROLE uptech_migration_owner;

-- Behavioral probes for deterministic normalization and operation-family bounds.
DO $verify$
DECLARE
  normalized uptech.google_workspace_verified_domain_v1[];
  legacy_scopes text[] := ARRAY[
    'https://www.googleapis.com/auth/admin.directory.customer.readonly',
    'https://www.googleapis.com/auth/admin.directory.user.readonly',
    'https://www.googleapis.com/auth/admin.directory.group.readonly',
    'https://www.googleapis.com/auth/admin.directory.orgunit.readonly'];
BEGIN
  IF EXISTS (SELECT 1 FROM uptech.onboarding_sessions
      WHERE allowed_operations <@ ARRAY['ACCESS_REQUEST_READ','ACCESS_REQUEST_SUBMIT']::text[]
        AND resource_workspace_id IS NULL)
     OR EXISTS (SELECT 1 FROM uptech.onboarding_sessions
      WHERE allowed_operations && ARRAY['FIRST_DOMAIN_CLAIM_READ','FIRST_DOMAIN_CLAIM_RESERVE','FIRST_DOMAIN_CLAIM_COMPLETE']::text[]
        AND allowed_operations && ARRAY['ACCESS_REQUEST_READ','ACCESS_REQUEST_SUBMIT']::text[])
  THEN RAISE EXCEPTION 'legacy onboarding capabilities were not safely reconciled';
  END IF;

  IF NOT uptech.directory_scopes_are_supported_v1(legacy_scopes)
     OR NOT uptech.directory_scopes_are_supported_v1(legacy_scopes || ARRAY['https://www.googleapis.com/auth/admin.directory.domain.readonly'])
     OR uptech.directory_scopes_are_supported_v1(legacy_scopes || ARRAY[legacy_scopes[1]])
     OR uptech.directory_scopes_are_supported_v1(legacy_scopes || ARRAY['unknown'])
  THEN RAISE EXCEPTION 'Directory scope predicate does not enforce exact four/five sets';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='uptech' AND p.proname IN ('activate_directory_connector_v1','lease_next_directory_job_v1')
        AND p.prosrc NOT LIKE '%directory_scopes_are_supported_v1%')
  THEN RAISE EXCEPTION 'Directory activation/lease routines do not use exact supported scopes';
  END IF;

  normalized := uptech.normalize_google_workspace_verified_domains_v1(
    ' Example.COM ', ARRAY[
      ROW('alias.example.com','ALIAS','example.com')::uptech.google_workspace_verified_domain_v1,
      ROW(' Example.COM ','PRIMARY',NULL)::uptech.google_workspace_verified_domain_v1,
      ROW('alias.example.com','ALIAS','example.com')::uptech.google_workspace_verified_domain_v1
    ]);
  IF cardinality(normalized) <> 2 OR (normalized[1]).normalized_domain <> 'alias.example.com'
     OR (normalized[2]).normalized_domain <> 'example.com' THEN
    RAISE EXCEPTION 'verified-domain normalization is not deterministic or deduplicating';
  END IF;

  BEGIN
    PERFORM uptech.normalize_google_workspace_verified_domains_v1(
      'example.com', ARRAY[ROW('alias.example.com','ALIAS','missing.example.com')
        ::uptech.google_workspace_verified_domain_v1]);
    RAISE EXCEPTION 'invalid alias provenance was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
END
$verify$;

ROLLBACK;

\echo 'Google Workspace tenant bootstrap verification passed (transaction rolled back).'
