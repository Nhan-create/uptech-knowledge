\set ON_ERROR_STOP on

BEGIN;
SET LOCAL ROLE uptech_migration_owner;

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('sessions','sessions_api_scope'),
      ('session_tokens','session_tokens_api_scope')
    ) AS expected(relation_name,policy_name)
    JOIN pg_class c ON c.relname=expected.relation_name
    JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='uptech'
    LEFT JOIN pg_policy p ON p.polrelid=c.oid AND p.polname=expected.policy_name
    WHERE NOT (c.relrowsecurity AND c.relforcerowsecurity)
      OR p.oid IS NULL
      OR p.polcmd<>'*'
      OR NOT p.polpermissive
      OR p.polroles<>ARRAY['uptech_api_runtime'::regrole::oid]
  ) THEN
    RAISE EXCEPTION 'shared session runtime policy preflight failed';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_policy p
    JOIN pg_class c ON c.oid=p.polrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='uptech' AND c.relname IN ('sessions','session_tokens')
      AND (0=ANY(p.polroles) OR 'uptech_api_runtime'::regrole::oid=ANY(p.polroles))
      AND NOT (
        (c.relname='sessions' AND p.polname='sessions_api_scope')
        OR (c.relname='session_tokens' AND p.polname='session_tokens_api_scope')
      )
  ) THEN
    RAISE EXCEPTION 'unexpected shared session runtime policy exists';
  END IF;
END
$preflight$;

ALTER POLICY sessions_api_scope ON uptech.sessions
  USING (
    client_type='WEB'
    AND workspace_id::text=NULLIF(current_setting('app.workspace_id',true),'')
    AND id::text=NULLIF(current_setting('app.session_id',true),'')
    AND EXISTS (
      SELECT 1 FROM uptech.workspaces AS context_workspace
      WHERE context_workspace.workspace_id=sessions.workspace_id
    )
  )
  WITH CHECK (
    client_type='WEB'
    AND workspace_id::text=NULLIF(current_setting('app.workspace_id',true),'')
    AND id::text=NULLIF(current_setting('app.session_id',true),'')
    AND EXISTS (
      SELECT 1 FROM uptech.workspaces AS context_workspace
      WHERE context_workspace.workspace_id=sessions.workspace_id
    )
  );

ALTER POLICY session_tokens_api_scope ON uptech.session_tokens
  USING (
    client_type='WEB'
    AND session_id::text=NULLIF(current_setting('app.session_id',true),'')
    AND workspace_id::text=NULLIF(current_setting('app.workspace_id',true),'')
    AND EXISTS (
      SELECT 1 FROM uptech.workspaces AS context_workspace
      WHERE context_workspace.workspace_id=session_tokens.workspace_id
    )
  )
  WITH CHECK (
    client_type='WEB'
    AND session_id::text=NULLIF(current_setting('app.session_id',true),'')
    AND workspace_id::text=NULLIF(current_setting('app.workspace_id',true),'')
    AND EXISTS (
      SELECT 1 FROM uptech.workspaces AS context_workspace
      WHERE context_workspace.workspace_id=session_tokens.workspace_id
    )
  );

REVOKE INSERT ON uptech.sessions,uptech.session_tokens FROM uptech_api_runtime;
REVOKE SELECT ON uptech.sessions FROM uptech_api_runtime;
GRANT SELECT (
  workspace_id,id,user_id,membership_id,client_type,status,security_version,
  idle_expires_at,absolute_expires_at,revoked_at
) ON uptech.sessions TO uptech_api_runtime;

COMMIT;
