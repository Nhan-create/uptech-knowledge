import {
  ALLOWED_SERVER_UPLOAD_EXTENSIONS,
  parseUploadedDocumentChunks,
} from "@/server/ai/document-parser";
import { embedTextWithGemini, readGeminiConfig } from "@/server/ai/gemini-client";
import {
  createDocumentComment,
  deleteUploadedKnowledgeDocument,
  getStoredKnowledgeDocument,
  listDocumentComments,
  loadWorkspacePolicySettings,
  recordWorkspaceDataAuditEvent,
  rollbackDocumentVersion,
  updateKnowledgeDocument,
  uploadNewDocumentVersion,
  type DocumentCommentKind,
} from "@/server/knowledge/repository";
import { redactSensitiveDlpContent } from "@/server/security/dlp-redactor";
import type { Locale } from "@/lib/preferences";
import {
  authorizeWorkspaceApi,
  resolveRequestId,
  workspaceError,
  workspaceJson,
} from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidDocumentId(documentId: string): boolean {
  return Boolean(documentId && /^[a-zA-Z0-9_-]{3,80}$/.test(documentId));
}

export async function GET(
  request: Request,
  context: Readonly<{ params: Promise<{ documentId: string }> }>,
): Promise<Response> {
  const requestId = resolveRequestId(request);
  const auth = await authorizeWorkspaceApi(request, requestId);
  if (!auth.ok) return auth.response;

  const { documentId } = await context.params;
  if (!isValidDocumentId(documentId)) {
    return workspaceError(400, "INVALID_DOCUMENT_ID", "Invalid document id.", requestId);
  }

  const [record, comments] = await Promise.all([
    getStoredKnowledgeDocument(auth.access, documentId),
    listDocumentComments(auth.access, documentId),
  ]);
  if (!record) {
    return workspaceError(404, "NOT_FOUND", "Document not found.", requestId);
  }

  return workspaceJson(
    {
      ok: true,
      comments,
      document: {
        ...record.summary,
        versions: record.versions,
        byteSize: record.byteSize,
        sections: record.chunks.map((c) => ({
          id: c.chunkId,
          heading: c.heading,
          locator: c.locator,
          content: c.content,
        })),
      },
    },
    200,
    requestId,
  );
}

export async function PATCH(
  request: Request,
  context: Readonly<{ params: Promise<{ documentId: string }> }>,
): Promise<Response> {
  const requestId = resolveRequestId(request);
  const auth = await authorizeWorkspaceApi(request, requestId);
  if (!auth.ok) return auth.response;

  const { documentId } = await context.params;
  if (!isValidDocumentId(documentId)) {
    return workspaceError(400, "INVALID_DOCUMENT_ID", "Invalid document id.", requestId);
  }

  let body: {
    spaceId?: unknown;
    governanceKind?: unknown;
    name?: unknown;
    locale?: unknown;
  };
  try {
    body = (await request.json()) as {
      spaceId?: unknown;
      governanceKind?: unknown;
      name?: unknown;
      locale?: unknown;
    };
  } catch {
    return workspaceError(400, "INVALID_JSON", "Invalid JSON payload.", requestId);
  }

  const locale: Locale = body.locale === "en" ? "en" : "vi";
  const spaceId =
    typeof body.spaceId === "string" && body.spaceId.trim()
      ? body.spaceId.trim()
      : undefined;
  const governanceKind =
    body.governanceKind === "verified" || body.governanceKind === "deprecated"
      ? body.governanceKind
      : undefined;
  const name =
    typeof body.name === "string" && body.name.trim() ? body.name.trim() : undefined;

  if (
    governanceKind === "verified" &&
    auth.access.workspaceRole !== "OWNER" &&
    auth.access.workspaceRole !== "ADMIN"
  ) {
    return workspaceError(
      403,
      "APPROVAL_AUTHORITY_REQUIRED",
      "Theo quy trình phê duyệt 2 bước (Maker-Checker), chỉ Chủ sở hữu (OWNER) hoặc Quản trị viên (ADMIN) mới có quyền xác minh chính thức tài liệu.",
      requestId,
    );
  }

  const updated = await updateKnowledgeDocument(auth.access, documentId, {
    spaceId,
    governanceKind,
    name,
    locale,
  });

  if (!updated) {
    return workspaceError(404, "NOT_FOUND", "Document not found.", requestId);
  }

  void recordWorkspaceDataAuditEvent(
    auth.access,
    "knowledge.document.governance_updated",
    documentId,
    { governanceKind, spaceId, name },
  );

  return workspaceJson({ ok: true, document: updated }, 200, requestId);
}

export async function POST(
  request: Request,
  context: Readonly<{ params: Promise<{ documentId: string }> }>,
): Promise<Response> {
  const requestId = resolveRequestId(request);
  const auth = await authorizeWorkspaceApi(request, requestId);
  if (!auth.ok) return auth.response;

  const { documentId } = await context.params;
  if (!isValidDocumentId(documentId)) {
    return workspaceError(400, "INVALID_DOCUMENT_ID", "Invalid document id.", requestId);
  }

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();

  // Case 1: Multipart upload of a new version (v2.0, v3.0, ...)
  if (contentType.includes("multipart/form-data")) {
    const policy = await loadWorkspacePolicySettings(auth.access);
    if (auth.access.workspaceRole === "MEMBER" && !policy.allowMemberUploads) {
      return workspaceError(
        403,
        "MEMBER_UPLOADS_DISABLED",
        "Quản trị viên hiện giới hạn quyền cập nhật phiên bản tài liệu cho OWNER và ADMIN.",
        requestId,
      );
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return workspaceError(400, "INVALID_MULTIPART", "Invalid multipart payload.", requestId);
    }

    const fileEntry = formData.get("file");
    if (!(fileEntry instanceof File)) {
      return workspaceError(400, "MISSING_FILE", "Form field 'file' is required.", requestId);
    }

    const fileName = fileEntry.name.trim() || "document.txt";
    const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_SERVER_UPLOAD_EXTENSIONS.has(extension)) {
      return workspaceError(
        400,
        "UNSUPPORTED_FILE_TYPE",
        "Only PDF, DOCX, TXT, MD, CSV, and JSON files are supported.",
        requestId,
      );
    }

    const maxAllowedBytes = Math.min(
      Math.max(1, policy.maxUploadMb) * 1024 * 1024,
      100 * 1024 * 1024,
    );
    if (fileEntry.size <= 0 || fileEntry.size > maxAllowedBytes) {
      return workspaceError(
        413,
        "INVALID_FILE_SIZE",
        `Kích thước tệp vượt giới hạn ${policy.maxUploadMb} MB.`,
        requestId,
      );
    }

    const locale: Locale = formData.get("locale") === "en" ? "en" : "vi";
    const versionNote =
      typeof formData.get("note") === "string"
        ? String(formData.get("note")).trim()
        : undefined;

    const bytes = new Uint8Array(await fileEntry.arrayBuffer());
    const rawChunks = await parseUploadedDocumentChunks({
      fileName,
      extension,
      bytes,
      locale,
    });
    const chunks = policy.piiRedactionEnabled
      ? rawChunks.map((c) => ({
          ...c,
          content: redactSensitiveDlpContent(c.content, true).sanitizedText,
        }))
      : rawChunks;

    const embeddings: Array<readonly number[] | null> = readGeminiConfig()
      ? await Promise.all(
          chunks
            .slice(0, 16)
            .map((chunk) =>
              embedTextWithGemini(`${chunk.heading}\n${chunk.content}`),
            ),
        )
      : [];

    const updated = await uploadNewDocumentVersion(auth.access, documentId, {
      fileName,
      extension,
      byteSize: fileEntry.size,
      rawBytes: bytes,
      chunks,
      embeddings,
      versionNote,
      locale,
    });

    if (!updated) {
      return workspaceError(404, "NOT_FOUND", "Document not found.", requestId);
    }

    return workspaceJson({ ok: true, document: updated }, 201, requestId);
  }

  // Case 2: JSON actions (rollback version OR add comment / outdated flag)
  let body: {
    action?: unknown;
    versionId?: unknown;
    commentKind?: unknown;
    chunkId?: unknown;
    body?: unknown;
    locale?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return workspaceError(400, "INVALID_JSON", "Invalid JSON payload.", requestId);
  }

  const locale: Locale = body.locale === "en" ? "en" : "vi";

  if (body.action === "rollback") {
    const versionId =
      typeof body.versionId === "string" ? body.versionId.trim() : "";
    if (!versionId) {
      return workspaceError(400, "MISSING_VERSION", "versionId is required.", requestId);
    }
    const rolledBack = await rollbackDocumentVersion(
      auth.access,
      documentId,
      versionId,
      locale,
    );
    if (!rolledBack) {
      return workspaceError(
        404,
        "VERSION_NOT_FOUND",
        "Không tìm thấy phiên bản cần khôi phục.",
        requestId,
      );
    }
    return workspaceJson({ ok: true, document: rolledBack }, 200, requestId);
  }

  if (body.action === "comment") {
    const text = typeof body.body === "string" ? body.body.trim() : "";
    if (text.length < 2 || text.length > 2_000) {
      return workspaceError(
        400,
        "INVALID_COMMENT",
        "Nội dung bình luận hoặc báo cáo phải từ 2 đến 2.000 ký tự.",
        requestId,
      );
    }
    const commentKind: DocumentCommentKind =
      body.commentKind === "OUTDATED_FLAG" || body.commentKind === "APPROVAL_NOTE"
        ? body.commentKind
        : "COMMENT";
    const chunkId =
      typeof body.chunkId === "string" && body.chunkId.trim()
        ? body.chunkId.trim()
        : null;

    const comment = await createDocumentComment(auth.access, documentId, {
      chunkId,
      commentKind,
      body: text,
    });
    const comments = await listDocumentComments(auth.access, documentId);
    return workspaceJson({ ok: true, comment, comments }, 201, requestId);
  }

  return workspaceError(400, "UNSUPPORTED_ACTION", "Unsupported document action.", requestId);
}

export async function DELETE(
  request: Request,
  context: Readonly<{ params: Promise<{ documentId: string }> }>,
): Promise<Response> {
  const requestId = resolveRequestId(request);
  const auth = await authorizeWorkspaceApi(request, requestId);
  if (!auth.ok) return auth.response;

  const { documentId } = await context.params;
  if (!isValidDocumentId(documentId)) {
    return workspaceError(400, "INVALID_DOCUMENT_ID", "Invalid document id.", requestId);
  }

  const deleted = await deleteUploadedKnowledgeDocument(auth.access, documentId);
  if (!deleted) {
    return workspaceError(
      404,
      "NOT_FOUND",
      "Uploaded document not found or cannot be deleted.",
      requestId,
    );
  }

  return workspaceJson({ ok: true, deletedId: documentId }, 200, requestId);
}
