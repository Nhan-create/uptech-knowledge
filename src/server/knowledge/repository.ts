import { randomUUID } from "node:crypto";
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
import {
  isWorkspacePreviewModeEnabled,
  type WorkspaceAccessContext,
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

export interface PersistedWorkspaceState {
  readonly schemaVersion?: number;
  readonly spaces: readonly SpaceSummaryView[];
  readonly documents: readonly StoredKnowledgeDocument[];
  readonly sessions: readonly ChatSession[];
  readonly cards?: readonly KnowledgeCardRecord[];
  readonly notifications?: readonly WorkspaceNotificationRecord[];
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
  return FILE_TYPES[2];
}

function buildSeedState(): PersistedWorkspaceState {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    spaces: [...DEFAULT_SPACES],
    documents: [],
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

      return {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        spaces: parsed.spaces,
        documents: parsed.documents,
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

export async function readUploadedDocumentBinary(documentId: string): Promise<Buffer | null> {
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
    await client.query("SELECT set_config('app.current_workspace_id', $1, true)", [
      access.workspaceId,
    ]);
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

export async function loadKnowledgeDocumentsAndSpaces(
  access: WorkspaceAccessContext,
): Promise<{
  readonly spaces: readonly SpaceSummaryView[];
  readonly documents: readonly StoredKnowledgeDocument[];
}> {
  if (canAttemptPostgres(access)) {
    const dbResult = await withTenantPostgres(access, async (query) => {
      const spaceRows = await query(
        "SELECT id, name, description FROM uptech.knowledge_spaces ORDER BY name ASC",
      );
      const docRows = await query(
        `SELECT id, space_id, name, file_type, version_label, detail, owner_label,
                updated_label, processing_kind, processing_label, governance_kind,
                governance_label, byte_size, is_user_uploaded
         FROM uptech.knowledge_documents
         ORDER BY created_at DESC`,
      );
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
        spaceRows: spaceRows.rows,
        docRows: docRows.rows,
        chunkRows: chunkRows.rows,
        versionRows: versionRows.rows,
      };
    });

    if (dbResult.spaceRows.length > 0 || dbResult.docRows.length > 0) {
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
      const spaces: SpaceSummaryView[] = dbResult.spaceRows.map((row) => {
        const id = String(row.id) as SpaceId;
        const view: SpaceSummaryView = {
          id,
          name: String(row.name),
          description: String(row.description ?? ""),
          documentCount: docCountBySpace.get(id) ?? 0,
        };
        spaceMap.set(id, view);
        return view;
      });

      const documents: StoredKnowledgeDocument[] = dbResult.docRows.map((row) => {
        const id = String(row.id) as DocumentId;
        const spaceId = String(row.space_id) as SpaceId;
        const space = spaceMap.get(spaceId) ?? { id: spaceId, name: spaceId };
        const processingKind = String(row.processing_kind) as DocumentSummaryView["processing"]["kind"];
        const govKind = String(row.governance_kind) === "deprecated" ? "deprecated" : "verified";

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
                label: String(row.governance_label || (govKind === "deprecated" ? "Phiên bản cũ" : "Đã xác minh")),
                description: String(row.detail ?? ""),
                variant: govKind === "deprecated" ? "warning" : "success",
              },
            ],
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
          chunks: chunksByDoc.get(id) ?? [],
        };
      });

      return { spaces, documents };
    }
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
    return {
      spaces: state.spaces.map((space) => ({
        ...space,
        documentCount: spaceCounts.get(space.id) ?? 0,
      })),
      documents: state.documents.map((doc) => ({
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

      const govLabel = args.locale === "vi" ? "Tải lên bởi người dùng" : "User uploaded";
      await query(
        `INSERT INTO uptech.knowledge_documents (
          workspace_id, id, space_id, name, file_type, version_label, detail,
          owner_label, updated_label, processing_kind, processing_label,
          governance_kind, governance_label, byte_size, is_user_uploaded
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ready', $10, 'active', $11, $12, true)`,
        [
          access.workspaceId,
          args.id,
          targetSpace.id,
          args.fileName,
          args.extension.toLowerCase(),
          "v1.0",
          detailText,
          access.actorLabel,
          nowLabel,
          readyLabel,
          govLabel,
          args.byteSize,
        ],
      );

      await query(
        `INSERT INTO uptech.knowledge_document_versions (
          workspace_id, document_id, version_id, version_label, note, updated_label
        ) VALUES ($1, $2, $3, 'v1.0', $4, $5)`,
        [access.workspaceId, args.id, `${args.id}-v1`, detailText, nowLabel],
      );

      for (const chunk of storedChunks) {
        await query(
          `INSERT INTO uptech.knowledge_document_chunks (
            workspace_id, chunk_id, document_id, chunk_index, heading, locator, content, embedding_json
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
          [
            access.workspaceId,
            chunk.chunkId,
            args.id,
            chunk.chunkIndex,
            chunk.heading,
            chunk.locator,
            chunk.content,
            chunk.embedding ? JSON.stringify(chunk.embedding) : null,
          ],
        );
      }

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
  args: Readonly<{ id: string; name: string; description: string }>,
): Promise<SpaceSummaryView> {
  if (canAttemptPostgres(access)) {
    return withTenantPostgres(access, async (query) => {
      await query(
        `INSERT INTO uptech.knowledge_spaces (workspace_id, id, name, description)
         VALUES ($1, $2, $3, $4)`,
        [access.workspaceId, args.id, args.name, args.description],
      );
      return {
        id: args.id as SpaceId,
        name: args.name,
        description: args.description,
        documentCount: 0,
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
      await query(
        `INSERT INTO uptech.ai_chat_sessions (workspace_id, id, membership_id, title, scope, updated_at)
         VALUES ($1, $2, $3, $4, $5, transaction_timestamp())
         ON CONFLICT (workspace_id, id) DO UPDATE
           SET scope = EXCLUDED.scope, updated_at = transaction_timestamp()`,
        [access.workspaceId, args.sessionId, access.membershipId, args.title, args.scope],
      );

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
        await query(
          `INSERT INTO uptech.ai_chat_turns (
             workspace_id, session_id, id, turn_order, prompt, scope, evidence_state,
             answer_paragraphs, citations, excluded_count, model_name, feedback
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12)`,
          [
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
        );
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
      for (const card of cards) {
        await query(
          `INSERT INTO uptech.knowledge_cards (
             workspace_id, id, kind, status, title, summary, rationale,
             space_id, space_name, source_document_id, source_document_name,
             source_locator, owner_label, updated_label, version
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
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
        );
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
        const res = await query(
          `SELECT id, kind, title, description, href, action_label, unread,
                  created_at::text AS created_at_iso
           FROM uptech.workspace_notifications
           ORDER BY created_at DESC
           LIMIT $1`,
          [MAX_NOTIFICATIONS],
        );
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
  }>,
): Promise<WorkspaceNotificationRecord | null> {
  const entry = createNotificationItem(input);

  if (canAttemptPostgres(access)) {
    return withTenantPostgres(access, async (query) => {
      try {
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
          await query("UPDATE uptech.workspace_notifications SET unread = false");
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
        await query("DELETE FROM uptech.workspace_notifications");
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
