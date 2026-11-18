import {
  deleteUploadedKnowledgeDocument,
  getStoredKnowledgeDocument,
  updateKnowledgeDocument,
} from "@/server/knowledge/repository";
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

  const record = await getStoredKnowledgeDocument(auth.access, documentId);
  if (!record) {
    return workspaceError(404, "NOT_FOUND", "Document not found.", requestId);
  }

  return workspaceJson(
    {
      ok: true,
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

  const updated = await updateKnowledgeDocument(auth.access, documentId, {
    spaceId,
    governanceKind,
    name,
    locale,
  });

  if (!updated) {
    return workspaceError(404, "NOT_FOUND", "Document not found.", requestId);
  }

  return workspaceJson({ ok: true, document: updated }, 200, requestId);
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
