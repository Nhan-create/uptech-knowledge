\set ON_ERROR_STOP on

BEGIN;
SET LOCAL ROLE uptech_migration_owner;

-- =============================================================================
-- 0020: Reconcile knowledge schema columns if an earlier pre-0012 table lacked
--       fields referenced by admin_get_workspace_overview_v1 / analytics.
-- =============================================================================

ALTER TABLE uptech.knowledge_documents
  ADD COLUMN IF NOT EXISTS processing_kind text NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS processing_label text NOT NULL DEFAULT 'Sẵn sàng',
  ADD COLUMN IF NOT EXISTS governance_kind text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS governance_label text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS byte_size bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_user_uploaded boolean NOT NULL DEFAULT false;

ALTER TABLE uptech.knowledge_cards
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft';

ALTER TABLE uptech.ai_chat_turns
  ADD COLUMN IF NOT EXISTS evidence_state text NOT NULL DEFAULT 'empty',
  ADD COLUMN IF NOT EXISTS citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS feedback text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp();

COMMIT;
