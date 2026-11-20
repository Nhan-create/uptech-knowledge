import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  FILE_TYPES,
  type DocumentDetailView,
  type DocumentId,
  type DocumentSummaryView,
  type FileType,
  type SpaceId,
  type SpaceSummaryView,
} from "@/features/knowledge/model";
import type { ChatTurn, ContextScopeType } from "@/features/chat/chat-engine";
import type { ChatSession } from "@/features/chat/chat-sessions";
import type { ExtractedDocumentChunk } from "@/server/ai/document-parser";
import { getRuntimeDatabasePool } from "@/server/db/runtime-pool";
import { UPTECH_BAOGIA_SEED_DOCUMENTS } from "@/server/knowledge/uptech-baogia-pack";
import {
  canAccessKnowledgeSpace,
  isWorkspacePreviewModeEnabled,
  type SpaceAccessScope,
  type WorkspaceAccessContext,
  type WorkspaceDepartmentKey,
} from "@/server/knowledge/access-context";
import type { Locale } from "@/lib/preferences";

export interface StoredDocumentChunk {
  readonly chunkId: string;
  readonly documentId: string;
  readonly chunkIndex: number;
  readonly heading: string;
  readonly locator: string;
  readonly content: string;
  readonly embedding?: readonly number[];
}

export interface StoredKnowledgeDocument {
  readonly summary: DocumentSummaryView;
  readonly versions: DocumentDetailView["versions"];
  readonly isUserUploaded: boolean;
  readonly byteSize: number;
  readonly rawFileExtension?: string;
  readonly chunks: readonly StoredDocumentChunk[];
}

export type KnowledgeCardKind = "decision" | "open-question" | "rule";
export type KnowledgeCardStatus = "draft" | "verified" | "archived";

export interface KnowledgeCardRecord {
  readonly id: string;
  readonly kind: KnowledgeCardKind;
  readonly status: KnowledgeCardStatus;
  readonly title: string;
  readonly summary: string;
  readonly rationale: string;
  readonly spaceId: string;
  readonly spaceName: string;
  readonly sourceDocumentId: string | null;
  readonly sourceDocumentName: string | null;
  readonly sourceLocator: string | null;
  readonly ownerLabel: string;
  readonly updatedLabel: string;
  readonly version: number;
}

export type WorkspaceNotificationKind =
  | "document_uploaded"
  | "document_updated"
  | "document_deleted"
  | "knowledge_created"
  | "knowledge_verified"
  | "utility_completed";

export interface WorkspaceNotificationRecord {
  readonly id: string;
  readonly kind: WorkspaceNotificationKind;
  readonly title: string;
  readonly description: string;
  readonly href: string | null;
  readonly actionLabel: string;
  readonly unread: boolean;
  readonly createdAtIso: string;
}

export interface UtilityRunRecord {
  readonly id: string;
  readonly task: "summary" | "translate" | "checklist" | "report" | "email";
  readonly title: string;
  readonly summary: string;
  readonly sections: readonly Readonly<{ heading: string; content: string }>[];
  readonly sources: readonly Readonly<{
    documentId: string | null;
    title: string;
    spaceName: string | null;
  }>[];
  readonly createdAtIso: string;
}

export interface WorkspacePolicySettings {
  readonly maxUploadMb: number;
  readonly allowMemberUploads: boolean;
  readonly requireVerifiedCardsInChat: boolean;
  readonly piiRedactionEnabled: boolean;
}

export type DocumentCommentKind = "COMMENT" | "OUTDATED_FLAG" | "APPROVAL_NOTE";

export interface DocumentCommentRecord {
  readonly id: string;
  readonly documentId: string;
  readonly chunkId: string | null;
  readonly authorLabel: string;
  readonly authorRole: "OWNER" | "ADMIN" | "MEMBER";
  readonly commentKind: DocumentCommentKind;
  readonly body: string;
  readonly resolved: boolean;
  readonly createdAtIso: string;
}

export interface KnowledgeConnectorRecord {
  readonly id: string;
  readonly connectorKind: "WEB_URL" | "WEBHOOK_API";
  readonly title: string;
  readonly sourceUrl: string;
  readonly spaceId: string;
  readonly documentId: string | null;
  readonly status: "ACTIVE" | "ERROR";
  readonly lastSyncedAtIso: string;
  readonly chunkCount: number;
  readonly createdByLabel: string;
}

export interface IngestionApiKeyRecord {
  readonly id: string;
  readonly label: string;
  readonly keyPrefix: string;
  readonly defaultSpaceId: string;
  readonly createdByLabel: string;
  readonly lastUsedAtIso: string | null;
  readonly revokedAtIso: string | null;
  readonly createdAtIso: string;
}

export interface PersistedWorkspaceState {
  readonly schemaVersion?: number;
  readonly spaces: readonly SpaceSummaryView[];
  readonly documents: readonly StoredKnowledgeDocument[];
  readonly sessions: readonly ChatSession[];
  readonly cards?: readonly KnowledgeCardRecord[];
  readonly notifications?: readonly WorkspaceNotificationRecord[];
  readonly utilityRuns?: readonly UtilityRunRecord[];
  readonly comments?: readonly DocumentCommentRecord[];
  readonly versionSnapshots?: Readonly<Record<string, readonly StoredDocumentChunk[]>>;
  readonly connectors?: readonly KnowledgeConnectorRecord[];
  readonly apiKeys?: readonly (IngestionApiKeyRecord & { readonly keyHash?: string })[];
}

const PREVIEW_DATA_DIR = resolve(process.cwd(), ".uptech-data");
const PREVIEW_DATA_FILE = resolve(PREVIEW_DATA_DIR, "workspace-knowledge.json");
const PREVIEW_FILES_DIR = resolve(PREVIEW_DATA_DIR, "files");
const CURRENT_SCHEMA_VERSION = 2;
const MAX_CHAT_SESSIONS = 30;
const MAX_STORED_TURNS_PER_SESSION = 50;
const MAX_NOTIFICATIONS = 80;

function createNotificationItem(args: Readonly<{
  kind: WorkspaceNotificationKind;
  title: string;
  description: string;
  href: string | null;
  actionLabel: string;
}>): WorkspaceNotificationRecord {
  return {
    id: `ntf_${randomUUID().slice(0, 12)}`,
    kind: args.kind,
    title: args.title,
    description: args.description,
    href: args.href,
    actionLabel: args.actionLabel,
    unread: true,
    createdAtIso: new Date().toISOString(),
  };
}

const DEFAULT_SPACES: readonly SpaceSummaryView[] = [
  {
    id: "spc_8f2a01" as SpaceId,
    name: "Nhân sự",
    description: "Chính sách nhân sự, quy định làm việc và tài liệu hội nhập.",
    documentCount: 0,
  },
  {
    id: "spc_c14d72" as SpaceId,
    name: "Vận hành",
    description: "Quy trình chuẩn SOP, vận hành hệ thống và hướng dẫn nội bộ.",
    documentCount: 0,
  },
  {
    id: "spc_6be903" as SpaceId,
    name: "Dự án Atlas",
    description: "Tài liệu kỹ thuật, biên bản bàn giao và đặc tả dự án.",
    documentCount: 0,
  },
];

let memoryLock: Promise<void> = Promise.resolve();

function withStoreLock<T>(work: () => Promise<T>): Promise<T> {
  const next = memoryLock.then(work, work);
  memoryLock = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export function normalizeDisplayFileType(extension: string): FileType {
  const lower = extension.toLowerCase();
  if (lower === "pdf" || lower === "docx" || lower === "md") {
    return lower;
  }
  if (lower === "doc" || lower === "pptx" || lower === "ppt" || lower === "rtf" || lower === "odt" || lower === "odp") {
    return "docx";
  }
  return FILE_TYPES[2];
}

function normalizeStorageFileType(
  extension: string,
  allowedValues?: readonly string[],
): string {
  const lower = extension.toLowerCase();
  if (allowedValues && allowedValues.includes(lower)) {
    return lower;
  }
  if (lower === "pdf") return "pdf";
  if (
    lower === "docx" ||
    lower === "doc" ||
    lower === "pptx" ||
    lower === "ppt" ||
    lower === "rtf" ||
    lower === "odt" ||
    lower === "odp"
  ) {
    return "docx";
  }
  if (lower === "md") return "md";
  if (
    lower === "csv" ||
    lower === "tsv" ||
    lower === "xlsx" ||
    lower === "xls" ||
    lower === "ods"
  ) {
    return "csv";
  }
  if (
    lower === "json" ||
    lower === "jsonl" ||
    lower === "yaml" ||
    lower === "yml" ||
    lower === "xml"
  ) {
    return "json";
  }
  return "txt";
}

function buildSeedState(): PersistedWorkspaceState {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    spaces: [...DEFAULT_SPACES],
    documents: [...UPTECH_BAOGIA_SEED_DOCUMENTS],
    sessions: [],
    cards: [],
    notifications: [],
  };
}

async function readPreviewStoreFile(): Promise<PersistedWorkspaceState> {
  try {
    const raw = await readFile(PREVIEW_DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<PersistedWorkspaceState>;
    if (
      Array.isArray(parsed.spaces) &&
      Array.isArray(parsed.documents) &&
      Array.isArray(parsed.sessions)
    ) {
      if (parsed.schemaVersion !== CURRENT_SCHEMA_VERSION) {
        // Strip legacy seeded fixture documents so only real user documents remain
        const realDocuments = parsed.documents.filter((doc) => doc.isUserUploaded);
        const migratedSpaces = parsed.spaces.map((space) => {
          const defaultMatch = DEFAULT_SPACES.find((item) => item.id === space.id);
          return defaultMatch
            ? { ...space, description: defaultMatch.description }
            : space;
        });
        const migratedState: PersistedWorkspaceState = {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          spaces: migratedSpaces.length > 0 ? migratedSpaces : [...DEFAULT_SPACES],
          documents: realDocuments,
          sessions: parsed.sessions,
        };
        await writePreviewStoreFile(migratedState);
        return migratedState;
      }

      const hasUptechSeed = parsed.documents.some((doc) =>
        doc.summary.id.startsWith("kb_uptech_"),
      );
      const documents = hasUptechSeed
        ? parsed.documents
        : [...UPTECH_BAOGIA_SEED_DOCUMENTS, ...parsed.documents];

      return {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        spaces: parsed.spaces.length > 0 ? parsed.spaces : [...DEFAULT_SPACES],
        documents,
        sessions: parsed.sessions,
        cards: Array.isArray(parsed.cards) ? parsed.cards : [],
        notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
      };
    }
  } catch {
    // Missing or unreadable cache falls through to clean seed.
  }

  const seeded = buildSeedState();
  await writePreviewStoreFile(seeded);
  return seeded;
}

async function writePreviewStoreFile(state: PersistedWorkspaceState): Promise<void> {
  await mkdir(PREVIEW_DATA_DIR, { recursive: true });
  await writeFile(
    PREVIEW_DATA_FILE,
    JSON.stringify({ ...state, schemaVersion: CURRENT_SCHEMA_VERSION }, null, 2),
    "utf8",
  );
}

function safeUploadedBinaryPath(documentId: string): string {
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(documentId)) {
    throw new Error("Invalid document storage identifier.");
  }
  return resolve(PREVIEW_FILES_DIR, `${documentId}.bin`);
}

export async function readUploadedDocumentBinary(
  documentId: string,
  access?: WorkspaceAccessContext,
): Promise<Buffer | null> {
  if (access && canAttemptPostgres(access)) {
    try {
      const dbBytes = await withTenantPostgres(access, async (query) => {
        const res = await query(
          `SELECT content_bytes
           FROM uptech.knowledge_document_blobs
           WHERE document_id = $1
           LIMIT 1`,
          [documentId],
        );
        const raw = res.rows[0]?.content_bytes;
        if (Buffer.isBuffer(raw)) return raw;
        if (raw instanceof Uint8Array) return Buffer.from(raw);
        return null;
      });
      if (dbBytes) return dbBytes;
    } catch {
      // Fallback safely if 0017 blob table is not yet present.
    }
  }

  if (!isWorkspacePreviewModeEnabled()) {
    return null;
  }

  try {
    return await readFile(safeUploadedBinaryPath(documentId));
  } catch {
    return null;
  }
}

function canAttemptPostgres(access: WorkspaceAccessContext): boolean {
  return Boolean(process.env.DATABASE_URL?.trim()) && access.mode === "authenticated";
}

function formatByteLabel(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const kb = sizeBytes / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

async function withTenantPostgres<T>(
  access: WorkspaceAccessContext,
  fn: (query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<T>,
): Promise<T> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }
  const pool = getRuntimeDatabasePool(databaseUrl);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.current_workspace_id', $1, true), set_config('app.workspace_id', $1, true)",
      [access.workspaceId],
    );
    const result = await fn((sql, params) => client.query(sql, params));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export interface RequiredColumnMeta {
  readonly columnName: string;
  readonly udtName: string;
  readonly isRequiredNoDefault: boolean;
  readonly hasCheckConstraint: boolean;
  readonly allowedValues?: readonly string[];
  readonly requiresSha256Prefix?: boolean;
  readonly requiresSha256DashPrefix?: boolean;
  readonly requiresUppercaseHex?: boolean;
}

type TenantPgQuery = (
  sql: string,
  params?: unknown[],
) => Promise<{ rows: Record<string, unknown>[] }>;

async function runWithSavepoint<T>(
  query: TenantPgQuery,
  savepointName: string,
  fn: () => Promise<T>,
  fallback: () => Promise<T>,
): Promise<T> {
  if (!/^[a-z_][a-z0-9_]*$/iu.test(savepointName)) {
    throw new Error(`Invalid savepoint identifier: ${savepointName}`);
  }
  await query(`SAVEPOINT ${savepointName}`);
  try {
    const result = await fn();
    await query(`RELEASE SAVEPOINT ${savepointName}`);
    return result;
  } catch {
    await query(`ROLLBACK TO SAVEPOINT ${savepointName}`).catch(() => undefined);
    await query(`RELEASE SAVEPOINT ${savepointName}`).catch(() => undefined);
    return fallback();
  }
}

function extractAllowedLiterals(constraintDef: string): string[] {
  const arrayMatch = constraintDef.match(/ARRAY\[([^\]]+)\]/u);
  if (arrayMatch) {
    const literals: string[] = [];
    for (const m of arrayMatch[1]!.matchAll(/'([^']+)'/gu)) {
      if (m[1]) literals.push(m[1]);
    }
    return literals;
  }
  const setMatch = constraintDef.match(/ANY\s*\(\s*'\{([^}]+)\}'::text\[\]\s*\)/u);
  if (setMatch) {
    return setMatch[1]!
      .split(",")
      .map((s) => s.trim().replace(/^"|"$/gu, ""))
      .filter(Boolean);
  }
  return [];
}

async function loadRequiredColumnsByTable(
  query: TenantPgQuery,
  tableNames: readonly string[],
): Promise<Map<string, readonly RequiredColumnMeta[]>> {
  const res = await runWithSavepoint(
    query,
    "sp_load_pg_attribute_cols",
    async () =>
      query(
        `SELECT c.relname::text AS table_name,
                a.attname::text AS column_name,
                t.typname::text AS udt_name,
                CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
                CASE WHEN a.atthasdef THEN 'has_default' ELSE NULL END AS column_default
         FROM pg_catalog.pg_attribute a
         JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
         WHERE n.nspname = 'uptech'
           AND c.relname = ANY($1::text[])
           AND a.attnum > 0
           AND NOT a.attisdropped
           AND a.attgenerated = ''
         ORDER BY a.attnum ASC`,
        [tableNames],
      ),
    async () =>
      query(
        `SELECT table_name::text AS table_name,
                column_name::text AS column_name,
                udt_name::text AS udt_name,
                is_nullable::text AS is_nullable,
                column_default::text AS column_default
         FROM information_schema.columns
         WHERE table_schema = 'uptech'
           AND table_name = ANY($1::text[])
         ORDER BY ordinal_position ASC`,
        [tableNames],
      ),
  );

  const checkDefsByTable = new Map<string, string[]>();
  const allowedByTableCol = new Map<string, Map<string, readonly string[]>>();
  await runWithSavepoint(
    query,
    "sp_load_check_constraints",
    async () => {
      const checkRes = await query(
        `SELECT c.relname::text AS table_name,
                pg_catalog.pg_get_constraintdef(con.oid) AS def
         FROM pg_catalog.pg_constraint con
         JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'uptech'
           AND c.relname = ANY($1::text[])
           AND con.contype = 'c'`,
        [tableNames],
      );
      for (const row of checkRes.rows) {
        const tbl = String(row.table_name);
        const def = String(row.def ?? "");
        const defs = checkDefsByTable.get(tbl) ?? [];
        defs.push(def);
        checkDefsByTable.set(tbl, defs);

        const literals = extractAllowedLiterals(def);
        if (literals.length === 0) continue;
        const colMatch = def.match(/\(\s*([a-z_][a-z0-9_]*)\s*=\s*ANY/iu);
        if (!colMatch) continue;
        const colName = colMatch[1]!;
        const colMap = allowedByTableCol.get(tbl) ?? new Map<string, readonly string[]>();
        colMap.set(colName, literals);
        allowedByTableCol.set(tbl, colMap);
      }
    },
    async () => undefined,
  );

  const byTable = new Map<string, RequiredColumnMeta[]>();
  for (const row of res.rows) {
    const tbl = String(row.table_name);
    const colName = String(row.column_name);
    const isNullable = String(row.is_nullable ?? "YES");
    const hasDefault = row.column_default !== null && row.column_default !== undefined;
    const isRequiredNoDefault = isNullable === "NO" && !hasDefault;
    const tblDefs = checkDefsByTable.get(tbl) ?? [];
    const colPattern = new RegExp(`\\b${colName}\\b`, "iu");
    const matchingDefs = tblDefs.filter((def) => colPattern.test(def));
    const hasCheckConstraint = matchingDefs.length > 0;
    const requiresSha256Prefix = matchingDefs.some((def) => /sha256:/iu.test(def));
    const requiresSha256DashPrefix = matchingDefs.some((def) => /sha256-/iu.test(def));
    const requiresUppercaseHex = matchingDefs.some(
      (def) => /\[A-F/u.test(def) && !/a-f/u.test(def),
    );

    const list = byTable.get(tbl) ?? [];
    list.push({
      columnName: colName,
      udtName: String(row.udt_name),
      isRequiredNoDefault,
      hasCheckConstraint,
      allowedValues: allowedByTableCol.get(tbl)?.get(colName),
      requiresSha256Prefix,
      requiresSha256DashPrefix,
      requiresUppercaseHex,
    });
    byTable.set(tbl, list);
  }
  return byTable;
}

function resolveAllowedValue(
  candidate: unknown,
  allowedValues: readonly string[] | undefined,
): unknown {
  if (!allowedValues || allowedValues.length === 0) return candidate;
  if (typeof candidate === "string") {
    if (allowedValues.includes(candidate)) return candidate;
    const ciMatch = allowedValues.find(
      (item) => item.toLowerCase() === candidate.toLowerCase(),
    );
    if (ciMatch) return ciMatch;
  }
  return allowedValues[0]!;
}

function defaultValueForLegacyColumn(
  udtName: string,
  access: WorkspaceAccessContext,
): unknown {
  if (udtName === "uuid") return access.userId || access.membershipId || access.workspaceId;
  if (
    udtName === "int2" ||
    udtName === "int4" ||
    udtName === "int8" ||
    udtName === "numeric" ||
    udtName === "float4" ||
    udtName === "float8"
  ) {
    return 0;
  }
  if (udtName === "bool") return false;
  if (udtName === "json" || udtName === "jsonb") return "{}";
  if (udtName === "timestamptz" || udtName === "timestamp") {
    return new Date().toISOString();
  }
  if (udtName === "date") return new Date().toISOString().slice(0, 10);
  if (udtName.startsWith("_")) return [];
  return "";
}

export function buildLegacySafeInsert(args: Readonly<{
  tableName: string;
  baseColumns: readonly string[];
  baseValues: readonly unknown[];
  requiredColumns: readonly RequiredColumnMeta[] | undefined;
  access: WorkspaceAccessContext;
  contextDefaults?: Readonly<Record<string, unknown>>;
  columnCasts?: Readonly<Record<string, string>>;
  onConflictSql?: string;
}>): { readonly sql: string; readonly values: unknown[] } {
  const columns = [...args.baseColumns];
  const values = [...args.baseValues];
  const casts: Record<string, string> = { ...(args.columnCasts ?? {}) };
  const present = new Set(columns);

  for (const reqCol of args.requiredColumns ?? []) {
    if (present.has(reqCol.columnName)) continue;
    if (!/^[a-z_][a-z0-9_]*$/u.test(reqCol.columnName)) continue;

    const rawOverride =
      args.contextDefaults &&
      Object.prototype.hasOwnProperty.call(args.contextDefaults, reqCol.columnName)
        ? args.contextDefaults[reqCol.columnName]
        : undefined;
    const hasContextOverride =
      rawOverride !== undefined &&
      (reqCol.udtName !== "uuid" || Boolean(rawOverride));

    if (
      !reqCol.isRequiredNoDefault &&
      !reqCol.hasCheckConstraint &&
      !hasContextOverride
    ) {
      continue;
    }

    present.add(reqCol.columnName);
    columns.push(reqCol.columnName);
    const rawCandidate = hasContextOverride
      ? rawOverride
      : defaultValueForLegacyColumn(reqCol.udtName, args.access);
    let finalValue = resolveAllowedValue(rawCandidate, reqCol.allowedValues);
    if (typeof finalValue === "string" && finalValue.length > 0) {
      let formatted = finalValue;
      if (reqCol.requiresUppercaseHex) {
        formatted = formatted.toUpperCase();
      }
      if (reqCol.requiresSha256Prefix && !formatted.startsWith("sha256:")) {
        formatted = `sha256:${formatted}`;
      } else if (
        reqCol.requiresSha256DashPrefix &&
        !formatted.startsWith("sha256-")
      ) {
        formatted = `sha256-${formatted}`;
      }
      finalValue = formatted;
    }
    values.push(finalValue);
    if (reqCol.udtName === "jsonb") casts[reqCol.columnName] = "::jsonb";
    else if (reqCol.udtName === "json") casts[reqCol.columnName] = "::json";
    else if (reqCol.udtName === "uuid") casts[reqCol.columnName] = "::uuid";
  }

  const colList = columns.map((c) => `"${c}"`).join(", ");
  const placeholders = columns.map((c, idx) => `$${idx + 1}${casts[c] ?? ""}`).join(", ");
  const suffix = args.onConflictSql ? ` ${args.onConflictSql}` : "";
  return {
    sql: `INSERT INTO uptech."${args.tableName}" (${colList}) VALUES (${placeholders})${suffix}`,
    values,
  };
}

async function insertDocumentWithChecksumRecovery(
  query: TenantPgQuery,
  insertArgs: Readonly<{
    baseColumns: readonly string[];
    baseValues: readonly unknown[];
    requiredColumns: readonly RequiredColumnMeta[] | undefined;
    access: WorkspaceAccessContext;
    contextDefaults: Readonly<Record<string, unknown>>;
    onConflictSql?: string;
    sha256Hex: string;
    md5Hex: string;
  }>,
): Promise<void> {
  const initial = buildLegacySafeInsert({
    tableName: "knowledge_documents",
    baseColumns: insertArgs.baseColumns,
    baseValues: insertArgs.baseValues,
    requiredColumns: insertArgs.requiredColumns,
    access: insertArgs.access,
    contextDefaults: insertArgs.contextDefaults,
    onConflictSql: insertArgs.onConflictSql,
  });

  await query("SAVEPOINT sp_doc_insert_main");
  try {
    await query(initial.sql, initial.values);
    await query("RELEASE SAVEPOINT sp_doc_insert_main");
    return;
  } catch (err) {
    await query("ROLLBACK TO SAVEPOINT sp_doc_insert_main").catch(() => undefined);
    await query("RELEASE SAVEPOINT sp_doc_insert_main").catch(() => undefined);

    const pgErr = err as { code?: string; constraint?: string };
    if (pgErr?.code !== "23514") {
      throw err;
    }

    await runWithSavepoint(
      query,
      "sp_log_doc_constraints",
      async () => {
        const defsRes = await query(
          `SELECT conname::text AS name,
                  pg_catalog.pg_get_constraintdef(oid) AS def
           FROM pg_catalog.pg_constraint
           WHERE conrelid = 'uptech.knowledge_documents'::regclass
             AND contype = 'c'`,
        );
        console.warn("[knowledge_documents_check_diagnostic]", {
          constraint: pgErr.constraint ?? null,
          constraints: defsRes.rows,
        });
      },
      async () => undefined,
    );

    if (!String(pgErr.constraint ?? "").includes("checksum")) {
      throw err;
    }

    const candidates = [
      `sha256:${insertArgs.sha256Hex}`,
      insertArgs.sha256Hex,
      insertArgs.sha256Hex.toUpperCase(),
      insertArgs.md5Hex,
      `sha256-${insertArgs.sha256Hex}`,
    ];

    for (let i = 0; i < candidates.length; i++) {
      const candidateVal = candidates[i]!;
      const retryCols = insertArgs.baseColumns.includes("checksum")
        ? insertArgs.baseColumns
        : [...insertArgs.baseColumns, "checksum"];
      const retryVals = insertArgs.baseColumns.includes("checksum")
        ? insertArgs.baseValues.map((v, idx) =>
            insertArgs.baseColumns[idx] === "checksum" ? candidateVal : v,
          )
        : [...insertArgs.baseValues, candidateVal];

      const retryInsert = buildLegacySafeInsert({
        tableName: "knowledge_documents",
        baseColumns: retryCols,
        baseValues: retryVals,
        requiredColumns: insertArgs.requiredColumns,
        access: insertArgs.access,
        contextDefaults: {
          ...insertArgs.contextDefaults,
          checksum: candidateVal,
        },
        onConflictSql: insertArgs.onConflictSql,
      });

      const spName = `sp_doc_checksum_retry_${i}`;
      await query(`SAVEPOINT ${spName}`);
      try {
        await query(retryInsert.sql, retryInsert.values);
        await query(`RELEASE SAVEPOINT ${spName}`);
        return;
      } catch (retryErr) {
        await query(`ROLLBACK TO SAVEPOINT ${spName}`).catch(() => undefined);
        await query(`RELEASE SAVEPOINT ${spName}`).catch(() => undefined);
        if (i === candidates.length - 1) {
          throw retryErr;
        }
      }
    }
    throw err;
  }
}

export async function loadKnowledgeDocumentsAndSpaces(
  access: WorkspaceAccessContext,
): Promise<{
  readonly spaces: readonly SpaceSummaryView[];
  readonly documents: readonly StoredKnowledgeDocument[];
}> {
  if (canAttemptPostgres(access)) {
    const dbResult = await withTenantPostgres(access, async (query) => {
      let spaceRows = await runWithSavepoint(
        query,
        "sp_spaces_select_1",
        async () =>
          (
            await query(
              `SELECT id, name, description, access_scope, allowed_department_key
               FROM uptech.knowledge_spaces
               ORDER BY name ASC`,
            )
          ).rows,
        async () =>
          (
            await query(
              "SELECT id, name, description FROM uptech.knowledge_spaces ORDER BY name ASC",
            )
          ).rows,
      );

      if (spaceRows.length === 0) {
        for (const seedSpace of DEFAULT_SPACES) {
          await query(
            `INSERT INTO uptech.knowledge_spaces (workspace_id, id, name, description)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (workspace_id, id) DO NOTHING`,
            [access.workspaceId, seedSpace.id, seedSpace.name, seedSpace.description],
          );
        }
        spaceRows = await runWithSavepoint(
          query,
          "sp_spaces_select_2",
          async () =>
            (
              await query(
                `SELECT id, name, description, access_scope, allowed_department_key
                 FROM uptech.knowledge_spaces
                 ORDER BY name ASC`,
              )
            ).rows,
          async () =>
            (
              await query(
                "SELECT id, name, description FROM uptech.knowledge_spaces ORDER BY name ASC",
              )
            ).rows,
        );
      }

      let docRows = await query(
        `SELECT id, space_id, name, file_type, version_label, detail, owner_label,
                updated_label, processing_kind, processing_label, governance_kind,
                governance_label, byte_size, is_user_uploaded
         FROM uptech.knowledge_documents
         ORDER BY created_at DESC`,
      );

      let seedFallbackDocs: readonly StoredKnowledgeDocument[] = [];
      if (
        spaceRows.length > 0 &&
        !docRows.rows.some((r) => String(r.id).startsWith("kb_uptech_"))
      ) {
        await query("SAVEPOINT sp_uptech_seed");
        try {
          const requiredCols = await loadRequiredColumnsByTable(query, [
            "knowledge_documents",
            "knowledge_document_versions",
            "knowledge_document_chunks",
          ]);
          const availableSpaceIds = new Set(spaceRows.map((s) => String(s.id)));
          const fallbackSpaceId = String(spaceRows[0]!.id);
          for (const seedDoc of UPTECH_BAOGIA_SEED_DOCUMENTS) {
            const targetSpaceId = availableSpaceIds.has(seedDoc.summary.space.id)
              ? seedDoc.summary.space.id
              : fallbackSpaceId;
            const docFullText = seedDoc.chunks
              .map((c) => `# ${c.heading}\n${c.content}`)
              .join("\n\n");
            const docSha256 = createHash("sha256").update(docFullText).digest("hex");
            const docMd5 = createHash("md5").update(docFullText).digest("hex");
            await insertDocumentWithChecksumRecovery(query, {
              baseColumns: [
                "workspace_id",
                "id",
                "space_id",
                "name",
                "file_type",
                "version_label",
                "detail",
                "owner_label",
                "updated_label",
                "processing_kind",
                "processing_label",
                "governance_kind",
                "governance_label",
                "byte_size",
                "is_user_uploaded",
              ],
              baseValues: [
                access.workspaceId,
                seedDoc.summary.id,
                targetSpaceId,
                seedDoc.summary.name,
                seedDoc.summary.fileType,
                seedDoc.summary.versionLabel,
                seedDoc.summary.detail,
                seedDoc.summary.ownerLabel,
                seedDoc.summary.updatedLabel,
                "ready",
                seedDoc.summary.processing.label,
                "active",
                seedDoc.summary.governance[0]?.label ?? "Dữ liệu UPTECH",
                seedDoc.byteSize,
                false,
              ],
              requiredColumns: requiredCols.get("knowledge_documents"),
              access,
              contextDefaults: {
                title: seedDoc.summary.name,
                slug: seedDoc.summary.id,
                status: "ready",
                checksum: docSha256,
                sha256: docSha256,
                content_hash: docSha256,
                content_sha256: docSha256,
                digest: docSha256,
                etag: docSha256,
                file_name: seedDoc.summary.name,
                original_filename: seedDoc.summary.name,
                filename: seedDoc.summary.name,
                mime_type: "text/markdown",
                content_type: "text/markdown",
                source_type: "system",
                membership_id: access.membershipId,
                created_by_membership_id: access.membershipId,
              },
              onConflictSql: "ON CONFLICT (workspace_id, id) DO NOTHING",
              sha256Hex: docSha256,
              md5Hex: docMd5,
            });

            const verInsert = buildLegacySafeInsert({
              tableName: "knowledge_document_versions",
              baseColumns: [
                "workspace_id",
                "document_id",
                "version_id",
                "version_label",
                "note",
                "updated_label",
              ],
              baseValues: [
                access.workspaceId,
                seedDoc.summary.id,
                seedDoc.versions[0]?.id ?? `${seedDoc.summary.id}-v1`,
                seedDoc.summary.versionLabel,
                seedDoc.summary.detail,
                seedDoc.summary.updatedLabel,
              ],
              requiredColumns: requiredCols.get("knowledge_document_versions"),
              access,
              contextDefaults: {
                id: seedDoc.versions[0]?.id ?? `${seedDoc.summary.id}-v1`,
                title: seedDoc.summary.name,
                status: "ready",
                checksum: docSha256,
                sha256: docSha256,
                content_hash: docSha256,
                membership_id: access.membershipId,
                author_label: seedDoc.summary.ownerLabel,
                byte_size: seedDoc.byteSize,
              },
              onConflictSql: "ON CONFLICT (workspace_id, document_id, version_id) DO NOTHING",
            });
            await query(verInsert.sql, verInsert.values);

            for (const chunk of seedDoc.chunks) {
              const chunkSha256 = createHash("sha256")
                .update(chunk.content)
                .digest("hex");
              const chunkInsert = buildLegacySafeInsert({
                tableName: "knowledge_document_chunks",
                baseColumns: [
                  "workspace_id",
                  "chunk_id",
                  "document_id",
                  "chunk_index",
                  "heading",
                  "locator",
                  "content",
                ],
                baseValues: [
                  access.workspaceId,
                  chunk.chunkId,
                  seedDoc.summary.id,
                  chunk.chunkIndex,
                  chunk.heading,
                  chunk.locator,
                  chunk.content,
                ],
                requiredColumns: requiredCols.get("knowledge_document_chunks"),
                access,
                contextDefaults: {
                  id: chunk.chunkId,
                  version_id: seedDoc.versions[0]?.id ?? `${seedDoc.summary.id}-v1`,
                  title: chunk.heading,
                  checksum: chunkSha256,
                  sha256: chunkSha256,
                  content_hash: chunkSha256,
                  token_count: chunk.content.length,
                },
                onConflictSql: "ON CONFLICT (workspace_id, chunk_id) DO NOTHING",
              });
              await query(chunkInsert.sql, chunkInsert.values);
            }
          }
          await query("RELEASE SAVEPOINT sp_uptech_seed");
          docRows = await query(
            `SELECT id, space_id, name, file_type, version_label, detail, owner_label,
                    updated_label, processing_kind, processing_label, governance_kind,
                    governance_label, byte_size, is_user_uploaded
             FROM uptech.knowledge_documents
             ORDER BY created_at DESC`,
          );
        } catch {
          await query("ROLLBACK TO SAVEPOINT sp_uptech_seed");
          await query("RELEASE SAVEPOINT sp_uptech_seed");
          seedFallbackDocs = UPTECH_BAOGIA_SEED_DOCUMENTS;
        }
      }

      const chunkRows = await query(
        `SELECT chunk_id, document_id, chunk_index, heading, locator, content, embedding_json
         FROM uptech.knowledge_document_chunks
         ORDER BY document_id ASC, chunk_index ASC`,
      );
      const versionRows = await query(
        `SELECT document_id, version_id, version_label, updated_label
         FROM uptech.knowledge_document_versions
         ORDER BY created_at DESC`,
      );
      return {
        spaceRows,
        docRows: docRows.rows,
        chunkRows: chunkRows.rows,
        versionRows: versionRows.rows,
        seedFallbackDocs,
      };
    });

    const chunksByDoc = new Map<string, StoredDocumentChunk[]>();
    for (const row of dbResult.chunkRows) {
      const docId = String(row.document_id);
      const list = chunksByDoc.get(docId) ?? [];
      list.push({
        chunkId: String(row.chunk_id),
        documentId: docId,
        chunkIndex: Number(row.chunk_index),
        heading: String(row.heading ?? ""),
        locator: String(row.locator ?? ""),
        content: String(row.content ?? ""),
        embedding: Array.isArray(row.embedding_json)
          ? (row.embedding_json as number[])
          : undefined,
      });
      chunksByDoc.set(docId, list);
    }

    const versionsByDoc = new Map<
      string,
      Array<{ id: string; label: string; updatedLabel: string }>
    >();
    for (const row of dbResult.versionRows) {
      const docId = String(row.document_id);
      const list = versionsByDoc.get(docId) ?? [];
      list.push({
        id: String(row.version_id),
        label: String(row.version_label),
        updatedLabel: String(row.updated_label ?? ""),
      });
      versionsByDoc.set(docId, list);
    }

    const docCountBySpace = new Map<string, number>();
    for (const row of dbResult.docRows) {
      const sid = String(row.space_id);
      docCountBySpace.set(sid, (docCountBySpace.get(sid) ?? 0) + 1);
    }

    const spaceMap = new Map<string, SpaceSummaryView>();
    const allSpaces: SpaceSummaryView[] = dbResult.spaceRows.map((row) => {
      const id = String(row.id) as SpaceId;
      const accessScope: SpaceAccessScope =
        row.access_scope === "ADMIN_ONLY"
          ? "ADMIN_ONLY"
          : row.access_scope === "DEPARTMENT"
            ? "DEPARTMENT"
            : "WORKSPACE";
      const allowedDepartmentKey: WorkspaceDepartmentKey | null =
        row.allowed_department_key === "SALES" ||
        row.allowed_department_key === "HR" ||
        row.allowed_department_key === "IT" ||
        row.allowed_department_key === "FINANCE"
          ? row.allowed_department_key
          : null;
      const view: SpaceSummaryView = {
        id,
        name: String(row.name),
        description: String(row.description ?? ""),
        documentCount: docCountBySpace.get(id) ?? 0,
        accessScope,
        allowedDepartmentKey,
      };
      spaceMap.set(id, view);
      return view;
    });

    const visibleSpaces = allSpaces.filter((space) =>
      canAccessKnowledgeSpace(access, space),
    );
    const visibleSpaceIds = new Set<string>(visibleSpaces.map((s) => s.id));

    const documents: StoredKnowledgeDocument[] = dbResult.docRows
      .filter((row) => visibleSpaceIds.has(String(row.space_id)))
      .map((row) => {
        const id = String(row.id) as DocumentId;
        const spaceId = String(row.space_id) as SpaceId;
        const space = spaceMap.get(spaceId) ?? { id: spaceId, name: spaceId };
        const processingKind = String(
          row.processing_kind,
        ) as DocumentSummaryView["processing"]["kind"];
        const govKind =
          String(row.governance_kind) === "deprecated" ? "deprecated" : "verified";
        const docChunks = chunksByDoc.get(id) ?? [];

        return {
          summary: {
            id,
            name: String(row.name),
            fileType: normalizeDisplayFileType(String(row.file_type)),
            versionLabel: String(row.version_label),
            detail: String(row.detail ?? ""),
            ownerLabel: String(row.owner_label ?? ""),
            updatedLabel: String(row.updated_label ?? ""),
            space: { id: space.id, name: space.name },
            processing: {
              kind: processingKind,
              label: String(row.processing_label ?? processingKind),
              description: String(row.detail ?? ""),
            },
            governance: [
              {
                kind: govKind,
                label: String(
                  row.governance_label ||
                    (govKind === "deprecated" ? "Phiên bản cũ" : "Đã xác minh"),
                ),
                description: String(row.detail ?? ""),
                variant: govKind === "deprecated" ? "warning" : "success",
              },
            ],
            chunkCount: docChunks.length,
          },
          versions: versionsByDoc.get(id) ?? [
            {
              id: `${id}-v1`,
              label: String(row.version_label),
              updatedLabel: String(row.updated_label ?? ""),
            },
          ],
          isUserUploaded: Boolean(row.is_user_uploaded),
          byteSize: Number(row.byte_size ?? 0),
          rawFileExtension: String(row.file_type ?? "").toLowerCase() || undefined,
          chunks: docChunks,
        };
      });

    if (dbResult.seedFallbackDocs.length > 0 && visibleSpaces.length > 0) {
      const existingIds = new Set(documents.map((d) => d.summary.id));
      for (const fallbackDoc of dbResult.seedFallbackDocs) {
        if (existingIds.has(fallbackDoc.summary.id)) continue;
        const targetSpace =
          spaceMap.get(fallbackDoc.summary.space.id) ?? visibleSpaces[0]!;
        if (!visibleSpaceIds.has(targetSpace.id)) continue;
        documents.push({
          ...fallbackDoc,
          summary: {
            ...fallbackDoc.summary,
            space: { id: targetSpace.id, name: targetSpace.name },
          },
        });
      }
      const counts = new Map<string, number>();
      for (const d of documents) {
        counts.set(d.summary.space.id, (counts.get(d.summary.space.id) ?? 0) + 1);
      }
      return {
        spaces: visibleSpaces.map((s) => ({
          ...s,
          documentCount: counts.get(s.id) ?? s.documentCount,
        })),
        documents,
      };
    }

    return { spaces: visibleSpaces, documents };
  }

  if (!isWorkspacePreviewModeEnabled()) {
    throw new Error("Workspace knowledge storage requires an authenticated database session.");
  }

  return withStoreLock(async () => {
    const state = await readPreviewStoreFile();
    const spaceCounts = new Map<string, number>();
    for (const doc of state.documents) {
      spaceCounts.set(doc.summary.space.id, (spaceCounts.get(doc.summary.space.id) ?? 0) + 1);
    }
    const visibleSpaces = state.spaces
      .filter((space) => canAccessKnowledgeSpace(access, space))
      .map((space) => ({
        ...space,
        documentCount: spaceCounts.get(space.id) ?? 0,
      }));
    const visibleIds = new Set<string>(visibleSpaces.map((s) => s.id));
    return {
      spaces: visibleSpaces,
      documents: state.documents
        .filter((doc) => visibleIds.has(doc.summary.space.id))
        .map((doc) => ({
          ...doc,
          summary: {
            ...doc.summary,
            chunkCount: doc.chunks.length,
          },
        })),
    };
  });
}

export async function getStoredKnowledgeDocument(
  access: WorkspaceAccessContext,
  documentId: string,
): Promise<StoredKnowledgeDocument | null> {
  const { documents } = await loadKnowledgeDocumentsAndSpaces(access);
  return documents.find((doc) => doc.summary.id === documentId) ?? null;
}

export async function createUploadedKnowledgeDocument(
  access: WorkspaceAccessContext,
  args: Readonly<{
    id: string;
    fileName: string;
    extension: string;
    byteSize: number;
    rawBytes?: Uint8Array;
    spaceId: string;
    chunks: readonly ExtractedDocumentChunk[];
    embeddings?: ReadonlyArray<readonly number[] | null>;
    locale: Locale;
  }>,
): Promise<DocumentDetailView> {
  const extUpper = args.extension.toUpperCase();
  const displayType = normalizeDisplayFileType(args.extension);
  const nowLabel = new Date().toLocaleDateString(
    args.locale === "vi" ? "vi-VN" : "en-US",
    { day: "2-digit", month: "2-digit", year: "numeric" },
  );
  const readyLabel = args.locale === "vi" ? "Sẵn sàng" : "Ready";
  const detailText = `${extUpper} · ${formatByteLabel(args.byteSize)} · ${args.chunks.length} ${args.locale === "vi" ? "đoạn chỉ mục" : "indexed sections"}`;

  const storedChunks: StoredDocumentChunk[] =
    args.chunks.length > 0
      ? args.chunks.map((chunk, index) => ({
          chunkId: `${args.id}-chunk-${index}`,
          documentId: args.id,
          chunkIndex: index,
          heading: chunk.heading,
          locator: chunk.locator,
          content: chunk.content,
          embedding: args.embeddings?.[index] ?? undefined,
        }))
      : [
          {
            chunkId: `${args.id}-chunk-0`,
            documentId: args.id,
            chunkIndex: 0,
            heading: args.fileName,
            locator: args.locale === "vi" ? "Tệp đính kèm" : "Uploaded file",
            content:
              args.locale === "vi"
                ? `Tài liệu "${args.fileName}" (${extUpper}, ${formatByteLabel(args.byteSize)}) đã được tải lên nhưng chưa đọc được văn bản thuần.`
                : `Document "${args.fileName}" (${extUpper}, ${formatByteLabel(args.byteSize)}) was uploaded without extractable text.`,
          },
        ];

  if (canAttemptPostgres(access)) {
    return withTenantPostgres(access, async (query) => {
      const spaceCheck = await query(
        "SELECT id, name FROM uptech.knowledge_spaces WHERE id = $1 LIMIT 1",
        [args.spaceId],
      );
      const targetSpace = spaceCheck.rows[0]
        ? {
            id: String(spaceCheck.rows[0].id) as SpaceId,
            name: String(spaceCheck.rows[0].name),
          }
        : {
            id: "space-hr" as SpaceId,
            name: args.locale === "vi" ? "Tài liệu tải lên" : "Uploaded files",
          };

      if (!spaceCheck.rows[0]) {
        await query(
          `INSERT INTO uptech.knowledge_spaces (workspace_id, id, name, description)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (workspace_id, id) DO NOTHING`,
          [access.workspaceId, targetSpace.id, targetSpace.name, "Workspace uploaded files"],
        );
      }

      const requiredCols = await loadRequiredColumnsByTable(query, [
        "knowledge_documents",
        "knowledge_document_versions",
        "knowledge_document_chunks",
      ]);

      const uploadContentInput =
        args.rawBytes && args.rawBytes.length > 0
          ? Buffer.from(args.rawBytes)
          : storedChunks.map((c) => `${c.heading}\n${c.content}`).join("\n\n");
      const uploadContentSha256 = createHash("sha256")
        .update(uploadContentInput)
        .digest("hex");
      const uploadContentMd5 = createHash("md5")
        .update(uploadContentInput)
        .digest("hex");

      const fileTypeAllowed = requiredCols
        .get("knowledge_documents")
        ?.find((c) => c.columnName === "file_type")?.allowedValues;
      const storageFileType = normalizeStorageFileType(
        args.extension,
        fileTypeAllowed,
      );

      const govLabel = args.locale === "vi" ? "Tải lên bởi người dùng" : "User uploaded";
      await insertDocumentWithChecksumRecovery(query, {
        baseColumns: [
          "workspace_id",
          "id",
          "space_id",
          "name",
          "file_type",
          "version_label",
          "detail",
          "owner_label",
          "updated_label",
          "processing_kind",
          "processing_label",
          "governance_kind",
          "governance_label",
          "byte_size",
          "is_user_uploaded",
        ],
        baseValues: [
          access.workspaceId,
          args.id,
          targetSpace.id,
          args.fileName,
          storageFileType,
          "v1.0",
          detailText,
          access.actorLabel,
          nowLabel,
          "ready",
          readyLabel,
          "active",
          govLabel,
          args.byteSize,
          true,
        ],
        requiredColumns: requiredCols.get("knowledge_documents"),
        access,
        contextDefaults: {
          title: args.fileName,
          slug: args.id,
          status: "ready",
          checksum: uploadContentSha256,
          sha256: uploadContentSha256,
          content_hash: uploadContentSha256,
          content_sha256: uploadContentSha256,
          digest: uploadContentSha256,
          etag: uploadContentSha256,
          file_name: args.fileName,
          original_filename: args.fileName,
          filename: args.fileName,
          mime_type:
            args.extension.toLowerCase() === "docx"
              ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              : args.extension.toLowerCase() === "pdf"
                ? "application/pdf"
                : "text/plain",
          content_type:
            args.extension.toLowerCase() === "docx"
              ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              : args.extension.toLowerCase() === "pdf"
                ? "application/pdf"
                : "text/plain",
          source_type: "upload",
          membership_id: access.membershipId,
          created_by_membership_id: access.membershipId,
        },
        sha256Hex: uploadContentSha256,
        md5Hex: uploadContentMd5,
      });

      const verCols = await query(
        `SELECT column_name::text AS column_name
         FROM information_schema.columns
         WHERE table_schema = 'uptech' AND table_name = 'knowledge_document_versions'`,
      );
      const verColSet = new Set(verCols.rows.map((r) => String(r.column_name)));
      const verBaseCols = [
        "workspace_id",
        "document_id",
        "version_id",
        "version_label",
        "note",
        "updated_label",
      ];
      const verBaseVals: unknown[] = [
        access.workspaceId,
        args.id,
        `${args.id}-v1`,
        "v1.0",
        detailText,
        nowLabel,
      ];
      const verCasts: Record<string, string> = {};
      if (verColSet.has("chunks_snapshot_json")) {
        verBaseCols.push("chunks_snapshot_json", "author_label", "byte_size");
        verBaseVals.push(JSON.stringify(storedChunks), access.actorLabel, args.byteSize);
        verCasts.chunks_snapshot_json = "::jsonb";
      }
      const verInsert = buildLegacySafeInsert({
        tableName: "knowledge_document_versions",
        baseColumns: verBaseCols,
        baseValues: verBaseVals,
        requiredColumns: requiredCols.get("knowledge_document_versions"),
        access,
        contextDefaults: {
          id: `${args.id}-v1`,
          title: args.fileName,
          status: "ready",
          checksum: uploadContentSha256,
          sha256: uploadContentSha256,
          content_hash: uploadContentSha256,
          membership_id: access.membershipId,
          author_label: access.actorLabel,
          byte_size: args.byteSize,
        },
        columnCasts: verCasts,
      });
      await query(verInsert.sql, verInsert.values);

      for (const chunk of storedChunks) {
        const chunkSha256 = createHash("sha256")
          .update(chunk.content)
          .digest("hex");
        const chunkInsert = buildLegacySafeInsert({
          tableName: "knowledge_document_chunks",
          baseColumns: [
            "workspace_id",
            "chunk_id",
            "document_id",
            "chunk_index",
            "heading",
            "locator",
            "content",
            "embedding_json",
          ],
          baseValues: [
            access.workspaceId,
            chunk.chunkId,
            args.id,
            chunk.chunkIndex,
            chunk.heading,
            chunk.locator,
            chunk.content,
            chunk.embedding ? JSON.stringify(chunk.embedding) : null,
          ],
          requiredColumns: requiredCols.get("knowledge_document_chunks"),
          access,
          contextDefaults: {
            id: chunk.chunkId,
            version_id: `${args.id}-v1`,
            title: chunk.heading,
            checksum: chunkSha256,
            sha256: chunkSha256,
            content_hash: chunkSha256,
            token_count: chunk.content.length,
          },
          columnCasts: { embedding_json: "::jsonb" },
        });
        await query(chunkInsert.sql, chunkInsert.values);
      }

      if (
        args.rawBytes &&
        args.rawBytes.length > 0 &&
        args.rawBytes.length <= 15 * 1024 * 1024
      ) {
        await runWithSavepoint(
          query,
          "sp_upload_blob",
          async () => {
            await query(
              `INSERT INTO uptech.knowledge_document_blobs (
                 workspace_id, document_id, file_extension, content_type, byte_size, content_bytes
               ) VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (workspace_id, document_id)
               DO UPDATE SET
                 file_extension = EXCLUDED.file_extension,
                 content_type = EXCLUDED.content_type,
                 byte_size = EXCLUDED.byte_size,
                 content_bytes = EXCLUDED.content_bytes`,
              [
                access.workspaceId,
                args.id,
                args.extension.toLowerCase(),
                "application/octet-stream",
                args.rawBytes!.length,
                Buffer.from(args.rawBytes!),
              ],
            );
          },
          async () => undefined,
        );
      }

      const uploadedNotification = createNotificationItem({
        kind: "document_uploaded",
        title:
          args.locale === "en"
            ? `Indexed: ${args.fileName}`
            : `Đã lập chỉ mục: ${args.fileName}`,
        description:
          args.locale === "en"
            ? `Parsed ${storedChunks.length} searchable segments in "${targetSpace.name}". Ready for AI Chat, Search & Utilities.`
            : `Đã tách ${storedChunks.length} đoạn tri thức vào không gian "${targetSpace.name}". Sẵn sàng cho Trợ lý AI, Tìm kiếm và Tiện ích.`,
        href: `/documents/${args.id}`,
        actionLabel: args.locale === "en" ? "Open document" : "Mở tài liệu",
      });

      await runWithSavepoint(
        query,
        "sp_upload_notif_with_recipient",
        async () => {
          await query(
            `INSERT INTO uptech.workspace_notifications (
               workspace_id, id, kind, title, description, href, action_label, unread, recipient_membership_id
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid)`,
            [
              access.workspaceId,
              uploadedNotification.id,
              uploadedNotification.kind,
              uploadedNotification.title,
              uploadedNotification.description,
              uploadedNotification.href,
              uploadedNotification.actionLabel,
              true,
              access.membershipId,
            ],
          );
        },
        async () => {
          await runWithSavepoint(
            query,
            "sp_upload_notif_legacy",
            async () => {
              await query(
                `INSERT INTO uptech.workspace_notifications (
                   workspace_id, id, kind, title, description, href, action_label, unread
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                  access.workspaceId,
                  uploadedNotification.id,
                  uploadedNotification.kind,
                  uploadedNotification.title,
                  uploadedNotification.description,
                  uploadedNotification.href,
                  uploadedNotification.actionLabel,
                  true,
                ],
              );
            },
            async () => undefined,
          );
        },
      );

      const firstChunk = storedChunks[0]!;
      return {
        id: args.id as DocumentId,
        name: args.fileName,
        fileType: displayType,
        versionLabel: "v1.0",
        detail: detailText,
        ownerLabel: access.actorLabel,
        updatedLabel: nowLabel,
        space: targetSpace,
        processing: {
          kind: "ready",
          label: readyLabel,
          description: detailText,
        },
        governance: [
          {
            kind: "verified",
            label: govLabel,
            description: detailText,
            variant: "success",
          },
        ],
        versions: [{ id: `${args.id}-v1`, label: "v1.0", updatedLabel: nowLabel }],
        preview: {
          kind: "fixture-excerpt",
          heading: firstChunk.heading,
          locator: firstChunk.locator,
          excerpt: firstChunk.content.slice(0, 600),
        },
      };
    });
  }

  if (!isWorkspacePreviewModeEnabled()) {
    throw new Error("Workspace upload requires an authenticated database session.");
  }

  return withStoreLock(async () => {
    const state = await readPreviewStoreFile();
    const matchedSpace =
      state.spaces.find((s) => s.id === args.spaceId) ?? state.spaces[0];
    const spaceRef = matchedSpace
      ? { id: matchedSpace.id, name: matchedSpace.name }
      : { id: "space-uploads" as SpaceId, name: "Uploads" };

    const summary: DocumentSummaryView = {
      id: args.id as DocumentId,
      name: args.fileName,
      fileType: displayType,
      versionLabel: "v1.0",
      detail: detailText,
      ownerLabel: access.actorLabel,
      updatedLabel: nowLabel,
      space: spaceRef,
      processing: {
        kind: "ready",
        label: readyLabel,
        description: detailText,
      },
      governance: [
        {
          kind: "verified",
          label: args.locale === "vi" ? "Đã lập chỉ mục" : "Indexed",
          description: detailText,
          variant: "success",
        },
      ],
      chunkCount: storedChunks.length,
    };

    const versions: DocumentDetailView["versions"] = [
      { id: `${args.id}-v1`, label: "v1.0", updatedLabel: nowLabel },
    ];

    const record: StoredKnowledgeDocument = {
      summary,
      versions,
      isUserUploaded: true,
      byteSize: args.byteSize,
      rawFileExtension: args.extension.toLowerCase(),
      chunks: storedChunks,
    };

    if (args.rawBytes && args.rawBytes.length > 0) {
      await mkdir(PREVIEW_FILES_DIR, { recursive: true });
      await writeFile(safeUploadedBinaryPath(args.id), args.rawBytes);
    }

    const uploadedNotification = createNotificationItem({
      kind: "document_uploaded",
      title:
        args.locale === "en"
          ? `Indexed: ${args.fileName}`
          : `Đã lập chỉ mục: ${args.fileName}`,
      description:
        args.locale === "en"
          ? `Parsed ${storedChunks.length} searchable segments in "${spaceRef.name}". Ready for AI Chat, Search & Utilities.`
          : `Đã tách ${storedChunks.length} đoạn tri thức vào không gian "${spaceRef.name}". Sẵn sàng cho Trợ lý AI, Tìm kiếm và Tiện ích.`,
      href: `/documents/${args.id}`,
      actionLabel: args.locale === "en" ? "Open document" : "Mở tài liệu",
    });

    await writePreviewStoreFile({
      ...state,
      documents: [record, ...state.documents],
      notifications: [uploadedNotification, ...(state.notifications ?? [])].slice(
        0,
        MAX_NOTIFICATIONS,
      ),
    });

    const firstChunk = storedChunks[0]!;
    return {
      ...summary,
      versions,
      sections: storedChunks.map((chunk) => ({
        id: chunk.chunkId,
        heading: chunk.heading,
        locator: chunk.locator,
        content: chunk.content,
      })),
      preview: {
        kind: "fixture-excerpt",
        heading: firstChunk.heading,
        locator: firstChunk.locator,
        excerpt: firstChunk.content.slice(0, 600),
      },
    };
  });
}

export async function createKnowledgeSpace(
  access: WorkspaceAccessContext,
  args: Readonly<{
    id: string;
    name: string;
    description: string;
    accessScope?: SpaceAccessScope;
    allowedDepartmentKey?: WorkspaceDepartmentKey | null;
  }>,
): Promise<SpaceSummaryView> {
  const accessScope: SpaceAccessScope = args.accessScope ?? "WORKSPACE";
  const allowedDepartmentKey: WorkspaceDepartmentKey | null =
    accessScope === "DEPARTMENT" ? (args.allowedDepartmentKey ?? null) : null;

  if (canAttemptPostgres(access)) {
    return withTenantPostgres(access, async (query) => {
      const requiredCols = await loadRequiredColumnsByTable(query, [
        "knowledge_spaces",
      ]);
      await runWithSavepoint(
        query,
        "sp_create_knowledge_space",
        async () => {
          const spaceInsert = buildLegacySafeInsert({
            tableName: "knowledge_spaces",
            baseColumns: [
              "workspace_id",
              "id",
              "name",
              "description",
              "access_scope",
              "allowed_department_key",
            ],
            baseValues: [
              access.workspaceId,
              args.id,
              args.name,
              args.description,
              accessScope,
              allowedDepartmentKey,
            ],
            requiredColumns: requiredCols.get("knowledge_spaces"),
            access,
            contextDefaults: {
              slug: args.id,
              membership_id: access.membershipId,
              created_by_membership_id: access.membershipId,
            },
          });
          await query(spaceInsert.sql, spaceInsert.values);
        },
        async () => {
          const legacyInsert = buildLegacySafeInsert({
            tableName: "knowledge_spaces",
            baseColumns: ["workspace_id", "id", "name", "description"],
            baseValues: [
              access.workspaceId,
              args.id,
              args.name,
              args.description,
            ],
            requiredColumns: requiredCols.get("knowledge_spaces"),
            access,
            contextDefaults: {
              slug: args.id,
              membership_id: access.membershipId,
              created_by_membership_id: access.membershipId,
            },
          });
          await query(legacyInsert.sql, legacyInsert.values);
        },
      );
      return {
        id: args.id as SpaceId,
        name: args.name,
        description: args.description,
        documentCount: 0,
        accessScope,
        allowedDepartmentKey,
      };
    });
  }

  if (!isWorkspacePreviewModeEnabled()) {
    throw new Error("Workspace space creation requires an authenticated database session.");
  }

  return withStoreLock(async () => {
    const state = await readPreviewStoreFile();
    const created: SpaceSummaryView = {
      id: args.id as SpaceId,
      name: args.name,
      description: args.description,
      documentCount: 0,
      accessScope,
      allowedDepartmentKey,
    };
    await writePreviewStoreFile({
      ...state,
      spaces: [...state.spaces, created],
    });
    return created;
  });
}

export async function updateKnowledgeDocument(
  access: WorkspaceAccessContext,
  documentId: string,
  patch: Readonly<{
    spaceId?: string;
    governanceKind?: "verified" | "deprecated";
    name?: string;
    locale?: Locale;
  }>,
): Promise<DocumentDetailView | null> {
  const locale = patch.locale ?? "vi";

  if (canAttemptPostgres(access)) {
    return withTenantPostgres(access, async (query) => {
      if (patch.name) {
        await query(
          "UPDATE uptech.knowledge_documents SET name = $2, updated_at = transaction_timestamp() WHERE id = $1",
          [documentId, patch.name],
        );
      }
      if (patch.spaceId) {
        await query(
          "UPDATE uptech.knowledge_documents SET space_id = $2, updated_at = transaction_timestamp() WHERE id = $1",
          [documentId, patch.spaceId],
        );
      }
      if (patch.governanceKind) {
        const dbGovKind = patch.governanceKind === "deprecated" ? "deprecated" : "active";
        const dbGovLabel =
          patch.governanceKind === "deprecated"
            ? locale === "vi"
              ? "Phiên bản cũ"
              : "Deprecated"
            : locale === "vi"
              ? "Đã xác minh"
              : "Verified";
        await query(
          `UPDATE uptech.knowledge_documents
           SET governance_kind = $2, governance_label = $3, updated_at = transaction_timestamp()
           WHERE id = $1`,
          [documentId, dbGovKind, dbGovLabel],
        );
      }
      const { documents } = await loadKnowledgeDocumentsAndSpaces(access);
      const updated = documents.find((d) => d.summary.id === documentId);
      if (!updated) return null;
      const firstChunk = updated.chunks[0];
      return {
        ...updated.summary,
        versions: updated.versions,
        sections: updated.chunks.map((c) => ({
          id: c.chunkId,
          heading: c.heading,
          locator: c.locator,
          content: c.content,
        })),
        preview: firstChunk
          ? {
              kind: "fixture-excerpt",
              heading: firstChunk.heading,
              locator: firstChunk.locator,
              excerpt: firstChunk.content.slice(0, 600),
            }
          : { kind: "unavailable", reason: "No indexed chunks." },
      };
    });
  }

  if (!isWorkspacePreviewModeEnabled()) return null;

  return withStoreLock(async () => {
    const state = await readPreviewStoreFile();
    const index = state.documents.findIndex((d) => d.summary.id === documentId);
    if (index === -1) return null;
    const existing = state.documents[index]!;

    const targetSpace = patch.spaceId
      ? state.spaces.find((s) => s.id === patch.spaceId)
      : undefined;

    const nextGovernance = patch.governanceKind
      ? [
          {
            kind: patch.governanceKind,
            label:
              patch.governanceKind === "deprecated"
                ? locale === "vi"
                  ? "Phiên bản cũ"
                  : "Deprecated"
                : locale === "vi"
                  ? "Đã xác minh"
                  : "Verified",
            description: existing.summary.detail,
            variant: (patch.governanceKind === "deprecated" ? "warning" : "success") as
              | "warning"
              | "success",
          },
        ]
      : existing.summary.governance;

    const updatedSummary: DocumentSummaryView = {
      ...existing.summary,
      name: patch.name?.trim() || existing.summary.name,
      space: targetSpace
        ? { id: targetSpace.id, name: targetSpace.name }
        : existing.summary.space,
      governance: nextGovernance,
    };

    const updatedRecord: StoredKnowledgeDocument = {
      ...existing,
      summary: updatedSummary,
    };

    const nextDocuments = [...state.documents];
    nextDocuments[index] = updatedRecord;
    const updatedNotification = createNotificationItem({
      kind: "document_updated",
      title:
        locale === "en"
          ? `Governance updated: ${updatedSummary.name}`
          : `Cập nhật quản trị: ${updatedSummary.name}`,
      description:
        patch.governanceKind === "deprecated"
          ? locale === "en"
            ? "Document flagged as Deprecated and excluded from Ready AI defaults."
            : "Tài liệu được chuyển sang trạng thái Phiên bản cũ để đội ngũ rà soát."
          : locale === "en"
            ? `Saved metadata changes in space "${updatedSummary.space.name}".`
            : `Đã cập nhật trạng thái hoặc không gian "${updatedSummary.space.name}".`,
      href: `/documents/${documentId}`,
      actionLabel: locale === "en" ? "Review details" : "Xem chi tiết",
    });

    await writePreviewStoreFile({
      ...state,
      documents: nextDocuments,
      notifications: [updatedNotification, ...(state.notifications ?? [])].slice(
        0,
        MAX_NOTIFICATIONS,
      ),
    });

    const firstChunk = updatedRecord.chunks[0];
    return {
      ...updatedSummary,
      versions: updatedRecord.versions,
      sections: updatedRecord.chunks.map((chunk) => ({
        id: chunk.chunkId,
        heading: chunk.heading,
        locator: chunk.locator,
        content: chunk.content,
      })),
      preview: firstChunk
        ? {
            kind: "fixture-excerpt",
            heading: firstChunk.heading,
            locator: firstChunk.locator,
            excerpt: firstChunk.content.slice(0, 600),
          }
        : { kind: "unavailable", reason: "Chưa có đoạn chỉ mục." },
    };
  });
}

export async function deleteUploadedKnowledgeDocument(
  access: WorkspaceAccessContext,
  documentId: string,
): Promise<boolean> {
  if (canAttemptPostgres(access)) {
    return withTenantPostgres(access, async (query) => {
      const deleted = await query(
        `DELETE FROM uptech.knowledge_documents
         WHERE id = $1 AND is_user_uploaded = true
         RETURNING id`,
        [documentId],
      );
      return deleted.rows.length > 0;
    });
  }

  if (!isWorkspacePreviewModeEnabled()) {
    return false;
  }

  return withStoreLock(async () => {
    const state = await readPreviewStoreFile();
    const target = state.documents.find((d) => d.summary.id === documentId);
    if (!target || !target.isUserUploaded) return false;
    await unlink(safeUploadedBinaryPath(documentId)).catch(() => undefined);
    const targetHref = `/documents/${documentId}`;
    const updatedPreviousNotifications = (state.notifications ?? []).map((item) =>
      item.href === targetHref ? { ...item, href: null } : item,
    );
    const deletedNotification = createNotificationItem({
      kind: "document_deleted",
      title: `Đã gỡ tài liệu: ${target.summary.name}`,
      description:
        "Tài liệu và toàn bộ đoạn chỉ mục đã bị xóa khỏi thư viện. Các liên kết cũ tới tài liệu này đã được vô hiệu hóa an toàn.",
      href: null,
      actionLabel: "Đã xóa nguồn",
    });

    await writePreviewStoreFile({
      ...state,
      documents: state.documents.filter((d) => d.summary.id !== documentId),
      notifications: [deletedNotification, ...updatedPreviousNotifications].slice(
        0,
        MAX_NOTIFICATIONS,
      ),
    });
    return true;
  });
}

export async function listPersistedChatSessions(
  access: WorkspaceAccessContext,
): Promise<readonly ChatSession[]> {
  if (canAttemptPostgres(access)) {
    return withTenantPostgres(access, async (query) => {
      const sessionRows = await query(
        `SELECT id, title, scope
         FROM uptech.ai_chat_sessions
         WHERE membership_id = $1
         ORDER BY updated_at DESC
         LIMIT 30`,
        [access.membershipId],
      );
      const turnRows = await query(
        `SELECT session_id, id, prompt, scope, evidence_state, answer_paragraphs,
                citations, excluded_count, feedback
         FROM uptech.ai_chat_turns
         ORDER BY turn_order ASC`,
      );

      const turnsBySession = new Map<string, ChatTurn[]>();
      for (const row of turnRows.rows) {
        const sid = String(row.session_id);
        const list = turnsBySession.get(sid) ?? [];
        const answerBody =
          row.answer_paragraphs && typeof row.answer_paragraphs === "object"
            ? (row.answer_paragraphs as {
                scopeLabel?: unknown;
                intro?: unknown;
                points?: unknown;
                footnote?: unknown;
              })
            : {};
        list.push({
          id: String(row.id),
          prompt: String(row.prompt),
          scope: String(row.scope) as ContextScopeType,
          scopeLabel: String(answerBody.scopeLabel ?? row.scope ?? ""),
          evidenceState: String(row.evidence_state) as ChatTurn["evidenceState"],
          intro: String(answerBody.intro ?? ""),
          points: Array.isArray(answerBody.points)
            ? (answerBody.points as ChatTurn["points"])
            : [],
          footnote: String(answerBody.footnote ?? ""),
          citations: Array.isArray(row.citations)
            ? (row.citations as ChatTurn["citations"])
            : [],
          excludedProcessingCount: Number(row.excluded_count ?? 0),
          feedback:
            row.feedback === "up" || row.feedback === "down" ? row.feedback : null,
        });
        turnsBySession.set(sid, list);
      }

      return sessionRows.rows.map((row) => ({
        id: String(row.id),
        title: String(row.title),
        scope: String(row.scope) as ContextScopeType,
        turns: turnsBySession.get(String(row.id)) ?? [],
      }));
    });
  }

  if (!isWorkspacePreviewModeEnabled()) {
    throw new Error("Workspace chat history requires an authenticated database session.");
  }

  return withStoreLock(async () => {
    const state = await readPreviewStoreFile();
    return state.sessions;
  });
}

export async function savePersistedChatTurn(
  access: WorkspaceAccessContext,
  args: Readonly<{
    sessionId: string;
    title: string;
    scope: ContextScopeType;
    turn: ChatTurn;
    replaceTurnId?: string;
    modelName?: string;
  }>,
): Promise<ChatSession> {
  if (canAttemptPostgres(access)) {
    return withTenantPostgres(access, async (query) => {
      const chatRequiredCols = await loadRequiredColumnsByTable(query, [
        "ai_chat_sessions",
        "ai_chat_turns",
      ]);
      const sessionInsert = buildLegacySafeInsert({
        tableName: "ai_chat_sessions",
        baseColumns: ["workspace_id", "id", "membership_id", "title", "scope"],
        baseValues: [
          access.workspaceId,
          args.sessionId,
          access.membershipId,
          args.title,
          args.scope,
        ],
        requiredColumns: chatRequiredCols.get("ai_chat_sessions"),
        access,
        contextDefaults: {
          created_by_membership_id: access.membershipId,
        },
        onConflictSql:
          "ON CONFLICT (workspace_id, id) DO UPDATE SET scope = EXCLUDED.scope, updated_at = transaction_timestamp()",
      });
      await query(sessionInsert.sql, sessionInsert.values);

      const serializedAnswerBody = JSON.stringify({
        scopeLabel: args.turn.scopeLabel,
        intro: args.turn.intro,
        points: args.turn.points,
        footnote: args.turn.footnote,
      });

      if (args.replaceTurnId) {
        await query(
          `UPDATE uptech.ai_chat_turns
           SET id = $2, prompt = $3, scope = $4, evidence_state = $5,
               answer_paragraphs = $6::jsonb, citations = $7::jsonb,
               excluded_count = $8, model_name = $9
           WHERE session_id = $1 AND id = $10`,
          [
            args.sessionId,
            args.turn.id,
            args.turn.prompt,
            args.turn.scope,
            args.turn.evidenceState,
            serializedAnswerBody,
            JSON.stringify(args.turn.citations),
            args.turn.excludedProcessingCount,
            args.modelName ?? null,
            args.replaceTurnId,
          ],
        );
      } else {
        const orderRow = await query(
          "SELECT COALESCE(MAX(turn_order), -1) + 1 AS next_order FROM uptech.ai_chat_turns WHERE session_id = $1",
          [args.sessionId],
        );
        const nextOrder = Number(orderRow.rows[0]?.next_order ?? 0);
        const turnInsert = buildLegacySafeInsert({
          tableName: "ai_chat_turns",
          baseColumns: [
            "workspace_id",
            "session_id",
            "id",
            "turn_order",
            "prompt",
            "scope",
            "evidence_state",
            "answer_paragraphs",
            "citations",
            "excluded_count",
            "model_name",
            "feedback",
          ],
          baseValues: [
            access.workspaceId,
            args.sessionId,
            args.turn.id,
            nextOrder,
            args.turn.prompt,
            args.turn.scope,
            args.turn.evidenceState,
            serializedAnswerBody,
            JSON.stringify(args.turn.citations),
            args.turn.excludedProcessingCount,
            args.modelName ?? null,
            args.turn.feedback,
          ],
          requiredColumns: chatRequiredCols.get("ai_chat_turns"),
          access,
          contextDefaults: {
            membership_id: access.membershipId,
          },
          columnCasts: {
            answer_paragraphs: "::jsonb",
            citations: "::jsonb",
          },
        });
        await query(turnInsert.sql, turnInsert.values);
      }

      const sessions = await listPersistedChatSessions(access);
      return (
        sessions.find((s) => s.id === args.sessionId) ?? {
          id: args.sessionId,
          title: args.title,
          scope: args.scope,
          turns: [args.turn],
        }
      );
    });
  }

  return withStoreLock(async () => {
    const state = await readPreviewStoreFile();
    const existing = state.sessions.find((s) => s.id === args.sessionId) ?? null;
    const baseTurns = existing?.turns ?? [];
    const nextTurns = args.replaceTurnId
      ? baseTurns.map((t) => (t.id === args.replaceTurnId ? args.turn : t))
      : [...baseTurns, args.turn].slice(-MAX_STORED_TURNS_PER_SESSION);

    const updatedSession: ChatSession = {
      id: args.sessionId,
      title: existing?.title || args.title,
      scope: args.scope,
      turns: nextTurns,
    };

    const nextSessions = [
      updatedSession,
      ...state.sessions.filter((s) => s.id !== args.sessionId),
    ].slice(0, MAX_CHAT_SESSIONS);

    await writePreviewStoreFile({
      ...state,
      sessions: nextSessions,
    });

    return updatedSession;
  });
}

export async function updatePersistedTurnFeedback(
  access: WorkspaceAccessContext,
  args: Readonly<{
    sessionId: string;
    turnId: string;
    feedback: "up" | "down" | null;
  }>,
): Promise<ChatSession | null> {
  if (canAttemptPostgres(access)) {
    return withTenantPostgres(access, async (query) => {
      await query(
        `UPDATE uptech.ai_chat_turns
         SET feedback = $3
         WHERE session_id = $1 AND id = $2`,
        [args.sessionId, args.turnId, args.feedback],
      );
      const sessions = await listPersistedChatSessions(access);
      return sessions.find((s) => s.id === args.sessionId) ?? null;
    });
  }

  return withStoreLock(async () => {
    const state = await readPreviewStoreFile();
    const existing = state.sessions.find((s) => s.id === args.sessionId);
    if (!existing) return null;
    const updatedSession: ChatSession = {
      ...existing,
      turns: existing.turns.map((t) =>
        t.id === args.turnId ? { ...t, feedback: args.feedback } : t,
      ),
    };
    await writePreviewStoreFile({
      ...state,
      sessions: state.sessions.map((s) =>
        s.id === args.sessionId ? updatedSession : s,
      ),
    });
    return updatedSession;
  });
}

export async function deletePersistedChatSession(
  access: WorkspaceAccessContext,
  sessionId: string,
): Promise<boolean> {
  if (canAttemptPostgres(access)) {
    return withTenantPostgres(access, async (query) => {
      const result = await query(
        `DELETE FROM uptech.ai_chat_sessions
         WHERE id = $1 AND membership_id = $2
         RETURNING id`,
        [sessionId, access.membershipId],
      );
      return result.rows.length > 0;
    });
  }

  return withStoreLock(async () => {
    const state = await readPreviewStoreFile();
    const exists = state.sessions.some((s) => s.id === sessionId);
    if (!exists) return false;
    await writePreviewStoreFile({
      ...state,
      sessions: state.sessions.filter((s) => s.id !== sessionId),
    });
    return true;
  });
}

export async function listKnowledgeCards(
  access: WorkspaceAccessContext,
): Promise<readonly KnowledgeCardRecord[]> {
  if (canAttemptPostgres(access)) {
    return withTenantPostgres(access, async (query) => {
      const res = await query(
        `SELECT id, kind, status, title, summary, rationale, space_id, space_name,
                source_document_id, source_document_name, source_locator,
                owner_label, updated_label, version
         FROM uptech.knowledge_cards
         ORDER BY updated_at DESC`,
      );
      return res.rows.map((row) => ({
        id: String(row.id),
        kind: String(row.kind) as KnowledgeCardKind,
        status: String(row.status) as KnowledgeCardStatus,
        title: String(row.title),
        summary: String(row.summary),
        rationale: String(row.rationale ?? ""),
        spaceId: String(row.space_id),
        spaceName: String(row.space_name ?? ""),
        sourceDocumentId:
          typeof row.source_document_id === "string" ? row.source_document_id : null,
        sourceDocumentName:
          typeof row.source_document_name === "string" ? row.source_document_name : null,
        sourceLocator:
          typeof row.source_locator === "string" ? row.source_locator : null,
        ownerLabel: String(row.owner_label ?? ""),
        updatedLabel: String(row.updated_label ?? ""),
        version: Number(row.version ?? 1),
      }));
    });
  }

  if (!isWorkspacePreviewModeEnabled()) {
    throw new Error("Knowledge cards require an authenticated database session.");
  }

  return withStoreLock(async () => {
    const state = await readPreviewStoreFile();
    return state.cards ?? [];
  });
}

export async function createKnowledgeCards(
  access: WorkspaceAccessContext,
  cards: readonly KnowledgeCardRecord[],
): Promise<readonly KnowledgeCardRecord[]> {
  if (cards.length === 0) return [];

  if (canAttemptPostgres(access)) {
    return withTenantPostgres(access, async (query) => {
      const requiredCols = await loadRequiredColumnsByTable(query, [
        "knowledge_cards",
      ]);
      for (const card of cards) {
        const cardInsert = buildLegacySafeInsert({
          tableName: "knowledge_cards",
          baseColumns: [
            "workspace_id",
            "id",
            "kind",
            "status",
            "title",
            "summary",
            "rationale",
            "space_id",
            "space_name",
            "source_document_id",
            "source_document_name",
            "source_locator",
            "owner_label",
            "updated_label",
            "version",
          ],
          baseValues: [
            access.workspaceId,
            card.id,
            card.kind,
            card.status,
            card.title,
            card.summary,
            card.rationale,
            card.spaceId,
            card.spaceName,
            card.sourceDocumentId,
            card.sourceDocumentName,
            card.sourceLocator,
            card.ownerLabel,
            card.updatedLabel,
            card.version,
          ],
          requiredColumns: requiredCols.get("knowledge_cards"),
          access,
          contextDefaults: {
            membership_id: access.membershipId,
            created_by_membership_id: access.membershipId,
          },
        });
        await query(cardInsert.sql, cardInsert.values);
      }
      return cards;
    });
  }

  if (!isWorkspacePreviewModeEnabled()) {
    throw new Error("Knowledge card creation requires an authenticated database session.");
  }

  return withStoreLock(async () => {
    const state = await readPreviewStoreFile();
    const firstCard = cards[0]!;
    const cardNotification = createNotificationItem({
      kind: "knowledge_created",
      title:
        cards.length > 1
          ? `Đã tạo ${cards.length} Thẻ tri thức mới`
          : `Thẻ tri thức mới: ${firstCard.title}`,
      description: firstCard.sourceDocumentName
        ? `Trích xuất từ "${firstCard.sourceDocumentName}" trong không gian ${firstCard.spaceName}.`
        : `Lưu trong không gian ${firstCard.spaceName} · trạng thái Chờ duyệt.`,
      href: "/knowledge",
      actionLabel: "Mở Thẻ tri thức",
    });

    await writePreviewStoreFile({
      ...state,
      cards: [...cards, ...(state.cards ?? [])],
      notifications: [cardNotification, ...(state.notifications ?? [])].slice(
        0,
        MAX_NOTIFICATIONS,
      ),
    });
    return cards;
  });
}

export async function updateKnowledgeCard(
  access: WorkspaceAccessContext,
  cardId: string,
  patch: Readonly<{
    status?: KnowledgeCardStatus;
    kind?: KnowledgeCardKind;
    title?: string;
    summary?: string;
    rationale?: string;
    locale?: Locale;
  }>,
): Promise<KnowledgeCardRecord | null> {
  const nowLabel = new Date().toLocaleDateString(
    patch.locale === "en" ? "en-US" : "vi-VN",
    { day: "2-digit", month: "2-digit", year: "numeric" },
  );

  if (canAttemptPostgres(access)) {
    return withTenantPostgres(access, async (query) => {
      const existing = await query(
        "SELECT * FROM uptech.knowledge_cards WHERE id = $1 LIMIT 1",
        [cardId],
      );
      const row = existing.rows[0];
      if (!row) return null;

      const nextStatus = patch.status ?? (String(row.status) as KnowledgeCardStatus);
      const nextKind = patch.kind ?? (String(row.kind) as KnowledgeCardKind);
      const nextTitle = patch.title?.trim() || String(row.title);
      const nextSummary = patch.summary?.trim() || String(row.summary);
      const nextRationale =
        patch.rationale !== undefined ? patch.rationale.trim() : String(row.rationale ?? "");
      const nextVersion = Number(row.version ?? 1) + 1;

      await query(
        `UPDATE uptech.knowledge_cards
         SET status = $2, kind = $3, title = $4, summary = $5, rationale = $6,
             updated_label = $7, version = $8, updated_at = transaction_timestamp()
         WHERE id = $1`,
        [cardId, nextStatus, nextKind, nextTitle, nextSummary, nextRationale, nowLabel, nextVersion],
      );

      return {
        id: cardId,
        kind: nextKind,
        status: nextStatus,
        title: nextTitle,
        summary: nextSummary,
        rationale: nextRationale,
        spaceId: String(row.space_id),
        spaceName: String(row.space_name ?? ""),
        sourceDocumentId:
          typeof row.source_document_id === "string" ? row.source_document_id : null,
        sourceDocumentName:
          typeof row.source_document_name === "string" ? row.source_document_name : null,
        sourceLocator:
          typeof row.source_locator === "string" ? row.source_locator : null,
        ownerLabel: String(row.owner_label ?? ""),
        updatedLabel: nowLabel,
        version: nextVersion,
      };
    });
  }

  if (!isWorkspacePreviewModeEnabled()) return null;

  return withStoreLock(async () => {
    const state = await readPreviewStoreFile();
    const cards = state.cards ?? [];
    const index = cards.findIndex((c) => c.id === cardId);
    if (index === -1) return null;
    const current = cards[index]!;

    const updated: KnowledgeCardRecord = {
      ...current,
      status: patch.status ?? current.status,
      kind: patch.kind ?? current.kind,
      title: patch.title?.trim() || current.title,
      summary: patch.summary?.trim() || current.summary,
      rationale: patch.rationale !== undefined ? patch.rationale.trim() : current.rationale,
      updatedLabel: nowLabel,
      version: current.version + 1,
    };

    const nextCards = [...cards];
    nextCards[index] = updated;

    const shouldNotifyVerified =
      patch.status === "verified" && current.status !== "verified";
    const nextNotifications = shouldNotifyVerified
      ? [
          createNotificationItem({
            kind: "knowledge_verified",
            title: `Đã xác minh chuẩn: ${updated.title}`,
            description: `Thẻ tri thức trong "${updated.spaceName}" đã chuyển sang trạng thái Đã xác minh (v${updated.version}).`,
            href: "/knowledge",
            actionLabel: "Xem Thẻ tri thức",
          }),
          ...(state.notifications ?? []),
        ].slice(0, MAX_NOTIFICATIONS)
      : state.notifications;

    await writePreviewStoreFile({
      ...state,
      cards: nextCards,
      notifications: nextNotifications,
    });
    return updated;
  });
}

export async function deleteKnowledgeCard(
  access: WorkspaceAccessContext,
  cardId: string,
): Promise<boolean> {
  if (canAttemptPostgres(access)) {
    return withTenantPostgres(access, async (query) => {
      const deleted = await query(
        "DELETE FROM uptech.knowledge_cards WHERE id = $1 RETURNING id",
        [cardId],
      );
      return deleted.rows.length > 0;
    });
  }

  if (!isWorkspacePreviewModeEnabled()) return false;

  return withStoreLock(async () => {
    const state = await readPreviewStoreFile();
    const cards = state.cards ?? [];
    if (!cards.some((c) => c.id === cardId)) return false;
    await writePreviewStoreFile({
      ...state,
      cards: cards.filter((c) => c.id !== cardId),
    });
    return true;
  });
}

export async function listWorkspaceNotifications(
  access: WorkspaceAccessContext,
): Promise<readonly WorkspaceNotificationRecord[]> {
  if (canAttemptPostgres(access)) {
    return withTenantPostgres(access, async (query) => {
      try {
        let res;
        try {
          res = await query(
            `SELECT id, kind, title, description, href, action_label, unread,
                    created_at::text AS created_at_iso
             FROM uptech.workspace_notifications
             WHERE recipient_membership_id IS NULL OR recipient_membership_id = $1::uuid
             ORDER BY created_at DESC
             LIMIT $2`,
            [access.membershipId, MAX_NOTIFICATIONS],
          );
        } catch {
          res = await query(
            `SELECT id, kind, title, description, href, action_label, unread,
                    created_at::text AS created_at_iso
             FROM uptech.workspace_notifications
             ORDER BY created_at DESC
             LIMIT $1`,
            [MAX_NOTIFICATIONS],
          );
        }
        return res.rows.map((row) => ({
          id: String(row.id),
          kind: String(row.kind) as WorkspaceNotificationKind,
          title: String(row.title),
          description: String(row.description),
          href: typeof row.href === "string" ? row.href : null,
          actionLabel: String(row.action_label ?? "Mở"),
          unread: Boolean(row.unread),
          createdAtIso: String(row.created_at_iso ?? new Date().toISOString()),
        }));
      } catch {
        return [];
      }
    });
  }

  if (!isWorkspacePreviewModeEnabled()) {
    throw new Error("Notifications require an authenticated database session.");
  }

  return withStoreLock(async () => {
    const state = await readPreviewStoreFile();
    return state.notifications ?? [];
  });
}

export async function recordWorkspaceNotification(
  access: WorkspaceAccessContext,
  input: Readonly<{
    kind: WorkspaceNotificationKind;
    title: string;
    description: string;
    href: string | null;
    actionLabel: string;
    broadcast?: boolean;
  }>,
): Promise<WorkspaceNotificationRecord | null> {
  const entry = createNotificationItem(input);

  if (canAttemptPostgres(access)) {
    return withTenantPostgres(access, async (query) => {
      try {
        try {
          await query(
            `INSERT INTO uptech.workspace_notifications (
               workspace_id, id, kind, title, description, href, action_label, unread, recipient_membership_id
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid)`,
            [
              access.workspaceId,
              entry.id,
              entry.kind,
              entry.title,
              entry.description,
              entry.href,
              entry.actionLabel,
              entry.unread,
              input.broadcast ? null : access.membershipId,
            ],
          );
        } catch {
          await query(
            `INSERT INTO uptech.workspace_notifications (
               workspace_id, id, kind, title, description, href, action_label, unread
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              access.workspaceId,
              entry.id,
              entry.kind,
              entry.title,
              entry.description,
              entry.href,
              entry.actionLabel,
              entry.unread,
            ],
          );
        }
        return entry;
      } catch {
        return null;
      }
    });
  }

  if (!isWorkspacePreviewModeEnabled()) return null;

  return withStoreLock(async () => {
    const state = await readPreviewStoreFile();
    await writePreviewStoreFile({
      ...state,
      notifications: [entry, ...(state.notifications ?? [])].slice(0, MAX_NOTIFICATIONS),
    });
    return entry;
  });
}

export async function markWorkspaceNotificationsRead(
  access: WorkspaceAccessContext,
  args: Readonly<{ notificationId?: string; markAll?: boolean }>,
): Promise<readonly WorkspaceNotificationRecord[]> {
  if (canAttemptPostgres(access)) {
    return withTenantPostgres(access, async (query) => {
      try {
        if (args.markAll) {
          try {
            await query(
              "UPDATE uptech.workspace_notifications SET unread = false WHERE recipient_membership_id IS NULL OR recipient_membership_id = $1::uuid",
              [access.membershipId],
            );
          } catch {
            await query("UPDATE uptech.workspace_notifications SET unread = false");
          }
        } else if (args.notificationId) {
          await query(
            "UPDATE uptech.workspace_notifications SET unread = false WHERE id = $1",
            [args.notificationId],
          );
        }
      } catch {
        // Ignore if table not yet migrated
      }
      return listWorkspaceNotifications(access);
    });
  }

  if (!isWorkspacePreviewModeEnabled()) return [];

  return withStoreLock(async () => {
    const state = await readPreviewStoreFile();
    const nextNotifications = (state.notifications ?? []).map((item) => {
      if (args.markAll || (args.notificationId && item.id === args.notificationId)) {
        return { ...item, unread: false };
      }
      return item;
    });
    await writePreviewStoreFile({ ...state, notifications: nextNotifications });
    return nextNotifications;
  });
}

export async function clearWorkspaceNotifications(
  access: WorkspaceAccessContext,
): Promise<void> {
  if (canAttemptPostgres(access)) {
    await withTenantPostgres(access, async (query) => {
      try {
        try {
          await query(
            "DELETE FROM uptech.workspace_notifications WHERE recipient_membership_id IS NULL OR recipient_membership_id = $1::uuid",
            [access.membershipId],
          );
        } catch {
          await query("DELETE FROM uptech.workspace_notifications");
        }
      } catch {
        // Ignore if table not yet migrated
      }
    });
    return;
  }

  if (!isWorkspacePreviewModeEnabled()) return;

  await withStoreLock(async () => {
    const state = await readPreviewStoreFile();
    await writePreviewStoreFile({ ...state, notifications: [] });
  });
}

export async function loadWorkspacePolicySettings(
  access: WorkspaceAccessContext,
): Promise<WorkspacePolicySettings> {
  const defaults: WorkspacePolicySettings = {
    maxUploadMb: 100,
    allowMemberUploads: true,
    requireVerifiedCardsInChat: false,
    piiRedactionEnabled: true,
  };
  if (!canAttemptPostgres(access)) return defaults;

  return withTenantPostgres(access, async (query) => {
    try {
      const res = await query(
        `SELECT max_upload_mb, allow_member_uploads, require_verified_cards_in_chat, pii_redaction_enabled
         FROM uptech.workspace_settings
         WHERE workspace_id = $1::uuid
         LIMIT 1`,
        [access.workspaceId],
      );
      const row = res.rows[0];
      if (!row) return defaults;
      return {
        maxUploadMb: Math.max(100, Number(row.max_upload_mb ?? 100)),
        allowMemberUploads: row.allow_member_uploads !== false,
        requireVerifiedCardsInChat: row.require_verified_cards_in_chat === true,
        piiRedactionEnabled: row.pii_redaction_enabled !== false,
      };
    } catch {
      return defaults;
    }
  });
}

export async function listUtilityRuns(
  access: WorkspaceAccessContext,
): Promise<readonly UtilityRunRecord[]> {
  if (canAttemptPostgres(access)) {
    return withTenantPostgres(access, async (query) => {
      try {
        const res = await query(
          `SELECT id, task, title, summary, sections_json, sources_json,
                  created_at::text AS created_at_iso
           FROM uptech.workspace_utility_runs
           WHERE membership_id = $1::uuid
           ORDER BY created_at DESC
           LIMIT 25`,
          [access.membershipId],
        );
        return res.rows.map((row) => ({
          id: String(row.id),
          task: String(row.task) as UtilityRunRecord["task"],
          title: String(row.title),
          summary: String(row.summary),
          sections: Array.isArray(row.sections_json)
            ? (row.sections_json as UtilityRunRecord["sections"])
            : [],
          sources: Array.isArray(row.sources_json)
            ? (row.sources_json as UtilityRunRecord["sources"])
            : [],
          createdAtIso: String(row.created_at_iso ?? new Date().toISOString()),
        }));
      } catch {
        return [];
      }
    });
  }

  if (!isWorkspacePreviewModeEnabled()) return [];

  return withStoreLock(async () => {
    const state = await readPreviewStoreFile();
    return state.utilityRuns ?? [];
  });
}

export async function saveUtilityRun(
  access: WorkspaceAccessContext,
  input: Readonly<{
    task: UtilityRunRecord["task"];
    title: string;
    summary: string;
    sections: UtilityRunRecord["sections"];
    sources: UtilityRunRecord["sources"];
  }>,
): Promise<UtilityRunRecord> {
  const entry: UtilityRunRecord = {
    id: `util_${randomUUID().slice(0, 10)}`,
    task: input.task,
    title: input.title,
    summary: input.summary,
    sections: input.sections,
    sources: input.sources,
    createdAtIso: new Date().toISOString(),
  };

  if (canAttemptPostgres(access)) {
    await withTenantPostgres(access, async (query) => {
      try {
        await query(
          `INSERT INTO uptech.workspace_utility_runs (
             workspace_id, id, membership_id, task, title, summary, sections_json, sources_json
           ) VALUES ($1, $2, $3::uuid, $4, $5, $6, $7::jsonb, $8::jsonb)`,
          [
            access.workspaceId,
            entry.id,
            access.membershipId,
            entry.task,
            entry.title,
            entry.summary,
            JSON.stringify(entry.sections),
            JSON.stringify(entry.sources),
          ],
        );
      } catch {
        // Ignore if utility_runs table is not yet migrated.
      }
    });
    return entry;
  }

  if (isWorkspacePreviewModeEnabled()) {
    await withStoreLock(async () => {
      const state = await readPreviewStoreFile();
      await writePreviewStoreFile({
        ...state,
        utilityRuns: [entry, ...(state.utilityRuns ?? [])].slice(0, 25),
      });
    });
  }

  return entry;
}

// ============================================================================
// Enterprise Data-Plane Audit Trail (SOC2 / ISO 27001)
// ============================================================================
export async function recordWorkspaceDataAuditEvent(
  access: WorkspaceAccessContext,
  eventType: string,
  targetId: string,
  metadata: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  if (!canAttemptPostgres(access)) return;
  await withTenantPostgres(access, async (query) => {
    await runWithSavepoint(
      query,
      "sp_workspace_audit_event",
      async () => {
        await query(
          `INSERT INTO uptech.audit_events (
             workspace_id, actor_user_id, actor_membership_id, event_type,
             target_type, target_id, request_id, outcome, metadata
           ) VALUES (
             $1::uuid, $2::uuid, $3::uuid, $4,
             'knowledge_resource', $5, $6, 'SUCCESS', $7::jsonb
           )`,
          [
            access.workspaceId,
            access.userId ?? null,
            access.membershipId ?? null,
            eventType,
            targetId,
            `req_${randomUUID().slice(0, 12)}`,
            JSON.stringify({
              actorLabel: access.actorLabel,
              workspaceRole: access.workspaceRole,
              ...metadata,
            }),
          ],
        );
      },
      async () => undefined,
    );
  }).catch(() => undefined);
}

// ============================================================================
// Multi-Version Document Lifecycle (Upload v2.0+, Snapshot Diff & Rollback)
// ============================================================================
function computeNextVersionLabel(currentLabel: string): string {
  const match = /^v?(\d+)(?:\.(\d+))?/i.exec(currentLabel.trim());
  if (!match) return "v2.0";
  const major = Number.parseInt(match[1] ?? "1", 10);
  return `v${major + 1}.0`;
}

export async function uploadNewDocumentVersion(
  access: WorkspaceAccessContext,
  documentId: string,
  args: Readonly<{
    fileName: string;
    extension: string;
    byteSize: number;
    rawBytes?: Uint8Array;
    chunks: readonly ExtractedDocumentChunk[];
    embeddings?: ReadonlyArray<readonly number[] | null>;
    versionNote?: string;
    locale: Locale;
  }>,
): Promise<DocumentDetailView | null> {
  const existing = await getStoredKnowledgeDocument(access, documentId);
  if (!existing) return null;

  const nextVersionLabel = computeNextVersionLabel(existing.summary.versionLabel);
  const nextVersionId = `${documentId}-${nextVersionLabel.replace(/[^a-zA-Z0-9]/g, "")}-${Date.now().toString(36).slice(-4)}`;
  const nowLabel =
    args.locale === "vi"
      ? `Cập nhật ${nextVersionLabel} · vừa xong`
      : `Updated ${nextVersionLabel} · just now`;
  const noteText =
    args.versionNote?.trim() ||
    (args.locale === "vi"
      ? `Cập nhật phiên bản ${nextVersionLabel} (${args.chunks.length} đoạn trích)`
      : `Updated version ${nextVersionLabel} (${args.chunks.length} segments)`);

  const storedChunks: StoredDocumentChunk[] =
    args.chunks.length > 0
      ? args.chunks.map((chunk, index) => ({
          chunkId: `${documentId}-chunk-${index}`,
          documentId,
          chunkIndex: index,
          heading: chunk.heading,
          locator: chunk.locator,
          content: chunk.content,
          embedding: args.embeddings?.[index] ?? undefined,
        }))
      : existing.chunks.map((c) => ({ ...c }));

  if (canAttemptPostgres(access)) {
    const result = await withTenantPostgres(access, async (query) => {
      const requiredCols = await loadRequiredColumnsByTable(query, [
        "knowledge_document_versions",
        "knowledge_document_chunks",
      ]);

      // Snapshot previous active version chunks if not already stored
      const prevVersion = existing.versions[0];
      if (prevVersion) {
        await runWithSavepoint(
          query,
          "sp_ver_prev_snapshot",
          async () => {
            await query(
              `UPDATE uptech.knowledge_document_versions
               SET chunks_snapshot_json = COALESCE(chunks_snapshot_json, $3::jsonb)
               WHERE document_id = $1 AND version_id = $2`,
              [documentId, prevVersion.id, JSON.stringify(existing.chunks)],
            );
          },
          async () => undefined,
        );
      }

      const verContentSha256 = createHash("sha256")
        .update(
          args.rawBytes && args.rawBytes.length > 0
            ? Buffer.from(args.rawBytes)
            : storedChunks.map((c) => `${c.heading}\n${c.content}`).join("\n\n"),
        )
        .digest("hex");

      await runWithSavepoint(
        query,
        "sp_ver_insert_snapshot",
        async () => {
          const verInsert = buildLegacySafeInsert({
            tableName: "knowledge_document_versions",
            baseColumns: [
              "workspace_id",
              "document_id",
              "version_id",
              "version_label",
              "note",
              "updated_label",
              "chunks_snapshot_json",
              "author_label",
              "byte_size",
            ],
            baseValues: [
              access.workspaceId,
              documentId,
              nextVersionId,
              nextVersionLabel,
              noteText,
              nowLabel,
              JSON.stringify(storedChunks),
              access.actorLabel,
              args.byteSize,
            ],
            requiredColumns: requiredCols.get("knowledge_document_versions"),
            access,
            contextDefaults: {
              id: nextVersionId,
              title: args.fileName,
              status: "ready",
              checksum: verContentSha256,
              sha256: verContentSha256,
              content_hash: verContentSha256,
              membership_id: access.membershipId,
              author_label: access.actorLabel,
              byte_size: args.byteSize,
            },
            columnCasts: { chunks_snapshot_json: "::jsonb" },
          });
          await query(verInsert.sql, verInsert.values);
        },
        async () => {
          const legacyVerInsert = buildLegacySafeInsert({
            tableName: "knowledge_document_versions",
            baseColumns: [
              "workspace_id",
              "document_id",
              "version_id",
              "version_label",
              "note",
              "updated_label",
            ],
            baseValues: [
              access.workspaceId,
              documentId,
              nextVersionId,
              nextVersionLabel,
              noteText,
              nowLabel,
            ],
            requiredColumns: requiredCols.get("knowledge_document_versions"),
            access,
            contextDefaults: {
              id: nextVersionId,
              title: args.fileName,
              status: "ready",
              checksum: verContentSha256,
              sha256: verContentSha256,
              content_hash: verContentSha256,
              membership_id: access.membershipId,
            },
          });
          await query(legacyVerInsert.sql, legacyVerInsert.values);
        },
      );

      await query(
        "DELETE FROM uptech.knowledge_document_chunks WHERE document_id = $1",
        [documentId],
      );
      for (const chunk of storedChunks) {
        const chunkSha256 = createHash("sha256")
          .update(chunk.content)
          .digest("hex");
        const chunkInsert = buildLegacySafeInsert({
          tableName: "knowledge_document_chunks",
          baseColumns: [
            "workspace_id",
            "chunk_id",
            "document_id",
            "chunk_index",
            "heading",
            "locator",
            "content",
            "embedding_json",
          ],
          baseValues: [
            access.workspaceId,
            chunk.chunkId,
            documentId,
            chunk.chunkIndex,
            chunk.heading,
            chunk.locator,
            chunk.content,
            chunk.embedding ? JSON.stringify(chunk.embedding) : null,
          ],
          requiredColumns: requiredCols.get("knowledge_document_chunks"),
          access,
          contextDefaults: {
            id: chunk.chunkId,
            version_id: nextVersionId,
            title: chunk.heading,
            checksum: chunkSha256,
            sha256: chunkSha256,
            content_hash: chunkSha256,
            token_count: chunk.content.length,
          },
          columnCasts: { embedding_json: "::jsonb" },
        });
        await query(chunkInsert.sql, chunkInsert.values);
      }

      if (
        args.rawBytes &&
        args.rawBytes.length > 0 &&
        args.rawBytes.length <= 15 * 1024 * 1024
      ) {
        await runWithSavepoint(
          query,
          "sp_ver_blob_upsert",
          async () => {
            await query(
              `INSERT INTO uptech.knowledge_document_blobs (
                 workspace_id, document_id, file_extension, content_type, byte_size, content_bytes
               ) VALUES ($1, $2, $3, 'application/octet-stream', $4, $5)
               ON CONFLICT (workspace_id, document_id)
               DO UPDATE SET
                 file_extension = EXCLUDED.file_extension,
                 byte_size = EXCLUDED.byte_size,
                 content_bytes = EXCLUDED.content_bytes`,
              [
                access.workspaceId,
                documentId,
                args.extension.toLowerCase(),
                args.rawBytes!.length,
                Buffer.from(args.rawBytes!),
              ],
            );
          },
          async () => undefined,
        );
      }

      await query(
        `UPDATE uptech.knowledge_documents
         SET version_label = $2,
             detail = $3,
             updated_label = $4,
             byte_size = $5,
             updated_at = transaction_timestamp()
         WHERE id = $1`,
        [documentId, nextVersionLabel, noteText, nowLabel, args.byteSize],
      );

      // Flag any verified Knowledge Cards derived from this document for re-verification
      await runWithSavepoint(
        query,
        "sp_ver_flag_cards",
        async () => {
          await query(
            `UPDATE uptech.knowledge_cards
             SET status = 'draft',
                 flagged_outdated_reason = $2,
                 updated_at = transaction_timestamp()
             WHERE source_document_id = $1 AND status = 'verified'`,
            [
              documentId,
              `Tài liệu nguồn vừa nâng cấp lên ${nextVersionLabel} — cần rà soát lại thẻ tri thức.`,
            ],
          );
        },
        async () => undefined,
      );

      return true;
    });

    if (result) {
      await recordWorkspaceDataAuditEvent(
        access,
        "knowledge.document.version_uploaded",
        documentId,
        {
          versionLabel: nextVersionLabel,
          chunkCount: storedChunks.length,
          byteSize: args.byteSize,
        },
      );
      await recordWorkspaceNotification(access, {
        kind: "document_updated",
        title: `Phiên bản mới ${nextVersionLabel}: ${existing.summary.name}`,
        description: noteText,
        href: `/documents/${documentId}`,
        actionLabel: "Xem & Đối chiếu",
      });
    }

    const refreshed = await getStoredKnowledgeDocument(access, documentId);
    if (!refreshed) return null;
    const firstChunk = refreshed.chunks[0];
    return {
      ...refreshed.summary,
      versions: refreshed.versions,
      sections: refreshed.chunks.map((c) => ({
        id: c.chunkId,
        heading: c.heading,
        locator: c.locator,
        content: c.content,
      })),
      preview: firstChunk
        ? {
            kind: "fixture-excerpt",
            heading: firstChunk.heading,
            locator: firstChunk.locator,
            excerpt: firstChunk.content.slice(0, 600),
          }
        : { kind: "unavailable", reason: "No indexed chunks." },
    };
  }

  if (!isWorkspacePreviewModeEnabled()) return null;

  return withStoreLock(async () => {
    const state = await readPreviewStoreFile();
    const idx = state.documents.findIndex((d) => d.summary.id === documentId);
    if (idx === -1) return null;
    const doc = state.documents[idx]!;
    const prevVersionId = doc.versions[0]?.id ?? `${documentId}-v1`;

    const snapshots: Record<string, readonly StoredDocumentChunk[]> = {
      ...(state.versionSnapshots ?? {}),
      [prevVersionId]: doc.chunks,
      [nextVersionId]: storedChunks,
    };

    const nextVersions = [
      { id: nextVersionId, label: nextVersionLabel, updatedLabel: nowLabel },
      ...doc.versions,
    ];

    const updatedDoc: StoredKnowledgeDocument = {
      ...doc,
      summary: {
        ...doc.summary,
        versionLabel: nextVersionLabel,
        detail: noteText,
        updatedLabel: nowLabel,
      },
      versions: nextVersions,
      byteSize: args.byteSize,
      chunks: storedChunks,
    };

    const nextDocs = [...state.documents];
    nextDocs[idx] = updatedDoc;

    await writePreviewStoreFile({
      ...state,
      documents: nextDocs,
      versionSnapshots: snapshots,
    });

    const firstChunk = storedChunks[0];
    return {
      ...updatedDoc.summary,
      versions: updatedDoc.versions,
      sections: storedChunks.map((c) => ({
        id: c.chunkId,
        heading: c.heading,
        locator: c.locator,
        content: c.content,
      })),
      preview: firstChunk
        ? {
            kind: "fixture-excerpt",
            heading: firstChunk.heading,
            locator: firstChunk.locator,
            excerpt: firstChunk.content.slice(0, 600),
          }
        : { kind: "unavailable", reason: "No indexed chunks." },
    };
  });
}

export async function getDocumentVersionChunks(
  access: WorkspaceAccessContext,
  documentId: string,
  versionId?: string,
): Promise<readonly StoredDocumentChunk[]> {
  const doc = await getStoredKnowledgeDocument(access, documentId);
  if (!doc) return [];
  if (!versionId || doc.versions[0]?.id === versionId || doc.summary.versionLabel === versionId) {
    return doc.chunks;
  }

  if (canAttemptPostgres(access)) {
    return withTenantPostgres(access, async (query) => {
      try {
        const res = await query(
          `SELECT chunks_snapshot_json
           FROM uptech.knowledge_document_versions
           WHERE document_id = $1 AND (version_id = $2 OR version_label = $2)
           LIMIT 1`,
          [documentId, versionId],
        );
        const snap = res.rows[0]?.chunks_snapshot_json;
        if (Array.isArray(snap) && snap.length > 0) {
          return snap as readonly StoredDocumentChunk[];
        }
      } catch {
        // Fallback below
      }
      return doc.chunks;
    });
  }

  if (isWorkspacePreviewModeEnabled()) {
    const state = await readPreviewStoreFile();
    const matchedVersion = doc.versions.find(
      (v) => v.id === versionId || v.label === versionId,
    );
    const snap =
      (matchedVersion && state.versionSnapshots?.[matchedVersion.id]) ??
      state.versionSnapshots?.[versionId];
    if (snap && snap.length > 0) return snap;
  }

  return doc.chunks;
}

export async function rollbackDocumentVersion(
  access: WorkspaceAccessContext,
  documentId: string,
  targetVersionId: string,
  locale: Locale = "vi",
): Promise<DocumentDetailView | null> {
  const existing = await getStoredKnowledgeDocument(access, documentId);
  if (!existing) return null;

  const targetVersion = existing.versions.find(
    (v) => v.id === targetVersionId || v.label === targetVersionId,
  );
  if (!targetVersion) return null;

  const targetChunks = await getDocumentVersionChunks(access, documentId, targetVersion.id);
  const restoredNote =
    locale === "vi"
      ? `Khôi phục (Rollback) từ phiên bản ${targetVersion.label}`
      : `Rolled back from version ${targetVersion.label}`;

  return uploadNewDocumentVersion(access, documentId, {
    fileName: existing.summary.name,
    extension: existing.rawFileExtension ?? existing.summary.fileType,
    byteSize: existing.byteSize,
    chunks: targetChunks.map((c, idx) => ({
      chunkIndex: idx,
      heading: c.heading,
      locator: c.locator,
      content: c.content,
    })),
    versionNote: restoredNote,
    locale,
  });
}

// ============================================================================
// Collaborative Document Comments, Approval Notes & Outdated Flags
// ============================================================================
export async function listDocumentComments(
  access: WorkspaceAccessContext,
  documentId: string,
): Promise<readonly DocumentCommentRecord[]> {
  if (canAttemptPostgres(access)) {
    return withTenantPostgres(access, async (query) => {
      try {
        const res = await query(
          `SELECT id, document_id, chunk_id, author_label, author_role,
                  comment_kind, body, resolved, created_at::text AS created_at_iso
           FROM uptech.knowledge_document_comments
           WHERE document_id = $1
           ORDER BY created_at DESC
           LIMIT 50`,
          [documentId],
        );
        return res.rows.map((r) => ({
          id: String(r.id),
          documentId: String(r.document_id),
          chunkId: r.chunk_id ? String(r.chunk_id) : null,
          authorLabel: String(r.author_label),
          authorRole: (r.author_role === "OWNER" || r.author_role === "ADMIN"
            ? r.author_role
            : "MEMBER") as DocumentCommentRecord["authorRole"],
          commentKind: (r.comment_kind === "OUTDATED_FLAG" ||
          r.comment_kind === "APPROVAL_NOTE"
            ? r.comment_kind
            : "COMMENT") as DocumentCommentKind,
          body: String(r.body),
          resolved: Boolean(r.resolved),
          createdAtIso: String(r.created_at_iso ?? new Date().toISOString()),
        }));
      } catch {
        return [];
      }
    });
  }

  if (!isWorkspacePreviewModeEnabled()) return [];
  const state = await readPreviewStoreFile();
  return (state.comments ?? []).filter((c) => c.documentId === documentId);
}

export async function createDocumentComment(
  access: WorkspaceAccessContext,
  documentId: string,
  input: Readonly<{
    chunkId?: string | null;
    commentKind?: DocumentCommentKind;
    body: string;
  }>,
): Promise<DocumentCommentRecord> {
  const comment: DocumentCommentRecord = {
    id: `cmt_${randomUUID().slice(0, 10)}`,
    documentId,
    chunkId: input.chunkId ?? null,
    authorLabel: access.actorLabel,
    authorRole: access.workspaceRole,
    commentKind: input.commentKind ?? "COMMENT",
    body: input.body.trim(),
    resolved: false,
    createdAtIso: new Date().toISOString(),
  };

  if (canAttemptPostgres(access)) {
    await withTenantPostgres(access, async (query) => {
      await query(
        `INSERT INTO uptech.knowledge_document_comments (
           workspace_id, id, document_id, chunk_id, author_membership_id,
           author_label, author_role, comment_kind, body
         ) VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6, $7, $8, $9)`,
        [
          access.workspaceId,
          comment.id,
          documentId,
          comment.chunkId,
          access.membershipId ?? null,
          comment.authorLabel,
          comment.authorRole,
          comment.commentKind,
          comment.body,
        ],
      );

      if (comment.commentKind === "OUTDATED_FLAG") {
        await runWithSavepoint(
          query,
          "sp_comment_flag_outdated",
          async () => {
            await query(
              `UPDATE uptech.knowledge_documents
               SET flagged_outdated_reason = $2,
                   flagged_outdated_by = $3,
                   flagged_outdated_at = transaction_timestamp()
               WHERE id = $1`,
              [documentId, comment.body, comment.authorLabel],
            );
          },
          async () => undefined,
        );
      }
    });

    await recordWorkspaceDataAuditEvent(
      access,
      comment.commentKind === "OUTDATED_FLAG"
        ? "knowledge.document.flagged_outdated"
        : "knowledge.document.comment_added",
      documentId,
      { commentKind: comment.commentKind },
    );
    return comment;
  }

  if (isWorkspacePreviewModeEnabled()) {
    await withStoreLock(async () => {
      const state = await readPreviewStoreFile();
      await writePreviewStoreFile({
        ...state,
        comments: [comment, ...(state.comments ?? [])].slice(0, 200),
      });
    });
  }

  return comment;
}

// ============================================================================
// Knowledge Connectors (Web URL Crawler & Enterprise Ingestion API Keys)
// ============================================================================
export async function listKnowledgeConnectors(
  access: WorkspaceAccessContext,
): Promise<readonly KnowledgeConnectorRecord[]> {
  if (canAttemptPostgres(access)) {
    return withTenantPostgres(access, async (query) => {
      try {
        const res = await query(
          `SELECT id, connector_kind, title, source_url, space_id, document_id,
                  status, last_synced_at::text AS last_synced_at_iso, chunk_count, created_by_label
           FROM uptech.workspace_knowledge_connectors
           ORDER BY last_synced_at DESC
           LIMIT 50`,
        );
        return res.rows.map((r) => ({
          id: String(r.id),
          connectorKind:
            r.connector_kind === "WEBHOOK_API" ? "WEBHOOK_API" : "WEB_URL",
          title: String(r.title),
          sourceUrl: String(r.source_url),
          spaceId: String(r.space_id),
          documentId: r.document_id ? String(r.document_id) : null,
          status: r.status === "ERROR" ? "ERROR" : "ACTIVE",
          lastSyncedAtIso: String(r.last_synced_at_iso ?? new Date().toISOString()),
          chunkCount: Number(r.chunk_count ?? 0),
          createdByLabel: String(r.created_by_label ?? access.actorLabel),
        }));
      } catch {
        return [];
      }
    });
  }

  if (!isWorkspacePreviewModeEnabled()) return [];
  const state = await readPreviewStoreFile();
  return state.connectors ?? [];
}

export async function saveKnowledgeConnectorRecord(
  access: WorkspaceAccessContext,
  input: Readonly<{
    id?: string;
    connectorKind?: "WEB_URL" | "WEBHOOK_API";
    title: string;
    sourceUrl: string;
    spaceId: string;
    documentId: string | null;
    chunkCount: number;
  }>,
): Promise<KnowledgeConnectorRecord> {
  const record: KnowledgeConnectorRecord = {
    id: input.id ?? `conn_${randomUUID().slice(0, 10)}`,
    connectorKind: input.connectorKind ?? "WEB_URL",
    title: input.title,
    sourceUrl: input.sourceUrl,
    spaceId: input.spaceId,
    documentId: input.documentId,
    status: "ACTIVE",
    lastSyncedAtIso: new Date().toISOString(),
    chunkCount: input.chunkCount,
    createdByLabel: access.actorLabel,
  };

  if (canAttemptPostgres(access)) {
    await withTenantPostgres(access, async (query) => {
      try {
        await query(
          `INSERT INTO uptech.workspace_knowledge_connectors (
             workspace_id, id, connector_kind, title, source_url, space_id,
             document_id, status, last_synced_at, chunk_count, created_by_label
           ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, 'ACTIVE', transaction_timestamp(), $8, $9)
           ON CONFLICT (workspace_id, id)
           DO UPDATE SET
             title = EXCLUDED.title,
             document_id = EXCLUDED.document_id,
             status = 'ACTIVE',
             last_synced_at = transaction_timestamp(),
             chunk_count = EXCLUDED.chunk_count`,
          [
            access.workspaceId,
            record.id,
            record.connectorKind,
            record.title,
            record.sourceUrl,
            record.spaceId,
            record.documentId,
            record.chunkCount,
            record.createdByLabel,
          ],
        );
      } catch {
        // Ignore if table not yet migrated
      }
    });
    await recordWorkspaceDataAuditEvent(
      access,
      "knowledge.connector.url_ingested",
      record.id,
      { sourceUrl: record.sourceUrl, chunkCount: record.chunkCount },
    );
    return record;
  }

  if (isWorkspacePreviewModeEnabled()) {
    await withStoreLock(async () => {
      const state = await readPreviewStoreFile();
      const filtered = (state.connectors ?? []).filter((c) => c.id !== record.id);
      await writePreviewStoreFile({
        ...state,
        connectors: [record, ...filtered].slice(0, 50),
      });
    });
  }

  return record;
}

export async function listIngestionApiKeys(
  access: WorkspaceAccessContext,
): Promise<readonly IngestionApiKeyRecord[]> {
  if (canAttemptPostgres(access)) {
    return withTenantPostgres(access, async (query) => {
      try {
        const res = await query(
          `SELECT id::text AS id, label, key_prefix, default_space_id, created_by_label,
                  last_used_at::text AS last_used_at_iso, revoked_at::text AS revoked_at_iso,
                  created_at::text AS created_at_iso
           FROM uptech.workspace_ingestion_api_keys
           ORDER BY created_at DESC
           LIMIT 30`,
        );
        return res.rows.map((r) => ({
          id: String(r.id),
          label: String(r.label),
          keyPrefix: String(r.key_prefix),
          defaultSpaceId: String(r.default_space_id),
          createdByLabel: String(r.created_by_label),
          lastUsedAtIso: r.last_used_at_iso ? String(r.last_used_at_iso) : null,
          revokedAtIso: r.revoked_at_iso ? String(r.revoked_at_iso) : null,
          createdAtIso: String(r.created_at_iso ?? new Date().toISOString()),
        }));
      } catch {
        return [];
      }
    });
  }

  if (!isWorkspacePreviewModeEnabled()) return [];
  const state = await readPreviewStoreFile();
  return state.apiKeys ?? [];
}

export async function createIngestionApiKey(
  access: WorkspaceAccessContext,
  input: Readonly<{ label: string; defaultSpaceId: string }>,
): Promise<{ readonly record: IngestionApiKeyRecord; readonly rawSecretKey: string }> {
  const tokenSecret = randomBytes(20).toString("hex");
  const rawSecretKey = `upt_live_${tokenSecret}`;
  const keyPrefix = `${rawSecretKey.slice(0, 14)}...${rawSecretKey.slice(-4)}`;
  const keyHash = createHash("sha256").update(rawSecretKey).digest("hex");
  const id = randomUUID();

  const record: IngestionApiKeyRecord = {
    id,
    label: input.label.trim() || "CI/CD Knowledge Sync Key",
    keyPrefix,
    defaultSpaceId: input.defaultSpaceId || "spc_8f2a01",
    createdByLabel: access.actorLabel,
    lastUsedAtIso: null,
    revokedAtIso: null,
    createdAtIso: new Date().toISOString(),
  };

  if (canAttemptPostgres(access)) {
    await withTenantPostgres(access, async (query) => {
      await query(
        `INSERT INTO uptech.workspace_ingestion_api_keys (
           workspace_id, id, label, key_prefix, key_hash, default_space_id, created_by_label
         ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)`,
        [
          access.workspaceId,
          id,
          record.label,
          record.keyPrefix,
          keyHash,
          record.defaultSpaceId,
          record.createdByLabel,
        ],
      );
    });
    await recordWorkspaceDataAuditEvent(
      access,
      "knowledge.connector.api_key_created",
      id,
      { label: record.label, keyPrefix: record.keyPrefix },
    );
    return { record, rawSecretKey };
  }

  if (isWorkspacePreviewModeEnabled()) {
    await withStoreLock(async () => {
      const state = await readPreviewStoreFile();
      await writePreviewStoreFile({
        ...state,
        apiKeys: [{ ...record, keyHash }, ...(state.apiKeys ?? [])],
      });
    });
  }

  return { record, rawSecretKey };
}

export async function revokeIngestionApiKey(
  access: WorkspaceAccessContext,
  keyId: string,
): Promise<void> {
  if (canAttemptPostgres(access)) {
    await withTenantPostgres(access, async (query) => {
      await query(
        `UPDATE uptech.workspace_ingestion_api_keys
         SET revoked_at = transaction_timestamp()
         WHERE id = $1::uuid AND revoked_at IS NULL`,
        [keyId],
      );
    });
    await recordWorkspaceDataAuditEvent(
      access,
      "knowledge.connector.api_key_revoked",
      keyId,
    );
    return;
  }

  if (isWorkspacePreviewModeEnabled()) {
    await withStoreLock(async () => {
      const state = await readPreviewStoreFile();
      await writePreviewStoreFile({
        ...state,
        apiKeys: (state.apiKeys ?? []).map((k) =>
          k.id === keyId ? { ...k, revokedAtIso: new Date().toISOString() } : k,
        ),
      });
    });
  }
}

