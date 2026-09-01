\set ON_ERROR_STOP on

-- Run against a disposable database after migrations 0001 through 0006.
BEGIN;

DO $verify$
DECLARE
  web_routine regprocedure := pg_catalog.to_regprocedure(
    'uptech.complete_web_google_login_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)'
  );
  web_internal regprocedure := pg_catalog.to_regprocedure(
    'uptech.complete_web_google_login_a2_internal_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)'
  );
  mobile_routine regprocedure := pg_catalog.to_regprocedure(
    'uptech.complete_mobile_google_callback_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uuid)'
  );
  mobile_internal regprocedure := pg_catalog.to_regprocedure(
    'uptech.complete_mobile_google_callback_a3_internal_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uuid)'
  );
  mobile_denial_routine regprocedure := pg_catalog.to_regprocedure(
    'uptech.complete_mobile_google_denial_v1(uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_rejection_class_v1,uptech.mobile_auth_ui_category_v1,uuid)'
  );
  mobile_exchange_v2 regprocedure := pg_catalog.to_regprocedure(
    'uptech.exchange_mobile_handoff_v2(uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)'
  );
  legacy_native_completion regprocedure := pg_catalog.to_regprocedure(
    'uptech.complete_native_google_login_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)'
  );
  guarded_routine regprocedure;
  source_text text;
BEGIN
  IF web_routine IS NULL OR web_internal IS NULL
     OR mobile_routine IS NULL OR mobile_internal IS NULL
     OR mobile_denial_routine IS NULL OR mobile_exchange_v2 IS NULL
     OR legacy_native_completion IS NULL THEN
    RAISE EXCEPTION 'A4 public/internal completion boundary is incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM uptech.identities
    WHERE provider = 'GOOGLE'
      AND issuer = 'accounts.google.com'
  ) THEN
    RAISE EXCEPTION 'A4 non-canonical Google issuer identity remains';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute_row
    JOIN pg_catalog.pg_type AS type_row
      ON type_row.typrelid = attribute_row.attrelid
    WHERE type_row.oid = 'uptech.google_login_completion_result_v2'::regtype::oid
      AND attribute_row.attname = 'access_state'
      AND NOT attribute_row.attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_enum AS enum_row
    JOIN pg_catalog.pg_type AS type_row ON type_row.oid = enum_row.enumtypid
    JOIN pg_catalog.pg_namespace AS namespace_row ON namespace_row.oid = type_row.typnamespace
    WHERE namespace_row.nspname = 'uptech'
      AND type_row.typname = 'google_login_access_state_v1'
    GROUP BY enum_row.enumtypid
    HAVING array_agg(enum_row.enumlabel::text ORDER BY enum_row.enumsortorder) = ARRAY[
      'UNKNOWN_WORKSPACE', 'USER_NOT_PROVISIONED', 'USER_SUSPENDED', 'WORKSPACE_SUSPENDED'
    ]
  ) THEN
    RAISE EXCEPTION 'A4 fixed safe access-state contract is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_enum AS enum_row
    JOIN pg_catalog.pg_type AS type_row ON type_row.oid = enum_row.enumtypid
    JOIN pg_catalog.pg_namespace AS namespace_row
      ON namespace_row.oid = type_row.typnamespace
    WHERE namespace_row.nspname = 'uptech'
      AND type_row.typname = 'mobile_auth_ui_category_v1'
    GROUP BY enum_row.enumtypid
    HAVING pg_catalog.array_agg(
      enum_row.enumlabel::text ORDER BY enum_row.enumsortorder
    ) = ARRAY[
      'PERSONAL_GOOGLE_ACCOUNT', 'UNKNOWN_WORKSPACE', 'USER_NOT_PROVISIONED',
      'USER_SUSPENDED', 'SESSION_REVOKED', 'SESSION_EXPIRED',
      'POLICY_OR_DEVICE_BLOCKED', 'OFFLINE', 'AUTH_ERROR',
      'WORKSPACE_SUSPENDED', 'GOOGLE_CANCELLED', 'PROVIDER_UNAVAILABLE'
    ]
  ) THEN
    RAISE EXCEPTION 'A4 mobile denial categories are incomplete';
  END IF;

  IF (
    SELECT pg_catalog.array_agg(
      attribute_row.attname::text ORDER BY attribute_row.attnum
    ) = ARRAY[
      'outcome', 'session_id', 'access_expires_at', 'refresh_expires_at',
      'active_workspace_id', 'memberships', 'denial_category'
    ]
    AND pg_catalog.array_agg(
      attribute_row.atttypid ORDER BY attribute_row.attnum
    ) = ARRAY[
      'text'::regtype::oid,
      'uuid'::regtype::oid,
      'timestamptz'::regtype::oid,
      'timestamptz'::regtype::oid,
      'uuid'::regtype::oid,
      'jsonb'::regtype::oid,
      'uptech.mobile_auth_ui_category_v1'::regtype::oid
    ]::oid[]
    FROM pg_catalog.pg_attribute AS attribute_row
    JOIN pg_catalog.pg_type AS type_row
      ON type_row.typrelid = attribute_row.attrelid
    WHERE type_row.oid = pg_catalog.to_regtype(
      'uptech.mobile_handoff_exchange_result_v2'
    )
      AND attribute_row.attnum > 0
      AND NOT attribute_row.attisdropped
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'A4 mobile handoff exchange result shape is wrong';
  END IF;

  IF (
    SELECT pg_catalog.count(*) = 9
      AND pg_catalog.bool_and(NOT attribute_row.attnotnull)
    FROM pg_catalog.pg_attribute AS attribute_row
    WHERE attribute_row.attrelid = 'uptech.mobile_handoffs'::regclass
      AND attribute_row.attname IN (
        'identity_id', 'user_id', 'workspace_id', 'membership_id',
        'user_security_version', 'identity_security_version',
        'workspace_security_version', 'membership_authz_version',
        'denial_category'
      )
      AND NOT attribute_row.attisdropped
  ) IS NOT TRUE OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute_row
    WHERE attribute_row.attrelid = 'uptech.mobile_handoffs'::regclass
      AND attribute_row.attname = 'denial_category'
      AND attribute_row.atttypid = 'uptech.mobile_auth_ui_category_v1'::regtype
      AND NOT attribute_row.attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'uptech.mobile_handoffs'::regclass
      AND constraint_row.conname =
        'mobile_handoffs_authority_or_denial_v2_check'
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated
      AND pg_catalog.pg_get_constraintdef(constraint_row.oid) ~
        'denial_category IS NULL.*identity_id IS NOT NULL.*membership_authz_version IS NOT NULL.*denial_category IS NOT NULL.*identity_id IS NULL.*membership_authz_version IS NULL'
  ) THEN
    RAISE EXCEPTION 'A4 normal/denial mobile handoff authority shape is wrong';
  END IF;

  FOREACH source_text IN ARRAY ARRAY[
    pg_get_functiondef(web_routine),
    pg_get_functiondef(mobile_routine),
    pg_get_functiondef(mobile_denial_routine),
    pg_get_functiondef(mobile_exchange_v2)
  ] LOOP
    IF source_text ~* '(^|[^[:alnum:]_])EXECUTE([^[:alnum:]_]|$)' THEN
      RAISE EXCEPTION 'dynamic SQL is forbidden in A4 completion routines';
    END IF;
  END LOOP;

  source_text := pg_get_functiondef(web_routine);
  IF source_text !~ 'workspace_domain_locators'
     OR source_text !~ 'normalized_domain = \(canonical_claims\)\.normalized_hosted_domain'
     OR source_text ~ 'tenant-a\.example|tenant-b\.example|unknown\.example'
     OR source_text !~ '''https://accounts.google.com'''
     OR source_text !~ 'complete_web_google_login_a2_internal_v1\([[:space:]]*p_completion_handle_hash, canonical_claims'
     OR source_text !~ 'UNKNOWN_WORKSPACE'
     OR source_text !~ 'USER_NOT_PROVISIONED'
     OR source_text !~ 'USER_SUSPENDED'
     OR source_text !~ 'WORKSPACE_SUSPENDED'
     OR source_text !~ 'selected_membership_role = ''MEMBER'''
     OR source_text !~ 'complete_web_google_login_a2_internal_v1' THEN
    RAISE EXCEPTION 'A4 exact-locator, safe-state, JIT-member, or bootstrap contract is missing';
  END IF;

  source_text := pg_get_functiondef(
    'uptech.complete_web_google_login_a1_internal_v1(uptech.google_auth_hash32_v1,uptech.google_verified_claims_assertion_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uptech.google_auth_hash32_v1,uuid)'::regprocedure
  );
  IF source_text !~ 'resolved_membership_status = ''PENDING'''
     OR source_text ~ 'resolved_membership_status IN \([[:space:]]*''PENDING'', ''DEPROVISIONED'''
     OR source_text !~ 'IF resolved_workspace_status = ''ACTIVE'' THEN' THEN
    RAISE EXCEPTION 'A4 web group-controlled or deprovisioned-member guard is missing';
  END IF;

  source_text := pg_get_functiondef(mobile_routine);
  IF source_text !~ 'workspace_domain_locators'
     OR source_text !~ 'normalized_domain = \(canonical_claims\)\.normalized_hosted_domain'
     OR source_text !~ 'WORKSPACE_SUSPENDED'
     OR source_text !~ 'complete_mobile_google_denial_v1'
     OR source_text !~ 'final_denial_category'
     OR source_text !~ 'complete_mobile_google_callback_a3_internal_v1\([[:space:]]*p_completion_handle_hash, canonical_claims'
     OR source_text !~ 'complete_mobile_google_callback_a3_internal_v1' THEN
    RAISE EXCEPTION 'A4 mobile denial-handoff callback boundary is missing';
  END IF;
  IF pg_catalog.strpos(source_text, 'selected_workspace_status') = 0
     OR pg_catalog.strpos(source_text, 'selected_workspace_status') >
        pg_catalog.strpos(source_text, 'complete_mobile_google_denial_v1') THEN
    RAISE EXCEPTION 'A4 final workspace denial remap precedes no denial handoff';
  END IF;

  source_text := pg_get_functiondef(mobile_denial_routine);
  IF source_text !~ 'status = ''EXCHANGE_RESERVED'''
     OR source_text !~ 'completion_expires_at <= observed_at'
     OR source_text !~ 'mobile_google_configuration_registry'
     OR source_text !~ 'configuration_row\.is_enabled'
     OR source_text !~ 'INSERT INTO uptech\.mobile_handoffs'
     OR source_text !~ 'NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL'
     OR source_text !~ 'observed_at \+ interval ''60 seconds'''
     OR source_text !~ 'status = ''REJECTED'''
     OR source_text !~ 'MOBILE_GOOGLE_CALLBACK_REJECTED'
     OR source_text !~ 'denial_handoff_created' THEN
    RAISE EXCEPTION 'A4 authenticated denial completion contract is incomplete';
  END IF;

  source_text := pg_get_functiondef(mobile_exchange_v2);
  IF source_text !~ 'exchange_mobile_handoff_v1'
     OR source_text !~ 'mobile_google_auth_admit_internal_v1'
     OR source_text !~ '''ACCESS_DENIED'''
     OR source_text !~ 'selected_handoff\.denial_category'
     OR source_text !~ 'status = ''CONSUMED'''
     OR source_text !~ 'p_app_exchange_challenge'
     OR source_text !~ 'p_installation_binding_hash'
     OR (
       pg_catalog.length(source_text)
       - pg_catalog.length(pg_catalog.replace(
           source_text, 'mobile_google_auth_admit_internal_v1', ''
         ))
       ) / pg_catalog.length('mobile_google_auth_admit_internal_v1') <> 1 THEN
    RAISE EXCEPTION 'A4 denial handoff exchange/delegation contract is incomplete';
  END IF;

  source_text := pg_get_functiondef(mobile_internal);
  IF source_text !~ 'mem\.status=''PENDING'''
     OR source_text ~ 'mem\.status IN \(''PENDING'',''DEPROVISIONED''\)'
     OR source_text !~ 'other_membership\.workspace_id <> ws\.workspace_id'
     OR source_text !~ 'target_membership\.status IN \(''SUSPENDED'', ''DEPROVISIONED''\)' THEN
    RAISE EXCEPTION 'A4 mobile cross-tenant or deprovisioned-member guard is missing';
  END IF;

  IF NOT (
    SELECT procedure_row.prosecdef
      AND procedure_row.provolatile = 'v'
      AND procedure_row.proconfig = ARRAY['search_path=pg_catalog, uptech']::text[]
      AND pg_get_userbyid(procedure_row.proowner) = 'uptech_migration_owner'
    FROM pg_catalog.pg_proc AS procedure_row
    WHERE procedure_row.oid = web_routine
  ) OR NOT (
    SELECT procedure_row.prosecdef
      AND procedure_row.provolatile = 'v'
      AND procedure_row.proconfig = ARRAY['search_path=pg_catalog, uptech']::text[]
      AND pg_get_userbyid(procedure_row.proowner) = 'uptech_migration_owner'
    FROM pg_catalog.pg_proc AS procedure_row
    WHERE procedure_row.oid = mobile_routine
  ) THEN
    RAISE EXCEPTION 'A4 public completion routine attributes are unsafe';
  END IF;

  FOREACH guarded_routine IN ARRAY ARRAY[
    mobile_denial_routine, mobile_exchange_v2
  ] LOOP
    IF NOT (
      SELECT procedure_row.prosecdef
        AND procedure_row.provolatile = 'v'
        AND procedure_row.proconfig = ARRAY['search_path=pg_catalog, uptech']::text[]
        AND pg_get_userbyid(procedure_row.proowner) = 'uptech_migration_owner'
      FROM pg_catalog.pg_proc AS procedure_row
      WHERE procedure_row.oid = guarded_routine
    ) OR NOT has_function_privilege(
      'uptech_api_runtime', guarded_routine, 'EXECUTE'
    ) OR has_function_privilege(
      'uptech_worker_runtime', guarded_routine, 'EXECUTE'
    ) OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS procedure_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(
          procedure_row.proacl,
          pg_catalog.acldefault('f', procedure_row.proowner)
        )
      ) AS acl_row
      WHERE procedure_row.oid = guarded_routine
        AND acl_row.grantee = 0
        AND acl_row.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'A4 denial routine attributes/grants are unsafe: %',
        guarded_routine;
    END IF;
  END LOOP;

  IF NOT has_function_privilege('uptech_api_runtime', web_routine, 'EXECUTE')
     OR has_function_privilege('uptech_worker_runtime', web_routine, 'EXECUTE')
     OR has_function_privilege('uptech_api_runtime', web_internal, 'EXECUTE')
     OR has_function_privilege('uptech_worker_runtime', web_internal, 'EXECUTE')
     OR NOT has_function_privilege('uptech_api_runtime', mobile_routine, 'EXECUTE')
     OR has_function_privilege('uptech_worker_runtime', mobile_routine, 'EXECUTE')
     OR has_function_privilege('uptech_api_runtime', mobile_internal, 'EXECUTE')
     OR has_function_privilege('uptech_worker_runtime', mobile_internal, 'EXECUTE') THEN
    RAISE EXCEPTION 'A4 public/internal execute separation is wrong';
  END IF;

  IF has_function_privilege(
       'uptech_api_runtime', legacy_native_completion, 'EXECUTE'
     ) OR has_function_privilege(
       'uptech_worker_runtime', legacy_native_completion, 'EXECUTE'
     ) OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS procedure_row
       CROSS JOIN LATERAL pg_catalog.aclexplode(
         COALESCE(
           procedure_row.proacl,
           pg_catalog.acldefault('f', procedure_row.proowner)
         )
       ) AS acl_row
       WHERE procedure_row.oid = legacy_native_completion
         AND acl_row.grantee = 0
         AND acl_row.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'A4 obsolete native completion remains runtime-executable';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      -- Workspaces and memberships retain their Phase 1, post-session RLS
      -- reads. This boundary covers only pre-tenant/auth authority tables.
      'workspace_domain_locators', 'users', 'identities', 'onboarding_sessions',
      'mobile_google_configuration_registry', 'mobile_google_transactions',
      'mobile_handoffs'
    ]) AS relation_name
    WHERE has_table_privilege(
      'uptech_api_runtime', 'uptech.' || relation_name, 'SELECT,INSERT,UPDATE,DELETE'
    ) OR has_table_privilege(
      'uptech_worker_runtime', 'uptech.' || relation_name, 'SELECT,INSERT,UPDATE,DELETE'
    )
  ) THEN
    RAISE EXCEPTION 'A4 runtime role has direct pre-tenant authority-table access';
  END IF;
END
$verify$;

ROLLBACK;
