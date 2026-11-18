\set ON_ERROR_STOP on

BEGIN;
SET LOCAL ROLE uptech_migration_owner;

-- Tenant-scoped Knowledge Spaces for documents, indexing, and AI RAG.
CREATE TABLE uptech.knowledge_spaces (
  workspace_id uuid NOT NULL REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT,
  id text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT knowledge_spaces_id_check CHECK (length(id) BETWEEN 1 AND 64),
  CONSTRAINT knowledge_spaces_name_check CHECK (length(name) BETWEEN 1 AND 120)
);

CREATE TABLE uptech.knowledge_documents (
  workspace_id uuid NOT NULL,
  id text NOT NULL,
  space_id text NOT NULL,
  name text NOT NULL,
  file_type text NOT NULL,
  version_label text NOT NULL,
  detail text NOT NULL DEFAULT '',
  owner_label text NOT NULL DEFAULT '',
  updated_label text NOT NULL DEFAULT '',
  processing_kind text NOT NULL,
  processing_label text NOT NULL,
  governance_kind text NOT NULL DEFAULT 'active',
  governance_label text NOT NULL DEFAULT '',
  byte_size bigint NOT NULL DEFAULT 0,
  is_user_uploaded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, space_id)
    REFERENCES uptech.knowledge_spaces (workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT knowledge_documents_file_type_check
    CHECK (file_type IN ('pdf', 'docx', 'md', 'txt', 'csv', 'json')),
  CONSTRAINT knowledge_documents_processing_kind_check
    CHECK (processing_kind IN ('ready', 'uploading', 'indexing', 'ocr', 'failed')),
  CONSTRAINT knowledge_documents_governance_kind_check
    CHECK (governance_kind IN ('active', 'deprecated'))
);

CREATE TABLE uptech.knowledge_document_versions (
  workspace_id uuid NOT NULL,
  document_id text NOT NULL,
  version_id text NOT NULL,
  version_label text NOT NULL,
  note text NOT NULL DEFAULT '',
  updated_label text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (workspace_id, document_id, version_id),
  FOREIGN KEY (workspace_id, document_id)
    REFERENCES uptech.knowledge_documents (workspace_id, id) ON DELETE CASCADE
);

-- Ready-Only indexed chunks used by hybrid full-text & vector retrieval.
CREATE TABLE uptech.knowledge_document_chunks (
  workspace_id uuid NOT NULL,
  chunk_id text NOT NULL,
  document_id text NOT NULL,
  chunk_index integer NOT NULL,
  heading text NOT NULL DEFAULT '',
  locator text NOT NULL DEFAULT '',
  content text NOT NULL,
  embedding_json jsonb,
  content_tsv tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(heading, '') || ' ' || coalesce(content, ''))
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (workspace_id, chunk_id),
  FOREIGN KEY (workspace_id, document_id)
    REFERENCES uptech.knowledge_documents (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT knowledge_document_chunks_index_check CHECK (chunk_index >= 0)
);

CREATE INDEX knowledge_document_chunks_tsv_idx
  ON uptech.knowledge_document_chunks USING gin (content_tsv);

-- Persistent AI assistant sessions & grounded turns with citation provenance.
CREATE TABLE uptech.ai_chat_sessions (
  workspace_id uuid NOT NULL REFERENCES uptech.workspaces (workspace_id) ON DELETE RESTRICT,
  id text NOT NULL,
  membership_id uuid NOT NULL,
  title text NOT NULL,
  scope text NOT NULL DEFAULT 'workspace',
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, membership_id)
    REFERENCES uptech.workspace_memberships (workspace_id, membership_id) ON DELETE RESTRICT
);

CREATE TABLE uptech.ai_chat_turns (
  workspace_id uuid NOT NULL,
  session_id text NOT NULL,
  id text NOT NULL,
  turn_order integer NOT NULL,
  prompt text NOT NULL,
  scope text NOT NULL DEFAULT 'workspace',
  evidence_state text NOT NULL,
  answer_paragraphs jsonb NOT NULL DEFAULT '[]'::jsonb,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  excluded_count integer NOT NULL DEFAULT 0,
  model_name text,
  feedback text,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (workspace_id, session_id, id),
  FOREIGN KEY (workspace_id, session_id)
    REFERENCES uptech.ai_chat_sessions (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT ai_chat_turns_evidence_check
    CHECK (evidence_state IN ('grounded', 'caution', 'empty')),
  CONSTRAINT ai_chat_turns_feedback_check
    CHECK (feedback IS NULL OR feedback IN ('up', 'down'))
);

ALTER TABLE uptech.knowledge_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.knowledge_spaces FORCE ROW LEVEL SECURITY;
CREATE POLICY knowledge_spaces_tenant_policy ON uptech.knowledge_spaces
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

ALTER TABLE uptech.knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.knowledge_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY knowledge_documents_tenant_policy ON uptech.knowledge_documents
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

ALTER TABLE uptech.knowledge_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.knowledge_document_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY knowledge_document_versions_tenant_policy ON uptech.knowledge_document_versions
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

ALTER TABLE uptech.knowledge_document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.knowledge_document_chunks FORCE ROW LEVEL SECURITY;
CREATE POLICY knowledge_document_chunks_tenant_policy ON uptech.knowledge_document_chunks
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

ALTER TABLE uptech.ai_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.ai_chat_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_chat_sessions_tenant_policy ON uptech.ai_chat_sessions
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

ALTER TABLE uptech.ai_chat_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE uptech.ai_chat_turns FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_chat_turns_tenant_policy ON uptech.ai_chat_turns
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON
  uptech.knowledge_spaces,
  uptech.knowledge_documents,
  uptech.knowledge_document_versions,
  uptech.knowledge_document_chunks,
  uptech.ai_chat_sessions,
  uptech.ai_chat_turns
TO uptech_api_runtime;

COMMIT;
