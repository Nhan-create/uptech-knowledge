\set ON_ERROR_STOP on

-- Production-safe, read-only structural verifier. Run after migration 0009.
-- Behavioral mutation probes remain in disposable PostgreSQL integration tests.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '30s';

DO $verify_read_only$
BEGIN
  IF pg_catalog.current_setting('transaction_read_only') <> 'on' THEN
    RAISE EXCEPTION 'bootstrap verifier requires a read-only transaction';
  END IF;
END
$verify_read_only$;

DO $verify$
DECLARE
  mismatch_count integer;
BEGIN
  SELECT count(*) INTO mismatch_count
  FROM (VALUES
    ('google_workspace_domain_kind_v1', ARRAY['PRIMARY','SECONDARY','ALIAS']::text[]),
    ('google_workspace_bootstrap_attempt_state_v1', ARRAY['PREPARED','COMMITTED','ABORTED']::text[]),
    ('google_workspace_bootstrap_prepare_outcome_v1', ARRAY['PREPARED','DENIED']::text[]),
    ('google_workspace_bootstrap_complete_outcome_v1', ARRAY['PROVISIONING','DENIED']::text[]),
    ('google_workspace_bootstrap_reconcile_outcome_v1', ARRAY['COMMITTED','NOT_COMMITTED','UNKNOWN']::text[]),
    ('google_workspace_bootstrap_abort_outcome_v1', ARRAY['ABORTED','UNKNOWN']::text[]),
    ('google_workspace_bootstrap_status_outcome_v1', ARRAY[
      'DIRECTORY_BOOTSTRAP_SYNC_PENDING','READY',
      'DIRECTORY_BOOTSTRAP_SYNC_FAILED_RETRYABLE',
      'DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED',
      'ONBOARDING_EXPIRED','DENIED']::text[]),
    ('google_workspace_bootstrap_retry_outcome_v1', ARRAY[
      'REQUEUED','DIRECTORY_BOOTSTRAP_SYNC_PENDING','READY',
      'DIRECTORY_BOOTSTRAP_SYNC_FAILED_SUPPORT_REQUIRED',
      'ONBOARDING_EXPIRED','DENIED']::text[]),
    ('google_workspace_bootstrap_finish_outcome_v1', ARRAY['FINISHED','DENIED']::text[]),
    ('google_workspace_bootstrap_reissue_outcome_v1', ARRAY['REISSUED','DENIED']::text[]),
    ('onboarding_capability_revoke_outcome_v1', ARRAY['REVOKED','DENIED']::text[]),
    ('workspace_access_request_submit_outcome_v1', ARRAY['PENDING','DENIED']::text[]),
    ('workspace_access_request_read_outcome_v1', ARRAY['FOUND','DENIED']::text[]),
    ('google_workspace_bootstrap_start_admission_outcome_v1', ARRAY['ADMITTED','RATE_LIMITED','DENIED']::text[]),
    ('google_directory_mapping_outcome_v1', ARRAY[
      'ADMIN','MEMBER','ACCESS_MAPPING_CONFLICT','USER_NOT_PROVISIONED',
      'USER_SUSPENDED','USER_REMOVED']::text[]),
    ('google_web_completion_validation_outcome_v1', ARRAY['VALID','DENIED']::text[]),
    ('google_login_route_v1', ARRAY['/admin','/home']::text[]),
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

  SELECT count(*) INTO mismatch_count
  FROM (VALUES
    ('google_workspace_bootstrap_prepare_result_v1', ARRAY['outcome']::text[],
      ARRAY['uptech.google_workspace_bootstrap_prepare_outcome_v1']::text[]),
    ('google_workspace_bootstrap_complete_result_v1', ARRAY['outcome','status_expires_at']::text[],
      ARRAY['uptech.google_workspace_bootstrap_complete_outcome_v1','timestamp with time zone']::text[]),
    ('google_workspace_bootstrap_reconcile_result_v1', ARRAY['outcome']::text[],
      ARRAY['uptech.google_workspace_bootstrap_reconcile_outcome_v1']::text[]),
    ('google_workspace_bootstrap_abort_result_v1', ARRAY['outcome']::text[],
      ARRAY['uptech.google_workspace_bootstrap_abort_outcome_v1']::text[]),
    ('google_workspace_bootstrap_status_result_v1', ARRAY['outcome']::text[],
      ARRAY['uptech.google_workspace_bootstrap_status_outcome_v1']::text[]),
    ('google_workspace_bootstrap_retry_result_v1', ARRAY['outcome']::text[],
      ARRAY['uptech.google_workspace_bootstrap_retry_outcome_v1']::text[]),
    ('google_workspace_bootstrap_finish_result_v1', ARRAY['outcome']::text[],
      ARRAY['uptech.google_workspace_bootstrap_finish_outcome_v1']::text[]),
    ('google_workspace_bootstrap_reissue_result_v1', ARRAY['outcome','status_expires_at']::text[],
      ARRAY['uptech.google_workspace_bootstrap_reissue_outcome_v1','timestamp with time zone']::text[]),
    ('onboarding_capability_revoke_result_v1', ARRAY['outcome']::text[],
      ARRAY['uptech.onboarding_capability_revoke_outcome_v1']::text[]),
    ('google_workspace_bootstrap_start_admission_result_v1', ARRAY['outcome']::text[],
      ARRAY['uptech.google_workspace_bootstrap_start_admission_outcome_v1']::text[]),
    ('workspace_access_request_submit_result_v1', ARRAY['outcome','request_id','status']::text[],
      ARRAY['uptech.workspace_access_request_submit_outcome_v1','uuid','uptech.workspace_access_request_status_v1']::text[]),
    ('workspace_access_request_read_result_v1', ARRAY['outcome','request_id','status']::text[],
      ARRAY['uptech.workspace_access_request_read_outcome_v1','uuid','uptech.workspace_access_request_status_v1']::text[]),
    ('google_directory_mapping_result_v1', ARRAY['outcome','target_role','target_department_key']::text[],
      ARRAY['uptech.google_directory_mapping_outcome_v1','text','text']::text[]),
    ('google_web_completion_validation_result_v1', ARRAY['outcome','transaction_id','canonical_claims']::text[],
      ARRAY['uptech.google_web_completion_validation_outcome_v1','uuid','uptech.google_verified_claims_assertion_v1']::text[]),
    ('google_login_completion_result_v3', ARRAY['outcome','access_state','allowed_operations','expires_at','route']::text[],
      ARRAY['uptech.google_login_completion_outcome_v1','uptech.google_login_access_state_v2','text[]','timestamp with time zone','uptech.google_login_route_v1']::text[])
  ) AS required(type_name, attribute_names, attribute_types)
  WHERE required.attribute_names IS DISTINCT FROM (
    SELECT array_agg(attribute.attname::text ORDER BY attribute.attnum)
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = (
      SELECT type_row.typrelid FROM pg_catalog.pg_type AS type_row
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = type_row.typnamespace
      WHERE namespace.nspname='uptech' AND type_row.typname=required.type_name)
      AND attribute.attnum > 0 AND NOT attribute.attisdropped
  ) OR required.attribute_types IS DISTINCT FROM (
    SELECT array_agg(pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) ORDER BY attribute.attnum)
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = (
      SELECT type_row.typrelid FROM pg_catalog.pg_type AS type_row
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = type_row.typnamespace
      WHERE namespace.nspname='uptech' AND type_row.typname=required.type_name)
      AND attribute.attnum > 0 AND NOT attribute.attisdropped
  );
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'bootstrap result composite shape is missing or incorrect';
  END IF;
END
$verify$;

DO $verify_web_v2_unknown_completion$
DECLARE
  validator_oid oid := 'uptech.validate_web_google_login_completion_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uuid)'::regprocedure::oid;
  completion_oid oid := 'uptech.complete_web_google_login_directory_v2(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)'::regprocedure::oid;
  denial_audit_oid oid := 'uptech.append_google_controlled_login_denial_audit_v1(uuid,uuid,text,text,uuid)'::regprocedure::oid;
  definition text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS procedure_row
    WHERE procedure_row.oid=validator_oid
      AND procedure_row.prorettype='uptech.google_web_completion_validation_result_v1'::regtype
      AND procedure_row.provolatile='v' AND procedure_row.prosecdef
      AND procedure_row.proowner='uptech_migration_owner'::regrole::oid
      AND procedure_row.proconfig=ARRAY['search_path=pg_catalog, uptech']::text[]
  ) OR pg_catalog.has_function_privilege('public',validator_oid,'EXECUTE')
    OR pg_catalog.has_function_privilege('uptech_api_runtime',validator_oid,'EXECUTE')
    OR pg_catalog.has_function_privilege('uptech_worker_runtime',validator_oid,'EXECUTE')
  THEN
    RAISE EXCEPTION 'private Web completion validator has wrong type, attributes, or ACL';
  END IF;

  definition := pg_catalog.pg_get_functiondef(validator_oid);
  IF pg_catalog.strpos(definition,'EXCHANGE_RESERVED')=0
    OR pg_catalog.strpos(definition,'FOR UPDATE')=0
    OR pg_catalog.strpos(definition,'observed_at := pg_catalog.clock_timestamp()')
      <= pg_catalog.strpos(definition,'FOR UPDATE')
    OR pg_catalog.strpos(definition,'https://accounts.google.com')=0
    OR pg_catalog.strpos(definition,'configuration_row.environment_name = selected_transaction.environment_name')=0
    OR pg_catalog.strpos(definition,'configuration_row.configuration_key = selected_transaction.configuration_key')=0
    OR pg_catalog.strpos(definition,$needle$configuration_row.purpose = 'WEB_LOGIN'$needle$)=0
    OR pg_catalog.strpos(definition,'configuration_row.is_enabled')=0
    OR pg_catalog.strpos(definition,'audience_configuration_key')=0
    OR pg_catalog.strpos(definition,'authorized_party_configuration_key')=0
    OR pg_catalog.strpos(definition,'web_nonce_hash')=0
    OR pg_catalog.strpos(definition,'p_request_id = selected_transaction.request_id')=0
    OR pg_catalog.strpos(definition,'INSERT INTO uptech.users')<>0
    OR pg_catalog.strpos(definition,'INSERT INTO uptech.identities')<>0
    OR pg_catalog.strpos(definition,'INSERT INTO uptech.onboarding_sessions')<>0
    OR pg_catalog.strpos(definition,'INSERT INTO uptech.sessions')<>0
  THEN
    RAISE EXCEPTION 'private Web completion validator drifted from canonical validation-only seam';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS procedure_row
    WHERE procedure_row.oid=completion_oid
      AND procedure_row.prorettype='uptech.google_login_completion_result_v3'::regtype
      AND procedure_row.provolatile='v' AND procedure_row.prosecdef
      AND procedure_row.proowner='uptech_migration_owner'::regrole::oid
      AND procedure_row.proconfig=ARRAY['search_path=pg_catalog, uptech']::text[]
  ) OR NOT pg_catalog.has_function_privilege('uptech_api_runtime',completion_oid,'EXECUTE')
    OR pg_catalog.has_function_privilege('public',completion_oid,'EXECUTE')
    OR pg_catalog.has_function_privilege('uptech_worker_runtime',completion_oid,'EXECUTE')
  THEN
    RAISE EXCEPTION 'V2 Web completion has wrong result type, attributes, or ACL';
  END IF;

  definition := pg_catalog.pg_get_functiondef(completion_oid);
  IF pg_catalog.strpos(definition,'validate_web_google_login_completion_v1')=0
    OR pg_catalog.strpos(definition,'complete_web_google_login_v1')<>0
    OR pg_catalog.strpos(definition,'complete_web_google_login_directory_v1')<>0
    OR pg_catalog.strpos(definition,'FIRST_DOMAIN_CLAIM_READ')=0
    OR pg_catalog.strpos(definition,'resource_workspace_id')=0
    OR pg_catalog.strpos(definition,$needle$status='REVOKED'$needle$)=0
    OR pg_catalog.strpos(definition,$needle$WHERE id=(validation).transaction_id AND status='EXCHANGE_RESERVED'$needle$)=0
    OR pg_catalog.strpos(definition,'transitioned_rows <> 1')=0
    OR pg_catalog.strpos(definition,$needle$EXCEPTION WHEN SQLSTATE 'PGA01'$needle$)=0
    OR pg_catalog.strpos(definition,'evaluate_google_directory_mapping_v1')=0
    OR pg_catalog.strpos(definition,'INSERT INTO uptech.sessions')=0
    OR pg_catalog.strpos(definition,'INSERT INTO uptech.workspace_memberships')=0
    OR pg_catalog.strpos(definition,'ACCESS_REQUEST_READ')=0
    OR pg_catalog.strpos(definition,'ACCESS_REQUEST_SUBMIT')=0
    OR pg_catalog.strpos(definition,'access_request_reason_class')=0
    OR pg_catalog.strpos(definition,'resource_workspace_id')=0
    OR pg_catalog.strpos(definition,'DIRECTORY_STALE_ACCESS_REQUEST_AVAILABLE')=0
    OR pg_catalog.strpos(definition,'selected_membership_role')=0
    OR pg_catalog.strpos(definition,'p_onboarding_token_hash IS DISTINCT FROM p_session_token_hash')=0
    OR pg_catalog.strpos(definition,'capability_committed')=0
  THEN
    RAISE EXCEPTION 'V2 unknown-domain completion bypasses its private seam or widens authority';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS procedure_row
    WHERE procedure_row.oid=denial_audit_oid AND procedure_row.provolatile='v'
      AND procedure_row.prosecdef
      AND procedure_row.proowner='uptech_migration_owner'::regrole::oid
      AND procedure_row.proconfig=ARRAY['search_path=pg_catalog, uptech']::text[])
    OR pg_catalog.has_function_privilege('public',denial_audit_oid,'EXECUTE')
    OR pg_catalog.has_function_privilege('uptech_api_runtime',denial_audit_oid,'EXECUTE')
    OR pg_catalog.has_function_privilege('uptech_worker_runtime',denial_audit_oid,'EXECUTE')
  THEN
    RAISE EXCEPTION 'controlled-login denial audit helper has wrong attributes or ACL';
  END IF;
  definition := pg_catalog.pg_get_functiondef(denial_audit_oid);
  IF pg_catalog.strpos(definition,'GOOGLE_AUTH_LOGIN_DENIED')=0
    OR pg_catalog.strpos(definition,'platform_audit_events')=0
    OR pg_catalog.strpos(definition,'audit_events')=0
    OR pg_catalog.strpos(definition,'access_state')=0
    OR pg_catalog.strpos(definition,'reason_class')=0
    OR pg_catalog.strpos(definition,'AUTHORITY_COMMIT_FAILED')=0
    OR pg_catalog.strpos(definition,'token')<>0
    OR pg_catalog.strpos(definition,'credential')<>0
    OR pg_catalog.strpos(definition,'domain')<>0
  THEN
    RAISE EXCEPTION 'controlled-login denial audit helper widened or lost its closed redacted schema';
  END IF;
END
$verify_web_v2_unknown_completion$;

DO $verify_mapping_evaluator$
DECLARE
  evaluator_oid oid := 'uptech.evaluate_google_directory_mapping_v1(uuid,uuid,text)'::regprocedure::oid;
  evaluator_definition text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS procedure_row
    WHERE procedure_row.oid = evaluator_oid
      AND procedure_row.prorettype = 'uptech.google_directory_mapping_result_v1'::regtype
      AND procedure_row.prosecdef
      AND procedure_row.provolatile = 's'
      AND procedure_row.proconfig = ARRAY['search_path=pg_catalog, uptech']::text[]
      AND NOT pg_catalog.has_function_privilege('public',procedure_row.oid,'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('uptech_api_runtime',procedure_row.oid,'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('uptech_worker_runtime',procedure_row.oid,'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'Directory mapping evaluator has wrong result, safety, or runtime grants';
  END IF;

  evaluator_definition := pg_catalog.pg_get_functiondef(evaluator_oid);
  IF pg_catalog.strpos(evaluator_definition, 'google_is_admin') <> 0
     OR pg_catalog.strpos(evaluator_definition, 'google_is_delegated_admin') <> 0
     OR pg_catalog.strpos(evaluator_definition, '''OWNER''') <> 0
     OR pg_catalog.strpos(evaluator_definition, 'people_group_memberships') = 0
     OR pg_catalog.strpos(evaluator_definition, 'people_org_units') = 0
     OR pg_catalog.strpos(evaluator_definition, 'lower(') = 0
     OR pg_catalog.strpos(evaluator_definition, 'p_generation_id') = 0
     OR pg_catalog.strpos(evaluator_definition, 'provider_customer_id') = 0
     OR pg_catalog.strpos(evaluator_definition, 'fresh_until') = 0
  THEN
    RAISE EXCEPTION 'Directory mapping evaluator lacks required generation-bound signals or uses Google admin authority';
  END IF;
END
$verify_mapping_evaluator$;

DO $verify$
DECLARE
  missing_count integer;
BEGIN
  SELECT count(*) INTO missing_count
  FROM (VALUES
    ('onboarding_sessions','resource_workspace_id'),
    ('onboarding_sessions','access_request_reason_class'),
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
    ('workspaces','workspaces_workspace_customer_unique','u'),
    ('onboarding_sessions','onboarding_sessions_resource_workspace_fk','f'),
    ('onboarding_sessions','onboarding_sessions_operations_check','c'),
    ('onboarding_sessions','onboarding_sessions_expiry_check','c'),
    ('onboarding_sessions','onboarding_sessions_access_reason_check','c'),
    ('workspace_domain_locators','workspace_domain_locators_customer_shape_check','c'),
    ('workspace_domain_locators','workspace_domain_locators_workspace_customer_fk','f'),
    ('workspace_domain_locators','workspace_domain_locators_workspace_customer_domain_unique','u'),
    ('workspace_domain_locators','workspace_domain_locators_alias_parent_fk','f'),
    ('connectors','connectors_directory_authorized_identity_fk','f'),
    ('connectors','connectors_directory_setup_metadata_check','c'),
    ('people_permission_mappings','people_permission_mappings_source_check','c'),
    ('people_permission_mappings','people_permission_mappings_target_check','c'),
    ('google_workspace_bootstrap_attempts','google_workspace_bootstrap_attempts_identity_fk','f'),
    ('google_workspace_bootstrap_attempts','google_workspace_bootstrap_attempts_candidate_workspace_unique','u'),
    ('google_workspace_bootstrap_attempts','google_workspace_bootstrap_attempts_candidate_status_hash_uniqu','u'),
    ('google_workspace_bootstrap_attempts','google_workspace_bootstrap_attempts_receipt_binding_unique','u'),
    ('google_workspace_bootstrap_attempts','google_workspace_bootstrap_attempts_deadline_check','c'),
    ('google_workspace_bootstrap_attempts','google_workspace_bootstrap_attempts_state_check','c'),
    ('google_workspace_bootstrap_attempts','google_workspace_bootstrap_attempts_timestamps_check','c'),
    ('google_workspace_bootstrap_receipts','google_workspace_bootstrap_receipts_attempt_binding_fk','f'),
    ('google_workspace_bootstrap_receipts','google_workspace_bootstrap_receipts_identity_fk','f'),
    ('google_workspace_bootstrap_receipts','google_workspace_bootstrap_receipts_workspace_fk','f'),
    ('google_workspace_bootstrap_receipts','google_workspace_bootstrap_receipts_connector_fk','f'),
    ('google_workspace_bootstrap_receipts','google_workspace_bootstrap_receipts_connector_unique','u'),
    ('workspace_access_requests','workspace_access_requests_workspace_fk','f'),
    ('workspace_access_requests','workspace_access_requests_identity_fk','f'),
    ('workspace_access_requests','workspace_access_requests_reason_check','c'),
    ('workspace_access_requests','workspace_access_requests_state_check','c'),
    ('workspace_access_requests','workspace_access_requests_timestamps_check','c')
  ) AS required(relation_name, constraint_name, constraint_type)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS constraint_row
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = constraint_row.connamespace
    WHERE namespace.nspname = 'uptech'
      AND constraint_row.conrelid = pg_catalog.to_regclass('uptech.' || required.relation_name)
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
    ('workspace_domain_locators','workspace_domain_locators_one_primary_customer', '(domain_kind = ''PRIMARY''::uptech.google_workspace_domain_kind_v1)'),
    ('service_actors','service_actors_one_active_sync_worker', '((actor_kind = ''SYNC_WORKER''::text) AND (status = ''ACTIVE''::text))'),
    ('google_workspace_bootstrap_attempts','google_workspace_bootstrap_attempts_one_live_source', '(state = ''PREPARED''::uptech.google_workspace_bootstrap_attempt_state_v1)'),
    ('workspace_access_requests','workspace_access_requests_one_pending_identity_reason', '(status = ''PENDING''::uptech.workspace_access_request_status_v1)')
  ) AS required(relation_name, index_name, predicate)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index AS index_row
    JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index_row.indexrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = index_relation.relnamespace
    WHERE namespace.nspname = 'uptech' AND index_relation.relname = required.index_name
      AND index_row.indrelid = pg_catalog.to_regclass('uptech.' || required.relation_name)
      AND index_row.indisunique AND index_row.indisvalid
      AND pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid) = required.predicate
  );
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'Task 2 partial unique index or predicate is missing';
  END IF;

  SELECT count(*) INTO missing_count
  FROM (VALUES
    ('workspace_domain_locators','workspace_domain_locators_alias_parent_check','enforce_workspace_domain_alias_parent_v1',21,true,true),
    ('google_workspace_bootstrap_attempts','google_workspace_bootstrap_attempts_transition_guard','enforce_google_workspace_bootstrap_attempt_transition_v1',27,false,false),
    ('google_workspace_bootstrap_receipts','google_workspace_bootstrap_receipts_committed_attempt','enforce_google_workspace_bootstrap_receipt_v1',5,true,true),
    ('google_workspace_bootstrap_receipts','google_workspace_bootstrap_receipts_immutable','enforce_google_workspace_bootstrap_receipt_v1',27,false,false),
    ('workspace_access_requests','workspace_access_requests_transition_guard','enforce_workspace_access_request_transition_v1',27,false,false)
  ) AS required(relation_name, trigger_name, function_name, trigger_type, is_constraint, is_deferred)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
    LEFT JOIN pg_catalog.pg_constraint AS constraint_row
      ON constraint_row.oid = trigger_row.tgconstraint
    WHERE trigger_row.tgname = required.trigger_name
      AND trigger_row.tgrelid = pg_catalog.to_regclass('uptech.' || required.relation_name)
      AND NOT trigger_row.tgisinternal AND trigger_row.tgenabled = 'O'
      AND trigger_row.tgfoid = pg_catalog.to_regprocedure('uptech.' || required.function_name || '()')
      AND trigger_row.tgtype = required.trigger_type
      AND (trigger_row.tgconstraint <> 0) = required.is_constraint
      AND COALESCE(constraint_row.conrelid = trigger_row.tgrelid, NOT required.is_constraint)
      AND COALESCE(constraint_row.condeferrable, false) = required.is_constraint
      AND COALESCE(constraint_row.condeferred, false) = required.is_deferred
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
  routine_definition text;
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

  object_oid := 'uptech.admit_google_workspace_bootstrap_start_v1(uptech.google_auth_hash32_v1,uuid)'::regprocedure::oid;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS procedure_row
    WHERE procedure_row.oid = object_oid
      AND procedure_row.prokind = 'f'
      AND procedure_row.provolatile = 'v'
      AND procedure_row.prosecdef
      AND procedure_row.proowner = 'uptech_migration_owner'::regrole::oid
      AND procedure_row.proconfig = ARRAY['search_path=pg_catalog, uptech']::text[]
  ) OR NOT pg_catalog.has_function_privilege('uptech_api_runtime', object_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege('uptech_worker_runtime', object_oid, 'EXECUTE')
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS procedure_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
        procedure_row.proacl, pg_catalog.acldefault('f', procedure_row.proowner))) AS acl
      WHERE procedure_row.oid = object_oid
        AND (acl.privilege_type <> 'EXECUTE'
          OR acl.grantee NOT IN (
            'uptech_migration_owner'::regrole::oid,
            'uptech_api_runtime'::regrole::oid
          ))
    )
  THEN
    RAISE EXCEPTION 'bootstrap start admission has wrong signature/definer/search_path/runtime grants';
  END IF;

  routine_definition := pg_catalog.pg_get_functiondef(object_oid);
  IF pg_catalog.strpos(routine_definition, 'GOOGLE_AUTH') = 0
    OR pg_catalog.strpos(routine_definition, 'UPTECH_GOOGLE_AUTH_RATE_LIMIT_AUDIT_V1') = 0
    OR pg_catalog.strpos(routine_definition, 'ON CONFLICT') = 0
  THEN
    RAISE EXCEPTION 'bootstrap start admission does not reuse the concurrency-safe GOOGLE_AUTH limiter';
  END IF;
END
$verify$;

DO $verify$
DECLARE
  object_oid oid;
  routine_definition text;
BEGIN
  object_oid := 'uptech.authenticate_google_workspace_bootstrap_source_v1(uptech.google_auth_hash32_v1)'::regprocedure::oid;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS procedure_row
    WHERE procedure_row.oid = object_oid
      AND procedure_row.prokind = 'f'
      AND procedure_row.provolatile = 's'
      AND procedure_row.prosecdef
      AND procedure_row.proowner = 'uptech_migration_owner'::regrole::oid
      AND procedure_row.proconfig = ARRAY['search_path=pg_catalog, uptech']::text[]
      AND pg_catalog.pg_get_function_result(procedure_row.oid) =
        'TABLE(identity_id uuid, provider_subject text, normalized_email text, hosted_domain text, identity_active boolean, user_active boolean)'
  ) OR NOT pg_catalog.has_function_privilege('uptech_api_runtime', object_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege('uptech_worker_runtime', object_oid, 'EXECUTE')
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS procedure_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
        procedure_row.proacl, pg_catalog.acldefault('f', procedure_row.proowner))) AS acl
      WHERE procedure_row.oid = object_oid
        AND (acl.privilege_type <> 'EXECUTE'
          OR acl.grantee NOT IN (
            'uptech_migration_owner'::regrole::oid,
            'uptech_api_runtime'::regrole::oid
          ))
    )
  THEN
    RAISE EXCEPTION 'bootstrap source authenticator has wrong signature/definer/search_path/runtime grants';
  END IF;

  routine_definition := pg_catalog.pg_get_functiondef(object_oid);
  IF pg_catalog.strpos(routine_definition, 'FIRST_DOMAIN_CLAIM_RESERVE') = 0
    OR pg_catalog.strpos(routine_definition, 'resource_workspace_id IS NULL') = 0
  THEN
    RAISE EXCEPTION 'bootstrap source authenticator lacks its fixed operation or unbound-source guard';
  END IF;

  FOREACH object_oid IN ARRAY ARRAY[
    'uptech.prepare_google_workspace_bootstrap_v1(uuid,uptech.google_auth_hash32_v1,uuid,uptech.google_auth_hash32_v1,uuid)'::regprocedure::oid,
    'uptech.complete_google_workspace_bootstrap_v1(uuid,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,text,text,text,text,uptech.google_workspace_verified_domain_v1[],text,text[],uuid)'::regprocedure::oid,
    'uptech.reconcile_google_workspace_bootstrap_v1(uuid,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,text,uuid)'::regprocedure::oid,
    'uptech.abort_google_workspace_bootstrap_v1(uuid,uptech.google_auth_hash32_v1,uuid)'::regprocedure::oid
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS procedure_row
      WHERE procedure_row.oid = object_oid
        AND procedure_row.prokind = 'f'
        AND procedure_row.provolatile = 'v'
        AND procedure_row.prosecdef
        AND procedure_row.proowner = 'uptech_migration_owner'::regrole::oid
        AND procedure_row.proconfig = ARRAY['search_path=pg_catalog, uptech']::text[]
    ) OR NOT pg_catalog.has_function_privilege('uptech_api_runtime', object_oid, 'EXECUTE')
      OR pg_catalog.has_function_privilege('uptech_worker_runtime', object_oid, 'EXECUTE')
      OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc AS procedure_row
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
          procedure_row.proacl, pg_catalog.acldefault('f', procedure_row.proowner))) AS acl
        WHERE procedure_row.oid = object_oid
          AND (acl.privilege_type <> 'EXECUTE'
            OR acl.grantee NOT IN (
              'uptech_migration_owner'::regrole::oid,
              'uptech_api_runtime'::regrole::oid
            ))
      )
    THEN
      RAISE EXCEPTION 'bootstrap entrypoint % has wrong signature/definer/search_path/runtime grants', object_oid::regprocedure;
    END IF;

    routine_definition := pg_catalog.pg_get_functiondef(object_oid);
    IF pg_catalog.strpos(routine_definition, 'pg_advisory_xact_lock') = 0
      OR pg_catalog.strpos(routine_definition, 'google-workspace-bootstrap:') = 0
      OR pg_catalog.strpos(routine_definition, 'hashtextextended') = 0
    THEN
      RAISE EXCEPTION 'bootstrap entrypoint % lacks the attempt advisory-xact lock', object_oid::regprocedure;
    END IF;
  END LOOP;

  FOREACH object_oid IN ARRAY ARRAY[
    'uptech.read_google_workspace_bootstrap_status_v1(uptech.google_auth_hash32_v1,uuid)'::regprocedure::oid,
    'uptech.retry_google_workspace_bootstrap_sync_v1(uptech.google_auth_hash32_v1,uuid)'::regprocedure::oid,
    'uptech.finish_google_workspace_bootstrap_v1(uptech.google_auth_hash32_v1,uuid)'::regprocedure::oid,
    'uptech.reissue_google_workspace_bootstrap_status_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uuid)'::regprocedure::oid,
    'uptech.revoke_onboarding_capability_v1(uptech.google_auth_hash32_v1,uuid)'::regprocedure::oid,
    'uptech.submit_workspace_access_request_v1(uptech.google_auth_hash32_v1,uuid)'::regprocedure::oid,
    'uptech.read_workspace_access_request_v1(uptech.google_auth_hash32_v1,uuid)'::regprocedure::oid
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS procedure_row
      WHERE procedure_row.oid = object_oid
        AND procedure_row.prokind = 'f'
        AND procedure_row.provolatile = 'v'
        AND procedure_row.prosecdef
        AND procedure_row.proowner = 'uptech_migration_owner'::regrole::oid
        AND procedure_row.proconfig = ARRAY['search_path=pg_catalog, uptech']::text[]
    ) OR NOT pg_catalog.has_function_privilege('uptech_api_runtime', object_oid, 'EXECUTE')
      OR pg_catalog.has_function_privilege('uptech_worker_runtime', object_oid, 'EXECUTE')
      OR pg_catalog.has_function_privilege('public', object_oid, 'EXECUTE')
      OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc AS procedure_row
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
          procedure_row.proacl, pg_catalog.acldefault('f', procedure_row.proowner))) AS acl
        WHERE procedure_row.oid = object_oid
          AND (acl.privilege_type <> 'EXECUTE'
            OR acl.grantee NOT IN (
              'uptech_migration_owner'::regrole::oid,
              'uptech_api_runtime'::regrole::oid
            ))
      )
    THEN
      RAISE EXCEPTION 'bootstrap status entrypoint % has wrong signature/definer/search_path/runtime grants', object_oid::regprocedure;
    END IF;
  END LOOP;

  FOREACH object_oid IN ARRAY ARRAY[
    'uptech.read_google_workspace_bootstrap_status_v1(uptech.google_auth_hash32_v1,uuid)'::regprocedure::oid,
    'uptech.retry_google_workspace_bootstrap_sync_v1(uptech.google_auth_hash32_v1,uuid)'::regprocedure::oid
  ] LOOP
    routine_definition := pg_catalog.pg_get_functiondef(object_oid);
    IF pg_catalog.strpos(
        routine_definition,
        'receipt.initial_status_onboarding_session_id = selected_capability.id'
      ) <> 0
      OR pg_catalog.strpos(
        routine_definition,
        'receipt.identity_id = selected_capability.identity_id'
      ) = 0
      OR pg_catalog.strpos(
        routine_definition,
        'receipt.workspace_id = selected_capability.resource_workspace_id'
      ) = 0
      OR pg_catalog.strpos(
        routine_definition,
        'connector.directory_authorized_by_identity_id = receipt.identity_id'
      ) = 0
      OR pg_catalog.strpos(
        routine_definition,
        'job.payload ->> ''bootstrap_attempt_id'' = selected_attempt_id::text'
      ) = 0
    THEN
      RAISE EXCEPTION 'bootstrap status entrypoint % lacks replacement-safe receipt/connector/job binding', object_oid::regprocedure;
    END IF;
  END LOOP;

  FOREACH object_oid IN ARRAY ARRAY[
    'uptech.read_google_workspace_bootstrap_status_v1(uptech.google_auth_hash32_v1,uuid)'::regprocedure::oid,
    'uptech.retry_google_workspace_bootstrap_sync_v1(uptech.google_auth_hash32_v1,uuid)'::regprocedure::oid,
    'uptech.finish_google_workspace_bootstrap_v1(uptech.google_auth_hash32_v1,uuid)'::regprocedure::oid,
    'uptech.reissue_google_workspace_bootstrap_status_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uuid)'::regprocedure::oid,
    'uptech.revoke_onboarding_capability_v1(uptech.google_auth_hash32_v1,uuid)'::regprocedure::oid,
    'uptech.submit_workspace_access_request_v1(uptech.google_auth_hash32_v1,uuid)'::regprocedure::oid,
    'uptech.read_workspace_access_request_v1(uptech.google_auth_hash32_v1,uuid)'::regprocedure::oid
  ] LOOP
    routine_definition := pg_catalog.pg_get_functiondef(object_oid);
    IF pg_catalog.strpos(routine_definition, 'p_request_id') = 0
      OR pg_catalog.strpos(routine_definition, 'audit_events') = 0
    THEN
      RAISE EXCEPTION 'Task 6 request-correlated routine % lacks an audit append', object_oid::regprocedure;
    END IF;
  END LOOP;

  routine_definition := pg_catalog.pg_get_functiondef(
    'uptech.submit_workspace_access_request_v1(uptech.google_auth_hash32_v1,uuid)'::regprocedure
  );
  IF pg_catalog.strpos(routine_definition, 'selected_capability.access_request_reason_class') = 0
    OR pg_catalog.strpos(routine_definition, 'WORKSPACE_ACCESS_REQUEST_SUBMITTED') = 0
    OR pg_catalog.strpos(routine_definition, 'WORKSPACE_ACCESS_REQUEST_DEDUPLICATED') = 0
    OR pg_catalog.strpos(routine_definition, 'fixed_reason_class') <> 0
  THEN
    RAISE EXCEPTION 'access submission does not preserve server reason provenance and audit deduplication';
  END IF;

  routine_definition := pg_catalog.pg_get_functiondef(
    'uptech.read_workspace_access_request_v1(uptech.google_auth_hash32_v1,uuid)'::regprocedure
  );
  IF pg_catalog.strpos(routine_definition, 'selected_capability.access_request_reason_class') = 0
    OR pg_catalog.strpos(routine_definition, 'WORKSPACE_ACCESS_REQUEST_READ') = 0
    OR pg_catalog.strpos(routine_definition, 'fixed_reason_class') <> 0
  THEN
    RAISE EXCEPTION 'access read does not preserve server reason provenance and audit its result';
  END IF;
END
$verify$;

DO $verify$
DECLARE
  publisher_oid regprocedure :=
    'uptech.publish_people_sync_generation_v1(uuid,uuid,uuid,boolean,timestamp with time zone,uuid)'::regprocedure;
  delegate_oid regprocedure :=
    'uptech.publish_people_sync_generation_internal_v2(uuid,uuid,uuid,boolean,timestamp with time zone,uuid)'::regprocedure;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid=routine.proowner
    WHERE routine.oid=publisher_oid AND routine.prosecdef AND routine.provolatile='v'
      AND routine.proconfig=ARRAY['search_path=pg_catalog, uptech']::text[]
      AND owner_role.rolname='uptech_migration_owner'
  ) OR NOT pg_catalog.has_function_privilege('uptech_worker_runtime',publisher_oid,'EXECUTE')
    OR pg_catalog.has_function_privilege('uptech_api_runtime',publisher_oid,'EXECUTE')
    OR pg_catalog.has_function_privilege('public',publisher_oid,'EXECUTE')
  THEN RAISE EXCEPTION 'workspace-serialized publisher boundary is misconfigured';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid=routine.proowner
    WHERE routine.oid=delegate_oid AND routine.prosecdef AND routine.provolatile='v'
      AND routine.proconfig=ARRAY['search_path=pg_catalog, uptech']::text[]
      AND owner_role.rolname='uptech_migration_owner'
  ) OR pg_catalog.has_function_privilege('uptech_worker_runtime',delegate_oid,'EXECUTE')
    OR pg_catalog.has_function_privilege('uptech_api_runtime',delegate_oid,'EXECUTE')
    OR pg_catalog.has_function_privilege('public',delegate_oid,'EXECUTE')
  THEN RAISE EXCEPTION 'publisher delegate is not private';
  END IF;
END
$verify$;

DO $verify$
DECLARE
  mobile_v2_oid regprocedure :=
    'uptech.complete_mobile_google_callback_directory_v2(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uuid)'::regprocedure;
  denial_oid regprocedure :=
    'uptech.complete_mobile_google_denial_v1(uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_rejection_class_v1,uptech.mobile_auth_ui_category_v1,uuid)'::regprocedure;
  denial_source text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid=routine.proowner
    WHERE routine.oid=mobile_v2_oid AND routine.prosecdef AND routine.provolatile='v'
      AND routine.proconfig=ARRAY['search_path=pg_catalog, uptech']::text[]
      AND owner_role.rolname='uptech_migration_owner'
      AND routine.prorettype='uptech.mobile_callback_result_v1'::regtype
  ) OR NOT pg_catalog.has_function_privilege('uptech_api_runtime',mobile_v2_oid,'EXECUTE')
    OR pg_catalog.has_function_privilege('uptech_worker_runtime',mobile_v2_oid,'EXECUTE')
    OR pg_catalog.has_function_privilege('public',mobile_v2_oid,'EXECUTE')
  THEN RAISE EXCEPTION 'Mobile Directory V2 boundary is misconfigured';
  END IF;
  SELECT routine.prosrc INTO denial_source FROM pg_catalog.pg_proc AS routine WHERE routine.oid=denial_oid;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid=routine.proowner
    WHERE routine.oid=denial_oid AND routine.prosecdef AND routine.provolatile='v'
      AND routine.proconfig=ARRAY['search_path=pg_catalog, uptech']::text[]
      AND owner_role.rolname='uptech_migration_owner'
      AND routine.prorettype='uptech.mobile_callback_result_v1'::regtype)
    OR NOT pg_catalog.has_function_privilege('uptech_api_runtime',denial_oid,'EXECUTE')
    OR pg_catalog.has_function_privilege('uptech_worker_runtime',denial_oid,'EXECUTE')
    OR pg_catalog.has_function_privilege('public',denial_oid,'EXECUTE')
    OR pg_catalog.strpos(denial_source,'FROM uptech.mobile_handoffs WHERE handoff_hash=p_handoff_hash')=0
    OR pg_catalog.strpos(denial_source,'WHERE token_hash=p_handoff_hash OR csrf_token_hash=p_handoff_hash')=0
    OR pg_catalog.strpos(denial_source,'FROM uptech.onboarding_sessions WHERE token_hash=p_handoff_hash')=0
    OR pg_catalog.strpos(denial_source,'p_request_id IS DISTINCT FROM selected_transaction.request_id')=0
    OR pg_catalog.strpos(denial_source,'''handoff_hash'',p_handoff_hash')>0
  THEN RAISE EXCEPTION 'Mobile denial helper boundary or collision guard is misconfigured'; END IF;
END
$verify$;

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

  normalized := uptech.normalize_google_workspace_verified_domains_v1(
    ' TENANT-A.EXAMPLE ', ARRAY[
      ROW('unknown.example','ALIAS','tenant-a.example')::uptech.google_workspace_verified_domain_v1,
      ROW(' TENANT-A.EXAMPLE ','PRIMARY',NULL)::uptech.google_workspace_verified_domain_v1,
      ROW('tenant-b.example','SECONDARY',NULL)::uptech.google_workspace_verified_domain_v1,
      ROW('unknown.example','ALIAS','tenant-a.example')::uptech.google_workspace_verified_domain_v1
    ]);
  IF cardinality(normalized) <> 3 OR (normalized[1]).normalized_domain <> 'tenant-a.example'
     OR (normalized[2]).normalized_domain <> 'tenant-b.example'
     OR (normalized[3]).normalized_domain <> 'unknown.example' THEN
    RAISE EXCEPTION 'verified-domain normalization is not deterministic or deduplicating';
  END IF;

  BEGIN
    PERFORM uptech.normalize_google_workspace_verified_domains_v1(
      'tenant-a.example', ARRAY[
        ROW('tenant-a.example','PRIMARY',NULL)::uptech.google_workspace_verified_domain_v1,
        ROW('tenant-b.example','ALIAS','unknown.example')::uptech.google_workspace_verified_domain_v1
      ]);
    RAISE EXCEPTION 'invalid alias provenance was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
END
$verify$;

ROLLBACK;

\echo 'Google Workspace tenant bootstrap verification passed (transaction rolled back).'
