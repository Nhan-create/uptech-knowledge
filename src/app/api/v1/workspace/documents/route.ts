import { randomUUID } from "node:crypto";

import {
  ALLOWED_SERVER_UPLOAD_EXTENSIONS,
  MAX_SERVER_UPLOAD_BYTES,
  parseUploadedDocumentChunks,
} from "@/server/ai/document-parser";
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
      `Kích thước tệp phải nằm trong khoảng 1 byte đến ${policy.maxUploadMb} MB theo thiết lập của tổ chức.`,
      requestId,
    );
  }

  const localeValue = formData.get("locale");
  const locale: Locale = localeValue === "en" ? "en" : "vi";
  const spaceIdValue = formData.get("spaceId");
  const spaceId =
    typeof spaceIdValue === "string" && spaceIdValue.trim().length > 0
      ? spaceIdValue.trim()
      : "space-hr";

  const bytes = new Uint8Array(await fileEntry.arrayBuffer());
  const rawChunks = await parseUploadedDocumentChunks({
    fileName,
    extension,
    bytes,
    locale,
  });
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
    byteSize: fileEntry.size,
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
