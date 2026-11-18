\set ON_ERROR_STOP on

BEGIN;
SET LOCAL ROLE uptech_migration_owner;

CREATE TABLE uptech.knowledge_cards (
  workspace_id uuid NOT NULL REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT,
  id text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  title text NOT NULL,
  summary text NOT NULL,
  rationale text NOT NULL DEFAULT '',
  space_id text NOT NULL,
  space_name text NOT NULL DEFAULT '',
  source_document_id text,
  source_document_name text,
  source_locator text,
  owner_label text NOT NULL DEFAULT '',
  updated_label text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT knowledge_cards_kind_check
    CHECK (kind IN ('decision', 'open-question', 'rule')),
  CONSTRAINT knowledge_cards_status_check
    CHECK (status IN ('draft', 'verified', 'archived')),
  CONSTRAINT knowledge_cards_version_check CHECK (version > 0)
);

ALTER TABLE uptech.knowledge_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.knowledge_cards FORCE ROW LEVEL SECURITY;
CREATE POLICY knowledge_cards_tenant_policy ON uptech.knowledge_cards
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON
  uptech.knowledge_cards
TO uptech_api_runtime;

COMMIT;
