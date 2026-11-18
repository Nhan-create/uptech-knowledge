import {
  getStoredKnowledgeDocument,
  readUploadedDocumentBinary,
} from "@/server/knowledge/repository";
import {
  authorizeWorkspaceApi,
  resolveRequestId,
  workspaceError,
} from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
};

export async function GET(
  request: Request,
  context: Readonly<{ params: Promise<{ documentId: string }> }>,
): Promise<Response> {
  const requestId = resolveRequestId(request);
  const auth = await authorizeWorkspaceApi(request, requestId);
  if (!auth.ok) return auth.response;

  const { documentId } = await context.params;
  if (!documentId || !/^[a-zA-Z0-9_-]{3,80}$/.test(documentId)) {
    return workspaceError(400, "INVALID_DOCUMENT_ID", "Invalid document id.", requestId);
  }

  const record = await getStoredKnowledgeDocument(auth.access, documentId);
  if (!record) {
    return workspaceError(404, "NOT_FOUND", "Document not found.", requestId);
  }

  const originalBytes = await readUploadedDocumentBinary(documentId);
  const extension =
    record.rawFileExtension ?? record.summary.fileType ?? "txt";
  const safeFileName = record.summary.name.replace(/["\\\r\n]/g, "_");

  if (originalBytes) {
    return new Response(new Uint8Array(originalBytes), {
      status: 200,
      headers: {
        "Content-Type": MIME_BY_EXTENSION[extension] ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeFileName)}`,
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "X-Request-Id": requestId,
      },
    });
  }

  const extractedMarkdown = [
    `# ${record.summary.name}`,
    "",
    ...record.chunks.map(
      (chunk) => `## ${chunk.heading} (${chunk.locator})\n\n${chunk.content}`,
    ),
  ].join("\n\n");

  const fallbackName = safeFileName.endsWith(".md")
    ? safeFileName
    : `${safeFileName}.extracted.md`;

  return new Response(extractedMarkdown, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fallbackName)}`,
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": requestId,
    },
  });
}
