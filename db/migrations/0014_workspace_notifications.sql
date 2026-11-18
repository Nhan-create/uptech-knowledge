\set ON_ERROR_STOP on

BEGIN;
SET LOCAL ROLE uptech_migration_owner;

CREATE TABLE uptech.workspace_notifications (
  workspace_id uuid NOT NULL REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT,
  id text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  href text,
  action_label text NOT NULL DEFAULT 'Mở',
  unread boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT workspace_notifications_kind_check
    CHECK (
      kind IN (
        'document_uploaded',
        'document_updated',
        'document_deleted',
        'knowledge_created',
        'knowledge_verified',
        'utility_completed'
      )
    )
);

ALTER TABLE uptech.workspace_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.workspace_notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_notifications_tenant_policy ON uptech.workspace_notifications
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON
  uptech.workspace_notifications
TO uptech_api_runtime;

COMMIT;
