\set ON_ERROR_STOP on

BEGIN;
SET LOCAL ROLE uptech_migration_owner;

-- =============================================================================
-- 0020: Reconcile legacy Neon knowledge_* and ai_chat_* tables where string ID
--       columns (e.g. 'spc_8f2a01', 'upload-<uuid>') were previously created as
--       uuid instead of text, and ensure all 0012/0013/0017/0018 columns & RLS
--       policies exist cleanly.
-- =============================================================================

DO $reconcile_knowledge$
DECLARE
  rec record;
  target_cols text[][] := ARRAY[
    ARRAY['knowledge_spaces', 'id'],
    ARRAY['knowledge_documents', 'id'],
    ARRAY['knowledge_documents', 'space_id'],
    ARRAY['knowledge_document_versions', 'document_id'],
    ARRAY['knowledge_document_versions', 'version_id'],
    ARRAY['knowledge_document_chunks', 'chunk_id'],
    ARRAY['knowledge_document_chunks', 'document_id'],
    ARRAY['knowledge_cards', 'id'],
    ARRAY['knowledge_cards', 'space_id'],
    ARRAY['knowledge_cards', 'source_document_id'],
    ARRAY['ai_chat_sessions', 'id'],
    ARRAY['ai_chat_turns', 'id'],
    ARRAY['ai_chat_turns', 'session_id']
  ];
  idx integer;
  tbl_name text;
  col_name text;
  col_type text;
BEGIN
  -- 0. Drop all existing RLS policies on knowledge_* and ai_chat_* (e.g. legacy *_api_read)
  --    so PostgreSQL allows altering column types from uuid -> text cleanly.
  FOR rec IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'uptech'
      AND tablename IN (
        'knowledge_spaces',
        'knowledge_documents',
        'knowledge_document_versions',
        'knowledge_document_chunks',
        'knowledge_cards',
        'ai_chat_sessions',
        'ai_chat_turns'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', rec.policyname, rec.schemaname, rec.tablename);
  END LOOP;

  -- 1. Drop inter-table FKs among knowledge_* and ai_chat_* before widening uuid -> text
  FOR rec IN
    SELECT DISTINCT n.nspname AS schema_name, c.relname AS table_name, con.conname AS constraint_name
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'uptech'
      AND con.contype = 'f'
      AND c.relname IN (
        'knowledge_spaces',
        'knowledge_documents',
        'knowledge_document_versions',
        'knowledge_document_chunks',
        'knowledge_cards',
        'ai_chat_sessions',
        'ai_chat_turns',
        'knowledge_document_blobs',
        'knowledge_document_comments'
      )
      AND con.confrelid <> 'uptech.workspaces'::regclass
      AND con.confrelid <> 'uptech.workspace_memberships'::regclass
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I',
      rec.schema_name,
      rec.table_name,
      rec.constraint_name
    );
  END LOOP;

  -- 2. Convert any uuid string-ID columns to text
  FOR idx IN 1 .. pg_catalog.array_length(target_cols, 1) LOOP
    tbl_name := target_cols[idx][1];
    col_name := target_cols[idx][2];
    SELECT c.data_type INTO col_type
    FROM information_schema.columns c
    WHERE c.table_schema = 'uptech'
      AND c.table_name = tbl_name
      AND c.column_name = col_name;

    IF col_type = 'uuid' THEN
      EXECUTE format('ALTER TABLE uptech.%I ALTER COLUMN %I DROP DEFAULT', tbl_name, col_name);
      EXECUTE format('ALTER TABLE uptech.%I ALTER COLUMN %I TYPE text USING %I::text', tbl_name, col_name, col_name);
    END IF;
  END LOOP;
END
$reconcile_knowledge$;

-- 3. Ensure all required columns exist across knowledge_* and ai_chat_* tables
ALTER TABLE uptech.knowledge_spaces
  ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS access_scope text NOT NULL DEFAULT 'WORKSPACE',
  ADD COLUMN IF NOT EXISTS allowed_department_key text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp();

ALTER TABLE uptech.knowledge_documents
  ADD COLUMN IF NOT EXISTS space_id text NOT NULL DEFAULT 'spc_8f2a01',
  ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS file_type text NOT NULL DEFAULT 'md',
  ADD COLUMN IF NOT EXISTS version_label text NOT NULL DEFAULT 'v1.0',
  ADD COLUMN IF NOT EXISTS detail text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS owner_label text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS updated_label text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS processing_kind text NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS processing_label text NOT NULL DEFAULT 'Sẵn sàng',
  ADD COLUMN IF NOT EXISTS governance_kind text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS governance_label text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS byte_size bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_user_uploaded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp();

ALTER TABLE uptech.knowledge_document_versions
  ADD COLUMN IF NOT EXISTS version_label text NOT NULL DEFAULT 'v1.0',
  ADD COLUMN IF NOT EXISTS note text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS updated_label text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS chunks_snapshot_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS author_label text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS byte_size bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp();

ALTER TABLE uptech.knowledge_cards
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'decision',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS summary text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS rationale text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS space_id text NOT NULL DEFAULT 'spc_8f2a01',
  ADD COLUMN IF NOT EXISTS space_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_document_id text,
  ADD COLUMN IF NOT EXISTS source_document_name text,
  ADD COLUMN IF NOT EXISTS source_locator text,
  ADD COLUMN IF NOT EXISTS owner_label text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS updated_label text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp();

ALTER TABLE uptech.ai_chat_turns
  ADD COLUMN IF NOT EXISTS evidence_state text NOT NULL DEFAULT 'empty',
  ADD COLUMN IF NOT EXISTS answer_paragraphs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS excluded_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS model_name text,
  ADD COLUMN IF NOT EXISTS feedback text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp();

-- 4. Restore FKs cleanly once all columns are text
DO $restore_fks$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'uptech.knowledge_documents'::regclass
      AND confrelid = 'uptech.knowledge_spaces'::regclass
      AND contype = 'f'
  ) THEN
    ALTER TABLE uptech.knowledge_documents
      ADD CONSTRAINT knowledge_documents_space_fk
      FOREIGN KEY (workspace_id, space_id)
      REFERENCES uptech.knowledge_spaces (workspace_id, id) ON DELETE RESTRICT
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'uptech.knowledge_document_versions'::regclass
      AND confrelid = 'uptech.knowledge_documents'::regclass
      AND contype = 'f'
  ) THEN
    ALTER TABLE uptech.knowledge_document_versions
      ADD CONSTRAINT knowledge_document_versions_doc_fk
      FOREIGN KEY (workspace_id, document_id)
      REFERENCES uptech.knowledge_documents (workspace_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'uptech.knowledge_document_chunks'::regclass
      AND confrelid = 'uptech.knowledge_documents'::regclass
      AND contype = 'f'
  ) THEN
    ALTER TABLE uptech.knowledge_document_chunks
      ADD CONSTRAINT knowledge_document_chunks_doc_fk
      FOREIGN KEY (workspace_id, document_id)
      REFERENCES uptech.knowledge_documents (workspace_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'uptech.ai_chat_turns'::regclass
      AND confrelid = 'uptech.ai_chat_sessions'::regclass
      AND contype = 'f'
  ) THEN
    ALTER TABLE uptech.ai_chat_turns
      ADD CONSTRAINT ai_chat_turns_session_fk
      FOREIGN KEY (workspace_id, session_id)
      REFERENCES uptech.ai_chat_sessions (workspace_id, id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END
$restore_fks$;

-- 5. Ensure RLS policies accept both app.current_workspace_id and app.workspace_id,
--    and grant runtime CRUD access to uptech_api_runtime.
DO $rls_sync$
DECLARE
  tbl text;
  pol text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'knowledge_spaces',
    'knowledge_documents',
    'knowledge_document_versions',
    'knowledge_document_chunks',
    'knowledge_cards',
    'ai_chat_sessions',
    'ai_chat_turns'
  ] LOOP
    pol := tbl || '_tenant_policy';
    EXECUTE format('ALTER TABLE uptech.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE uptech.%I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON uptech.%I', tbl || '_migration_owner', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON uptech.%I TO uptech_migration_owner USING (true) WITH CHECK (true)',
      tbl || '_migration_owner', tbl
    );
    EXECUTE format('DROP POLICY IF EXISTS %I ON uptech.%I', pol, tbl);
    EXECUTE format(
      'CREATE POLICY %I ON uptech.%I TO uptech_api_runtime ' ||
      'USING (workspace_id = COALESCE(' ||
        'NULLIF(pg_catalog.current_setting(''app.current_workspace_id'', true), '''')::uuid, ' ||
        'NULLIF(pg_catalog.current_setting(''app.workspace_id'', true), '''')::uuid' ||
      ')) ' ||
      'WITH CHECK (workspace_id = COALESCE(' ||
        'NULLIF(pg_catalog.current_setting(''app.current_workspace_id'', true), '''')::uuid, ' ||
        'NULLIF(pg_catalog.current_setting(''app.workspace_id'', true), '''')::uuid' ||
      '))',
      pol, tbl
    );
  END LOOP;
END
$rls_sync$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  uptech.knowledge_spaces,
  uptech.knowledge_documents,
  uptech.knowledge_document_versions,
  uptech.knowledge_document_chunks,
  uptech.knowledge_cards,
  uptech.ai_chat_sessions,
  uptech.ai_chat_turns
TO uptech_api_runtime;

COMMIT;
