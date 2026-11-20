import { randomUUID } from "node:crypto";

import {
  ALLOWED_SERVER_UPLOAD_EXTENSIONS,
  chunkTextPassages,
  parseUploadedDocumentChunks,
} from "@/server/ai/document-parser";
import { MIN_WORKSPACE_UPLOAD_MB } from "@/features/documents/upload-spec";
import { embedTextWithGemini, readGeminiConfig } from "@/server/ai/gemini-client";
import {
  createUploadedKnowledgeDocument,
  loadKnowledgeDocumentsAndSpaces,
  loadWorkspacePolicySettings,
} from "@/server/knowledge/repository";
import { redactSensitiveDlpContent } from "@/server/security/dlp-redactor";
import type { Locale } from "@/lib/preferences";
import {
  authorizeWorkspaceApi,
  resolveRequestId,
  workspaceError,
  workspaceJson,
} from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);
  const auth = await authorizeWorkspaceApi(request, requestId);
  if (!auth.ok) return auth.response;

  const { spaces, documents } = await loadKnowledgeDocumentsAndSpaces(auth.access);
  return workspaceJson(
    {
      ok: true,
      spaces,
      documents: documents.map((d) => ({
        ...d.summary,
        isUserUploaded: d.isUserUploaded,
        chunkCount: d.chunks.length,
      })),
    },
    200,
    requestId,
  );
}

export async function POST(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request);
  const auth = await authorizeWorkspaceApi(request, requestId);
  if (!auth.ok) return auth.response;

  const policy = await loadWorkspacePolicySettings(auth.access);
  if (auth.access.workspaceRole === "MEMBER" && !policy.allowMemberUploads) {
    return workspaceError(
      403,
      "MEMBER_UPLOADS_DISABLED",
      "Quản trị viên tổ chức hiện đang giới hạn quyền tải lên tài liệu chỉ dành cho OWNER và ADMIN.",
      requestId,
    );
  }

  const effectiveMaxMb = Math.max(MIN_WORKSPACE_UPLOAD_MB, policy.maxUploadMb);
  const maxAllowedBytes = effectiveMaxMb * 1024 * 1024;
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();

  let fileName = "document.txt";
  let extension = "";
  let byteSize = 0;
  let bytes: Uint8Array | undefined;
  let locale: Locale = "vi";
  let spaceId = "space-hr";
  let rawChunks;

  if (contentType.includes("application/json")) {
    let body: {
      mode?: unknown;
      fileName?: unknown;
      extension?: unknown;
      byteSize?: unknown;
      spaceId?: unknown;
      locale?: unknown;
      extractedText?: unknown;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return workspaceError(400, "INVALID_JSON", "Invalid JSON upload payload.", requestId);
    }

    fileName =
      typeof body.fileName === "string" && body.fileName.trim()
        ? body.fileName.trim()
        : "document.txt";
    extension =
      (typeof body.extension === "string" && body.extension.trim()
        ? body.extension.trim().toLowerCase()
        : fileName.split(".").pop()?.toLowerCase()) ?? "";
    if (!ALLOWED_SERVER_UPLOAD_EXTENSIONS.has(extension)) {
      return workspaceError(
        400,
        "UNSUPPORTED_FILE_TYPE",
        "Định dạng tệp này chưa được hỗ trợ.",
        requestId,
      );
    }

    byteSize = typeof body.byteSize === "number" ? body.byteSize : 0;
    if (byteSize <= 0 || byteSize > maxAllowedBytes) {
      return workspaceError(
        413,
        "INVALID_FILE_SIZE",
        `Kích thước tệp phải nằm trong khoảng 1 byte đến ${effectiveMaxMb} MB.`,
        requestId,
      );
    }

    locale = body.locale === "en" ? "en" : "vi";
    spaceId =
      typeof body.spaceId === "string" && body.spaceId.trim().length > 0
        ? body.spaceId.trim()
        : "space-hr";
    const extractedText =
      typeof body.extractedText === "string" ? body.extractedText.trim() : "";
    rawChunks = extractedText
      ? chunkTextPassages(extractedText, fileName, locale)
      : [];
  } else {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return workspaceError(
        400,
        "INVALID_MULTIPART",
        "Expected multipart/form-data upload payload.",
        requestId,
      );
    }

    const fileEntry = formData.get("file");
    if (!(fileEntry instanceof File)) {
      return workspaceError(400, "MISSING_FILE", "Form field 'file' is required.", requestId);
    }

    fileName = fileEntry.name.trim() || "document.txt";
    extension = fileName.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_SERVER_UPLOAD_EXTENSIONS.has(extension)) {
      return workspaceError(
        400,
        "UNSUPPORTED_FILE_TYPE",
        "Định dạng tệp này chưa được hỗ trợ.",
        requestId,
      );
    }

    byteSize = fileEntry.size;
    if (byteSize <= 0 || byteSize > maxAllowedBytes) {
      return workspaceError(
        413,
        "INVALID_FILE_SIZE",
        `Kích thước tệp phải nằm trong khoảng 1 byte đến ${effectiveMaxMb} MB.`,
        requestId,
      );
    }

    const localeValue = formData.get("locale");
    locale = localeValue === "en" ? "en" : "vi";
    const spaceIdValue = formData.get("spaceId");
    spaceId =
      typeof spaceIdValue === "string" && spaceIdValue.trim().length > 0
        ? spaceIdValue.trim()
        : "space-hr";

    bytes = new Uint8Array(await fileEntry.arrayBuffer());
    rawChunks = await parseUploadedDocumentChunks({
      fileName,
      extension,
      bytes,
      locale,
    });
  }

  const chunks = policy.piiRedactionEnabled
    ? rawChunks.map((chunk) => ({
        ...chunk,
        content: redactSensitiveDlpContent(chunk.content, true).sanitizedText,
      }))
    : rawChunks;

  const embeddings: Array<readonly number[] | null> = readGeminiConfig()
    ? await Promise.all(
        chunks
          .slice(0, 5)
          .map((chunk) => embedTextWithGemini(`${chunk.heading}\n${chunk.content}`)),
      )
    : [];

  const documentId = `upload-${randomUUID()}`;
  const detail = await createUploadedKnowledgeDocument(auth.access, {
    id: documentId,
    fileName,
    extension,
    byteSize,
    rawBytes: bytes,
    spaceId,
    chunks,
    embeddings,
    locale,
  });

  return workspaceJson(
    {
      ok: true,
      document: detail,
      chunkCount: chunks.length,
    },
    201,
    requestId,
  );
}
